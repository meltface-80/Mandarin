// Scanner.cs — reading the music folders into the database (v0.8.18): the
// Node server's scan (lib/library/scanner.js, scanHere), rule for rule, made
// here. What it writes must be what that one wrote — every album's key and
// id, every column, as the same kind of value — because the Node server reads
// the same database, and an album's key is what its favourite, its edits and
// its plays hang on. So the values are JavaScript's (Tags/Js.cs), and they go
// to SQLite as better-sqlite3 sent them: every number as a double.
//
// Incremental: a file whose size and modification time are unchanged is not
// opened again. Work is done one folder at a time, because what an album IS
// depends on its neighbours. A file that is the same file under a new path is
// recognised and keeps its track. Nothing is removed unless its folder was
// read in full and it wasn't there; a folder missing, empty, unreadable or
// suddenly mostly gone keeps its tracks.
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server.Scan;

// The tag reader's JavaScript, not Mandarin.Server's JSON helpers of the same name.
using Js = Mandarin.Server.Tags.Js;

/* A value as better-sqlite3 gave it to JavaScript, and back. */
internal static class Sql
{
    public static object? Val(SqliteDataReader r, int i) => r.GetValue(i) switch
    {
        DBNull => null,
        long l => (double)l,
        double d => d,
        string s => s,
        byte[] b => b,
        var o => o
    };

    public static JsObj Row(SqliteDataReader r)
    {
        var o = new JsObj();
        for (var i = 0; i < r.FieldCount; i++) o[r.GetName(i)] = Val(r, i);
        return o;
    }

    /* As better-sqlite3 binds: a number as a double (SQLite's column affinity does the rest), text as text. */
    public static void Bind(SqliteCommand c, string name, object? v)
    {
        switch (v)
        {
            case null or Undef: c.Parameters.AddWithValue(name, DBNull.Value); break;
            case double d:
                if (double.IsNaN(d)) c.Parameters.AddWithValue(name, DBNull.Value);
                else c.Parameters.Add(name, SqliteType.Real).Value = d;
                break;
            case string s: c.Parameters.Add(name, SqliteType.Text).Value = s; break;
            case System.Numerics.BigInteger b: c.Parameters.Add(name, SqliteType.Integer).Value = (long)b; break;
            case long l: c.Parameters.Add(name, SqliteType.Real).Value = (double)l; break;
            case int n: c.Parameters.Add(name, SqliteType.Real).Value = (double)n; break;
            case byte[] bytes: c.Parameters.Add(name, SqliteType.Blob).Value = bytes; break;
            default: throw new JsError("SQLite3 can only bind numbers, strings, bigints, buffers, and null");
        }
    }
}

/* A Map, in the order things were put in (taken out and put back: at the end). */
internal sealed class OrderedMap<T> where T : class
{
    private readonly Dictionary<string, LinkedListNode<(string Key, T Value)>> index = new(StringComparer.Ordinal);
    private readonly LinkedList<(string Key, T Value)> order = new();
    public int Count => index.Count;
    public T? Get(string k) => index.TryGetValue(k, out var n) ? n.Value.Value : null;
    public void Set(string k, T v)
    {
        if (index.TryGetValue(k, out var n)) { n.Value = (k, v); return; }
        index[k] = order.AddLast((k, v));
    }
    public void Delete(string k)
    {
        if (!index.Remove(k, out var n)) return;
        order.Remove(n);
    }
    public IEnumerable<(string Key, T Value)> Entries => order;
    public IEnumerable<T> Values => order.Select(e => e.Value);
}

/* A Set of numbers, in the order they were added. */
internal sealed class OrderedIds
{
    private readonly HashSet<double> seen = [];
    private readonly List<double> order = [];
    public void Add(double v) { if (seen.Add(v)) order.Add(v); }
    public IEnumerable<double> Items => order;
}

internal sealed class ScanState
{
    public bool Running;
    public double Progress, Files, Parsed, Errors;
    public double? StartedAt, FinishedAt;
    public JsObj? LastResult;

    public JsObj ToJs()
    {
        var o = new JsObj();
        o["running"] = Running;
        o["progress"] = Progress;
        o["files"] = Files;
        o["parsed"] = Parsed;
        o["errors"] = Errors;
        o["startedAt"] = StartedAt;
        o["finishedAt"] = FinishedAt;
        o["lastResult"] = LastResult;
        return o;
    }
}

internal sealed partial class Scanner(SqliteConnection db, string root, IReadOnlyList<string> rootsGiven, double massRemoval, int slots, Action<string> log)
{
    // Which reading of the tags a track row holds: rows from before are read again once.
    private const double TagsV = 2;
    private static readonly HashSet<string> AudioExt = [".flac", ".fla", ".mp3", ".m4a", ".mp4", ".m4b", ".alac", ".aac", ".wav", ".wave",
        ".aif", ".aiff", ".aifc", ".ogg", ".oga", ".opus", ".dsf", ".dff", ".wv", ".ape", ".wma"];
    private static readonly string[] ArtNames = ["cover", "folder", "front", "album", "albumart", "albumartsmall", "thumb"];
    private static readonly string[] ImgExt = [".jpg", ".jpeg", ".png", ".webp"];

    public readonly ScanState State = new();
    // Called at most every five seconds while the scan writes, so albums found so far can be shown and played.
    public Action? OnProgress;
    private HashSet<double>? claimed;
    private SqliteTransaction? tx;
    private readonly Dictionary<string, SqliteCommand> cmds = new(StringComparer.Ordinal);

    private static double NowMs() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // ---------------------------------------------------------------- SQL

    private SqliteCommand Prep(string sql, (string Name, object? Value)[] ps)
    {
        if (!cmds.TryGetValue(sql, out var c))
        {
            c = db.CreateCommand();
            c.CommandText = sql;
            cmds[sql] = c;
        }
        c.Transaction = tx;
        c.Parameters.Clear();
        foreach (var (n, v) in ps) Sql.Bind(c, n, v);
        return c;
    }

    private int Exec(string sql, params (string, object?)[] ps) => Prep(sql, ps).ExecuteNonQuery();

    private List<JsObj> All(string sql, params (string, object?)[] ps)
    {
        var outList = new List<JsObj>();
        using var r = Prep(sql, ps).ExecuteReader();
        while (r.Read()) outList.Add(Sql.Row(r));
        return outList;
    }

