// MusicBrainz.cs — the questions the identification scan asks MusicBrainz
// (v0.8.19): lib/identify/musicbrainz.js, rule for rule. No key: MusicBrainz's
// read API asks only for a User-Agent that names the app and no more than one
// request a second (Lookups.MbWait). The base URL can be pointed elsewhere (a
// fake in the tests); off musicbrainz.org the wait is dropped. What comes back
// is made into the candidates the scorer weighs, key for key as there, since
// they are kept as JSON in album_matches.
using System.Text.RegularExpressions;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal interface IReleases
{
    Task<JsObj?> Release(string mbid);
    Task<List<JsObj>> ByBarcode(object? code);
    Task<List<JsObj>> ByCatno(object? catno, object? label = null);
    Task<List<JsObj>> ByIsrc(object? isrc);
}

internal sealed partial class MusicBrainz(string? baseUrl, string version) : IReleases
{
    public const string DefaultBase = "https://musicbrainz.org/ws/2";
    public readonly string BaseUrl = (string.IsNullOrEmpty(baseUrl) ? DefaultBase : baseUrl).TrimEnd('/');
    public readonly string UserAgent = $"Mandarin/{version} ( https://github.com/meltface-80/Mandarin )";
    public int Requests;

    [GeneratedRegex("[+\\-&|!(){}\\[\\]^\"~*?:\\\\/]")]
    private static partial Regex Special();

    /* Lucene's special characters escaped, so a title with a colon or a bracket is searched for as text. */
    public static string Quote(object? s) => Special().Replace(Js.IsNullish(s) ? "" : Js.Str(s), m => "\\" + m.Value);

    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static string S(object? v) => Js.Truthy(v) ? Js.Str(v) : "";

    /* "Artist A feat. B" from a release's artist credit, as MusicBrainz shows it. */
    public static string CreditName(object? credit)
    {
        var parts = L(credit).Select(c0 =>
        {
            var c = O(c0);
            var name = Js.Truthy(c["name"]) ? Js.Str(c["name"]) : c["artist"] is JsObj a && Js.Truthy(a["name"]) ? Js.Str(a["name"]) : "";
            return name + S(c["joinphrase"]);
        });
        return Js.Trim(string.Concat(parts));
    }

    private static double Position(object? v) => Js.Truthy(v) ? Js.ToNumber(v) : 0;

    [GeneratedRegex("^[0-9]{4}")]
    private static partial Regex FourDigits();
    private static object? YearOf(object? d) => FourDigits().IsMatch(S(d)) ? double.Parse(S(d)[..4], System.Globalization.CultureInfo.InvariantCulture) : null;

