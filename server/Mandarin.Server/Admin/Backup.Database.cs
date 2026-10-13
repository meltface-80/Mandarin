// Backup.Database.cs — the whole database and the album edits' copy in a
// backup, and the backups kept on the server (v0.8.22; out of Backup.cs in
// v0.9.2).
using System.Globalization;
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
