using System.Diagnostics;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Tests;

/// <summary>
/// The library scan made by the C# server (v0.8.18, Scan/) writes what the Node server's scan wrote: one
/// music folder, every kind of thing a scan has to decide about, every table compared, value for value
/// and as the same kind of value, after the first scan and after each change to the folder. The Node
/// server's side is kept (test/golden/scan-csharp.json) and `mandarin-server scan` is held to it, step for
/// step. What depends on the machine is held by rule: the folder's own path; a file's length and time as
/// the file has them, and the cover's key the scan makes from those; a lossy file's length in seconds as
/// the C# reader reads it and an album's as its tracks' sum; ffmpeg's name in the tags it writes; times
/// of the scan as "&lt;now&gt;" (test/scan-csharp.test.js, in C#; the folder made in
/// ScanCsharpTests.Library.cs).
/// </summary>
public sealed partial class ScanCsharpTests(ScanCsharpTests.Book book) : IClassFixture<ScanCsharpTests.Book>
{
    /// <summary>test/golden/scan-csharp.json; the test asks for every kept answer itself, at its end.</summary>
    public sealed class Book() : KeptBook("scan-csharp");

    private const double Day = 86400000;
    private static double Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    [GeneratedRegex(@"Lav[fc]\d+(\.\d+)+")] private static partial Regex Lavf();
    [GeneratedRegex(@" in \d+\.\ds$")] private static partial Regex Took();

    // albums.updated_at is the time of the write; everything else must be the same.
    // Left out of the dump: what changes with the clock, and the C# server's own columns beyond the Node server's (the classical fields, bug list item 48).
    private static readonly Dictionary<string, string[]> Volatile = new() { ["albums"] = ["updated_at"], ["tracks"] = ["composer", "conductor", "work", "movement", "movement_no", "performers"] };

    private sealed record Table(List<string> Cols, List<JsonArray> Rows);

    // A value as better-sqlite3 gave it: a number, text, a Buffer (as JSON.stringify writes one) or null.
    private static JsonNode? Value(object v) => v switch
    {
        DBNull => null,
        long l => JsonValue.Create((double)l),
        double d => JsonValue.Create(d),
        string s => JsonValue.Create(s),
        byte[] b => new JsonObject { ["type"] = "Buffer", ["data"] = new JsonArray([.. b.Select(x => (JsonNode?)JsonValue.Create((double)x))]) },
        _ => JsonValue.Create(Convert.ToString(v, CultureInfo.InvariantCulture))
    };

