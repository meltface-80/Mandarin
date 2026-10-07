// Library.cs — the library, in memory, and the screens that read it (v0.8.4):
// lib/library/index.js and the read routes of lib/server/api-library.js, rule
// for rule. The Library wall, its Focus sheet, search, artists, genres and
// decades, an album's page, the random wall, Favourites and Listen later are
// answered here.
//
// The database is the record and this is a working copy, as the Node server
// keeps one. Which copy is current is the Node server's to say: the scanner,
// edits, hearts and label rules still change the library there. So every
// request first asks it (GET /internal/library, on 127.0.0.1 with the key this
// server started it with) which copy it holds, and the copy here is rebuilt
// from the database when that changed. Hearts and Listen later ("marks")
// change no list's order, so they alone only re-read their own two tables.
//
// Orders are JavaScript's: localeCompare is ICU's collation, which this
// server uses too (so it isn't built with invariant globalization), and every
// sort is stable, as JavaScript's is.
using System.Globalization;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Mandarin.Server;

internal sealed class Album
{
    public long Id;
    public string Title = "", Artist = "", ImageKey = "", Key = "";
    public string NTitle = "", NArtist = "", JTitle = "", JArtist = "";
    public string[] TTitle = [], TArtist = [];
    public string SortTitle = "", SortArtist = "";
    public (string Name, string N)[] ArtistNames = [];
    public long? Year;
    public string? Date;
    public string DateKey = "";
    public List<string> Genres = [];
    public long? Rate, Bits, Added;
    public bool Lossless, Compilation, CustomArt, Edited;
    public string? Container, Dir, Label, Service;
    public int Discs = 1;
    public string ScannedTitle = "", ScannedArtist = "";
    public long? ScannedYear;
    public Box? Box;
    public bool Transient;
    public string? LabelName, LabelKey, LabelSource;
}

internal sealed record Box(string Name, long Disc, long Of, List<long> Ids);

internal sealed record LibState(string Boot, long Version, long Marks, bool Building, JsonNode? Progress, bool LabelsOn, int Depth, List<string> Roots)
{
    public string Sig => Boot + "|" + Version + "|" + LabelsOn + "|" + Depth + "|" + string.Join("\n", Roots);
}

internal sealed class LabelGroup
{
    public string Key = "", Title = "";
    public Dictionary<string, int> Names = [], OwnNames = [];
    public List<Album> Albums = [];
    public List<(string Key, string Display)> MergedFrom = [];
}

internal sealed class Marks(Dictionary<string, long> fav, Dictionary<string, long> later, long n)
{
    public readonly Dictionary<string, long> Fav = fav, Later = later;
    public readonly long N = n;
}

internal sealed partial class Snapshot
{
    public string Sig = "";
    public List<Album> Albums = [];
    public Dictionary<long, Album> ById = [];
    public volatile Marks Marks = new([], [], 0);
    public Dictionary<string, (string Target, string SourceName)> LabelMerges = [];
    public Dictionary<string, Dictionary<string, string>> TrackEdits = [];
    public bool LabelsOn;
    public Dictionary<string, LabelGroup> LabelGroups = [];
    public readonly Dictionary<string, List<Album>> ViewCache = [];

    public int Count => Albums.Count;
    public Album? Find(double id) => !double.IsNaN(id) && id == Math.Floor(id) && ById.TryGetValue((long)id, out var a) ? a : null;

    public string? LabelOf(Album al)
    {
        if (!LabelsOn || al.LabelName == null) return null;
        if (!LabelMerges.TryGetValue(al.LabelKey!, out var m)) return al.LabelName;
        return LabelGroups.TryGetValue(m.Target, out var g) ? g.Title : al.LabelName;
    }
    public string MergedKey(string key) => LabelMerges.TryGetValue(key, out var m) ? m.Target : key;
}

