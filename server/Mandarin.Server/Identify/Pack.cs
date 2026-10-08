// Pack.cs — the MusicBrainz pack (v0.8.19): lib/identify/mbpack.js, rule for
// rule. Every release with a barcode, with its tracks, kept on this machine
// (tools/mbpack/build.js makes it from MusicBrainz's data dump). The scan asks
// it first; what it doesn't have, musicbrainz.org is still asked.
//
// PackStore is the pack in the data folder (Settings → Library Scanner →
// MusicBrainz pack): downloaded on request, checked against its published
// SHA-256, and kept up to date — once a day the server asks whether a newer
// one is out and fetches it. Removed, the scan asks musicbrainz.org for all.
using System.Globalization;
using System.IO.Compression;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal sealed partial class MbPack
{
    public const int Format = 1;
    public readonly string File;
    private readonly SqliteConnection db;
    private readonly object gate = new();
    private bool closed;
    private readonly Dictionary<string, object?> meta = new(StringComparer.Ordinal);

    private MbPack(SqliteConnection db, string file)
    {
        this.db = db;
        File = file;
        foreach (var r in Query("SELECT key, value FROM meta")) meta[Js.Str(r[0])] = r[1];
    }

    /* pack.meta.<key>: undefined when there's no such row. */
    public object? Meta(string key) => meta.TryGetValue(key, out var v) ? v : Undef.V;

    /* The pack in this file, or null: none there, or not one this version reads. */
    public static MbPack? Open(string? file, Action<string>? log = null)
    {
        log ??= _ => { };
        if (string.IsNullOrEmpty(file) || !Path.Exists(file)) return null;
        SqliteConnection? c = null;
        try
        {
            c = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = file, Mode = SqliteOpenMode.ReadOnly, Pooling = false }.ToString());
            c.Open();
            var pack = new MbPack(c, file);
            if (Js.ToNumber(pack.Meta("format")) != Format)
            {
                c.Dispose();
                log($"MusicBrainz pack: format {Js.Str(pack.Meta("format"))}, not {Format}; not used");
                return null;
            }
            return pack;
        }
        catch (Exception e)
        {
            c?.Dispose();
            log("MusicBrainz pack: can't be read (" + e.Message + ")");
            return null;
        }
    }

    /* A row's values as JavaScript has them from better-sqlite3: numbers as numbers, text, bytes, null. */
    private List<object?[]> Query(string sql, params object[] args)
    {
        lock (gate)
        {
            if (closed) return [];
            using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            for (var i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), args[i]);
            using var r = cmd.ExecuteReader();
            var rows = new List<object?[]>();
            while (r.Read())
            {
                var row = new object?[r.FieldCount];
                for (var i = 0; i < r.FieldCount; i++) row[i] = Value(r.IsDBNull(i) ? null : r.GetValue(i));
                rows.Add(row);
            }
            return rows;
        }
    }
    private static object? Value(object? v) => v switch { long l => (double)l, int n => (double)n, _ => v };

    public JsObj Info()
    {
        var o = new JsObj();
        o["file"] = File;
        o["built"] = Js.Truthy(Meta("built")) ? Meta("built") : null;
        o["dump"] = Js.Truthy(Meta("dump")) ? Meta("dump") : null;
        var n = Js.ToNumber(Meta("releases"));
        o["releases"] = double.IsNaN(n) || n == 0 ? 0.0 : n;
        double size;
        try { size = new FileInfo(File).Length; } catch (Exception) { size = 0; }
        o["size"] = size;
        return o;
    }

    [GeneratedRegex("^0+")] private static partial Regex LeadingZeros();

    /* codeOf: the barcode's digits without its leading zeros, or null. */
    public static string? CodeOf(object? barcode)
    {
        var digits = new string((Js.Truthy(barcode) ? Js.Str(barcode) : "").Where(char.IsAsciiDigit).ToArray());
        var c = LeadingZeros().Replace(digits, "", 1);
        return c.Length > 0 ? c : null;
    }

    [GeneratedRegex("^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}\\z")]
    private static partial Regex GidShape();

    public static byte[]? GidBlob(object? g)
    {
        var s = Js.Truthy(g) ? Js.Str(g) : "";
        return GidShape().IsMatch(s) ? Convert.FromHexString(s.Replace("-", "")) : null;
    }

    public static object? GidText(object? b)
    {
        if (!Js.Truthy(b)) return null;
        var bytes = b switch { byte[] x => x, string s => Encoding.UTF8.GetBytes(s), _ => Encoding.UTF8.GetBytes(Js.Str(b)) };
        var h = Convert.ToHexString(bytes).ToLowerInvariant();
        string Part(int from, int to) => from >= h.Length ? "" : h[from..Math.Min(to, h.Length)];
        return $"{Part(0, 8)}-{Part(8, 12)}-{Part(12, 16)}-{Part(16, 20)}-{(h.Length > 20 ? h[20..] : "")}";
    }

    private static string Pad(double v, int n) => Js.Num(v).PadLeft(n, '0');

    public static object? DateText(object? n0)
    {
        if (!Js.Truthy(n0)) return null;
        var n = Js.ToNumber(n0);
        var y = Math.Floor(n / 10000);
        var m = Math.Floor(n / 100) % 100;
        var d = n % 100;
        if (m != 0 && !double.IsNaN(m)) return d != 0 && !double.IsNaN(d) ? $"{Js.Num(y)}-{Pad(m, 2)}-{Pad(d, 2)}" : $"{Js.Num(y)}-{Pad(m, 2)}";
        return Pad(y, 4);
    }

    private static object? YearOf(object? n) => Js.Truthy(n) ? Math.Floor(Js.ToNumber(n) / 10000) : null;

    private static object? Or(object? v, object? d) => Js.Truthy(v) ? v : d;

    /* JSON.parse(text || "[]").length */
    private static object? Length(object? json)
    {
        var v = JsJson.Parse(Js.Truthy(json) ? Js.Str(json) : "[]");
        return v switch { List<object?> l => (double)l.Count, string s => (double)s.Length, _ => Undef.V };
    }

    /* Releases with this barcode, as MusicBrainz.ByBarcode gives them; a leading 0 is no part of it here. */
    public List<JsObj> ByBarcode(object? code)
    {
        var c = CodeOf(code);
        if (c == null) return [];
        return Query("SELECT r.id, r.gid, r.title, r.artist, r.tracks FROM releases r WHERE r.code = $1", c).Select(r =>
        {
            var o = new JsObj();
            o["mbid"] = GidText(r[1]);
            o["title"] = Or(r[2], "");
            o["artist"] = Or(r[3], "");
            o["track_count"] = Length(r[4]);
            o["score"] = 100.0;
            return o;
        }).ToList();
    }

    /* Whether any release carries this barcode (either form). */
    public bool Has(object? code)
    {
        var c = CodeOf(code);
        return c != null && Query("SELECT 1 FROM releases WHERE code = $1 LIMIT 1", c).Count > 0;
    }

    /* SameValueZero, for new Set(…).size. */
    private static string SetKey(object? v) => v switch
    {
        null => "null",
        Undef => "undefined",
        double d => double.IsNaN(d) ? "NaN" : "n" + (d == 0 ? 0 : d).ToString("R", CultureInfo.InvariantCulture),
        string s => "s" + s,
        bool b => b ? "true" : "false",
        _ => "o" + System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(v)
    };

    /* One release in full, as MusicBrainz.CandidateOf makes it; null when the pack doesn't have it. */
    public JsObj? Release(object? mbid)
    {
        var b = GidBlob(mbid);
        if (b == null) return null;
        const string sql = @"SELECT r.gid, r.title, r.artist, r.note, r.date, r.country, r.tracks,
                                    g.gid AS g_gid, g.title AS g_title, g.note AS g_note, g.type AS g_type, g.first AS g_first
                               FROM releases r LEFT JOIN groups g ON g.id = r.grp WHERE r.gid = $1";
        var rows = Query(sql, b);
        if (rows.Count == 0) return null;
        var r = rows[0];
        object? gid = r[0], title = r[1], artist = r[2], note = r[3], date = r[4], country = r[5], tracksJson = r[6];
        object? gGid = r[7], gTitle = r[8], gNote = r[9], gType = r[10], gFirst = r[11];
        var tracks = new List<object?>();
        if (JsJson.Parse(Js.Truthy(tracksJson) ? Js.Str(tracksJson) : "[]") is List<object?> list)
            foreach (var t0 in list)
            {
                var a = t0 as List<object?> ?? [];
                object? At(int i) => i < a.Count ? a[i] : Undef.V;
                var t = new JsObj();
                t["disc"] = At(0);
                t["no"] = At(1);
                t["title"] = Or(At(2), "");
                t["artist"] = Or(At(4), "");
                t["length"] = Js.IsNullish(At(3)) ? null : At(3);
                tracks.Add(t);
            }
        var first = Js.Truthy(gFirst) ? gFirst : date;
        var discs = tracks.Select(t => SetKey(((JsObj)t!)["disc"])).Distinct().Count();
        var o = new JsObj();
        o["mbid"] = GidText(gid);
        o["group_mbid"] = GidText(gGid);
        o["title"] = Js.Truthy(gTitle) ? gTitle : Or(title, "");
        o["artist"] = Or(artist, "");
        o["year"] = YearOf(first);
        o["date"] = DateText(first);
        o["release_title"] = Or(title, "");
        o["release_year"] = YearOf(date);
        o["release_date"] = DateText(date);
        o["edition"] = Or(note, "");
        o["group_note"] = Or(gNote, "");
        o["type"] = Or(gType, null);
        o["country"] = Or(country, null);
        o["discs"] = discs > 0 ? (double)discs : null;
        o["track_count"] = (double)tracks.Count;
        o["tracks"] = tracks;
        o["source"] = "musicbrainz";
        o["from_pack"] = true;
        return o;
    }

    public void Close()
    {
        lock (gate)
        {
            if (closed) return;
            closed = true;
            try { db.Dispose(); } catch (Exception) { /* closed */ }
        }
    }
}