    // Every table: its columns and its rows, each value beside the kind SQLite keeps it as.
    private static SortedDictionary<string, Table> Dump(string file)
    {
        using var db = SqliteDump.Open(file);
        var output = new SortedDictionary<string, Table>(StringComparer.Ordinal);
        foreach (var name in SqliteDump.All(db, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").Select(r => r.Str("name")!))
        {
            var cols = SqliteDump.All(db, $"PRAGMA table_info({name})").Select(c => c.Str("name")!).Where(c => !(Volatile.GetValueOrDefault(name) ?? []).Contains(c)).ToList();
            if (cols.Count == 0) continue;
            using var q = db.CreateCommand();
            q.CommandText = $"SELECT {string.Join(", ", cols.Select(c => $"\"{c}\", typeof(\"{c}\")"))} FROM {name} ORDER BY rowid";
            using var rd = q.ExecuteReader();
            var rows = new List<JsonArray>();
            while (rd.Read()) rows.Add(new JsonArray([.. Enumerable.Range(0, rd.FieldCount).Select(i => Value(rd.GetValue(i)))]));
            output[name] = new Table(cols, rows);
        }
        return output;
    }

    private sealed class Scanned
    {
        public List<string> Lines = [];
        public JsonNode? Result, State;
    }

    // The scan made by the program, as the server has it made: the job on its input, a line of JSON each thing it says.
    private static async Task<Scanned> ScanCs(string dataDir, string root, bool force, int massRemoval)
    {
        var job = new JsonObject { ["dataDir"] = dataDir, ["root"] = root, ["roots"] = new JsonArray(Path.GetFullPath(root)), ["massRemoval"] = massRemoval, ["force"] = force, ["slots"] = 2 };
        var r = await ServerCommand.Run(["scan"], stdin: JsJson.Stringify(job));
        var o = new Scanned();
        foreach (var l in r.Out.Split('\n').Where(x => x.Length > 0))
        {
            var m = JsJson.Parse(l)!;
            switch (m.Str("type"))
            {
                case "log": o.Lines.Add(m.Str("line")!); break;
                case "state" or "progress": o.State = m["state"]?.DeepClone(); break;
                case "result": o.Result = m["result"]?.DeepClone(); o.State = m["state"]?.DeepClone(); break;
                case "error": throw new InvalidOperationException(m.Str("message"));
            }
        }
        Assert.True(o.Result != null, "the scan's result\n" + r.Err);
        return o;
    }

    private static List<string> Said(IEnumerable<string> lines) =>
        [.. lines.Where(l => !l.Contains("made by the C# server", StringComparison.Ordinal)).Select(l => Took().Replace(l, " in …s"))];

    private static readonly string[] StateKeys = ["files", "parsed", "errors", "progress", "running"];

    // What a file is, read before each scan: its length and its time as Node's stat gave it (ms, from the
    // nanoseconds), the last seen for one gone since; and a lossy file's length in seconds as the C# reader reads it.
    private sealed class Looker(string music)
    {
        public readonly Dictionary<string, (long Size, double MtimeMs)> Stats = [];
        public readonly Dictionary<string, JsonNode?> Seconds = [];

        // Each file's length and time as Node's fs.statSync gives them (mtimeMs: seconds × 1000 + nanoseconds ÷ 10⁶, the
        // figure a cover's key is made from), asked of node itself in one go. The stat command gave them until item 205:
        // Ubuntu 26.04's runners carry uutils' stat (0.10.0), whose %.9Y gives the nanoseconds rounded to the tenth of
        // a microsecond (.441316400 for 441316361), so a key made from its figure matched the server's only for the
        // files whose time happened to be round.
        private void StatAll(IReadOnlyList<string> paths)
        {
            if (paths.Count == 0) return;
            var psi = new ProcessStartInfo("node") { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.ArgumentList.Add("-e");
            psi.ArgumentList.Add("const fs=require('fs');let s='';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>s+=d).on('end',()=>{"
                + "for(const p of s.split('\\n').filter(Boolean)){try{const t=fs.statSync(p);console.log(JSON.stringify({p,size:t.size,ms:t.mtimeMs}))}catch{}}})");
            using var x = Process.Start(psi)!;
            var output = x.StandardOutput.ReadToEndAsync();
            x.StandardInput.Write(string.Join("\n", paths) + "\n");
            x.StandardInput.Close();
            x.WaitForExit();
            foreach (var l in output.Result.Split('\n').Where(l => l.Length > 0))
            {
                var o = JsJson.Parse(l)!;
                Stats[o.Str("p")!] = ((long)o.Num("size")!, (double)o.Num("ms")!);
            }
        }

        private void Walk(string dir, HashSet<string> seen, List<string> files)
        {
            string[] names;
            try { names = Directory.GetFileSystemEntries(dir); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return; }
            foreach (var p in names)
            {
                bool isDir;
                try { isDir = Directory.Exists(p); if (!isDir && !File.Exists(p)) continue; } catch (IOException) { continue; }
                if (isDir)
                {
                    bool link = new DirectoryInfo(p).LinkTarget != null;
                    if (!link || !seen.Contains(p)) { seen.Add(p); Walk(p, seen, files); }
                }
                else files.Add(p);
            }
        }

        public async Task Look()
        {
            var files = new List<string>();
            Walk(music, [], files);
            StatAll(files);
            var lossy = Stats.Keys.Where(p => Regex.IsMatch(p, @"\.(mp3|m4a)$", RegexOptions.IgnoreCase) && File.Exists(p)).ToList();
            if (lossy.Count == 0) return;
            var r = await ServerCommand.Run(["tags"], stdin: string.Join("\n", lossy));
            foreach (var l in r.Out.Trim().Split('\n').Where(x => x.Length > 0))
            {
                var x = JsJson.Parse(l)!;
                if (x.Bool("ok") == true) Seconds[x.Str("path")!] = x["tags"]?["duration"]?.DeepClone();
            }
        }
    }

    private static double? D(JsonNode? n) => n is JsonValue v && v.TryGetValue<double>(out var d) ? d : null;
    private static bool Eq(JsonNode? n, double x) => D(n) is { } d && d == x;

    private static JsonNode? Text(JsonNode? v, string root) =>
        v is JsonValue s && s.TryGetValue<string>(out var t) ? JsonValue.Create(Lavf().Replace(t.Replace(root, "<root>", StringComparison.Ordinal), "Lav<ffmpeg>")) : v?.DeepClone();

    // A database's tables, with what depends on the machine held by rule (above) and named for it.
    private static SortedDictionary<string, Table> Normalised(SortedDictionary<string, Table> tables, string root, Looker files)
    {
        var now = Now;
        int At(string t, string c) => tables.TryGetValue(t, out var x) ? x.Cols.IndexOf(c) * 2 : -2;
        var ruled = new HashSet<string>();   // "table:row:col" held by rule
        void Rule(JsonArray r, int j, string to, string t, int i) { r[j] = to; ruled.Add($"{t}:{i}:{j}"); }
        if (tables.TryGetValue("tracks", out var T))
        {
            int pathAt = At("tracks", "path"), mtimeAt = At("tracks", "mtime"), sizeAt = At("tracks", "size"), durAt = At("tracks", "duration"),
                lossAt = At("tracks", "lossless"), albumAt = At("tracks", "album_id");
            string? PathOf(JsonArray r) => r[pathAt] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
            JsonNode? SecondsOf(JsonArray r) => PathOf(r) is { } p && Eq(r[lossAt], 0) && files.Seconds.TryGetValue(p, out var x) ? x : null;
            for (int i = 0; i < T.Rows.Count; i++)
            {
                var r = T.Rows[i];
                var st = PathOf(r) is { } p && files.Stats.TryGetValue(p, out var x) ? x : ((long Size, double MtimeMs)?)null;
                if (st is { } a && Eq(r[mtimeAt], Math.Floor(a.MtimeMs))) Rule(r, mtimeAt, "<the file's time>", "tracks", i);
                if (st is { } b && Eq(r[sizeAt], b.Size)) Rule(r, sizeAt, "<the file's length>", "tracks", i);
                if (SecondsOf(r) is { } sec && D(r[durAt]) is { } dur && D(sec) == dur) Rule(r, durAt, "<as the reader reads it>", "tracks", i);
            }
            if (tables.TryGetValue("albums", out var A))
            {
                int idAt = At("albums", "id"), hashAt = At("albums", "art_hash"), artAt = At("albums", "art_path"), aDurAt = At("albums", "duration");
                // Its cover's key: sha1 of a file's path, length and time (the cover's, else a track's).
                string? KeyOf(string p) => files.Stats.TryGetValue(p, out var st)
                    ? Convert.ToHexStringLower(SHA1.HashData(Encoding.UTF8.GetBytes($"{p}|{st.Size}|{JsJson.Number(st.MtimeMs)}")))[..10] : null;
                for (int i = 0; i < A.Rows.Count; i++)
                {
                    var a = A.Rows[i];
                    var mine = T.Rows.Where(r => D(r[albumAt]) is { } x && Eq(a[idAt], x)).ToList();
                    var hash = a[hashAt] is JsonValue hv && hv.TryGetValue<string>(out var h) && h.Length > 0 ? h : null;
                    var from = new[] { a[artAt] is JsonValue av && av.TryGetValue<string>(out var ap) ? ap : null }.Concat(mine.Select(PathOf))
                        .FirstOrDefault(p => !string.IsNullOrEmpty(p) && hash != null && KeyOf(p) == hash);
                    if (from != null) Rule(a, hashAt, "<the key of " + Text(JsonValue.Create(from), root)!.GetValue<string>() + ">", "albums", i);
                    // A lossy album's length: its tracks' as read, summed.
                    if (mine.Any(r => Eq(r[lossAt], 0)))
                    {
                        var durs = mine.Select(r => SecondsOf(r) is { } s ? D(s) : D(r[durAt])).ToList();
                        double sum = 0, back = 0;
                        foreach (var x in durs) sum += x ?? double.NaN;
                        for (int k = durs.Count - 1; k >= 0; k--) back += durs[k] ?? double.NaN;
                        if (Eq(a[aDurAt], sum) || Eq(a[aDurAt], back)) Rule(a, aDurAt, "<its tracks' summed>", "albums", i);
                    }
                }
            }
        }
        int trackMtime = At("tracks", "mtime");
        foreach (var (t, table) in tables)
            for (int i = 0; i < table.Rows.Count; i++)
            {
                var r = table.Rows[i];
                for (int j = 0; j < r.Count; j += 2)
                {
                    if (ruled.Contains($"{t}:{i}:{j}")) continue;
                    if (D(r[j]) is { } n && n > now - 3 * Day && n < now + Day && !(t == "tracks" && j == trackMtime)) r[j] = "<now>";
                    else r[j] = Text(r[j], root);
                }
            }
        return tables;
    }

    // Anything else said: the folder's own path, and times, by name.
    private static JsonNode? Named(JsonNode? v, string root) => v switch
    {
        JsonArray a => new JsonArray([.. a.Select(x => Named(x, root))]),
        JsonObject o => new JsonObject(o.Select(kv => KeyValuePair.Create(kv.Key, Named(kv.Value, root)))),
        JsonValue s when s.TryGetValue<string>(out var t) => JsonValue.Create(t.Replace(root, "<root>", StringComparison.Ordinal)),
        _ when D(v) is { } n && n > Now - 3 * Day => JsonValue.Create("<now>"),
        _ => v?.DeepClone()
    };

    private static JsonNode Result(JsonNode r)
    {
        var o = r.DeepClone().AsObject();
        o.Remove("ms");
        return o;
    }
}
