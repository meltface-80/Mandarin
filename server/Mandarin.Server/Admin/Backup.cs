// Backup.cs — Backup & restore (v0.8.22), from lib/backup.js rule for rule.
//
// A backup is one file, mandarin-backup-<date>.tar.gz, holding:
//   manifest.json   what made it, when, and which parts are in it
//   server.json     the server's settings you changed, every player's own
//                   settings, your collection and the API keys, each part if chosen
//   tailscale.json  the server's Tailscale identity, with the keys
//   app.json        the Android app's own settings (from the app only)
//   page.json       one device's screen settings
//   musicd.db       the whole database, if chosen
//
// Written and read exactly as the Node server writes and reads them, so a
// backup made by either restores on the other: the same tar headers, the same
// JSON (JSON.stringify's, one space a level), blobs as { $b64 }. Read as the
// Node server reads one: a file that isn't gzip, or is cut short, is refused
// in zlib's words; each JSON part 64 MB at most; the database copy to a file
// of its own. Restoring the whole database stages it, and the Node server swaps
// it in when it starts again (lib/backup.js swapStaged), today's account,
// sign-ins and Tailscale identity kept.
using System.Globalization;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Admin;

using Js = Mandarin.Server.Tags.Js;

internal static partial class Backup
{
    public const int Format = 1;
    public static readonly string[] Parts = ["settings", "devices", "collection", "keys", "database"];
    public static readonly string[] ServerParts = ["settings", "devices", "collection", "keys"];
    // Settings a person sets, and nothing the server keeps for itself.
    public static readonly string[] SettingsKeys = ["displayEnabled", "displaySeconds", "homeRows", "identify",
        "labelFolderDepth", "labelsEnabled", "mbpack_dir", "music_folders", "radioZones", "replaygain",
        "shareCardReview", "shareReviews", "shareServices", "smartPicksEnabled", "smartPicksHour", "waveformEnabled"];
    public static readonly string[] CollectionKeys = ["userPlaylists", "smartPlaylists"];
    public static readonly string[] CollectionTables = ["favourites", "listen_later", "label_merges", "album_edits", "track_edits", "album_matches"];
    // The Qobuz and Tidal sign-ins travel with the keys: tokens, never a password.
    public static readonly string[] KeyKeys = ["discogsToken", "fanartKey", "lastfmKey", "qobuz", "qobuzSettings", "tidal", "tidalSettings"];
    // Kept from the server being restored, whatever the database brought.
    private static readonly string[] KeepTables = ["account", "devices"];
    private static readonly string[] KeepSettings = ["authSecret", "tailscale"];

    /* An error the page shows, with its HTTP status (400 unless said). */
    public sealed class Refused(string message, int status = 400) : Exception(message)
    {
        public int Status { get; } = status;
    }

    // ------------------------------------------------------------ reading the database

    /* A column as better-sqlite3 gives it to JavaScript: numbers as numbers, blobs as Buffers. */
    private static object? Col(object? v) => v switch
    {
        null or DBNull => null,
        long l => (double)l,
        double d => d,
        string s => s,
        byte[] b => b,
        _ => Convert.ToString(v, CultureInfo.InvariantCulture)
    };

    /* rowOut: a row with its blobs as base64, so it goes into JSON and back. */
    private static JsObj RowOut(SqliteDataReader r)
    {
        var o = new JsObj();
        for (var i = 0; i < r.FieldCount; i++)
        {
            var v = Col(r.IsDBNull(i) ? null : r.GetValue(i));
            if (v is byte[] b) { var x = new JsObj(); x["$b64"] = Convert.ToBase64String(b); o[r.GetName(i)] = x; }
            else o[r.GetName(i)] = v;
        }
        return o;
    }

