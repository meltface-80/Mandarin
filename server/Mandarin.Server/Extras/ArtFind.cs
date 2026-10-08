// ArtFind.cs — looking for a missing cover on the web (v0.8.22): lib/library/
// artfind.js, rule for rule.
//
// Three catalogues with open, key-free search: Apple's (iTunes Search), Deezer
// and MusicBrainz with the Cover Art Archive. Each hit is scored against the
// album as it is on disk — its title, its artist and, most tellingly, its
// track names: a record with the same songs in it is the same record, however
// the title is spelled. Only a hit that agrees on all three is "sure" and
// picked without asking; anything less is offered as a suggestion.
//
// The answers are read as JavaScript reads them (JsJson), so an odd one does
// here what it does there: a field that isn't there is undefined, a list that
// isn't one stops that catalogue's part.
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static partial class ArtFind
{
    private const double SureTracks = 0.6, SureArtist = 0.8, SureTitle = 0.8;

    /* get(url): the answer as JSON, or an error. */
    public delegate Task<object?> Get(string url);

    // ------------------------------------------------------------ comparison

    [GeneratedRegex(@"\s*[(\[][^)\]]*[)\]]\s*", RegexOptions.CultureInvariant)]
    private static partial Regex Brackets();
    [GeneratedRegex(@"\s*[(\[][^)\]]*(remaster|deluxe|edition|expanded|anniversary|bonus|mono|stereo|version|reissue|explicit|clean)[^)\]]*[)\]]\s*", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Edition();

    // String(s || "") and String(s == null ? "" : s).
    private static string Or(object? v) => Js.Truthy(v) ? Js.Str(v) : "";
    private static string Fold(object? v) => Names.Fold(Js.IsNullish(v) ? "" : Js.Str(v));

    /* Every bracketed part dropped: "Untitled #1 (Vaka)" and "Untitled 1" are one song. */
    public static string Bare(object? s) => Names.Fold(Brackets().Replace(Or(s), " "));
    /* normalize.js loose: edition noise dropped. */
    public static string Loose(object? s) => Names.Fold(Edition().Replace(Or(s), " "));

    private static double Dice(string a, string b)
    {
        var A = a.Split(' ').Where(x => x.Length > 0).ToList();
        var B = b.Split(' ').Where(x => x.Length > 0).ToList();
        if (A.Count == 0 || B.Count == 0) return 0;
        var pool = new List<string>(B);
        var hit = 0;
        foreach (var t in A)
        {
            var i = pool.IndexOf(t);
            if (i >= 0) { hit++; pool.RemoveAt(i); }
        }
        return 2.0 * hit / (A.Count + B.Count);
    }

    public static double SameText(object? a, object? b)
    {
        string la = Loose(a), lb = Loose(b);
        if (la.Length == 0 && lb.Length == 0) return 1;
        if (la.Length == 0 || lb.Length == 0) return 0;
        if (la == lb || Bare(a) == Bare(b)) return 1;
        return Dice(la, lb);
    }

    public static double SameArtist(object? a, object? b)
    {
        string fa = Fold(a), fb = Fold(b);
        if (fa.Length == 0 || fb.Length == 0) return 0;
        if (fa == fb) return 1;
        if (Names.SortName(Or(a)) == Names.SortName(Or(b))) return 1;
        if (fa.Contains(fb, StringComparison.Ordinal) || fb.Contains(fa, StringComparison.Ordinal)) return 0.9;
        if (Names.SplitArtists(Or(a)).Select(n => Names.Fold(n)).Contains(fb)) return 0.9;
        return Dice(fa, fb);
    }

    /* What share of the album's own tracks turn up in the candidate's list. */
    public static double? TrackMatch(List<object?> local, List<object?>? remote)
    {
        if (local.Count == 0 || remote == null || remote.Count == 0) return null;
        var r = remote.Select(t => (L: Loose(t), B: Bare(t))).ToList();
        var hit = 0;
        foreach (var t in local)
        {
            string l = Loose(t), b = Bare(t);
            if (l.Length == 0 && b.Length == 0) continue;
            if (r.Any(x => x.L == l || (b.Length > 0 && x.B == b) || Dice(l, x.L) >= 0.8)) hit++;
        }
        return (double)hit / local.Count;
    }

    private sealed class Cand
    {
        public string Source = "";
        public object? Id, Title, Artist, Year, TrackCount, Url, Thumb;
        public Func<Task<List<object?>>>? Tracks;
        public Func<Task<bool>>? Check;
        public List<object?>? TrackList;
        public double? MTitle, MTracks;
        public double MArtist, Score;
        public bool Sure, Dead;
    }

    private static void Score(Cand c, string title, string artist, List<object?> local)
    {
        var titleKnown = Loose(title).Length > 0;
        c.MTitle = titleKnown ? SameText(title, c.Title) : null;
        c.MArtist = SameArtist(artist, c.Artist);
        c.MTracks = TrackMatch(local, c.TrackList);
        var t = c.MTitle ?? 0.5;
        c.Score = c.MTracks == null
            ? 0.9 * (0.55 * t + 0.45 * c.MArtist)
            : 0.3 * t + 0.25 * c.MArtist + 0.45 * c.MTracks.Value;
        c.Sure = c.MTracks != null && c.MTracks.Value >= SureTracks && c.MArtist >= SureArtist && (c.MTitle == null || c.MTitle.Value >= SureTitle);
    }

    // ------------------------------------------------- JavaScript's reading

    /* o.k: undefined on a primitive, a TypeError on null or undefined. */
    private static object? F(object? o, string k) => o switch
    {
        null or Undef => throw new JsError($"Cannot read properties of {Js.Str(o)} (reading '{k}')"),
        JsObj j => j[k],
        List<object?> l when k == "length" => (double)l.Count,
        string s when k == "length" => (double)s.Length,
        _ => Undef.V
    };
    /* (v || []) for a list's methods: a TypeError when it isn't one. */
    private static List<object?> Arr(object? v) => !Js.Truthy(v) ? [] : v as List<object?> ?? throw new JsError("not an array");
    /* !!(v || []).length */
    private static bool HasLength(object? v) => Js.Truthy(v) && Js.Truthy(F(v, "length"));
    // SameValueZero, for a Map's or a Set's keys.
    private static bool Same(object? a, object? b) => a switch
    {
        double x => b is double y && (x == y || (double.IsNaN(x) && double.IsNaN(y))),
        string x => b is string y && x == y,
        bool x => b is bool y && x == y,
        null => b is null,
        Undef => b is Undef,
        _ => ReferenceEquals(a, b)
    };
    // String(x).slice(0, 4)
    private static string First4(object? v) { var s = Js.Str(v); return s.Length > 4 ? s[..4] : s; }

    // ---------------------------------------------------------------- sources

    [GeneratedRegex(@"/[0-9]+x[0-9]+(bb)?\.(jpg|png|webp)\z", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Sized();
    private static string Hi(object? url) => Sized().Replace(Or(url), "/1200x1200bb.jpg", 1);
    private static string Thumb300(object? url)
    {
        var s = Js.Str(url);
        var i = s.IndexOf("100x100bb", StringComparison.Ordinal);
        return i < 0 ? s : s[..i] + "300x300bb" + s[(i + 9)..];
    }

    private static async Task<List<Cand>> Itunes(string title, string artist, List<object?> local, Get get)
    {
        var keys = new List<object?>();
        var out_ = new List<Cand>();
        void Add(object? r)
        {
            if (!Js.Truthy(r) || !Js.Truthy(F(r, "collectionId")) || !Js.Truthy(F(r, "artworkUrl100"))) return;
            var id = F(r, "collectionId");
            if (keys.Any(k => Same(k, id))) return;
            keys.Add(id);
            var date = F(r, "releaseDate");
            out_.Add(new Cand
            {
                Source = "Apple Music", Id = Js.Str(id),
                Title = Js.Truthy(F(r, "collectionName")) ? F(r, "collectionName") : "",
                Artist = Js.Truthy(F(r, "artistName")) ? F(r, "artistName") : "",
                Year = Js.Truthy(date) ? Js.StringToNumber(First4(date)) : null,
                TrackCount = Js.Truthy(F(r, "trackCount")) ? F(r, "trackCount") : null,
                Url = Hi(F(r, "artworkUrl100")), Thumb = Thumb300(F(r, "artworkUrl100")),
                Tracks = async () =>
                {
                    var j = await get($"https://itunes.apple.com/lookup?id={Js.Str(id)}&entity=song&limit=200");
                    return Arr(F(j, "results")).Where(x => Js.StrictEq(F(x, "wrapperType"), "track")).Select(x => F(x, "trackName")).ToList();
                }
            });
        }
        var term = string.Join(" ", new[] { artist, title }.Where(x => x.Length > 0));
        // Both asked at once; their hits added album search first, as the tests' answers come.
        var jobs = new List<Task<object?>> { get($"https://itunes.apple.com/search?media=music&entity=album&limit=8&term={Lookups.Encode(term)}") };
        // By a song as well: finds the record when its title is a symbol, a blank
        // or spelled differently from the catalogue's.
        var song = local.FirstOrDefault(t => Bare(t).Length > 3);
        if (song != null) jobs.Add(get($"https://itunes.apple.com/search?media=music&entity=song&limit=10&term={Lookups.Encode(artist + " " + Js.Str(song))}"));
        foreach (var job in jobs)
        {
            try { foreach (var r in Arr(F(await job, "results"))) Add(r); }
            catch (Exception) { /* that search has nothing (Promise.allSettled) */ }
        }
        return out_;
    }

    private static async Task<List<Cand>> Deezer(string title, string artist, List<object?> local, Get get)
    {
        var q = Loose(title).Length > 0
            ? $"artist:\"{artist}\" album:\"{title}\""
            : $"{artist} {(local.Count > 0 && Js.Truthy(local[0]) ? Js.Str(local[0]) : "")}";
        async Task<object?> Ask(string query)
        {
            try { return await get($"https://api.deezer.com/search/album?limit=8&q={Lookups.Encode(query)}"); }
            catch (Exception) { return null; }
        }
        var j = await Ask(q);
        if (!Js.Truthy(j) || !HasLength(F(j, "data"))) j = await Ask(artist + " " + title);
        var data = Js.Truthy(j) ? F(j, "data") : null;
        return Arr(data).Where(r => Js.Truthy(F(r, "cover_xl"))).Select(r =>
        {
            var id = F(r, "id");
            var who = F(r, "artist");
            var name = Js.Truthy(who) ? F(who, "name") : who;
            return new Cand
            {
                Source = "Deezer", Id = Js.Str(id),
                Title = Js.Truthy(F(r, "title")) ? F(r, "title") : "",
                Artist = Js.Truthy(name) ? name : "",
                Year = null,
                TrackCount = Js.Truthy(F(r, "nb_tracks")) ? F(r, "nb_tracks") : null,
                Url = F(r, "cover_xl"),
                Thumb = Js.Truthy(F(r, "cover_big")) ? F(r, "cover_big") : Js.Truthy(F(r, "cover_medium")) ? F(r, "cover_medium") : F(r, "cover_xl"),
                Tracks = async () =>
                {
                    var t = await get($"https://api.deezer.com/album/{Js.Str(id)}/tracks?limit=200");
                    return Arr(F(t, "data")).Select(x => F(x, "title")).ToList();
                }
            };
        }).ToList();
    }

    private static async Task<List<Cand>> MusicBrainz(string title, string artist, Get get)
    {
        if (Loose(title).Length == 0) return [];
        var q = $"release:\"{title.Replace("\"", "")}\" AND artist:\"{artist.Replace("\"", "")}\"";
        var j = await get($"https://musicbrainz.org/ws/2/release/?fmt=json&limit=6&query={Lookups.Encode(q)}");
        var out_ = new List<Cand>();
        var seen = new List<object?>();
        var releases = F(j, "releases");
        // for…of: a string's characters have no release group; anything else that isn't a list can't be gone through.
        if (releases is string) return out_;
        foreach (var r in Arr(releases))
        {
            var group = F(r, "release-group");
            var rg = Js.Truthy(group) ? F(group, "id") : group;
            if (!Js.Truthy(rg) || seen.Any(x => Same(x, rg))) continue;
            seen.Add(rg);
            var credits = F(r, "artist-credit");
            object? firstCredit = Js.Truthy(credits) ? credits switch
            {
                List<object?> l => l.Count > 0 ? l[0] : Undef.V,
                string s => s.Length > 0 ? s[..1] : Undef.V,
                JsObj o => o["0"],
                _ => Undef.V
            } : Undef.V;
            var name = Js.Truthy(firstCredit) ? F(firstCredit, "name") : Undef.V;
            var date = F(r, "date");
            object? year = null;
            if (Js.Truthy(date)) { var y = Js.StringToNumber(First4(date)); year = y != 0 && !double.IsNaN(y) ? y : null; }
            var rgs = Js.Str(rg);
            out_.Add(new Cand
            {
                Source = "MusicBrainz", Id = rg,
                Title = Js.Truthy(F(r, "title")) ? F(r, "title") : "",
                Artist = Js.Truthy(name) ? name : "",
                Year = year,
                TrackCount = Js.Truthy(F(r, "track-count")) ? F(r, "track-count") : null,
                Url = $"https://coverartarchive.org/release-group/{rgs}/front-1200",
                Thumb = $"https://coverartarchive.org/release-group/{rgs}/front-250",
                // Not every release group has a cover: ask the archive before offering it.
                Check = async () =>
                {
                    try { return HasLength(F(await get($"https://coverartarchive.org/release-group/{rgs}"), "images")); }
                    catch (Exception) { return false; }
                }
            });
            if (out_.Count >= 3) break;
        }
        return out_;
    }

    // ------------------------------------------------------------------ find

    private static double Round2(double x) => Js.Round(x * 100) / 100;

    /* → { sure: candidate|null, candidates: [...] }, best first. */
    public static async Task<JsObj> Find(string title, string artist, IEnumerable<object?> trackTitles, Get get, Action<string> log)
    {
        var local = trackTitles.Where(Js.Truthy).ToList();
        var sources = new (string Name, Task<List<Cand>> Job)[]
        {
            ("itunes", Itunes(title, artist, local, get)),
            ("deezer", Deezer(title, artist, local, get)),
            ("musicbrainz", MusicBrainz(title, artist, get))
        };
        var all = new List<Cand>();
        foreach (var (name, job) in sources)
        {
            try { all.AddRange(await job); }
            catch (Exception e) { log($"[art] {name}: {e.Message}"); }
        }

        // A first pass on names alone decides whose track lists are worth fetching.
        foreach (var c in all) Score(c, title, artist, local);
        all = all.OrderByDescending(c => c.Score).ToList();
        await Task.WhenAll(all.Take(8).Select(async c =>
        {
            if (c.Tracks != null)
            {
                try { c.TrackList = await c.Tracks(); }
                catch (Exception) { c.TrackList = null; }
                Score(c, title, artist, local);
            }
            if (c.Check != null && !await c.Check()) c.Dead = true;
        }));
        all = all.Where(c => !c.Dead).OrderByDescending(c => c.Sure ? 1 : 0).ThenByDescending(c => c.Score).ToList();

        var seen = new List<object?>();
        var candidates = new List<object?>();
        foreach (var c in all)
        {
            if (seen.Any(x => Same(x, c.Url))) continue;
            seen.Add(c.Url);
            var match = new JsObj();
            match["title"] = c.MTitle is { } mt ? Round2(mt) : null;
            match["artist"] = Round2(c.MArtist);
            match["tracks"] = c.MTracks is { } mk ? Round2(mk) : null;
            var o = new JsObj();
            o["source"] = c.Source;
            o["title"] = c.Title;
            o["artist"] = c.Artist;
            o["year"] = c.Year;
            o["tracks"] = c.TrackList != null ? (double)c.TrackList.Count : c.TrackCount;
            o["url"] = c.Url;
            o["thumb"] = c.Thumb;
            o["score"] = Round2(c.Score);
            o["match"] = match;
            o["sure"] = c.Sure;
            candidates.Add(o);
            if (candidates.Count >= 12) break;
        }
        var result = new JsObj();
        result["sure"] = candidates.Count > 0 && candidates[0] is JsObj top && top["sure"] is true ? top : null;
        result["candidates"] = candidates;
        return result;
    }

    /* The catalogues as the server asks them: JSON, nine seconds, the app's name. */
    public static Get Web(string userAgent) => url => Lookups.Json(url, [("User-Agent", userAgent), ("Accept", "application/json")], 9000);
}
