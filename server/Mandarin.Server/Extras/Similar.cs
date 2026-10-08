// Similar.cs — acts worth hearing next, given the one that is playing
// (v0.8.20): lib/similar.js and lib/played-artists.js, rule for rule. Pure:
// every function takes Deezer's answers (as JSON.parse reads them) and
// returns a decision; the fetching is Taste.cs's.
//
// Deezer's related acts for the playing act are the pool; each is scored by
// Deezer's rank and by how near it sits to what you play (the taste graph,
// built daily from the related lists of your most-played acts). Three are
// drawn — two not heard of, one you know with a record you don't own — the
// draw weighted by the square of the score.
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

/* An act as the scoring sees it (rankActs' rows). */
internal sealed class Act
{
    public string Id = "", Name = "";
    public double Rank;
    public double? Fans;
    public object? Picture;
    public double Score;
    public string? Known;
    public bool Near;
    public List<string> Via = [];

    public JsObj PoolJson()
    {
        var o = new JsObj();
        o["id"] = Id;
        o["name"] = Name;
        o["rank"] = Rank;
        o["fans"] = Fans;
        o["picture"] = Picture;
        return o;
    }
    public static Act FromPool(JsObj o) => new()
    {
        Id = Js.Str(o["id"]), Name = Js.Str(o["name"]), Rank = Js.ToNumber(o["rank"]),
        Fans = o["fans"] is double f ? f : null, Picture = o["picture"] is Undef ? null : o["picture"]
    };
}

internal sealed record Seed(string Name, double Days, double Last);

internal static partial class Similar
{
    public const int Wanted = 3, SearchRows = 10, Candidates = 3;
    public const int RelatedRows = 20, Pool = 8, Unknown = 2, ShownKeep = 30;
    public const double MinFans = 1000;

    [GeneratedRegex("[^a-z0-9]+")] private static partial Regex NotWord();
    [GeneratedRegex("[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+")] private static partial Regex Spaces();

    /* Letters and digits, lower case, accents gone, single spaces (similar.js normalize). */
    public static string Normalize(object? s)
    {
        var t = Scan.ScanNames.Nfkd(Js.Lower(Js.IsNullish(s) ? "" : Js.Str(s)));
        var sb = new StringBuilder(t.Length);
        foreach (var c in t) if (c < 0x300 || c > 0x36F) sb.Append(c);
        return Js.Trim(Spaces().Replace(NotWord().Replace(sb.ToString(), " "), " "));
    }

    /* Whole-name containment either way, then a leading "The" discounted. */
    public static bool NamesOverlap(object? a0, object? b0)
    {
        string a = Normalize(a0), b = Normalize(b0);
        if (a.Length == 0 || b.Length == 0) return false;
        if ((" " + a + " ").Contains(" " + b + " ", StringComparison.Ordinal) || (" " + b + " ").Contains(" " + a + " ", StringComparison.Ordinal)) return true;
        static string Strip(string s) => s.StartsWith("the ", StringComparison.Ordinal) ? s[4..] : s;
        return Strip(a) == Strip(b);
    }

    private static List<object?>? Data(object? json) => json is JsObj o && o["data"] is List<object?> d ? d : null;
    private static string? IdOf(JsObj a) => Js.IsNullish(a["id"]) ? null : Js.Str(a["id"]);
    private static string NameOf(JsObj a) => a["name"] is string s ? Js.Trim(s) : "";
    private static object? PictureOf(JsObj a) => Js.Truthy(a["picture_medium"]) ? a["picture_medium"] : Js.Truthy(a["picture"]) ? a["picture"] : null;

    /* The Deezer artists worth trying for this name, best first: an exact name ahead of a containing one, then followers. */
    public static List<(string Id, string Name, double Fans, bool Exact)> ReadDeezerArtists(object? json, object? artist)
    {
        var data = Data(json);
        var outList = new List<(string Id, string Name, double Fans, bool Exact)>();
        if (data == null) return outList;
        foreach (var a0 in data)
        {
            if (a0 is not JsObj a) continue;
            var id = IdOf(a);
            var name = NameOf(a);
            if (string.IsNullOrEmpty(id) || name.Length == 0) continue;
            if (!NamesOverlap(name, artist)) continue;
            var fans = Js.ToNumber(a["nb_fan"]);
            outList.Add((id, name, double.IsNaN(fans) ? 0 : fans, Normalize(name) == Normalize(artist)));
        }
        return Library.Sorted(outList, (x, y) =>
        {
            var e = (y.Exact ? 1 : 0) - (x.Exact ? 1 : 0);
            return e != 0 ? e : Lookups.Sgn(y.Fans - x.Fans);
        });
    }