/* MusicBrainz, asking the pack first for a barcode or a release (withPack): what the pack has needs no request. */
internal sealed class PackFirst(MusicBrainz mb, Func<MbPack?> pack) : IReleases
{
    public readonly MusicBrainz Mb = mb;
    public int PackHits;

    public async Task<List<JsObj>> ByBarcode(object? code)
    {
        var k = pack();
        var found = k != null ? k.ByBarcode(code) : [];
        if (found.Count > 0) { Interlocked.Increment(ref PackHits); return found; }
        return await Mb.ByBarcode(code);
    }
    public async Task<JsObj?> Release(string mbid)
    {
        var k = pack();
        var rel = k?.Release(mbid);
        return rel ?? await Mb.Release(mbid);
    }
    public Task<List<JsObj>> ByCatno(object? catno, object? label = null) => Mb.ByCatno(catno, label);
    public Task<List<JsObj>> ByIsrc(object? isrc) => Mb.ByIsrc(isrc);
    public Task<List<JsObj>> Search(object? title, object? artist, object? tracks = null, double limit = 10, bool loose = false) => Mb.Search(title, artist, tracks, limit, loose);
    public Task<List<JsObj>> GroupReleases(object? mbid) => Mb.GroupReleases(mbid);
}

/* The pack alone, while musicbrainz.org isn't answering (identifyFromPack). */
internal sealed class PackOnly(MbPack pack) : IReleases
{
    public Task<JsObj?> Release(string mbid) => Task.FromResult(pack.Release(mbid));
    public Task<List<JsObj>> ByBarcode(object? code) => Task.FromResult(pack.ByBarcode(code));
    public Task<List<JsObj>> ByCatno(object? catno, object? label = null) => Task.FromResult(new List<JsObj>());
    public Task<List<JsObj>> ByIsrc(object? isrc) => Task.FromResult(new List<JsObj>());
}