    private JsObj? Get(string sql, params (string, object?)[] ps)
    {
        using var r = Prep(sql, ps).ExecuteReader();
        return r.Read() ? Sql.Row(r) : null;
    }

    /* db.transaction(fn)(): BEGIN IMMEDIATE (lib/library/db.js), rolled back if fn throws. */
    private void Transaction(Action body)
    {
        using var t = db.BeginTransaction(deferred: false);
        tx = t;
        try
        {
            body();
            t.Commit();
        }
        finally { tx = null; }
    }

    private object? Setting(string key, object? fallback)
    {
        var r = Get("SELECT value FROM settings WHERE key = $k", ("$k", key));
        if (r == null) return fallback;
        try { return JsJson.Parse(Js.Str(r["value"])); } catch (JsError) { return fallback; }
    }

    private void SetSetting(string key, object? value) =>
        Exec("INSERT INTO settings(key, value) VALUES($k, $v) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ("$k", key), ("$v", Js.Json(value)));

    // ------------------------------------------------------------ the folders

    /* The watched folders: absolute, each once, none inside another. */
    public List<string> Roots()
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var list = new List<string>();
        foreach (var r in rootsGiven)
        {
            if (string.IsNullOrEmpty(r)) continue;
            var p = NodePath.Resolve(r);
            if (seen.Add(p)) list.Add(p);
        }
        list.Sort(string.CompareOrdinal);
        return list.Where(r => !list.Any(o => o != r && NodePath.IsInside(r, o))).ToList();
    }

    /* An album folder as the key names it: relative to its music folder. */
    private string RelFolder(string dir)
    {
        var roots = Roots();
        var r = roots.Where(x => NodePath.IsInside(dir, x)).OrderByDescending(x => x.Length).FirstOrDefault();
        var rel = r != null ? NodePath.Relative(r, dir) : dir;
        return Js.Lower(string.Join("/", (rel.Length > 0 ? rel : ".").Split('/')));
    }

    private static List<string> ListImages(string dir)
    {
        try
        {
            return NodeFs.ReadDirNames(dir).Where(f => ImgExt.Contains(Js.Lower(NodePath.Extname(f))) && !f.StartsWith('.')).Select(f => NodePath.Join(dir, f)).ToList();
        }
        catch (IOException) { return []; }
    }

    [GeneratedRegex("front|cover")]
    private static partial Regex FrontOrCover();
    [GeneratedRegex("back|inlay|cd|disc|booklet|tray")]
    private static partial Regex NotTheFront();

    public static string? PickArt(List<string> images)
    {
        if (images.Count == 0) return null;
        var scored = images.Select(p =>
        {
            var b = Js.Lower(NodePath.Basename(p, NodePath.Extname(p)));
            double score = 100;
            var i = Array.IndexOf(ArtNames, b);
            if (i >= 0) score = i;
            else if (FrontOrCover().IsMatch(b)) score = 20;
            else if (NotTheFront().IsMatch(b)) score = 200;
            return (P: p, Score: score);
        }).OrderBy(x => x.Score).ThenBy(x => x.P, Comparer<string>.Create(Library.Lc)).ToList();
        // Only a lone image, or one whose name says what it is, stands for the album.
        if (scored[0].Score < 100 || images.Count == 1) return scored[0].P;
        return null;
    }

    public static string? ArtHash(string p)
    {
        if (!NodeFs.TryStat(p, follow: true, out var st)) return null;
        var hash = SHA1.HashData(Encoding.UTF8.GetBytes(p + "|" + Js.Num(st.Size) + "|" + Js.Num(st.MtimeMs)));
        return Convert.ToHexString(hash).ToLowerInvariant()[..10];
    }

    private sealed record DiscImages(string Dir, List<string> Images);

    /*
     * Every folder under root, depth first. [listed] collects each folder read in
     * full, [unreadable] each one that couldn't be: what was under those is kept
     * as it was, never taken for deleted.
     */
    private static void Walk(string root, Action<string, List<string>, List<string>, List<DiscImages>> onDir, HashSet<string> listed, HashSet<string> unreadable)
    {
        var stack = new List<string> { root };
        var seen = new HashSet<string>(StringComparer.Ordinal);
        while (stack.Count > 0)
        {
            var dir = stack[^1];
            stack.RemoveAt(stack.Count - 1);
            var real = NodeFs.RealPathOf(dir);
            if (real == null) { unreadable.Add(dir); continue; }
            if (!seen.Add(real)) { unreadable.Add(dir); continue; }   // a symlink loop: not read twice
            List<Entry> entries;
            try { entries = NodeFs.ReadDir(dir); } catch (IOException) { unreadable.Add(dir); continue; }
            listed.Add(dir);
            var files = new List<string>();
            var images = new List<string>();
            var discDirs = new List<string>();
            foreach (var e in entries)
            {
                if (e.Name.StartsWith('.')) continue;
                var full = NodePath.Join(dir, e.Name);
                bool isDir = e.Type == EntryType.Dir, isFile = e.Type == EntryType.File;
                if (e.Type == EntryType.Link)
                {
                    if (!NodeFs.TryStat(full, follow: true, out var st)) { unreadable.Add(full); continue; }
                    isDir = st.IsDirectory;
                    isFile = st.IsFile;
                }
                if (isDir)
                {
                    // "CD1", "Disc 2"…: one album split across folders, read as part of this one.
                    if (ScanNames.DiscDir().IsMatch(e.Name)) discDirs.Add(full); else stack.Add(full);
                }
                else if (isFile)
                {
                    var ext = Js.Lower(NodePath.Extname(e.Name));
                    if (AudioExt.Contains(ext)) files.Add(full);
                    else if (ImgExt.Contains(ext)) images.Add(full);
                }
            }
            var discImages = new List<DiscImages>();
            discDirs.Sort(string.CompareOrdinal);
            foreach (var d in discDirs)
            {
                List<Entry> inner;
                try { inner = NodeFs.ReadDir(d); } catch (IOException) { unreadable.Add(d); continue; }
                listed.Add(d);
                var imgs = new List<string>();
                foreach (var e in inner)
                {
                    if (e.Name.StartsWith('.')) continue;
                    var full = NodePath.Join(d, e.Name);
                    var ext = Js.Lower(NodePath.Extname(e.Name));
                    if (e.Type == EntryType.Dir) stack.Add(full);
                    else if (AudioExt.Contains(ext)) files.Add(full);
                    else if (ImgExt.Contains(ext)) imgs.Add(full);
                }
                discImages.Add(new DiscImages(d, imgs));
            }
            if (files.Count > 0 || images.Count > 0)
            {
                files.Sort(string.CompareOrdinal);
                onDir(dir, files, images, discImages);
            }
        }
    }