    /* Up to `wanted` related acts, in Deezer's order, by id once each. */
    public static List<(string Id, string Name, object? Picture)> ReadDeezerRelated(object? json, int wanted = 0)
    {
        var limit = wanted > 0 ? wanted : Wanted;
        var data = Data(json);
        var outList = new List<(string Id, string Name, object? Picture)>();
        if (data == null) return outList;
        var seen = new HashSet<string>();
        foreach (var a0 in data)
        {
            if (a0 is not JsObj a) continue;
            var id = IdOf(a);
            var name = NameOf(a);
            if (string.IsNullOrEmpty(id) || name.Length == 0 || !seen.Add(id)) continue;
            outList.Add((id, name, PictureOf(a)));
            if (outList.Count >= limit) break;
        }
        return outList;
    }

    [GeneratedRegex("^([0-9]{4})")] private static partial Regex Year4();

    /* The year from Deezer's "YYYY-MM-DD", or null ("0000-00-00", or a year after next). */
    public static double? YearOf(object? releaseDate)
    {
        var m = Year4().Match(Js.Trim(Js.IsNullish(releaseDate) ? "" : Js.Str(releaseDate)));
        if (!m.Success) return null;
        var y = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
        if (y < 1900 || y > DateTime.Now.Year + 1) return null;
        return y;
    }

    /* Related acts with what the scoring needs: rank, followers, picture. */
    public static List<Act> ReadDeezerPool(object? json, int limit = 0)
    {
        var data = Data(json);
        var outList = new List<Act>();
        if (data == null) return outList;
        var seen = new HashSet<string>();
        foreach (var a0 in data)
        {
            if (a0 is not JsObj a) continue;
            var id = IdOf(a);
            var name = NameOf(a);
            if (string.IsNullOrEmpty(id) || name.Length == 0 || !seen.Add(id)) continue;
            double? fans = null;
            if (!Js.IsNullish(a["nb_fan"])) { var f = Js.ToNumber(a["nb_fan"]); fans = double.IsNaN(f) ? 0 : f; }
            outList.Add(new Act { Id = id, Name = name, Rank = outList.Count, Fans = fans, Picture = PictureOf(a) });
            if (outList.Count >= (limit > 0 ? limit : RelatedRows)) break;
        }
        return outList;
    }

    public sealed class Near
    {
        public double Score;
        public List<string> Via = [];
    }

    /* The taste graph: for every act related to something you play, how near it is to your listening, 0..1. */
    public static Dictionary<string, Near> TasteGraph(IEnumerable<Seed> seeds, Func<string, List<object?>?> relatedOf, double now)
    {
        var g = new Dictionary<string, Near>();
        var order = new List<string>();
        foreach (var seed in seeds)
        {
            if (string.IsNullOrEmpty(seed.Name)) continue;
            var age = (now - (double.IsNaN(seed.Last) ? 0 : seed.Last)) / 86400000;
            var recency = age <= 30 ? 1 : age <= 90 ? 0.6 : 0.3;
            var w = Math.Max(1, double.IsNaN(seed.Days) || seed.Days == 0 ? 1 : seed.Days) * recency;
            var rel = relatedOf(seed.Name) ?? [];
            for (var i = 0; i < rel.Count; i++)
            {
                // { name, id }, as relatedActs keeps them.
                if (rel[i] is not JsObj act || !Js.Truthy(act["name"])) continue;
                var key = Normalize(act["name"]);
                if (key.Length == 0 || key == Normalize(seed.Name)) continue;
                if (!g.TryGetValue(key, out var e)) { e = new Near(); g[key] = e; order.Add(key); }
                e.Score += w * (1 - i / (2.0 * Math.Max(1, rel.Count)));
                if (!e.Via.Contains(seed.Name)) e.Via.Add(seed.Name);
            }
        }
        double max = 0;
        foreach (var k in order) if (g[k].Score > max) max = g[k].Score;
        if (max > 0) foreach (var k in order) g[k].Score /= max;
        return g;
    }