internal static partial class Library
{
    private static readonly CompareInfo Collation = CultureInfo.InvariantCulture.CompareInfo;
    /* a.localeCompare(b) */
    public static int Lc(string a, string b) => Math.Sign(Collation.Compare(a, b, CompareOptions.None));
    private static int LcBase(string a, string b) => Math.Sign(Collation.Compare(a, b, CompareOptions.IgnoreCase | CompareOptions.IgnoreNonSpace | CompareOptions.IgnoreKanaType | CompareOptions.IgnoreWidth));

    private static readonly string[] Services = ["qobuz", "tidal"];
    private static string? ServiceOf(string key) => Services.FirstOrDefault(s => key.StartsWith(s + ":", StringComparison.Ordinal));
    private static string AlbumIdOf(string key, string svc) => key[(svc.Length + 1)..];

    private static readonly string[] Sorts = ["album", "artist", "year", "added", "plays", "lastplayed", "random"];
    private static readonly string[] Played = ["any", "never", "played", "6", "12"];
    private static readonly (string Value, string Label, int Days)[] AddedWindows = [("7", "7 days", 7), ("30", "30 days", 30), ("90", "3 months", 90), ("365", "12 months", 365)];
    private const int ChipMax = 40;
    private const long Day = 86400000;

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    // --------------------------------------------------------------- numbers

    public static string RateShort(long hz)
    {
        if (hz % 1000 == 0) return (hz / 1000).ToString(CultureInfo.InvariantCulture);
        return (hz / 1000.0).ToString("F1", CultureInfo.InvariantCulture);
    }
    private static string? RateLabel(long hz) => hz != 0 ? RateShort(hz) + " kHz" : null;

    [GeneratedRegex("mpeg", RegexOptions.IgnoreCase)] private static partial Regex RxMpeg();
    [GeneratedRegex("flac", RegexOptions.IgnoreCase)] private static partial Regex RxFlac();
    [GeneratedRegex("wave|wav", RegexOptions.IgnoreCase)] private static partial Regex RxWav();
    [GeneratedRegex("aiff", RegexOptions.IgnoreCase)] private static partial Regex RxAiff();
    [GeneratedRegex("dsf|dsd|dff", RegexOptions.IgnoreCase)] private static partial Regex RxDsd();
    [GeneratedRegex("ogg", RegexOptions.IgnoreCase)] private static partial Regex RxOgg();
    [GeneratedRegex("m4a|mp4|isom|m4b|alac", RegexOptions.IgnoreCase)] private static partial Regex RxMp4();
    [GeneratedRegex("wavpack", RegexOptions.IgnoreCase)] private static partial Regex RxWavPack();
    [GeneratedRegex("ape|monkey", RegexOptions.IgnoreCase)] private static partial Regex RxApe();
    private static string? FormatName(string? container, bool lossless)
    {
        var c = container ?? "";
        if (RxMpeg().IsMatch(c) && !lossless) return "MP3";
        if (RxFlac().IsMatch(c)) return "FLAC";
        if (RxWav().IsMatch(c)) return "WAV";
        if (RxAiff().IsMatch(c)) return "AIFF";
        if (RxDsd().IsMatch(c)) return "DSD";
        if (RxOgg().IsMatch(c)) return "Ogg";
        if (RxMp4().IsMatch(c)) return lossless ? "ALAC" : "AAC";
        if (RxWavPack().IsMatch(c)) return "WavPack";
        if (RxApe().IsMatch(c)) return "APE";
        return c.Length > 0 ? c : null;
    }

    // The same order for the same seed, page after page.
    private static uint SeededRank(string s, uint seed)
    {
        uint h = seed;
        foreach (var c in s) h = unchecked(h * 31 + c);
        return h;
    }
    private static uint ToUint32(long v) => unchecked((uint)v);