    // ------------------------------------------------------------ album identity

    /*
     * An album's key changed: every table that names the album by its key
     * follows, so its favourite, Listen later, edits, identification, label
     * lookup, release day and Album of the day go with it.
     */
    private void Rekey(string from, string to)
    {
        if (from.Length == 0 || to.Length == 0 || from == to) return;
        foreach (var t in new[] { "albums", "favourites", "listen_later", "label_lookups", "album_edits", "track_edits", "album_matches", "album_ids" })
            Exec($"UPDATE OR IGNORE {t} SET key = $to WHERE key = $from", ("$to", to), ("$from", from));
        Exec("UPDATE OR IGNORE cache SET key = $to WHERE ns = 'mbday' AND key = $from", ("$to", to), ("$from", from));
        if (Setting("album_of_the_day", null) is JsObj aotd && Js.StrictEq(aotd["key"], from))
        {
            var copy = new JsObj();
            foreach (var k in aotd.Keys) copy[k] = aotd[k];
            copy["key"] = to;
            SetSetting("album_of_the_day", copy);
        }
    }

    private sealed class Group
    {
        public string Title = "";
        public readonly List<JsObj> Rows = [];
        public string Artist = "";
        public double Compilation;
        public string SortArtist = "";
        public string Base = "";
        public string Key = "";
    }

    private static string KeyOf(object? v) => ScanNames.Key(Js.IsNullish(v) ? "" : Js.Str(v));

    /*
     * Decide each track's album within one folder.
     *   - The album-artist tag wins when present.
     *   - A compilation flag, or several track artists on one album title with
     *     no album artist, makes it "Various Artists".
     *   - Otherwise the track artist is the album artist.
     * A missing album tag names the album after its folder.
     */
    private List<Group> GroupDir(string dir, List<JsObj> rows)
    {
        var groups = new List<Group>();
        var index = new Dictionary<string, Group>(StringComparer.Ordinal);
        var dirName = NodePath.Basename(dir);
        foreach (var r in rows)
        {
            var title = Js.Truthy(r["album"]) ? Js.Str(r["album"]) : dirName;
            var k = ScanNames.Key(title);
            if (!index.TryGetValue(k, out var g)) { g = new Group { Title = title }; index[k] = g; groups.Add(g); }
            g.Rows.Add(r);
        }
        foreach (var g in groups)
        {
            var tagged = g.Rows.FirstOrDefault(r => Js.Truthy(r["album_artist"]));
            var artists = new HashSet<string>(g.Rows.Select(r => KeyOf(r["artist"])).Where(s => s.Length > 0), StringComparer.Ordinal);
            string albumArtist;
            if (tagged != null) albumArtist = Js.Str(tagged["album_artist"]);
            else if (g.Rows.Any(r => Js.Truthy(r["compilation"])) || artists.Count > 1) albumArtist = "Various Artists";
            else albumArtist = g.Rows.Count > 0 && Js.Truthy(g.Rows[0]["artist"]) ? Js.Str(g.Rows[0]["artist"]) : "Unknown Artist";
            g.Artist = albumArtist;
            g.Compilation = ScanNames.Key(albumArtist) == "various artists" ? 1 : 0;
            var sorted = g.Rows.FirstOrDefault(r => Js.Truthy(r["artist_sort"]));
            g.SortArtist = sorted != null ? Js.Str(sorted["artist_sort"]) : albumArtist;
            g.Base = ScanNames.Key(albumArtist) + "\u0001" + ScanNames.Key(g.Title);
            g.Key = g.Base + "\u0001" + RelFolder(dir);
        }
        return groups;
    }

    private double AlbumIdFor(Group g, string dir, double now)
    {
        var id = AlbumIdFor1(g, dir, now);
        claimed?.Add(id);
        return id;
    }