internal sealed class PackError(string message, int status) : Exception(message)
{
    public int Status { get; } = status;
}

internal sealed partial class PackStore
{
    public const string PackUrl = "https://github.com/meltface-80/Mandarin/releases/download/mbpack";
    private const string Name = "mbpack.sqlite";
    // Room kept free beside a download, so the drive isn't filled to the last byte.
    private const long Spare = 200L * 1048576;
    private const long DayMs = 24L * 3600 * 1000;

    private sealed class Job
    {
        public string Phase = "";
        public double Done, Total;
        public string? Error;
        public Job Copy() => (Job)MemberwiseClone();
    }

    private readonly string dataDir;
    private readonly string? fixedDir;
    private readonly string url;
    private readonly Action<string> log;
    private readonly long checkMs;
    private readonly object gate = new();
    private MbPack? pack;
    private bool packKnown;         // false: not opened yet (undefined); true with null: none
    private Job? job;
    private JsObj? latest;
    private Task? checking;
    private long checkedAt;
    public string? DescribeError { get; private set; }
    private Timer? timer, first;
    public Task? Running { get; private set; }

    public PackStore(string dataDir, string? dir, string? url, Action<string> log, long checkMs = DayMs)
    {
        this.dataDir = dataDir;
        fixedDir = string.IsNullOrEmpty(dir) ? null : dir;
        this.url = (string.IsNullOrEmpty(url) ? PackUrl : url).TrimEnd('/');
        this.log = log;
        this.checkMs = checkMs;
    }

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ------------------------------------------------------------ settings (db.setting)