    private static string? ReleaseDate(long? year, string? tagDate, string? mbDay)
    {
        if (year is null or 0) return null;
        var y = year.Value.ToString(CultureInfo.InvariantCulture);
        var date = tagDate != null && tagDate.StartsWith(y, StringComparison.Ordinal) ? tagDate : y;
        if (mbDay != null)
        {
            string? d = null;
            try { var n = JsonNode.Parse(mbDay); d = n is JsonObject o ? JsString(o["date"]) : null; } catch (JsonException) { /* not ours */ }
            if (!string.IsNullOrEmpty(d) && d.StartsWith(y, StringComparison.Ordinal) && d.Length > date.Length) date = d;
        }
        return date;
    }
    // A JSON value as String(v) would give it, or null for null.
    private static string? JsString(JsonNode? n) => n == null ? null : n is JsonValue v && v.TryGetValue<string>(out var s) ? s : n.ToJsonString();

    private static string DateKey(string? date)
    {
        if (string.IsNullOrEmpty(date)) return "";
        var p = date.Split('-');
        return $"{p[0]}-{(p.Length > 1 && p[1].Length > 0 ? p[1] : "00")}-{(p.Length > 2 && p[2].Length > 0 ? p[2] : "00")}";
    }

    /* A stable sort, as JavaScript's. */
    public static List<T> Sorted<T>(IEnumerable<T> src, Comparison<T> cmp)
    {
        var arr = src.Select((x, i) => (x, i)).ToArray();
        Array.Sort(arr, (a, b) => { int c = cmp(a.x, b.x); return c != 0 ? c : a.i.CompareTo(b.i); });
        return arr.Select(p => p.x).ToList();
    }

    // ------------------------------------------------------------- the state

    private static Uri? upstream;
    private static string frontKey = "";
    private static readonly HttpClient Http = new(new SocketsHttpHandler { UseProxy = false, PooledConnectionIdleTimeout = TimeSpan.FromSeconds(30) }) { Timeout = TimeSpan.FromSeconds(10) };
    private static volatile Snapshot? current;
    private static readonly SemaphoreSlim Building = new(1, 1);

    public static void Init(Uri node, string key) { upstream = node; frontKey = key; }