    private static List<object?> TableRows(SqliteConnection c, string table)
    {
        var rows = new List<object?>();
        try
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = $"SELECT * FROM {table}";
            using var r = cmd.ExecuteReader();
            while (r.Read()) rows.Add(RowOut(r));
        }
        catch (SqliteException) { return []; }
        return rows;
    }

    private static JsObj SettingsOf(SqliteConnection c, string[] keys)
    {
        var o = new JsObj();
        foreach (var k in keys)
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = "SELECT value FROM settings WHERE key = $k";
            cmd.Parameters.AddWithValue("$k", k);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) continue;
            var raw = r.IsDBNull(0) ? "null" : Convert.ToString(r.GetValue(0), CultureInfo.InvariantCulture) ?? "null";
            try { o[k] = JsJson.Parse(raw); } catch (JsError) { /* unreadable: left out */ }
        }
        return o;
    }

    /* snapshot: the server's part of a backup, only the parts asked for. */
    public static JsObj Snapshot(SqliteConnection c, ISet<string> include)
    {
        var s = new JsObj();
        if (include.Contains("settings")) s["settings"] = SettingsOf(c, SettingsKeys);
        if (include.Contains("devices")) s["devices"] = TableRows(c, "audio_devices");
        if (include.Contains("collection"))
        {
            var col = new JsObj();
            col["settings"] = SettingsOf(c, CollectionKeys);
            var tables = new JsObj();
            foreach (var t in CollectionTables) tables[t] = TableRows(c, t);
            col["tables"] = tables;
            s["collection"] = col;
        }
        if (include.Contains("keys")) s["keys"] = SettingsOf(c, KeyKeys);
        return s;
    }

    // ------------------------------------------------------------ applying

    /* rowIn: a row's { $b64 } back to bytes. Object.entries of null throws, as there. */
    private static List<(string Key, object? Value)> RowIn(object? r0)
    {
        if (r0 is null or Undef) throw new Refused("Cannot convert undefined or null to object");
        var o = new List<(string, object?)>();
        if (r0 is JsObj j)
            foreach (var k in j.Keys)
            {
                var v = j[k];
                o.Add((k, v is JsObj b && b["$b64"] is string s ? Convert.FromBase64String(s) : v));
            }
        else if (r0 is string str) for (var i = 0; i < str.Length; i++) o.Add((i.ToString(CultureInfo.InvariantCulture), str[i].ToString()));
        else if (r0 is List<object?> l) for (var i = 0; i < l.Count; i++) o.Add((i.ToString(CultureInfo.InvariantCulture), l[i]));
        return o;
    }

    /* A value bound as better-sqlite3 binds it: numbers as doubles; true, false and objects refused. */
    private static object Bind(object? v) => v switch
    {
        null or Undef => DBNull.Value,
        double d => d,
        string s => s,
        byte[] b => b,
        _ => throw new Refused("SQLite3 can only bind numbers, strings, bigints, buffers, and null")
    };

    private static List<string> ColumnsOf(SqliteConnection c, string table)
    {
        var cols = new List<string>();
        try
        {
            using var cmd = c.CreateCommand();
            cmd.CommandText = $"PRAGMA table_info({table})";
            using var r = cmd.ExecuteReader();
            while (r.Read()) cols.Add(r.GetString(1));
        }
        catch (SqliteException) { return []; }
        return cols;
    }

    private static int Run(SqliteConnection c, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        return cmd.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection c, string sql, params object?[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), Bind(args[i]));
        return cmd.ExecuteScalar();
    }

    private static string Placeholders(int n) => string.Join(",", Enumerable.Range(1, n).Select(i => "$" + i));

    /* The rows of a table in a backup, as JavaScript would walk them: a list's items, a string's characters, else not iterable. */
    private static IEnumerable<object?> Iterate(object? rows) => rows switch
    {
        null or Undef => [],
        List<object?> l => l,
        string s => s.Select(ch => (object?)ch.ToString()),
        _ when !Js.Truthy(rows) => [],
        _ => throw new Refused("rows is not iterable")
    };

    private static int ReplaceTable(SqliteConnection c, string table, object? rows)
    {
        var cols = ColumnsOf(c, table);
        if (cols.Count == 0) return 0;
        Run(c, $"DELETE FROM {table}");
        var n = 0;
        foreach (var r0 in Iterate(rows))
        {
            var r = RowIn(r0);
            var have = r.Select(x => x.Key).ToHashSet();
            var use = cols.Where(have.Contains).ToList();
            if (use.Count == 0) continue;
            var values = use.Select(u => r.Last(x => x.Key == u).Value).ToArray();
            Run(c, $"INSERT OR REPLACE INTO {table}({string.Join(",", use)}) VALUES({Placeholders(use.Count)})", values);
            n++;
        }
        return n;
    }

    private static object? SwapId(object? id, IReadOnlyDictionary<string, string>? map) =>
        map != null && id is not null and not Undef && map.TryGetValue(Js.Str(id), out var to) && to.Length > 0 ? to : id;

    /*
     * apply: the server's part of a backup, applied, in one transaction.
     * `map` swaps a player id for another (this phone's, after the app was
     * reinstalled). Settings the backup doesn't hold go back to their defaults.
     */
    public static List<string> Apply(SqliteConnection c, JsObj server, ISet<string> include, IReadOnlyDictionary<string, string>? map)
    {
        var done = new List<string>();
        void PutAll(string[] keys, object? values)
        {
            foreach (var k in keys)
            {
                if (values is JsObj vo && vo.Has(k))
                {
                    var v = vo[k];
                    if (k == "radioZones" && v is List<object?> zones) v = zones.Select(id => SwapId(id, map)).ToList();
                    Run(c, "INSERT INTO settings(key, value) VALUES($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, Js.Json(v));
                }
                else Run(c, "DELETE FROM settings WHERE key = $1", k);
            }
        }
        using var tx = c.BeginTransaction(System.Data.IsolationLevel.Serializable, deferred: false);
        if (include.Contains("settings") && Js.Truthy(server["settings"])) { PutAll(SettingsKeys, server["settings"]); done.Add("settings"); }
        if (include.Contains("devices") && server["devices"] is List<object?> devices)
        {
            var cols = ColumnsOf(c, "audio_devices");
            foreach (var r0 in devices)
            {
                var r = RowIn(r0);
                object? Get(string k) { for (var i = r.Count - 1; i >= 0; i--) if (r[i].Key == k) return r[i].Value; return Undef.V; }
                var id = SwapId(Get("id"), map);
                if (r.FindIndex(x => x.Key == "id") is var at && at >= 0) r[at] = ("id", id); else r.Add(("id", id));
                var have = Scalar(c, "SELECT id FROM audio_devices WHERE id = $1", id) != null;
                if (have) Run(c, "UPDATE audio_devices SET name = $1, settings = $2 WHERE id = $3",
                    Js.Truthy(Get("name")) ? Get("name") : null, Js.Truthy(Get("settings")) ? Get("settings") : "{}", id);
                else
                {
                    var keys = r.Select(x => x.Key).ToHashSet();
                    var use = cols.Where(keys.Contains).ToList();
                    Run(c, $"INSERT INTO audio_devices({string.Join(",", use)}) VALUES({Placeholders(use.Count)})", use.Select(Get).ToArray());
                }
            }
            done.Add("devices");
        }
        if (include.Contains("collection") && server["collection"] is var col && Js.Truthy(col))
        {
            var cs = col is JsObj co ? co["settings"] : Undef.V;
            PutAll(CollectionKeys, Js.Truthy(cs) ? cs : new JsObj());
            var tables = col is JsObj co2 && Js.Truthy(co2["tables"]) ? co2["tables"] : new JsObj();
            foreach (var t in CollectionTables)
            {
                var rows = tables is JsObj to ? to[t] : Undef.V;
                ReplaceTable(c, t, Js.Truthy(rows) ? rows : new List<object?>());
            }
            done.Add("collection");
        }
        if (include.Contains("keys") && Js.Truthy(server["keys"])) { PutAll(KeyKeys, server["keys"]); done.Add("keys"); }
        tx.Commit();
        return done;
    }

    // ------------------------------------------------------------ tar.gz

    private static byte[] TarHeader(string name, long size, long mtimeMs)
    {
        var h = new byte[512];
        void Put(string s, int at) { var b = Encoding.UTF8.GetBytes(s); Array.Copy(b, 0, h, at, Math.Min(b.Length, 512 - at)); }
        Put(name.Length > 99 ? name[..99] : name, 0);
        Put("0000644\0", 100); Put("0000000\0", 108); Put("0000000\0", 116);
        Put(Convert.ToString(size, 8).PadLeft(11, '0') + "\0", 124);
        Put(Convert.ToString(mtimeMs / 1000, 8).PadLeft(11, '0') + "\0", 136);
        Put("        ", 148);
        Put("0", 156);
        Put("ustar\0", 257); Put("00", 263);
        var sum = 0;
        foreach (var b in h) sum += b;
        Put(Convert.ToString(sum, 8).PadLeft(6, '0') + "\0 ", 148);
        return h;
    }
    private static byte[] Pad(long n) => new byte[(512 - (int)(n % 512)) % 512];

    /* An entry: JSON text (JSON.stringify(v, null, 1)), or a file read from disk (the database copy). */
    public sealed record Entry(string Name, byte[]? Data = null, string? File = null);
    public static Entry JsonEntry(string name, object? value) => new(name, Encoding.UTF8.GetBytes(Pretty(value)));

    /* writeBackup: the entries as a tar, gzipped. */
    public static async Task WriteBackup(Stream output, IEnumerable<Entry> entries)
    {
        await using var gz = new GZipStream(output, new ZLibCompressionOptions { CompressionLevel = 6 }, leaveOpen: true);
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var e in entries)
        {
            if (e.File != null)
            {
                var size = new FileInfo(e.File).Length;
                await gz.WriteAsync(TarHeader(e.Name, size, now));
                await using (var f = File.OpenRead(e.File)) await f.CopyToAsync(gz);
                await gz.WriteAsync(Pad(size));
            }
            else
            {
                var data = e.Data ?? [];
                await gz.WriteAsync(TarHeader(e.Name, data.Length, now));
                await gz.WriteAsync(data);
                await gz.WriteAsync(Pad(data.Length));
            }
        }
        await gz.WriteAsync(new byte[1024]);
    }

    /* JSON.stringify(v, null, 1). */
    public static string Pretty(object? v)
    {
        var sb = new StringBuilder();
        if (!WritePretty(sb, v, "")) return "undefined";
        return sb.ToString();
    }
    private static bool WritePretty(StringBuilder sb, object? v, string indent)
    {
        switch (v)
        {
            case JsObj o:
            {
                var inner = indent + " ";
                var first = true;
                var mark = sb.Length;
                sb.Append('{');
                foreach (var k in o.Keys)
                {
                    var x = o[k];
                    if (x is Undef) continue;
                    var at = sb.Length;
                    sb.Append(first ? "\n" : ",\n").Append(inner);
                    Js.Quote(sb, k);
                    sb.Append(": ");
                    if (!WritePretty(sb, x, inner)) { sb.Length = at; continue; }
                    first = false;
                }
                if (first) { sb.Length = mark; sb.Append("{}"); return true; }
                sb.Append('\n').Append(indent).Append('}');
                return true;
            }
            case List<object?> l:
            {
                if (l.Count == 0) { sb.Append("[]"); return true; }
                var inner = indent + " ";
                sb.Append('[');
                for (var i = 0; i < l.Count; i++)
                {
                    sb.Append(i == 0 ? "\n" : ",\n").Append(inner);
                    if (!WritePretty(sb, l[i], inner)) sb.Append("null");
                }
                sb.Append('\n').Append(indent).Append(']');
                return true;
            }
            default:
            {
                var s = Js.Json(v);
                if (s == null) return false;
                sb.Append(s);
                return true;
            }
        }
    }

    public sealed record Read(JsObj Parts, bool HasDb);

    /* A stream of what's inflated, its CRC-32 and length kept for the trailer's check. */
    private sealed class Checked(Stream inner) : Stream
    {
        public uint Crc = 0xffffffffu;
        public long Length0;
        public override int Read(byte[] buffer, int offset, int count) => Read(buffer.AsSpan(offset, count));
        public override int Read(Span<byte> buffer)
        {
            var n = inner.Read(buffer);
            for (var i = 0; i < n; i++) Crc = CrcTable[(Crc ^ buffer[i]) & 0xff] ^ (Crc >> 8);
            Length0 += n;
            return n;
        }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }
    private static readonly uint[] CrcTable = Enumerable.Range(0, 256).Select(n =>
    {
        var c = (uint)n;
        for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        return c;
    }).ToArray();

    /* The gzip around a backup as zlib takes it: the header's own words, and a member read to its trailer (trailing zero bytes allowed). */
    private static void CheckHead(FileStream f)
    {
        var head = new byte[4];
        var n = f.Read(head, 0, 4);
        f.Position = 0;
        if (n < 2) throw new Refused("unexpected end of file");
        if (head[0] != 0x1f || head[1] != 0x8b) throw new Refused("incorrect header check");
        if (n < 4) throw new Refused("unexpected end of file");
        if (head[2] != 8) throw new Refused("unknown compression method");
        if ((head[3] & 0xe0) != 0) throw new Refused("unknown header flags set");
    }
    private static void CheckTrailer(FileStream f, uint crc, long length)
    {
        var want = new byte[8];
        BitConverter.TryWriteBytes(want.AsSpan(0, 4), crc);
        BitConverter.TryWriteBytes(want.AsSpan(4, 4), (uint)(length & 0xffffffff));
        if (!BitConverter.IsLittleEndian) { Array.Reverse(want, 0, 4); Array.Reverse(want, 4, 4); }
        var end = f.Length;
        var back = (int)Math.Min(end, 65536 + 8);
        var tail = new byte[back];
        f.Position = end - back;
        f.ReadExactly(tail);
        // Where the member ends: its trailer. After it, zlib takes the end or a
        // zero byte (padding) as the end; anything else must be another member.
        for (var at = back - 8; at >= 0; at--)
        {
            if (!tail.AsSpan(at, 8).SequenceEqual(want)) continue;
            var after = back - (at + 8);
            if (after == 0 || tail[at + 8] == 0) return;
            if (after >= 2 && (tail[at + 8] != 0x1f || tail[at + 9] != 0x8b)) throw new Refused("incorrect header check");
            throw new Refused("unexpected end of file");
        }
        throw new Refused("unexpected end of file");
    }

    /*
     * readBackup: the JSON parts into memory (each at most 64 MB), the
     * database copy to dbFile when there is one.
     */
    public static Read ReadBackup(string file, string? dbFile)
    {
        const long JsonMax = 64L * 1024 * 1024;
        var parts = new JsObj();
        var hasDb = false;
        using var f = File.OpenRead(file);
        CheckHead(f);
        Checked inflated;
        Exception? failed = null;
        using (var gz = new GZipStream(f, CompressionMode.Decompress, leaveOpen: true))
        {
            inflated = new Checked(gz);
            try
            {
                var h = new byte[512];
                while (true)
                {
                    if (!Fill(inflated, h)) break;
                    if (h.All(b => b == 0)) break;
                    var nul = Array.IndexOf(h, (byte)0, 0, 100);
                    var name = Encoding.UTF8.GetString(h, 0, nul < 0 ? 100 : nul);
                    var sizeText = Encoding.UTF8.GetString(h, 124, 12);
                    var cut = sizeText.IndexOf('\0');
                    var size = ParseOctal(Js.Trim(cut < 0 ? sizeText : sizeText[..cut]) is { Length: > 0 } st ? st : "0");
                    var isDb = name == "musicd.db";
                    var isJson = !isDb && JsonPart().IsMatch(name);
                    if (isDb && dbFile == null) throw new Refused("A database copy wasn't expected here");
                    if (isJson && size > JsonMax) throw new Refused("The backup's " + name + " is too large");
                    if (double.IsNaN(size) || size == 0)
                    {
                        // Nothing in it: as written, an empty part.
                        if (isDb) { File.WriteAllBytes(dbFile!, []); hasDb = true; }
                        else if (isJson) Part(parts, name, []);
                        continue;
                    }
                    var left = (long)size;
                    if (isDb)
                    {
                        using (var w = File.Create(dbFile!)) if (!Copy(inflated, w, left)) throw new CutShort();
                        hasDb = true;
                    }
                    else if (isJson)
                    {
                        var buf = new byte[left];
                        if (!Fill(inflated, buf)) throw new CutShort();
                        Part(parts, name, buf);
                    }
                    else if (!Copy(inflated, Stream.Null, left)) throw new CutShort();
                    if (!Copy(inflated, Stream.Null, (512 - left % 512) % 512)) break;
                }
                // The rest, inflated to the member's end (its checksum read there).
                inflated.CopyTo(Stream.Null);
            }
            catch (CutShort e) { failed = e; inflated.CopyTo(Stream.Null); }
            catch (InvalidDataException) { throw new Refused("incorrect data check"); }
        }
        CheckTrailer(f, ~inflated.Crc, inflated.Length0);
        if (failed != null) throw new Refused("The backup file is cut short");
        if (parts["manifest"] is not JsObj m || !Js.StrictEq(m["app"], "mandarin")) throw new Refused("That isn't a Mandarin backup");
        return new Read(parts, hasDb);
    }

    private sealed class CutShort : Exception;

    [GeneratedRegexAttribute("^[a-z]+\\.json\\z")] private static partial Regex JsonPartRx();
    private static Regex JsonPart() => JsonPartRx();

    private static void Part(JsObj parts, string name, byte[] bytes)
    {
        try { parts[name[..^5]] = JsJson.Parse(Encoding.UTF8.GetString(bytes)); }
        catch (JsError) { throw new Refused("The backup's " + name + " is unreadable"); }
    }

    /* parseInt(s, 8) */
    private static double ParseOctal(string s)
    {
        var i = 0;
        var neg = false;
        if (i < s.Length && (s[i] == '+' || s[i] == '-')) { neg = s[i] == '-'; i++; }
        var start = i;
        double v = 0;
        while (i < s.Length && s[i] >= '0' && s[i] <= '7') v = v * 8 + (s[i++] - '0');
        if (i == start) return double.NaN;
        return neg ? -v : v;
    }

    private static bool Fill(Stream s, byte[] buf)
    {
        var got = 0;
        while (got < buf.Length) { var n = s.Read(buf, got, buf.Length - got); if (n == 0) return false; got += n; }
        return true;
    }
    private static bool Copy(Stream s, Stream to, long count)
    {
        var buf = new byte[81920];
        while (count > 0)
        {
            var n = s.Read(buf, 0, (int)Math.Min(buf.Length, count));
            if (n == 0) return false;
            to.Write(buf, 0, n);
            count -= n;
        }
        return true;
    }

    // ------------------------------------------------------------ the whole database

    private static string SqliteMessage(SqliteException e)
    {
        var m = Regex.Match(e.Message, "^SQLite Error \\d+: '(.*)'\\.$", RegexOptions.Singleline);
        return m.Success ? m.Groups[1].Value : e.Message;
    }

    /* copyDatabase: a consistent copy of the open database. */
    public static void CopyDatabase(string to)
    {
        using var src = Db.Open();
        using var dst = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = to, Pooling = false }.ToString());
        dst.Open();
        src.BackupDatabase(dst);
    }

    /* checkDatabase: does `file` look like a Mandarin database? */
    public static void CheckDatabase(string file)
    {
        try
        {
            if (!File.Exists(file)) throw new Refused("unable to open database file");
            using var d = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = file, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
            d.Open();
            using var cmd = d.CreateCommand();
            cmd.CommandText = "SELECT name FROM sqlite_master WHERE type = 'table'";
            var names = new HashSet<string>();
            using (var r = cmd.ExecuteReader()) while (r.Read()) names.Add(r.GetString(0));
            foreach (var t in new[] { "albums", "tracks", "settings" }) if (!names.Contains(t)) throw new Refused("missing " + t);
        }
        catch (Exception e) when (e is SqliteException or Refused)
        {
            var why = e is SqliteException se ? SqliteMessage(se) : e.Message;
            throw new Refused("The database in that backup isn't a Mandarin database (" + why + ")");
        }
    }

    /*
     * stageDatabase: `file` (a database from a backup) readied to replace the
     * open one at the next start: today's account, signed-in devices and
     * Tailscale identity copied in, this phone under its id of today.
     */
    public static string StageDatabase(string file, string currentFile, string dataDir, IReadOnlyDictionary<string, string>? map)
    {
        CheckDatabase(file);
        try
        {
            using (var d = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = file, Pooling = false }.ToString()))
            {
                d.Open();
                using (var att = d.CreateCommand())
                {
                    att.CommandText = "ATTACH DATABASE $f AS cur";
                    att.Parameters.AddWithValue("$f", currentFile);
                    att.ExecuteNonQuery();
                }
                using (var tx = d.BeginTransaction(System.Data.IsolationLevel.Serializable, deferred: false))
                {
                    List<string> Cols(string schema, string t)
                    {
                        using var cmd = d.CreateCommand();
                        cmd.CommandText = $"PRAGMA {schema}.table_info({t})";
                        var l = new List<string>();
                        using var r = cmd.ExecuteReader();
                        while (r.Read()) l.Add(r.GetString(1));
                        return l;
                    }
                    foreach (var t in KeepTables)
                    {
                        var have = Cols("cur", t).ToHashSet();
                        var use = Cols("main", t).Where(have.Contains).ToList();
                        if (use.Count == 0) continue;
                        Run(d, $"DELETE FROM main.{t}");
                        Run(d, $"INSERT INTO main.{t}({string.Join(",", use)}) SELECT {string.Join(",", use)} FROM cur.{t}");
                    }
                    foreach (var k in KeepSettings)
                    {
                        Run(d, "DELETE FROM main.settings WHERE key = $1", k);
                        Run(d, "INSERT INTO main.settings(key, value) SELECT key, value FROM cur.settings WHERE key = $1", k);
                    }
                    foreach (var (from, to) in map ?? new Dictionary<string, string>())
                    {
                        if (Scalar(d, "SELECT 1 FROM main.audio_devices WHERE id = $1", from) == null) continue;
                        Run(d, "DELETE FROM main.audio_devices WHERE id = $1", to);
                        Run(d, "UPDATE main.audio_devices SET id = $1 WHERE id = $2", to, from);
                    }
                    if (map != null && Scalar(d, "SELECT value FROM main.settings WHERE key = 'radioZones'") is string rz)
                    {
                        try
                        {
                            if (JsJson.Parse(rz) is List<object?> zones)
                                Run(d, "UPDATE main.settings SET value = $1 WHERE key = 'radioZones'", Js.Json(zones.Select(id => SwapId(id, map)).ToList()));
                        }
                        catch (JsError) { /* left as it is */ }
                    }
                    tx.Commit();
                }
                Run(d, "DETACH DATABASE cur");
                using (var j = d.CreateCommand()) { j.CommandText = "PRAGMA journal_mode = DELETE"; j.ExecuteScalar(); }
            }
        }
        catch (SqliteException e) { throw new Refused(SqliteMessage(e)); }
        var staged = Path.Combine(dataDir, "restore-staged.db");
        File.Move(file, staged, overwrite: true);
        return staged;
    }

    // ------------------------------------------------------------ the album edits' copy

    /* exportEdits: the album edits written to album-edits.json beside the database (lib/library/db.js). */
    public static void ExportEdits(SqliteConnection c, string dataDir)
    {
        var rows = new List<object?>();
        using (var cmd = c.CreateCommand())
        {
            cmd.CommandText = "SELECT * FROM album_edits";
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                var o = new JsObj();
                for (var i = 0; i < r.FieldCount; i++)
                {
                    var v = Col(r.IsDBNull(i) ? null : r.GetValue(i));
                    o[r.GetName(i)] = r.GetName(i) == "art" ? (v is byte[] b ? Convert.ToBase64String(b) : v is string s && s.Length > 0 ? Convert.ToBase64String(Encoding.UTF8.GetBytes(s)) : null)
                        : v is byte[] other ? BlobAsBuffer(other) : v;
                }
                rows.Add(o);
            }
        }
        var doc = new JsObj();
        doc["version"] = 1.0;
        doc["saved_at"] = (double)DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        doc["edits"] = rows;
        var file = Path.Combine(dataDir, "album-edits.json");
        File.WriteAllText(file + ".tmp", Js.Json(doc));
        File.Move(file + ".tmp", file, overwrite: true);
    }
    /* A Buffer as JSON.stringify writes it. */
    private static JsObj BlobAsBuffer(byte[] b)
    {
        var o = new JsObj();
        o["type"] = "Buffer";
        o["data"] = b.Select(x => (object?)(double)x).ToList();
        return o;
    }

    // ------------------------------------------------------------ kept on the server

    /* stamp: the local date and time as a file name's part. */
    public static string Stamp(DateTime? at = null) => (at ?? DateTime.Now).ToString("yyyy-MM-dd-HHmmss", CultureInfo.InvariantCulture);

    /* "0.6.14" > "0.6.9", RC builds below their release. */
    public static bool Newer(object? a, object? b)
    {
        static List<object> P(object? v) => Regex.Split(Js.Str(Js.Truthy(v) ? v : "0"), "[.-]")
            .Select(x => DigitsOnly().IsMatch(x) ? (object)double.Parse(x, CultureInfo.InvariantCulture) : x).ToList();
        var x = P(a);
        var y = P(b);
        for (var i = 0; i < Math.Max(x.Count, y.Count); i++)
        {
            object? m = i < x.Count ? x[i] : null, n = i < y.Count ? y[i] : null;
            if (m == null) return n is string;
            if (n == null) return m is not string;
            if (m is double dm && n is double dn) { if (dm == dn) continue; return dm > dn; }
            if (m is string sm && n is string sn && sm == sn) continue;
            return m is double;
        }
        return false;
    }
    [GeneratedRegexAttribute("^[0-9]+\\z")] private static partial Regex DigitsOnlyRx();
    private static Regex DigitsOnly() => DigitsOnlyRx();

    /* partsOf: the request's parts, { settings: true, … }, from a list, an object or a query string. */
    public static Dictionary<string, bool> PartsOf(object? x)
    {
        var out_ = new Dictionary<string, bool>();
        var order = new List<string>();
        void Set(string k, bool v) { if (!out_.ContainsKey(k)) order.Add(k); out_[k] = v; }
        if (x is string s) x = s.Split(',').Select(p => (object?)p).ToList();
        if (x is List<object?> l) foreach (var p in l) Set(Js.Trim(Js.Str(p)), true);
        else if (x is JsObj o) foreach (var k in o.Keys) Set(k, Js.Truthy(o[k]));
        foreach (var k in order) if (!Parts.Contains(k) && k != "app" && k != "page") out_.Remove(k);
        return out_;
    }

    public sealed class Store(string dataDir)
    {
        private const int KeepManual = 10, KeepAuto = 5;
        public readonly string Dir = Path.Combine(dataDir, "backups");

        public List<JsObj> List()
        {
            string[] names;
            // In name order, as Node's readdir gives them (libuv sorts): ties keep it.
            try { names = Directory.GetFiles(Dir).Select(Path.GetFileName).OfType<string>().Where(n => RecordName().IsMatch(n)).OrderBy(n => n, StringComparer.Ordinal).ToArray(); }
            catch (IOException) { return []; }
            catch (UnauthorizedAccessException) { return []; }
            var list = new List<JsObj>();
            foreach (var n in names)
            {
                try { if (JsJson.Parse(System.IO.File.ReadAllText(Path.Combine(Dir, n))) is JsObj o) list.Add(o); }
                catch (Exception e) when (e is JsError or IOException) { /* unreadable: left out */ }
            }
            return Library.Sorted(list, (a, b) =>
            {
                var d = Js.ToNumber(b["created"]) - Js.ToNumber(a["created"]);
                return double.IsNaN(d) || d == 0 ? 0 : d < 0 ? -1 : 1;
            });
        }
        public string? File(string id)
        {
            if (!IdRx().IsMatch(id)) return null;
            var f = Path.Combine(Dir, id + ".tar.gz");
            return System.IO.File.Exists(f) ? f : null;
        }
        public string NewId(string kind) => $"{kind}-{Stamp()}-{Convert.ToHexString(RandomNumberGenerator.GetBytes(3)).ToLowerInvariant()}";
        public string PathFor(string id) { Directory.CreateDirectory(Dir); return Path.Combine(Dir, id + ".tar.gz"); }
        public JsObj Record(JsObj meta)
        {
            System.IO.File.WriteAllText(Path.Combine(Dir, Js.Str(meta["id"]) + ".json"), Pretty(meta));
            Prune(Js.Str(meta["kind"]));
            return meta;
        }
        public bool Remove(string id)
        {
            if (!IdRx().IsMatch(id)) return false;
            var gone = false;
            foreach (var ext in new[] { ".tar.gz", ".json" })
            {
                var f = Path.Combine(Dir, id + ext);
                if (System.IO.File.Exists(f)) { System.IO.File.Delete(f); gone = true; }
            }
            return gone;
        }
        private void Prune(string kind)
        {
            var keep = kind == "auto" ? KeepAuto : KeepManual;
            foreach (var m in List().Where(m => Js.StrictEq(m["kind"], kind)).Skip(keep)) Remove(Js.Str(m["id"]));
        }
    }
    [GeneratedRegexAttribute("^[a-z0-9-]+\\.json\\z")] private static partial Regex RecordNameRx();
    private static Regex RecordName() => RecordNameRx();
    [GeneratedRegexAttribute("^[a-z0-9-]+\\z")] private static partial Regex IdRxRx();
    private static Regex IdRx() => IdRxRx();
}