    /* Score the pool for one share. */
    public static List<Act> RankActs(List<Act> pool, string? playing, Dictionary<string, Near> taste, Func<string, string?> known, HashSet<string> heavy, HashSet<string> shown)
    {
        var n = Math.Max(1, pool.Count);
        var outList = new List<Act>();
        foreach (var act in pool)
        {
            var key = Normalize(act.Name);
            if (key.Length == 0 || key == Normalize(playing ?? "")) continue;
            if (heavy.Contains(key)) continue;
            taste.TryGetValue(key, out var t);
            var score = 0.3 * (1 - act.Rank / n) + (t != null ? Math.Sqrt(t.Score) : 0);
            if (act.Fans != null && act.Fans < MinFans) score *= 0.5;
            if (shown.Contains(act.Id)) score *= 0.5;
            outList.Add(new Act
            {
                Id = act.Id, Name = act.Name, Rank = act.Rank, Fans = act.Fans, Picture = act.Picture,
                Score = score, Known = known(act.Name), Near = t != null, Via = t != null ? t.Via.Take(2).ToList() : []
            });
        }
        return Library.Sorted(outList, (a, b) => Lookups.Sgn(b.Score - a.Score));
    }

    /* A weighted draw: probability rises with the square of the score. */
    public static int Draw(List<Act> list, Func<double> rnd)
    {
        double total = 0;
        var w = list.Select(x => { var m = Math.Max(0.01, x.Score); var v = m * m; total += v; return v; }).ToList();
        var r = rnd() * total;
        for (var i = 0; i < list.Count; i++) { r -= w[i]; if (r <= 0) return i; }
        return list.Count - 1;
    }

    /* Three acts from the ranking: two not heard of, one you know, filled from the rest. */
    public static List<Act> Choose(List<Act> ranked, Func<double>? rnd = null, int want = Wanted)
    {
        rnd ??= Random.Shared.NextDouble;
        static List<Act> ByNear(IEnumerable<Act> list) { var l = list.ToList(); return l.Where(a => a.Near).Concat(l.Where(a => !a.Near)).ToList(); }
        var unknown = ByNear(ranked.Where(a => a.Known == null)).Take(Pool).ToList();
        var familiar = ranked.Where(a => a.Known != null).Take(Pool).ToList();
        var picks = new List<Act>();
        bool Take(List<Act> from)
        {
            if (from.Count == 0) return false;
            var near = from.Any(a => a.Near) ? from.Where(a => a.Near).ToList() : from;
            var pick = near[Draw(near, rnd)];
            from.RemoveAt(from.IndexOf(pick));
            picks.Add(pick);
            return true;
        }
        for (var i = 0; i < Unknown && picks.Count < want; i++) if (!Take(unknown)) break;
        if (picks.Count < want) Take(familiar);
        while (picks.Count < want && (Take(unknown) || Take(familiar))) { }
        return picks;
    }

    /* Why an act is on the row, in a few words. */
    public static string ReasonFor(Act act, string? playing)
    {
        if (act.Known == "library") return "In your library — a record you don't have";
        if (act.Known == "played") return "Something you've played — a record you don't have";
        var via = act.Via.Where(v => Normalize(v) != Normalize(playing ?? "")).ToList();
        if (via.Count >= 2) return $"Near {via[0]} and {via[1]}, which you play";
        if (via.Count == 1) return $"Near {via[0]}, which you play";
        return !string.IsNullOrEmpty(playing) ? $"Near {playing}" : "";
    }

    /* An act's best-known record from their top tracks: the album most of those tracks are from. */
    public static JsObj? ReadDeezerTop(object? json)
    {
        var data = Data(json);
        if (data == null) return null;
        var tally = new List<(string Id, string Title, object? Cover, int N)>();
        foreach (var t0 in data)
        {
            if (t0 is not JsObj t || t["album"] is not JsObj al || Js.IsNullish(al["id"])) continue;
            var id = Js.Str(al["id"]);
            var i = tally.FindIndex(x => x.Id == id);
            if (i < 0) tally.Add((id, al["title"] is string s ? Js.Trim(s) : "", Js.Truthy(al["cover_medium"]) ? al["cover_medium"] : Js.Truthy(al["cover"]) ? al["cover"] : null, 1));
            else tally[i] = (tally[i].Id, tally[i].Title, tally[i].Cover, tally[i].N + 1);
        }
        (string Id, string Title, object? Cover, int N)? best = null;
        foreach (var e in tally) if (e.Title.Length > 0 && (best == null || e.N > best.Value.N)) best = e;
        if (best == null) return null;
        var o = new JsObj();
        o["id"] = best.Value.Id;
        o["title"] = best.Value.Title;
        o["cover"] = best.Value.Cover;
        o["n"] = (double)best.Value.N;
        return o;
    }