    private static async Task<LibState?> State()
    {
        if (upstream == null) return null;
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, new Uri(upstream, "/internal/library"));
            req.Headers.Add("X-Mandarin-Front-Key", frontKey);
            using var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) return null;
            var j = (await JsonNode.ParseAsync(await res.Content.ReadAsStreamAsync())) as JsonObject;
            if (j == null) return null;
            var labels = j["labels"] as JsonObject;
            return new LibState(JsString(j["boot"]) ?? "", (long)(j["version"]?.GetValue<double>() ?? 0), (long)(j["marks"]?.GetValue<double>() ?? 0),
                j["building"]?.GetValue<bool>() == true, j["progress"]?.DeepClone(),
                labels?["enabled"]?.GetValue<bool>() == true, (int)(labels?["depth"]?.GetValue<double>() ?? 0),
                (labels?["roots"] as JsonArray)?.Select(x => JsString(x) ?? "").ToList() ?? []);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or JsonException or InvalidOperationException or FormatException)
        {
            return null;
        }
    }

    /* The copy the Node server holds, built here if it isn't already. */
    private static async Task<(Snapshot, LibState)?> Current()
    {
        var st = await State();
        if (st == null) return null;
        var s = current;
        if (s == null || s.Sig != st.Sig)
        {
            await Building.WaitAsync();
            try
            {
                s = current;
                if (s == null || s.Sig != st.Sig)
                {
                    var t0 = Environment.TickCount64;
                    s = await Task.Run(() => Build(st));
                    current = s;
                    var ms = Environment.TickCount64 - t0;
                    if (ms > 500) Front.Log($"[library] {s.Albums.Count} albums read in {ms} ms");
                }
            }
            finally { Building.Release(); }
        }
        if (s.Marks.N != st.Marks)
        {
            using var c = Db.Open();
            s.Marks = ReadMarks(c, st.Marks);
        }
        return (s, st);
    }

    private static Marks ReadMarks(SqliteConnection c, long n) =>
        new(KeyTimes(c, "SELECT key, added_at FROM favourites"), KeyTimes(c, "SELECT key, added_at FROM listen_later"), n);

    private static Dictionary<string, long> KeyTimes(SqliteConnection c, string sql)
    {
        var m = new Dictionary<string, long>();
        foreach (var r in Rows(c, sql)) m[(string)r[0]!] = Long(r[1]) ?? 0;
        return m;
    }

    // ------------------------------------------------------------- the build

    private static List<object?[]> Rows(SqliteConnection c, string sql, params object[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (int i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), args[i]);
        using var r = cmd.ExecuteReader();
        var list = new List<object?[]>();
        while (r.Read())
        {
            var row = new object?[r.FieldCount];
            for (int i = 0; i < r.FieldCount; i++) row[i] = r.IsDBNull(i) ? null : r.GetValue(i);
            list.Add(row);
        }
        return list;
    }
    private static Dictionary<string, int> Columns(SqliteConnection c, string sql, params object[] args)
    {
        using var cmd = c.CreateCommand();
        cmd.CommandText = sql;
        for (int i = 0; i < args.Length; i++) cmd.Parameters.AddWithValue("$" + (i + 1), args[i]);
        using var r = cmd.ExecuteReader(System.Data.CommandBehavior.SchemaOnly);
        var m = new Dictionary<string, int>();
        for (int i = 0; i < r.FieldCount; i++) m.TryAdd(r.GetName(i), i);
        return m;
    }

    // A column as JavaScript's `x || null` reads it: 0, "" and null are nothing.
    private static long? Long(object? v) => v switch
    {
        long l => l == 0 ? null : l,
        double d => d == 0 || double.IsNaN(d) ? null : (long)d,
        string s => long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out var l) && l != 0 ? l : null,
        _ => null
    };
    private static string? Text(object? v) => v switch { null => null, string s => s.Length > 0 ? s : null, long l => l == 0 ? null : l.ToString(CultureInfo.InvariantCulture), _ => v.ToString() };
    private static bool Truthy(object? v) => v switch { null => false, long l => l != 0, double d => d != 0, string s => s.Length > 0, _ => true };

    [GeneratedRegex(@"^the\s+\S", RegexOptions.IgnoreCase)] private static partial Regex TheName();
    [GeneratedRegex(@"^the\s", RegexOptions.IgnoreCase)] private static partial Regex TheStart();

    private static Snapshot Build(LibState st)
    {
        using var c = Db.Open();
        const string sql = @"SELECT a.*, e.title AS e_title, e.artist AS e_artist, e.year AS e_year,
                                    e.art_hash AS e_art_hash, e.art_source AS e_art_source, d.value AS mb_day
                               FROM albums a LEFT JOIN album_edits e ON e.key = a.key
                               LEFT JOIN cache d ON d.ns = 'mbday' AND d.key = a.key
                              ORDER BY a.id";
        var col = Columns(c, sql);
        var rows = Rows(c, sql);
        object? F(object?[] r, string name) => col.TryGetValue(name, out var i) ? r[i] : null;

        // One name per artist whatever the leading "The".
        var theForms = new Dictionary<string, string>();
        foreach (var r in rows)
        {
            var a = Names.JsTrim(Text(F(r, "e_artist")) ?? Text(F(r, "artist")) ?? "");
            if (TheName().IsMatch(a)) theForms.TryAdd(Names.ArtistKey(a), a);
        }
        var discs = new Dictionary<long, long>();
        foreach (var r in Rows(c, "SELECT album_id, COUNT(DISTINCT COALESCE(disc_no, 1)) AS n FROM tracks GROUP BY album_id")) discs[(long)r[0]!] = (long)r[1]!;

        var all = new List<Album>(rows.Count);
        foreach (var r in rows)
        {
            var id = (long)F(r, "id")!;
            var title = Text(F(r, "e_title")) ?? Text(F(r, "title")) ?? "";
            var artist = Text(F(r, "e_artist")) ?? Text(F(r, "artist")) ?? "";
            if (Text(F(r, "e_artist")) == null && !TheStart().IsMatch(artist) && theForms.TryGetValue(Names.ArtistKey(artist), out var the)) artist = the;
            var year = Long(F(r, "e_year")) ?? Long(F(r, "year"));
            var date = ReleaseDate(year, Text(F(r, "date")), Text(F(r, "mb_day")));
            var eArt = Text(F(r, "e_art_hash"));
            var nTitle = Names.Fold(title);
            var nArtist = Names.Fold(artist);
            var lossless = Truthy(F(r, "lossless"));
            var key = (string)F(r, "key")!;
            List<string> genres;
            try { genres = (JsonNode.Parse(Text(F(r, "genres")) ?? "[]") as JsonArray)?.Select(g => JsString(g) ?? "null").ToList() ?? []; }
            catch (JsonException) { genres = []; }
            all.Add(new Album
            {
                Id = id, Title = title, Artist = artist, Key = key,
                ImageKey = eArt != null ? $"al-{id}-e{eArt}" : $"al-{id}-{Text(F(r, "art_hash")) ?? "0"}",
                NTitle = nTitle, NArtist = nArtist,
                TTitle = nTitle.Split(' ', StringSplitOptions.RemoveEmptyEntries),
                TArtist = nArtist.Split(' ', StringSplitOptions.RemoveEmptyEntries),
                JTitle = nTitle.Replace(" ", ""), JArtist = nArtist.Replace(" ", ""),
                SortTitle = (Text(F(r, "e_title")) == null ? Text(F(r, "sort_title")) : null) ?? Names.SortName(title),
                SortArtist = (Text(F(r, "e_artist")) == null ? Text(F(r, "sort_artist")) : null) ?? Names.SortName(artist),
                ArtistNames = Names.SplitArtists(artist).Select(n => (n, Names.Fold(n))).Where(x => x.Item2.Length > 0).ToArray(),
                Year = year, Date = date, DateKey = DateKey(date),
                Genres = genres,
                Rate = Long(F(r, "max_rate")),
                Bits = lossless ? Long(F(r, "max_bits")) : null,
                Lossless = lossless,
                Container = FormatName(Text(F(r, "container")), lossless),
                Added = Long(F(r, "added_at")),
                Compilation = Truthy(F(r, "compilation")),
                Discs = discs.TryGetValue(id, out var dn) && dn != 0 ? (int)dn : 1,
                Dir = Text(F(r, "dir")) ?? (F(r, "dir") as string),
                Label = Text(F(r, "label")),
                CustomArt = eArt != null,
                ScannedTitle = Text(F(r, "title")) ?? "", ScannedArtist = Text(F(r, "artist")) ?? "", ScannedYear = Long(F(r, "year")),
                Edited = Text(F(r, "e_title")) != null || Text(F(r, "e_artist")) != null || Long(F(r, "e_year")) != null || eArt != null,
                Service = ServiceOf(key)
            });
        }

        // One spelling per genre, as most of the library writes it.
        var spellings = new Dictionary<string, List<(string G, int N)>>();
        foreach (var al in all)
            foreach (var g in al.Genres)
            {
                var k = Names.Fold(g);
                if (k.Length == 0) continue;
                if (!spellings.TryGetValue(k, out var list)) spellings[k] = list = [];
                int i = list.FindIndex(x => x.G == g);
                if (i < 0) list.Add((g, 1)); else list[i] = (g, list[i].N + 1);
            }
        var genreAs = new Dictionary<string, string>();
        foreach (var (k, list) in spellings)
        {
            var best = list[0];
            foreach (var x in list.Skip(1)) if (x.N > best.N) best = x;
            genreAs[k] = best.G;
        }
        foreach (var al in all)
            al.Genres = al.Genres.Select(g => genreAs.TryGetValue(Names.Fold(g), out var to) ? to : g).Distinct().ToList();

        BoxSets(c, all);

        // A service's albums on the walls only when kept and its import is on.
        var kept = new HashSet<string>(Rows(c, "SELECT key FROM cache WHERE ns IN ('qobuz-kept', 'tidal-kept')").Select(r => (string)r[0]!));
        var shown = new Dictionary<string, bool>();
        foreach (var id in Services)
            shown[id] = Js.Truthy(Db.Setting(c, id)) && Db.Setting(c, id + "Settings") is JsonObject so && so["import"] is JsonValue iv && iv.TryGetValue<bool>(out var ib) && ib;
        foreach (var a in all) a.Transient = a.Service != null && (!shown[a.Service] || !kept.Contains(a.Key));

        var s = new Snapshot
        {
            Sig = st.Sig,
            Albums = all.Where(a => !a.Transient).ToList(),
            LabelsOn = st.LabelsOn,
        };
        foreach (var a in all) s.ById[a.Id] = a;
        s.Marks = ReadMarks(c, st.Marks);

        // Merged labels, a chain followed to its end.
        var merges = Rows(c, "SELECT source_key, source_name, target_key FROM label_merges");
        var direct = new Dictionary<string, string>();
        foreach (var r in merges) direct[(string)r[0]!] = (string)r[2]!;
        foreach (var r in merges)
        {
            string src = (string)r[0]!, t = (string)r[2]!;
            int hops = 0;
            while (direct.TryGetValue(t, out var next) && hops++ < 20 && t != src) t = next;
            s.LabelMerges[src] = (t, (string)r[1]!);
        }
        var lookups = new Dictionary<string, string>();
        try { foreach (var r in Rows(c, "SELECT key, label FROM label_lookups WHERE label IS NOT NULL")) lookups[(string)r[0]!] = Convert.ToString(r[1], CultureInfo.InvariantCulture)!; }
        catch (SqliteException) { /* an older database without the table */ }
        foreach (var r in Rows(c, "SELECT key, pos, title FROM track_edits WHERE title IS NOT NULL"))
        {
            var k = (string)r[0]!;
            if (!s.TrackEdits.TryGetValue(k, out var m)) s.TrackEdits[k] = m = [];
            m[(string)r[1]!] = Convert.ToString(r[2], CultureInfo.InvariantCulture)!;
        }

        // Each album's label under the rules.
        foreach (var al in s.Albums)
        {
            string? name = st.Depth > 0 ? Names.LabelFromFolder(al.Dir, st.Roots, st.Depth) : null, source = "folder";
            if (string.IsNullOrEmpty(name)) { name = al.Label; source = "tag"; }
            if (Names.IsLikelyNotALabel(name)) name = null;
            if (name == null && lookups.TryGetValue(al.Key, out var looked)) { name = looked; source = "lookup"; }
            al.LabelName = !string.IsNullOrEmpty(name) ? Names.CanonicalLabelName(name) : null;
            al.LabelKey = !string.IsNullOrEmpty(name) ? Names.LabelKey(name) : null;
            al.LabelSource = !string.IsNullOrEmpty(name) ? source : null;
        }
        s.LabelGroups = BuildLabelGroups(s);
        return s;
    }

    [GeneratedRegex(@"^(?:cd|disc|disk)\s*[-_.]?\s*([0-9]+)\s*[-–—:_.]\s*(\S[^\n\r  ]*)\z", RegexOptions.IgnoreCase)]
    private static partial Regex NamedDisc();
    [GeneratedRegex(@"^([^\n\r  ]+?)\s+[-–—]\s+([^\n\r  ]+)\z")]
    private static partial Regex LeadArtist();

    /* Box sets filed as discs that are albums of their own (index.js, boxSets). */
    private static void BoxSets(SqliteConnection c, List<Album> albums)
    {
        var dirs = new Dictionary<long, HashSet<string>>();
        foreach (var r in Rows(c, "SELECT album_id, path FROM tracks"))
        {
            var id = (long)r[0]!;
            if (!dirs.TryGetValue(id, out var set)) dirs[id] = set = [];
            set.Add(Names.Dirname((string)r[1]!));
        }
        var byParent = new Dictionary<string, List<(Album Al, long Disc, string Dir)>>();
        var parents = new List<string>();
        foreach (var al in albums)
        {
            al.Box = null;
            if (!dirs.TryGetValue(al.Id, out var set) || set.Count != 1) continue;
            var dir = set.First();
            var m = NamedDisc().Match(Names.Basename(dir));
            if (!m.Success) continue;
            var parent = Names.Dirname(dir);
            if (!byParent.TryGetValue(parent, out var list)) { byParent[parent] = list = []; parents.Add(parent); }
            list.Add((al, double.TryParse(m.Groups[1].Value, NumberStyles.Float, CultureInfo.InvariantCulture, out var dn) ? (long)dn : 0, dir));
        }
        foreach (var parent in parents)
        {
            var list = byParent[parent];
            if (list.Select(x => x.Dir).Distinct().Count() < 2) continue;
            list = Sorted(list, (a, b) => a.Disc.CompareTo(b.Disc));
            var name = Names.Basename(parent);
            var lead = LeadArtist().Match(name);
            if (lead.Success && list.Any(x => Names.ArtistKey(x.Al.Artist) == Names.ArtistKey(lead.Groups[1].Value))) name = lead.Groups[2].Value;
            var ids = list.Select(x => x.Al.Id).ToList();
            var of = Math.Max(list.Count, list[^1].Disc);
            foreach (var x in list) x.Al.Box = new Box(name, x.Disc, of, ids);
        }
    }

    private static Dictionary<string, LabelGroup> BuildLabelGroups(Snapshot s)
    {
        var m = new Dictionary<string, LabelGroup>();
        var order = new List<LabelGroup>();
        foreach (var al in s.Albums)
        {
            if (al.LabelKey == null) continue;
            var key = s.MergedKey(al.LabelKey);
            if (!m.TryGetValue(key, out var g)) { m[key] = g = new LabelGroup { Key = key }; order.Add(g); }
            g.Albums.Add(al);
            Bump(g.Names, al.LabelName!);
            if (key == al.LabelKey) Bump(g.OwnNames, al.LabelName!);
        }
        foreach (var (src, mg) in s.LabelMerges)
            if (m.TryGetValue(mg.Target, out var g)) g.MergedFrom.Add((src, mg.SourceName));
        // The name most of its own albums use; the shorter one when tied.
        static string Pick(Dictionary<string, int> names) =>
            Sorted(names.ToList(), (a, b) => b.Value != a.Value ? b.Value.CompareTo(a.Value) : a.Key.Length.CompareTo(b.Key.Length))[0].Key;
        foreach (var g in order)
        {
            g.Title = g.OwnNames.Count > 0 ? Pick(g.OwnNames) : Pick(g.Names);
            g.Albums = Sorted(g.Albums, (a, b) => Or(Lc(a.SortTitle, b.SortTitle), () => Lc(a.NArtist, b.NArtist)));
            g.MergedFrom = Sorted(g.MergedFrom, (a, b) => Lc(a.Display, b.Display));
        }
        // Kept in the order first seen, as a Map is.
        var ordered = new Dictionary<string, LabelGroup>();
        foreach (var g in order) ordered[g.Key] = g;
        return ordered;
    }
    private static void Bump(Dictionary<string, int> m, string k) => m[k] = m.TryGetValue(k, out var n) ? n + 1 : 1;
    private static int Or(int a, Func<int> b) => a != 0 ? a : b();
}
