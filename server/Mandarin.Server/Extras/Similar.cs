// Similar.cs — the taste graph and an act's similar acts (v0.8.20): lib/similar.js
// and lib/played-artists.js, rule for rule. Pure: every function takes Deezer's
// answers (as JSON.parse reads them) and returns a decision; the fetching is
// Taste.cs's. The taste graph, built daily from the related lists of your
// most-played acts, says how near an act sits to what you play. The share card's
// three suggestions it once drew went with item 336.
using System.Text;
using System.Text.RegularExpressions;
using Mandarin.Server.Identify;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal sealed record Seed(string Name, double Days, double Last);

internal static partial class Similar
{
    public const int Wanted = 3, SearchRows = 10, Candidates = 3;

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