    /* Every full album from an artist's listing, newest first. */
    public static List<object?> ReadDeezerAlbumList(object? json)
    {
        var data = Data(json);
        var outList = new List<JsObj>();
        if (data == null) return [];
        foreach (var a0 in data)
        {
            if (a0 is not JsObj album || Js.IsNullish(album["id"])) continue;
            if (Js.Lower(Js.Str(Js.Truthy(album["record_type"]) ? album["record_type"] : "")) != "album") continue;
            var title = album["title"] is string s ? Js.Trim(s) : "";
            if (title.Length == 0) continue;
            var o = new JsObj();
            o["id"] = Js.Str(album["id"]);
            o["title"] = title;
            o["year"] = YearOf(album["release_date"]);
            o["cover"] = Js.Truthy(album["cover_medium"]) ? album["cover_medium"] : Js.Truthy(album["cover"]) ? album["cover"] : null;
            outList.Add(o);
        }
        double Y(JsObj o) => o["year"] is double y ? y : 0;
        return Library.Sorted(outList, (a, b) => Lookups.Sgn(Y(b) - Y(a))).Select(x => (object?)x).ToList();
    }

    /* The record to name for an act: their best-known, or for an act you know the newest you don't own. */
    public static JsObj? RecordFor(Act act, JsObj? top, List<object?> albums, IEnumerable<string> ownedTitles)
    {
        var owned = new HashSet<string>(ownedTitles.Select(t => Normalize(t)));
        JsObj? WithYear(JsObj? a)
        {
            if (a == null) return null;
            var hit = albums.OfType<JsObj>().FirstOrDefault(x => Js.StrictEq(x["id"], a["id"]));
            var o = new JsObj();
            o["title"] = a["title"];
            o["year"] = !Js.IsNullish(a["year"]) ? a["year"] : hit != null ? hit["year"] : null;
            o["cover"] = Js.Truthy(a["cover"]) ? a["cover"] : hit != null ? hit["cover"] : null;
            return o;
        }
        if (act.Known != null)
        {
            var fresh = albums.OfType<JsObj>().FirstOrDefault(a => !Js.IsNullish(a["year"]) && !owned.Contains(Normalize(a["title"])));
            if (fresh != null) return WithYear(fresh);
            if (top != null && !owned.Contains(Normalize(top["title"]))) return WithYear(top);
            return null;
        }
        return WithYear(top) ?? WithYear(albums.Count > 0 ? albums[0] as JsObj : null);
    }

    // ------------------------------------------------------------ played-artists.js

    /* The acts to ask about, best first: distinct days played, then the latest play. */
    public static List<Seed> PlayedArtists(IEnumerable<(object? Artist, object? Ts)> rows, Func<object?, string> split, int limit = 40)
    {
        var seen = new Dictionary<string, (string Name, HashSet<double> Days, double Last)>();
        var order = new List<string>();
        foreach (var (artist, ts0) in rows)
        {
            var name = Js.Trim(split(Js.Truthy(artist) ? artist : ""));
            if (name.Length == 0) continue;
            var key = Normalize(name);
            if (key.Length == 0 || key is "various artists" or "various" or "va") continue;
            var ts = Js.ToNumber(ts0);
            if (double.IsNaN(ts)) ts = 0;
            if (!seen.TryGetValue(key, out var e)) { e = (name, [], 0); order.Add(key); }
            e.Days.Add(Math.Floor(ts / 86400000));
            if (ts > e.Last) e.Last = ts;
            seen[key] = e;
        }
        var list = order.Select(k => new Seed(seen[k].Name, seen[k].Days.Count, seen[k].Last)).ToList();
        list = Library.Sorted(list, (a, b) =>
        {
            var d = Lookups.Sgn(b.Days - a.Days);
            return d != 0 ? d : Lookups.Sgn(b.Last - a.Last);
        });
        return list.Take(Math.Max(0, limit)).ToList();
    }
}