    private static JsonNode? Setting(string key)
    {
        try { using var c = Db.Open(); return Db.Setting(c, key); }
        catch (Exception) { return null; }
    }
    private static void SetSetting(string key, JsonNode? value)
    {
        using var c = Db.Open();
        using var cmd = c.CreateCommand();
        cmd.CommandText = "INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
        cmd.Parameters.AddWithValue("$k", key);
        cmd.Parameters.AddWithValue("$v", value == null ? "null" : value.ToJsonString());
        cmd.ExecuteNonQuery();
    }

    /* Where the pack lives: MBPACK_DIR, else the folder chosen, else the data folder. */
    public string Dir
    {
        get
        {
            if (fixedDir != null) return NodePath.Resolve(fixedDir);
            var chosen = Setting("mbpack_dir");
            var s = chosen is JsonValue v && v.TryGetValue<string>(out var str) ? str : chosen == null ? null : chosen.ToJsonString();
            return !string.IsNullOrEmpty(s) ? NodePath.Resolve(s) : NodePath.Resolve(dataDir);
        }
    }
    public string FilePath => NodePath.Join(Dir, Name);

    // ------------------------------------------------------------ the file system as Node sees it

    [LibraryImport("libc", EntryPoint = "access", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Access(string path, int mode);
    [LibraryImport("libc", EntryPoint = "rename", SetLastError = true, StringMarshalling = StringMarshalling.Utf8)]
    private static partial int Rename(string from, string to);
    private const int WOk = 2, EROFS = 30, EXDEV = 18;

    /* fs.accessSync(path, W_OK): null when writable, else the errno. */
    private static int? NotWritable(string path)
    {
        try { return Access(path, WOk) == 0 ? null : Marshal.GetLastPInvokeError(); }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException) { return null; }
    }
    private static bool Docker => System.IO.File.Exists("/.dockerenv");

    /* Free bytes on the drive a folder is on; null when it can't be told. */
    public static double? FreeIn(string dir)
    {
        try { return Directory.Exists(dir) ? new DriveInfo(dir).AvailableFreeSpace : null; }
        catch (Exception) { return null; }
    }

    private static string Mb(double n) => Js.Round((double.IsNaN(n) ? 0 : n) / 1048576).ToString("#,0", CultureInfo.InvariantCulture) + " MB";

    /* Why the pack's folder can't be used, or null: not there, or not writable. */
    public string? DirProblem()
    {
        var d = Dir;
        if (!Directory.Exists(d))
            return d + " isn't there" + (Docker ? " — the container wasn't started with it mounted (-v …:" + d + "). Start it again with that line, or choose another folder." : ". Choose another folder.");
        if (NotWritable(d) is int err)
            return "Can't write to " + d + (err == EROFS ? " — it's read-only to the server" + (Docker ? " (mounted with :ro)" : "") : "") + ". Choose another folder.";
        return null;
    }

    private bool BusyNow() => job != null && job.Error == null && job.Phase != "done";
    public bool Busy() { lock (gate) return BusyNow(); }

    /* Moved across drives as well as within one. */
    private static async Task MoveFile(string from, string to)
    {
        if (Rename(from, to) == 0) return;
        var err = Marshal.GetLastPInvokeError();
        if (err != EXDEV) throw new IOException(new System.ComponentModel.Win32Exception(err).Message);
        var tmp = to + ".moving";
        try
        {
            await using (var src = System.IO.File.OpenRead(from))
            await using (var dst = new FileStream(tmp, FileMode.Create, FileAccess.Write))
                await src.CopyToAsync(dst);
            if (Rename(tmp, to) != 0) throw new IOException(new System.ComponentModel.Win32Exception(Marshal.GetLastPInvokeError()).Message);
        }
        catch (Exception) { try { System.IO.File.Delete(tmp); } catch (Exception) { /* gone */ } throw; }
        try { System.IO.File.Delete(from); } catch (Exception) { /* gone */ }
    }

    /* Keep the pack in another folder (another drive): the one here is moved there. null puts it back in the data folder. */
    public async Task<JsObj> SetDir(string? dir)
    {
        if (fixedDir != null) throw new PackError("The pack's folder is set by MBPACK_DIR on the server", 409);
        if (Busy()) throw new PackError("Wait for the download to finish", 409);
        var next = !string.IsNullOrEmpty(dir) ? NodePath.Resolve(dir) : NodePath.Resolve(dataDir);
        if (next == "/") throw new PackError("Not the top folder — choose one on the drive", 400);
        var err = NotWritable(next);
        if (err != null || !Directory.Exists(next))
        {
            var why = err == EROFS ? " — it's read-only to the server" + (Docker ? " (mounted with :ro). Mount the folder into the container on its own line, without :ro, and choose it there" : "")
                : Docker ? " — is it mounted into the container?" : "";
            throw new PackError("Can't write to " + next + why, 400);
        }
        var from = FilePath;
        var to = NodePath.Join(next, Name);
        if (from != to && Path.Exists(from))
        {
            double size = new FileInfo(from).Length;
            var free = FreeIn(next);
            if (free != null && free < size + Spare) throw new PackError($"Not enough room there: the pack needs {Mb(size)}, {Mb(free.Value)} free", 400);
            lock (gate)
            {
                ClosePack();
                job = new Job { Phase = "moving", Done = 0, Total = size };
            }
            try { await MoveFile(from, to); }
            catch (Exception e)
            {
                var failed = "Couldn't move the pack: " + e.Message;
                lock (gate)
                {
                    job = new Job { Phase = "moving", Done = 0, Total = size, Error = failed };
                    pack = null; packKnown = false;
                }
                throw new PackError(failed, 500);
            }
            lock (gate) job = null;
        }
        SetSetting("mbpack_dir", !string.IsNullOrEmpty(dir) ? JsonValue.Create(next) : null);
        lock (gate) { ClosePack(); }
        return Status();
    }

    /* The pack, opened once; null when there's none — or while it's being moved. */
    public MbPack? Get()
    {
        lock (gate)
        {
            if (job != null && job.Phase == "moving" && job.Error == null) return null;
            if (!packKnown) { pack = MbPack.Open(FilePath, log); packKnown = true; }
            return pack;
        }
    }

    public bool Wanted() => Truthy(Setting("mbpack"));

    /* !!value, for a setting as JSON keeps it. */
    private static bool Truthy(JsonNode? n) => n switch
    {
        null => false,
        JsonValue v when v.TryGetValue<bool>(out var b) => b,
        JsonValue v when v.TryGetValue<double>(out var d) => d != 0 && !double.IsNaN(d),
        JsonValue v when v.TryGetValue<string>(out var str) => str.Length > 0,
        _ => true
    };

    /* JavaScript's a > b, for a published date against the one here. */
    private static bool Gt(object? a, object? b)
    {
        if (a is string x && b is string y) return string.CompareOrdinal(x, y) > 0;
        double p = Js.ToNumber(a), q = Js.ToNumber(b);
        return p > q;
    }

    public JsObj Status()
    {
        var p = Get();
        Job? j;
        JsObj? lt;
        lock (gate) { j = job?.Copy(); lt = latest; }
        var o = new JsObj();
        var dir = Dir;
        o["dir"] = dir;
        o["dir_fixed"] = fixedDir != null;
        o["dir_problem"] = DirProblem();
        o["data_dir"] = NodePath.Resolve(dataDir);
        o["free"] = FreeIn(dir);
        o["installed"] = p != null ? p.Info() : null;
        if (lt != null)
        {
            var l = new JsObj();
            l["built"] = lt["built"];
            l["dump"] = lt["dump"];
            var n = Js.ToNumber(lt["releases"]);
            l["releases"] = double.IsNaN(n) || n == 0 ? 0.0 : n;
            l["gz_size"] = lt["gz_size"];
            l["size"] = lt["size"];
            o["latest"] = l;
        }
        else o["latest"] = null;
        o["newer"] = p != null && lt != null && Js.Truthy(lt["built"]) && Gt(lt["built"], Js.Truthy(p.Meta("built")) ? p.Meta("built") : "");
        if (j != null)
        {
            var jo = new JsObj();
            jo["phase"] = j.Phase;
            jo["done"] = j.Done;
            jo["total"] = j.Total;
            jo["error"] = j.Error;
            o["job"] = jo;
        }
        else o["job"] = null;
        o["checking"] = checking != null;
        return o;
    }

    /* What's published, asked in the background: GitHub at most every ten minutes. */
    public void CheckSoon()
    {
        lock (gate)
        {
            if (checking != null || (checkedAt != 0 && Now - checkedAt < 10 * 60 * 1000)) return;
            checking = Task.Run(async () =>
            {
                try { await Describe(); DescribeError = null; }
                catch (Exception e) { DescribeError = Message(e); }
                finally { lock (gate) { checking = null; checkedAt = Now; } }
            });
        }
    }

    private static string Message(Exception e) => e is AggregateException { InnerException: { } inner } ? inner.Message : e.Message;

    private static readonly HttpClient Http = new(new SocketsHttpHandler { AllowAutoRedirect = true, AutomaticDecompression = System.Net.DecompressionMethods.None })
    { Timeout = Timeout.InfiniteTimeSpan };

    private static async Task<HttpResponseMessage> Fetch(string address, CancellationToken ct)
    {
        Lookups.Allowed(address);
        try { return await Http.GetAsync(address, HttpCompletionOption.ResponseHeadersRead, ct); }
        catch (OperationCanceledException) when (ct.IsCancellationRequested) { throw new LookupError("The operation was aborted due to timeout"); }
        catch (HttpRequestException e) { throw new LookupError("fetch failed" + (e.InnerException != null ? " (" + e.InnerException.Message + ")" : "")); }
    }

    /* What's published: its date, size and checksum. */
    public async Task<JsObj> Describe()
    {
        using var cts = new CancellationTokenSource(30000);
        using var r = await Fetch($"{url}/mbpack-{MbPack.Format}.json", cts.Token);
        if (!r.IsSuccessStatusCode) throw new LookupError((int)r.StatusCode == 404 ? "no pack is published yet" : "HTTP " + (int)r.StatusCode);
        var d = JsJson.Parse(await r.Content.ReadAsStringAsync(cts.Token)) as JsObj ?? new JsObj();
        lock (gate) latest = d;
        return d;
    }

    /* The bytes of a response as they come, counted and hashed (the download's progress and its checksum). */
    private sealed class Counted(Stream inner, IncrementalHash hash, Job job) : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => Took(buffer.AsSpan(offset, inner.Read(buffer, offset, count)));
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            var n = await inner.ReadAsync(buffer, ct);
            return Took(buffer.Span[..n]);
        }
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) => ReadAsync(buffer.AsMemory(offset, count), ct).AsTask();
        private int Took(ReadOnlySpan<byte> got)
        {
            hash.AppendData(got);
            job.Done += got.Length;
            return got.Length;
        }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    /* Fetch the published pack and put it in place of the one here. */
    public JsObj Download()
    {
        // A folder that isn't there says so, rather than an ENOENT from the download.
        var problem = DirProblem();
        var start = false;
        lock (gate)
        {
            if (!BusyNow())
            {
                job = new Job { Phase = "checking", Error = problem };
                start = problem == null;
            }
        }
        if (start) Running = Task.Run(DownloadNow);
        return Status();
    }

    private async Task DownloadNow()
    {
        var file = FilePath;
        var tmp = file + ".download";
        Job? current = null;
        try
        {
            var d = await Describe();
            // Room for the new pack beside the old one, which stays until it's in place.
            var free = FreeIn(Dir);
            if (free != null && Js.Truthy(d["size"]) && free < Js.ToNumber(d["size"]) + Spare)
                throw new LookupError($"Not enough room in {Dir}: the pack needs {Mb(Js.ToNumber(d["size"]))}, {Mb(free.Value)} free");
            var gz = Js.ToNumber(d["gz_size"]);
            current = new Job { Phase = "downloading", Total = double.IsNaN(gz) ? 0 : gz };
            lock (gate) job = current;
            var name = Js.Truthy(d["file"]) ? Js.Str(d["file"]) : $"mbpack-{MbPack.Format}.sqlite.gz";
            using var r = await Fetch($"{url}/{name}", CancellationToken.None);
            if (!r.IsSuccessStatusCode) throw new LookupError("download HTTP " + (int)r.StatusCode);
            using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            await using (var body = await r.Content.ReadAsStreamAsync())
            {
                var counted = new Counted(body, hash, current);
                await using (var gunzip = new GZipStream(counted, CompressionMode.Decompress, leaveOpen: true))
                await using (var outFile = new FileStream(tmp, FileMode.Create, FileAccess.Write))
                    await gunzip.CopyToAsync(outFile);
                // Whatever followed the compressed data still counts towards the checksum.
                var rest = new byte[81920];
                while (await counted.ReadAsync(rest) > 0) { }
            }
            var sum = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
            if (Js.Truthy(d["sha256"]) && sum != Js.Str(d["sha256"])) throw new LookupError("the download doesn't match its checksum; try again");
            var test = MbPack.Open(tmp);
            if (test == null) throw new LookupError("the download isn't a pack this server reads");
            test.Close();
            lock (gate) ClosePack();
            if (Rename(tmp, file) != 0) throw new IOException(new System.ComponentModel.Win32Exception(Marshal.GetLastPInvokeError()).Message);
            lock (gate) { pack = null; packKnown = false; }
            SetSetting("mbpack", JsonValue.Create(true));
            lock (gate) job = new Job { Phase = "done", Done = current.Done, Total = current.Total };
            log($"MusicBrainz pack: {Js.Str(Get()?.Info()["releases"])} releases ({Js.Str(d["built"])})");
        }
        catch (Exception e)
        {
            try { System.IO.File.Delete(tmp); } catch (Exception) { /* not there */ }
            var msg = e is InvalidDataException ? "invalid gzip data (" + e.Message + ")" : Message(e);
            log("MusicBrainz pack: " + msg);
            lock (gate)
            {
                var j = (job ?? new Job()).Copy();
                j.Error = msg;
                job = j;
            }
        }
    }

    public JsObj Remove()
    {
        lock (gate)
        {
            if (BusyNow()) throw new PackError("Wait for the " + (job!.Phase == "moving" ? "move" : "download") + " to finish", 409);
            ClosePack();
        }
        try { System.IO.File.Delete(FilePath); } catch (Exception) { /* not there */ }
        SetSetting("mbpack", JsonValue.Create(false));
        lock (gate) { pack = null; packKnown = true; job = null; }
        return Status();
    }

    /* Once a day: a newer pack published is fetched (only once you've chosen one). */
    public void Start()
    {
        async Task Tick()
        {
            if (!Wanted() || Get() == null) return;
            try
            {
                await Describe();
                if (Js.Truthy(Status()["newer"])) Download();
            }
            catch (Exception) { /* asked again tomorrow */ }
        }
        timer = new Timer(_ => { _ = Tick(); }, null, checkMs, checkMs);
        first = new Timer(_ => { _ = Tick(); }, null, 60000, Timeout.Infinite);
    }

    public void Stop()
    {
        timer?.Dispose(); timer = null;
        first?.Dispose(); first = null;
        lock (gate) ClosePack();
    }

    private void ClosePack()
    {
        pack?.Close();
        pack = null;
        packKnown = false;
    }
}