    /* A release as the scorer wants it: names, year and the tracks in order with their lengths in seconds. */
    public static JsObj CandidateOf(JsObj rel)
    {
        var tracks = new List<object?>();
        var media = Library.Sorted(L(rel["media"]).Select(O), (a, b) => Lookups.Sgn(Position(a["position"]) - Position(b["position"])));
        for (var mi = 0; mi < media.Count; mi++)
        {
            var m = media[mi];
            foreach (var t in Library.Sorted(L(m["tracks"]).Select(O), (a, b) => Lookups.Sgn(Position(a["position"]) - Position(b["position"]))))
            {
                var rec = t["recording"] as JsObj;
                var ms = !Js.IsNullish(t["length"]) ? t["length"] : rec != null ? rec["length"] : Undef.V;
                var tr = new JsObj();
                tr["disc"] = Js.Truthy(m["position"]) ? m["position"] : (double)(mi + 1);
                tr["no"] = Js.Truthy(t["position"]) ? t["position"] : (double)(tracks.Count + 1);
                tr["title"] = Js.Truthy(t["title"]) ? t["title"] : rec != null && Js.Truthy(rec["title"]) ? rec["title"] : "";
                tr["artist"] = Js.Truthy(t["artist-credit"]) ? CreditName(t["artist-credit"]) : "";
                tr["length"] = !Js.IsNullish(ms) ? Js.ToNumber(ms) / 1000 : null;
                tracks.Add(tr);
            }
        }
        var rg = O(rel["release-group"]);
        var first = Js.Truthy(rg["first-release-date"]) ? Js.Str(rg["first-release-date"]) : S(rel["date"]);
        var types = new List<object?> { rg["primary-type"] };
        types.AddRange(L(rg["secondary-types"]));
        var type = string.Join(" + ", types.Where(Js.Truthy).Select(Js.Str));
        var c = new JsObj();
        c["mbid"] = rel["id"];
        c["group_mbid"] = Js.Truthy(rg["id"]) ? rg["id"] : null;
        c["title"] = Js.Truthy(rg["title"]) ? rg["title"] : S(rel["title"]);
        c["artist"] = CreditName(rel["artist-credit"]);
        c["year"] = YearOf(first);
        c["date"] = first.Length > 0 ? first : null;
        c["release_title"] = S(rel["title"]);
        c["release_year"] = YearOf(rel["date"]);
        c["release_date"] = Js.Truthy(rel["date"]) ? rel["date"] : null;
        c["edition"] = S(rel["disambiguation"]);
        c["group_note"] = S(rg["disambiguation"]);
        c["type"] = type.Length > 0 ? type : null;
        c["country"] = Js.Truthy(rel["country"]) ? rel["country"] : null;
        c["discs"] = media.Count > 0 ? (double)media.Count : null;
        c["track_count"] = tracks.Count > 0 ? (double)tracks.Count : Js.Truthy(rel["track-count"]) ? rel["track-count"] : 0.0;
        c["tracks"] = tracks;
        return c;
    }

    private async Task<object?> Get(string path, params (string, object?)[] ps)
    {
        var all = new List<(string, object?)> { ("fmt", "json") };
        all.AddRange(ps);
        Requests++;
        if (BaseUrl == DefaultBase) await Lookups.MbWait();
        return await Lookups.Json($"{BaseUrl}/{path}?{Lookups.Query(all)}", [("User-Agent", UserAgent), ("Accept", "application/json")], 15000);
    }

    private static double TrackCountOf(JsObj r)
    {
        if (Js.Truthy(r["track-count"])) return Js.ToNumber(r["track-count"]);
        var n = 0.0;
        foreach (var m in L(r["media"])) n += Js.Truthy(O(m)["track-count"]) ? Js.ToNumber(O(m)["track-count"]) : 0;
        return n;
    }

    private static double ScoreOf(JsObj r) { var n = Js.ToNumber(r["score"]); return double.IsNaN(n) ? 0 : n; }

    [GeneratedRegex("[ \\t\\n\\v\\f\\r\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff:;,./]+")]
    private static partial Regex WordSplit();

    /* Releases with this title — and this artist, when the tag is worth trusting; and this many tracks, if asked. */
    public async Task<List<JsObj>> Search(object? title, object? artist, object? tracks = null, double limit = 10, bool loose = false)
    {
        var words = WordSplit().Split(Js.IsNullish(title) ? "" : Js.Truthy(title) ? Js.Str(title) : "").Select(w => Quote(w)).Where(w => w.Length > 1).ToList();
        var parts = new List<string> { loose && words.Count > 0 ? $"release:({string.Join(" AND ", words)})" : $"release:\"{Quote(title)}\"" };
        if (Js.Truthy(tracks)) parts.Add("tracks:" + Js.Num(Js.ToNumber(tracks)));
        if (Js.Truthy(artist)) parts.Add($"artist:\"{Quote(artist)}\"");
        var j = await Get("release/", ("query", string.Join(" AND ", parts)), ("limit", limit));
        return L((j as JsObj)?["releases"]).Select(O).Select(r =>
        {
            var o = new JsObj();
            o["mbid"] = r["id"];
            o["title"] = S(r["title"]);
            o["artist"] = CreditName(r["artist-credit"]);
            o["year"] = FourDigits().IsMatch(S(r["date"])) ? double.Parse(S(r["date"])[..4], System.Globalization.CultureInfo.InvariantCulture) : null;
            o["track_count"] = TrackCountOf(r);
            o["score"] = ScoreOf(r);
            return o;
        }).ToList();
    }