    private double AlbumIdFor1(Group g, string dir, double now)
    {
        var hit = Get("SELECT id FROM albums WHERE key = $k", ("$k", g.Key));
        if (hit != null) return Js.ToNumber(hit["id"]);
        // The folder renamed or moved (the tracks known, the old folder gone):
        // the same album, under its new key — plays, edits and favourite kept.
        var prevIds = new List<double>();
        foreach (var r in g.Rows)
        {
            var v = Js.Truthy(r["unchanged"]) ? r["album_id"] : r["prev_album"];
            if (!Js.Truthy(v)) continue;
            var n = Js.ToNumber(v);
            if (!prevIds.Contains(n)) prevIds.Add(n);
        }
        if (prevIds.Count == 1)
        {
            var old = Get("SELECT id, key, dir FROM albums WHERE id = $id", ("$id", prevIds[0]));
            if (old != null)
            {
                var oldKey = Js.Str(old["key"]);
                var sameName = string.Join("\u0001", oldKey.Split('\u0001').Take(2)) == g.Base;
                var oldDir = old["dir"];
                // Its names changed in the same folder (an untagged album named from its folders, or tags rewritten): still the same album.
                var sameFolder = Js.Truthy(oldDir) && NodePath.Resolve(Js.Str(oldDir)) == NodePath.Resolve(dir) && !(claimed != null && claimed.Contains(Js.ToNumber(old["id"])));
                if ((sameName && !(Js.Truthy(oldDir) && NodeFs.Exists(Js.Str(oldDir)))) || sameFolder)
                {
                    Rekey(oldKey, g.Key);
                    Exec("UPDATE albums SET title = $title, artist = $artist, sort_title = $sort_title, sort_artist = $sort_artist, compilation = $compilation WHERE id = $id",
                        ("$id", old["id"]), ("$title", g.Title), ("$artist", g.Artist), ("$sort_title", ScanNames.SortName(g.Title)),
                        ("$sort_artist", ScanNames.SortName(g.SortArtist)), ("$compilation", g.Compilation));
                    // New names, not yet looked up under them: identification asks again.
                    if (!sameName) Exec("DELETE FROM album_matches WHERE key = $k AND status = 'unidentified'", ("$k", g.Key));
                    return Js.ToNumber(old["id"]);
                }
            }
        }
        // What was kept under the key before folders counted (edits restored into a new database; an album that left and is back).
        if (g.Base.Length > 0)
        {
            Rekey(g.Base, g.Key);
            var was = Get("SELECT id FROM albums WHERE key = $k", ("$k", g.Key));
            if (was != null) return Js.ToNumber(was["id"]);
        }
        (string, object?)[] row =
        [
            ("$key", g.Key), ("$title", g.Title), ("$artist", g.Artist), ("$sort_title", ScanNames.SortName(g.Title)),
            ("$sort_artist", ScanNames.SortName(g.SortArtist)), ("$dir", dir), ("$now", now), ("$compilation", g.Compilation)
        ];
        // Back after a while away: the id it had, if nothing has taken it since.
        var retired = Get("SELECT id FROM album_ids WHERE key = $k", ("$k", g.Key));
        if (retired != null && Get("SELECT id FROM albums WHERE id = $id", ("$id", retired["id"])) == null)
        {
            Exec(@"INSERT INTO albums(id, key, title, artist, sort_title, sort_artist, dir, added_at, updated_at, compilation)
                   VALUES($id, $key, $title, $artist, $sort_title, $sort_artist, $dir, $now, $now, $compilation)", [("$id", retired["id"]), .. row]);
            return Js.ToNumber(retired["id"]);
        }
        Exec(@"INSERT INTO albums(key, title, artist, sort_title, sort_artist, dir, added_at, updated_at, compilation)
               VALUES($key, $title, $artist, $sort_title, $sort_artist, $dir, $now, $now, $compilation)", row);
        return Js.ToNumber(Get("SELECT last_insert_rowid() AS id")!["id"]);
    }

    /* JavaScript's SameValueZero, for a Map's keys and includes(). */
    private static bool Same(object? a, object? b) => (a, b) switch
    {
        (double x, double y) => x == y || (double.IsNaN(x) && double.IsNaN(y)),
        _ => Js.StrictEq(a, b)
    };

    /* scanner.js count: the values that are there, most common first (ties: first seen). */
    private static List<object?> Count(IEnumerable<object?> vals)
    {
        var keys = new List<object?>();
        var counts = new List<int>();
        foreach (var v in vals)
        {
            if (!Js.Truthy(v)) continue;
            var i = keys.FindIndex(k => Same(k, v));
            if (i < 0) { keys.Add(v); counts.Add(1); } else counts[i]++;
        }
        return keys.Select((k, i) => (K: k, N: counts[i])).OrderByDescending(x => x.N).Select(x => x.K).ToList();
    }

    /* Math.max / Math.min over numbers, NaN as JavaScript has it. */
    private static double JsMax(IEnumerable<object?> vals)
    {
        var m = double.NegativeInfinity;
        foreach (var v in vals) { var n = Js.ToNumber(v); if (double.IsNaN(n)) return double.NaN; if (n > m) m = n; }
        return m;
    }

    private static double JsMin(IEnumerable<object?> vals)
    {
        var m = double.PositiveInfinity;
        foreach (var v in vals) { var n = Js.ToNumber(v); if (double.IsNaN(n)) return double.NaN; if (n < m) m = n; }
        return m;
    }

    private static object? OrNull(double v) => v == 0 || double.IsNaN(v) ? null : v;

    /* Of several tracks' dates, the album's: the most precise one of [year], the commonest at that precision. */
    private static string? AlbumDateOf(IEnumerable<object?> dates, object? year)
    {
        if (!Js.Truthy(year)) return null;
        var y = Js.Str(year);
        var keys = new List<string>();
        var counts = new List<int>();
        foreach (var d in dates)
        {
            if (!Js.Truthy(d)) continue;
            var s = Js.Str(d);
            if (!s.StartsWith(y, StringComparison.Ordinal)) continue;
            var i = keys.IndexOf(s);
            if (i < 0) { keys.Add(s); counts.Add(1); } else counts[i]++;
        }
        var best = y;
        var n = 0;
        for (var i = 0; i < keys.Count; i++)
            if (keys[i].Length > best.Length || (keys[i].Length == best.Length && counts[i] > n)) { best = keys[i]; n = counts[i]; }
        return best;
    }

    /* for (const g of JSON.parse(t.genres || "[]")) */
    private static IEnumerable<object?> GenresOf(JsObj t)
    {
        var parsed = JsJson.Parse(Js.Truthy(t["genres"]) ? Js.Str(t["genres"]) : "[]");
        if (parsed is List<object?> l) return l;
        if (parsed is string s) return s.EnumerateRunes().Select(r => (object?)r.ToString());
        throw new JsError("JSON.parse(...) is not iterable");
    }

    /* Recompute an album's derived columns from its tracks. */
    private void RefreshAlbum(double id, Dictionary<string, List<string>>? imagesByDir)
    {
        var tracks = All("SELECT * FROM tracks WHERE album_id = $id ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path", ("$id", id));
        if (tracks.Count == 0) return;
        var now = NowMs();
        var years = Count(tracks.Select(t => t["year"]));
        var labels = Count(tracks.Select(t => t["label"]));
        var genres = new List<object?>();
        foreach (var t in tracks) foreach (var g in GenresOf(t)) if (!genres.Any(x => Same(x, g))) genres.Add(g);
        var dirs = Count(tracks.Select(t => (object?)NodePath.Dirname(Js.Str(t["path"]))));
        var dir = dirs.Count > 0 ? Js.Str(dirs[0]) : "";
        if (ScanNames.DiscDir().IsMatch(NodePath.Basename(dir))) dir = NodePath.Dirname(dir);
        // Folder art: the album's own folder, then each disc folder.
        string? art = null;
        foreach (var d in new[] { dir }.Concat(dirs.Select(x => Js.Str(x))))
        {
            var list = imagesByDir != null && imagesByDir.TryGetValue(d, out var imgs) ? imgs : ListImages(d);
            art = PickArt(list);
            if (art != null) break;
        }
        var lossy = tracks.Any(t => !Js.Truthy(t["lossless"]));
        var maxRate = JsMax(tracks.Select(t => Js.Truthy(t["sample_rate"]) ? t["sample_rate"] : 0.0));
        var maxBits = JsMax(tracks.Select(t => Js.Truthy(t["bits"]) ? t["bits"] : 0.0));
        var containers = Count(tracks.Select(t => t["container"]));
        var duration = 0.0;
        foreach (var t in tracks) duration += Js.Truthy(t["duration"]) ? Js.ToNumber(t["duration"]) : 0;
        var addedAt = JsMin(tracks.Select(t => t["mtime"]));
        object? First(List<object?> l) => l.Count > 0 ? l[0] : null;
        Exec(@"UPDATE albums SET year=$year, date=$date, label=$label, genres=$genres, dir=$dir, art_path=$art_path, art_embedded=$art_embedded,
                 art_hash=$art_hash, track_count=$track_count, duration=$duration, max_rate=$max_rate, max_bits=$max_bits,
                 lossless=$lossless, container=$container, added_at=$added_at,
                 barcode=$barcode, catno=$catno, country=$country, mb_album=$mb_album, mb_group=$mb_group, updated_at=$now WHERE id=$id",
            ("$id", id),
            ("$year", First(years)),
            ("$date", AlbumDateOf(tracks.Select(t => t["date"]), First(years))),
            ("$label", First(labels)),
            ("$genres", Js.Json(genres.Take(8).ToList())),
            ("$dir", dir),
            ("$art_path", art),
            ("$art_embedded", art != null ? null : tracks[0]["path"]),
            ("$art_hash", art != null ? ArtHash(art) : ArtHash(Js.Str(tracks[0]["path"]))),
            ("$track_count", (double)tracks.Count),
            ("$duration", duration),
            ("$max_rate", OrNull(maxRate)),
            ("$max_bits", OrNull(maxBits)),
            ("$lossless", lossy ? 0.0 : 1.0),
            ("$container", First(containers)),
            ("$added_at", addedAt == 0 || double.IsNaN(addedAt) ? now : addedAt),
            // The release's identifiers: what most of its tracks say.
            ("$barcode", First(Count(tracks.Select(t => t["barcode"])))),
            ("$catno", First(Count(tracks.Select(t => t["catno"])))),
            ("$country", First(Count(tracks.Select(t => t["country"])))),
            ("$mb_album", First(Count(tracks.Select(t => t["mb_album"])))),
            ("$mb_group", First(Count(tracks.Select(t => t["mb_group"])))),
            ("$now", now));
    }

    /* Tracks under dir out of the library ([which]: only those it says) (scanner.js removeUnder, v0.8.34). */
    public int RemoveUnder(string dir, Func<string, bool>? which = null)
    {
        var d = NodePath.Resolve(dir);
        var n = 0;
        Transaction(() =>
        {
            foreach (var r in All("SELECT id, path FROM tracks"))
            {
                var p = Js.Str(r["path"]);
                if (NodePath.IsInside(p, d) && p != d && (which == null || which(p))) { Exec("DELETE FROM tracks WHERE id = $id", ("$id", r["id"])); n++; }
            }
            DropEmptyAlbums();
        });
        return n;
    }

    /* Tracks the library has under dir (scanner.js countUnder, v0.8.34). */
    public double CountUnder(string dir)
    {
        var d = NodePath.Resolve(dir);
        var like = LikeEscapes().Replace(d, m => "\\" + m.Value) + "/%";
        return Js.ToNumber(Get("SELECT COUNT(*) AS n FROM tracks WHERE path LIKE $l ESCAPE '\\'", ("$l", like))!["n"]);
    }

    [System.Text.RegularExpressions.GeneratedRegex(@"[\\%_]")]
    private static partial System.Text.RegularExpressions.Regex LikeEscapes();

    /* Albums left with no tracks go — their ids kept, for when they come back. */
    private void DropEmptyAlbums()
    {
        foreach (var r in All("SELECT a.id, a.key FROM albums a LEFT JOIN tracks t ON t.album_id = a.id WHERE t.id IS NULL"))
        {
            Exec("INSERT INTO album_ids(key, id) VALUES($k, $id) ON CONFLICT(key) DO UPDATE SET id = excluded.id", ("$k", r["key"]), ("$id", r["id"]));
            Exec("DELETE FROM albums WHERE id = $id", ("$id", r["id"]));
        }
    }

    // ------------------------------------------------------------ the scan

    private sealed class Known(JsObj r)
    {
        public readonly object? Id = r["id"];
        public string Path = Js.Str(r["path"]);
        public readonly object? Mtime = r["mtime"];
        public readonly object? Size = r["size"];
        public readonly object? AlbumId = r["album_id"];
        public readonly object? Year = r["year"];
        public readonly object? Date = r["date"];
        public readonly object? TagsV = r["tags_v"];
    }

    /* A file of a folder: unchanged (its row as it is), or read now. */
    private sealed record Pending(Known? Prev, JsObj? Read);

    /* A folder's files read, side by side on the cores playback doesn't keep, each thread at the lowest priority. */
    private sealed class Readers : IDisposable
    {
        private readonly BlockingCollection<Action> work = new();
        public Readers(int n)
        {
            for (var i = 0; i < n; i++)
            {
                new Thread(() =>
                {
                    Cpu.LowerThisThread();
                    foreach (var a in work.GetConsumingEnumerable()) a();
                }) { IsBackground = true, Name = "tags" }.Start();
            }
        }

        public (JsObj? Tags, string? Error)[] Read(List<string> files)
        {
            var res = new (JsObj?, string?)[files.Count];
            if (files.Count == 0) return res;
            using var done = new CountdownEvent(files.Count);
            for (var i = 0; i < files.Count; i++)
            {
                var j = i;
                work.Add(() =>
                {
                    try { res[j] = (TagReader.ReadTags(files[j]), null); }
                    catch (Exception e) { res[j] = (null, e is JsError ? e.Message : e.GetType().Name + ": " + e.Message); }
                    finally { done.Signal(); }
                });
            }
            done.Wait();
            return res;
        }

        public void Dispose() => work.CompleteAdding();
    }

    public JsObj Scan(bool force)
    {
        var t0 = NowMs();
        State.Running = true; State.Progress = 0; State.Files = 0; State.Parsed = 0; State.Errors = 0; State.StartedAt = t0; State.FinishedAt = null;
        log("[scan] made by the C# server, its tags read a few files at a time on the cores playback doesn't keep");
        var roots = Roots();
        var present = roots.Where(NodeFs.Exists).ToList();
        if (present.Count == 0)
        {
            // Nothing to read at all: every track is kept as it was.
            State.Running = false;
            var none = new JsObj();
            none["status"] = "no-music";
            none["root"] = roots.Count > 0 ? roots[0] : root;
            none["roots"] = roots.Select(r => (object?)r).ToList();
            State.LastResult = none;
            log($"[scan] {(roots.Count > 0 ? string.Join(", ", roots) : root)} not found — mount your music there, or add a folder in Settings → Music folders");
            return none;
        }
        // Once after v0.6.0-RC8's key change: every folder regrouped (no tags read again).
        var regroup = Js.Truthy(Setting("album_regroup", false));
        claimed = [];   // albums given to a group in this scan: not taken over by another
        var known = new OrderedMap<Known>();
        foreach (var r in All("SELECT id, path, mtime, size, album_id, year, date, tags_v FROM tracks")) known.Set(Js.Str(r["path"]), new Known(r));
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var touched = new OrderedIds();
        var imagesByDir = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        double added = 0, changed = 0;
        double knownTotal = known.Count > 0 ? known.Count : 1;

        // A file that is the same file under a new path — the music mounted at a
        // different place, or a folder renamed — is recognised by its size,
        // modification time and name, and keeps its track (and album, plays,
        // playlists, edits) instead of being read again from scratch.
        static string IdOf(object? size, object? mtime, string file) => Js.Str(size) + "|" + Js.Str(mtime) + "|" + NodePath.Basename(file);
        var byIdentity = new Dictionary<string, List<Known>>(StringComparer.Ordinal);
        foreach (var r in known.Values)
        {
            var k = IdOf(r.Size, r.Mtime, r.Path);
            if (!byIdentity.TryGetValue(k, out var l)) byIdentity[k] = l = [];
            l.Add(r);
        }
        double relocated = 0;
        Known? Relocate(string file, double size, double mtime)
        {
            if (!byIdentity.TryGetValue(IdOf(size, mtime, file), out var list)) return null;
            var i = list.FindIndex(r => !seen.Contains(r.Path) && !NodeFs.Exists(r.Path));
            if (i < 0) return null;
            var r = list[i];
            list.RemoveAt(i);
            Exec("UPDATE tracks SET path = $p WHERE id = $id", ("$p", file), ("$id", r.Id));
            known.Delete(r.Path);
            r.Path = file;
            known.Set(file, r);
            relocated++;
            return r;
        }
        var lastProgress = NowMs();
        var listed = new HashSet<string>(StringComparer.Ordinal);
        var unreadable = new HashSet<string>(StringComparer.Ordinal);
        using var readers = new Readers(Math.Max(1, slots));

        void OnDir(string dir, List<string> files, List<string> images, List<DiscImages> discImages)
        {
            imagesByDir[dir] = images;
            foreach (var di in discImages) imagesByDir[di.Dir] = di.Images;
            if (files.Count == 0) return;
            var rows = new List<Pending?>();
            var toRead = new List<(string File, double Mtime, double Size, Known? Prev, int At)>();
            foreach (var file in files)
            {
                seen.Add(file);
                State.Files++;
                if (!NodeFs.TryStat(file, follow: true, out var st)) continue;
                var mtime = Math.Floor(st.MtimeMs);
                var prev = known.Get(file);
                if (prev == null && !force)
                {
                    var moved = Relocate(file, st.Size, mtime);
                    if (moved != null) { touched.Add(Js.ToNumber(moved.AlbumId)); rows.Add(new Pending(moved, null)); continue; }
                }
                // (A track read before release dates were kept, or before every tag was: read once more.)
                if (!force && prev != null && Js.StrictEq(prev.Mtime, mtime) && Js.StrictEq(prev.Size, st.Size)
                    && !(Js.Truthy(prev.Year) && !Js.Truthy(prev.Date)) && Js.ToNumber(Js.Truthy(prev.TagsV) ? prev.TagsV : 0.0) >= TagsV)
                {
                    rows.Add(new Pending(prev, null));
                    continue;
                }
                toRead.Add((file, mtime, st.Size, prev, rows.Count));
                rows.Add(null);
            }
            var dirty = toRead.Count > 0;
            var readings = readers.Read(toRead.Select(x => x.File).ToList());
            for (var i = 0; i < toRead.Count; i++)
            {
                var x = toRead[i];
                var (tags, error) = readings[i];
                if (tags != null)
                {
                    // Untagged, or partly: the rest from the folder and file names (v0.6.0-RC10).
                    if (Js.Truthy(tags["tagged"])) ScanNames.Fill(tags, x.File, Roots(), (JsObj)tags["tagged"]!);
                    State.Parsed++;
                    var row = new JsObj();
                    row["path"] = x.File;
                    row["mtime"] = x.Mtime;
                    row["size"] = x.Size;
                    row["prev_album"] = x.Prev != null ? x.Prev.AlbumId : null;
                    foreach (var k in tags.Keys) row[k] = tags[k];
                    rows[x.At] = new Pending(null, row);
                    if (x.Prev != null) changed++; else added++;
                }
                else
                {
                    State.Errors++;
                    if (State.Errors <= 20) log($"[scan] could not read {x.File}: {error}");
                }
                State.Progress = Math.Min(99, Js.Round(100 * State.Files / Math.Max(knownTotal, State.Files + 1)));
            }
            if (!dirty && !regroup) return;
            // Regroup the whole folder, unchanged neighbours included.
            var full = new List<JsObj>();
            foreach (var p in rows)
            {
                if (p == null) continue;
                if (p.Read != null) { full.Add(p.Read); continue; }
                var t = Get("SELECT * FROM tracks WHERE path = $p", ("$p", p.Prev!.Path))
                    ?? throw new JsError("Cannot read properties of undefined (reading 'genres')");
                var o = new JsObj();
                o["unchanged"] = true;
                o["genres"] = JsJson.Parse(Js.Truthy(t["genres"]) ? Js.Str(t["genres"]) : "[]");
                foreach (var k in t.Keys) o[k] = t[k];
                full.Add(o);
            }
            var groups = GroupDir(dir, full);
            var now = NowMs();
            Transaction(() =>
            {
                foreach (var g in groups)
                {
                    var albumId = AlbumIdFor(g, dir, now);
                    touched.Add(albumId);
                    foreach (var r in g.Rows)
                    {
                        if (Js.Truthy(r["unchanged"]))
                        {
                            if (!Js.StrictEq(r["album_id"], albumId))
                            {
                                touched.Add(Js.ToNumber(r["album_id"]));
                                Exec("UPDATE tracks SET album_id = $a WHERE id = $id", ("$a", albumId), ("$id", r["id"]));
                            }
                            continue;
                        }
                        var path = Js.Str(r["path"]);
                        var prev = known.Get(path);
                        if (prev != null) touched.Add(Js.ToNumber(prev.AlbumId));
                        object? Or(object? v) => Js.Truthy(v) ? v : null;
                        object? Nul(object? v) => Js.IsNullish(v) ? null : v;
                        Exec(UpsertTrack,
                            ("$album_id", albumId), ("$path", r["path"]), ("$mtime", r["mtime"]), ("$size", r["size"]), ("$title", r["title"]), ("$artist", r["artist"]),
                            ("$album_artist", r["album_artist"]), ("$album", r["album"]), ("$track_no", r["track_no"]), ("$disc_no", r["disc_no"]), ("$duration", r["duration"]),
                            ("$codec", r["codec"]), ("$container", r["container"]), ("$sample_rate", r["sample_rate"]), ("$bits", r["bits"]), ("$channels", r["channels"]),
                            ("$lossless", r["lossless"]), ("$year", r["year"]), ("$date", Or(r["date"])), ("$label", r["label"]),
                            ("$genres", Js.Json(Js.Truthy(r["genres"]) ? r["genres"] : new List<object?>())),
                            ("$tags_v", TagsV), ("$isrc", Or(r["isrc"])), ("$barcode", Or(r["barcode"])), ("$catno", Or(r["catno"])), ("$country", Or(r["country"])),
                            ("$mb_album", Or(r["mb_album"])), ("$mb_group", Or(r["mb_group"])), ("$mb_recording", Or(r["mb_recording"])),
                            ("$rg_track_gain", Nul(r["rg_track_gain"])), ("$rg_track_peak", Nul(r["rg_track_peak"])),
                            ("$rg_album_gain", Nul(r["rg_album_gain"])), ("$rg_album_peak", Nul(r["rg_album_peak"])),
                            ("$names_from", Or(r["names_from"])));
                        var tid = Get("SELECT id FROM tracks WHERE path = $p", ("$p", path));
                        if (tid != null) Exec("INSERT INTO track_tags(track_id, tags) VALUES($id, $t) ON CONFLICT(track_id) DO UPDATE SET tags = excluded.tags",
                            ("$id", tid["id"]), ("$t", Js.Json(Js.Truthy(r["tags"]) ? r["tags"] : new JsObj())));
                        // A file changed on disk is measured again (lib/loudness.js).
                        if (tid != null && prev != null && (!Js.StrictEq(prev.Mtime, r["mtime"]) || !Js.StrictEq(prev.Size, r["size"])))
                            Exec("DELETE FROM track_loudness WHERE track_id = $id", ("$id", tid["id"]));
                    }
                }
                // Ready to show and play now, not only when the whole scan ends.
                foreach (var g in groups)
                {
                    var id = Get("SELECT id FROM albums WHERE key = $k", ("$k", g.Key));
                    if (id != null) RefreshAlbum(Js.ToNumber(id["id"]), imagesByDir);
                }
            });
            if (OnProgress != null && NowMs() - lastProgress > 5000)
            {
                lastProgress = NowMs();
                OnProgress();
            }
        }

        foreach (var r in present) Walk(r, OnDir, listed, unreadable);

        // A file that wasn't found is removed only when the folder it was in (or,
        // the album's folder gone, the nearest one above it) was read in full
        // this time and it wasn't there. Everything else is kept as it was, and
        // checked again next scan: a watched folder missing or empty, a folder
        // that couldn't be read, most of a folder gone at once.
        string? RootOf(string p) => roots.Where(r => NodePath.IsInside(p, r)).OrderByDescending(r => r.Length).FirstOrDefault();
        var emptyDirs = new Dictionary<string, bool>(StringComparer.Ordinal);
        bool IsEmptyDir(string d)
        {
            if (emptyDirs.TryGetValue(d, out var e)) return e;
            try { e = NodeFs.ReadDirNames(d).All(n => n.StartsWith('.')); } catch (IOException) { e = false; }
            return emptyDirs[d] = e;
        }
        var existing = new Dictionary<string, bool>(StringComparer.Ordinal);
        bool Exists(string d) => existing.TryGetValue(d, out var x) ? x : existing[d] = NodeFs.Exists(d);
        var seenTops = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in seen)
        {
            var r = RootOf(p);
            seenTops.Add(r != null ? NodePath.Join(r, NodePath.Relative(r, p).Split('/')[0]) : p);
        }
        var offline = new List<(string Dir, string Reason, int Tracks)>();
        var offlineAt = new Dictionary<string, int>(StringComparer.Ordinal);
        void Keep(string d, string reason)
        {
            if (offlineAt.TryGetValue(d, out var i)) offline[i] = (offline[i].Dir, offline[i].Reason, offline[i].Tracks + 1);
            else { offlineAt[d] = offline.Count; offline.Add((d, reason, 1)); }
        }
        // folder → tracks that would go (null: in no watched folder), in the order first met
        var gone = new List<(string? Group, List<Known> Rows)>();
        var goneAt = new Dictionary<string, int>(StringComparer.Ordinal);
        const string NoGroup = "\u0000";
        void Gone(string? group, Known r)
        {
            var k = group ?? NoGroup;
            if (!goneAt.TryGetValue(k, out var i)) { goneAt[k] = i = gone.Count; gone.Add((group, [])); }
            gone[i].Rows.Add(r);
        }
        var knownIn = new List<(string Group, int N)>();
        var knownInAt = new Dictionary<string, int>(StringComparer.Ordinal);
        double removed = 0;
        var musicRoot = NodePath.Resolve(root);
        foreach (var (p, r) in known.Entries)
        {
            // A streamed track (lib/services) has no file: never the scanner's to remove.
            if (p.Contains("://", StringComparison.Ordinal)) continue;
            var rootOf = RootOf(p);
            // In no watched folder: gone. Folders removed in Settings take their tracks with them there.
            if (rootOf == null) { if (!seen.Contains(p)) Gone(null, r); continue; }
            var rel = NodePath.Relative(rootOf, p).Split('/');
            var group = rel.Length > 1 ? NodePath.Join(rootOf, rel[0]) : rootOf;
            if (knownInAt.TryGetValue(group, out var ki)) knownIn[ki] = (group, knownIn[ki].N + 1);
            else { knownInAt[group] = knownIn.Count; knownIn.Add((group, 1)); }
            if (seen.Contains(p)) continue;
            if (!present.Contains(rootOf) || IsEmptyDir(rootOf)) { Keep(rootOf, Exists(rootOf) ? "empty" : "missing"); continue; }
            // In the music folder the server was started with, each folder in it is usually a drive mounted there: one missing or empty is kept the same way.
            if (group != rootOf && rootOf == musicRoot && !seenTops.Contains(group) && (!Exists(group) || IsEmptyDir(group)))
            {
                Keep(group, Exists(group) ? "empty" : "missing");
                continue;
            }
            var d = p;
            var verdict = "keep";
            for (; ; )
            {
                if (unreadable.Contains(d)) break;
                if (d != p && listed.Contains(d)) { verdict = "remove"; break; }
                if (d == rootOf) break;
                d = NodePath.Dirname(d);
            }
            if (verdict == "keep") { Keep(group, "unreadable"); continue; }
            Gone(group, r);
        }
        // The same, over a whole watched folder: many small folders gone at once.
        bool TooMany(double n, double of) => n > massRemoval && n > 0.25 * of;
        var goneByRoot = new Dictionary<string, double>(StringComparer.Ordinal);
        var knownByRoot = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var (group, n) in knownIn) { var r = RootOf(group) ?? NoGroup; knownByRoot[r] = knownByRoot.GetValueOrDefault(r) + n; }
        foreach (var (group, rows) in gone) if (group != null) { var r = RootOf(group) ?? NoGroup; goneByRoot[r] = goneByRoot.GetValueOrDefault(r) + rows.Count; }
        Transaction(() =>
        {
            foreach (var (group, rows) in gone)
            {
                var rootOf = group != null ? RootOf(group) : null;
                var whole = rootOf != null && TooMany(goneByRoot.GetValueOrDefault(rootOf), knownByRoot.GetValueOrDefault(rootOf));
                if (group != null && (whole || TooMany(rows.Count, knownInAt.TryGetValue(group, out var gi) ? knownIn[gi].N : 0)))
                {
                    for (var i = 0; i < rows.Count; i++) Keep(whole ? rootOf! : group, "vanished");
                    continue;
                }
                foreach (var r in rows)
                {
                    Exec("DELETE FROM tracks WHERE id = $id", ("$id", r.Id));
                    touched.Add(Js.ToNumber(r.AlbumId));
                    removed++;
                }
            }
        });
        var words = new Dictionary<string, string> { ["missing"] = "is missing", ["empty"] = "is empty", ["unreadable"] = "couldn't all be read", ["vanished"] = "has lost most of its files at once" };
        foreach (var (d, reason, n) in offline) log($"[scan] {d} {words[reason]} — kept its {Js.Num(n)} tracks as they were");
        Transaction(() =>
        {
            foreach (var id in touched.Items) RefreshAlbum(id, imagesByDir);
            DropEmptyAlbums();
        });

        var albums = Js.ToNumber(Get("SELECT COUNT(*) AS n FROM albums")!["n"]);
        var tracksN = Js.ToNumber(Get("SELECT COUNT(*) AS n FROM tracks")!["n"]);
        var result = new JsObj();
        result["status"] = added != 0 || changed != 0 || removed != 0 || relocated != 0 || regroup ? "updated" : "unchanged";
        result["added"] = added;
        result["changed"] = changed;
        result["removed"] = removed;
        result["relocated"] = relocated;
        result["kept_offline"] = (double)offline.Sum(o => o.Tracks);
        result["albums"] = albums;
        result["tracks"] = tracksN;
        // Each folder whose tracks were kept, for the page's notice.
        result["offline_dirs"] = offline.Select(o =>
        {
            var x = new JsObj();
            x["dir"] = o.Dir;
            x["name"] = NodePath.Basename(o.Dir);
            x["tracks"] = (double)o.Tracks;
            x["reason"] = o.Reason;
            x["missing"] = !NodeFs.Exists(o.Dir);
            return (object?)x;
        }).ToList();
        result["roots"] = roots.Select(r => (object?)r).ToList();
        result["errors"] = State.Errors;
        var ms = NowMs() - t0;
        result["ms"] = ms;
        // The regroup done everywhere it could be: not asked again.
        if (regroup && offline.Count == 0) SetSetting("album_regroup", false);
        State.Running = false;
        State.Progress = 100;
        State.FinishedAt = NowMs();
        State.LastResult = result;
        log($"[scan] {result["status"]}: +{Js.Num(added)} ~{Js.Num(changed)} -{Js.Num(removed)}{(relocated != 0 ? $" moved {Js.Num(relocated)}" : "")} files; "
            + $"{Js.Num(albums)} albums, {Js.Num(tracksN)} tracks in {(ms / 1000).ToString("F1", System.Globalization.CultureInfo.InvariantCulture)}s");
        return result;
    }

    private const string UpsertTrack = @"INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration,
          codec, container, sample_rate, bits, channels, lossless, year, date, label, genres,
          tags_v, isrc, barcode, catno, country, mb_album, mb_group, mb_recording,
          rg_track_gain, rg_track_peak, rg_album_gain, rg_album_peak, names_from)
        VALUES($album_id, $path, $mtime, $size, $title, $artist, $album_artist, $album, $track_no, $disc_no, $duration,
          $codec, $container, $sample_rate, $bits, $channels, $lossless, $year, $date, $label, $genres,
          $tags_v, $isrc, $barcode, $catno, $country, $mb_album, $mb_group, $mb_recording,
          $rg_track_gain, $rg_track_peak, $rg_album_gain, $rg_album_peak, $names_from)
        ON CONFLICT(path) DO UPDATE SET album_id=excluded.album_id, mtime=excluded.mtime, size=excluded.size,
          title=excluded.title, artist=excluded.artist, album_artist=excluded.album_artist, album=excluded.album,
          track_no=excluded.track_no, disc_no=excluded.disc_no, duration=excluded.duration, codec=excluded.codec,
          container=excluded.container, sample_rate=excluded.sample_rate, bits=excluded.bits, channels=excluded.channels,
          lossless=excluded.lossless, year=excluded.year, date=excluded.date, label=excluded.label, genres=excluded.genres,
          tags_v=excluded.tags_v, isrc=excluded.isrc, barcode=excluded.barcode, catno=excluded.catno, country=excluded.country,
          mb_album=excluded.mb_album, mb_group=excluded.mb_group, mb_recording=excluded.mb_recording,
          rg_track_gain=excluded.rg_track_gain, rg_track_peak=excluded.rg_track_peak,
          rg_album_gain=excluded.rg_album_gain, rg_album_peak=excluded.rg_album_peak, names_from=excluded.names_from";
}