    private static List<JsObj> Brief(object? j) => L((j as JsObj)?["releases"]).Select(O).Select(r =>
    {
        var o = new JsObj();
        o["mbid"] = r["id"];
        o["title"] = S(r["title"]);
        o["artist"] = CreditName(r["artist-credit"]);
        o["track_count"] = TrackCountOf(r);
        o["score"] = ScoreOf(r);
        return o;
    }).ToList();

    /* Releases carrying this barcode (a UPC or EAN off the sleeve). */
    public async Task<List<JsObj>> ByBarcode(object? code)
    {
        var digits = new string((Js.IsNullish(code) ? "" : Js.Str(code)).Where(char.IsAsciiDigit).ToArray());
        if (digits.Length == 0) return [];
        return Brief(await Get("release/", ("query", "barcode:" + digits), ("limit", 10.0)));
    }

    /* Releases with this catalogue number (and label, when known). */
    public async Task<List<JsObj>> ByCatno(object? catno, object? label = null)
    {
        var c = Js.Trim(Js.IsNullish(catno) ? "" : Js.Str(catno));
        if (c.Length == 0) return [];
        var parts = new List<string> { $"catno:\"{Quote(c)}\"" };
        if (Js.Truthy(label)) parts.Add($"label:\"{Quote(label)}\"");
        return Brief(await Get("release/", ("query", string.Join(" AND ", parts)), ("limit", 10.0)));
    }

    /* The releases a recording (by its ISRC) appears on. */
    public async Task<List<JsObj>> ByIsrc(object? isrc)
    {
        var code = Js.Upper(new string((Js.IsNullish(isrc) ? "" : Js.Str(isrc)).Where(char.IsAsciiLetterOrDigit).ToArray()));
        if (code.Length != 12) return [];
        object? j;
        try { j = await Get("isrc/" + Lookups.Encode(code), ("inc", "releases")); } catch (Exception) { j = null; }
        var seen = new List<string>();
        var outList = new List<JsObj>();
        foreach (var rec in L((j as JsObj)?["recordings"]))
            foreach (var r0 in L(O(rec)["releases"]))
            {
                var r = O(r0);
                var id = Js.Str(r["id"]);
                if (seen.Contains(id)) continue;
                seen.Add(id);
                var o = new JsObj();
                o["mbid"] = r["id"];
                o["title"] = S(r["title"]);
                o["track_count"] = Js.Truthy(r["track-count"]) ? r["track-count"] : 0.0;
                o["score"] = 0.0;
                outList.Add(o);
            }
        return outList;
    }

    /* The releases in a release group (a MusicBrainz "album" link pasted in). */
    public async Task<List<JsObj>> GroupReleases(object? mbid)
    {
        var j = await Get("release-group/" + Lookups.Encode(Js.Str(mbid)), ("inc", "releases+media"));
        return L((j as JsObj)?["releases"]).Select(O).Select(r =>
        {
            var o = new JsObj();
            o["mbid"] = r["id"];
            o["title"] = S(r["title"]);
            o["date"] = S(r["date"]);
            var n = 0.0;
            foreach (var m in L(r["media"])) n += Js.Truthy(O(m)["track-count"]) ? Js.ToNumber(O(m)["track-count"]) : 0;
            o["track_count"] = n;
            o["score"] = 0.0;
            return o;
        }).ToList();
    }

    /* One release in full: every track with its title and length. */
    public async Task<JsObj?> Release(string mbid)
    {
        var j = await Get("release/" + Lookups.Encode(mbid), ("inc", "recordings+artist-credits+release-groups"));
        return j is JsObj o && Js.Truthy(o["id"]) ? CandidateOf(o) : null;
    }
}
