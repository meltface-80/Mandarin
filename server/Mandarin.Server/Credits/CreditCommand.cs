// CreditCommand.cs — `mandarin-server score` with { "fn": "credits" } (bug list
// item 129): the credit rules (CreditRules.cs) asked directly by the tests
// (test/Mandarin.Tests/CreditsTests.cs), a job in and its answer out.
//
//   { tags?: [[track, { NAME: [values] }], …], release?: {…}, tracks?: n,
//     artist?: {…}, search?: [{…}, name], wikidata?: [{…}, qid], fanart?: {…},
//     deezer?: [{…}, name], url?: "…" }
//   → { credits: [{ track, name, mbid, role, source }], acts: [[name, mbid]],
//       rows: [{ key, name, mbid, roles, tracks, source }], artist: {…}, found,
//       wikidata, wikidata_site, fanart, deezer, key, back }
using Mandarin.Server.Tags;

namespace Mandarin.Server.Credits;

using Js = Mandarin.Server.Tags.Js;

internal static class CreditCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static List<object?> Strings(IEnumerable<string> list) => list.Select(x => (object?)x).ToList();

    public static JsObj Run(JsObj job)
    {
        var o = new JsObj();
        var credits = new List<Credit>();
        foreach (var t in L(job["tags"]))
        {
            var p = L(t);
            if (p.Count == 2 && p[1] is JsObj tags) credits.AddRange(CreditRules.FromTags((int)Js.ToNumber(p[0]), tags));
        }
        if (job["release"] is JsObj rel)
        {
            credits.AddRange(CreditRules.FromRelease(rel));
            o["acts"] = CreditRules.ReleaseActs(rel).Select(act => (object?)new List<object?> { act.Name, act.Mbid }).ToList();
        }
        o["credits"] = credits.Select(c =>
        {
            var x = new JsObj();
            x["track"] = (double)c.Track; x["name"] = c.Name; x["mbid"] = c.Mbid; x["role"] = c.Role; x["source"] = c.Source;
            return (object?)x;
        }).ToList();
        o["rows"] = CreditRules.Merge(credits, Js.Truthy(job["tracks"]) ? (int)Js.ToNumber(job["tracks"]) : 0).Select(r =>
        {
            var x = new JsObj();
            x["key"] = r.Key; x["name"] = r.Name; x["mbid"] = r.Mbid; x["roles"] = Strings(r.Roles);
            x["tracks"] = r.Tracks.Select(n => (object?)(double)n).ToList(); x["source"] = r.Source;
            return (object?)x;
        }).ToList();
        if (job["artist"] is JsObj a)
        {
            var f = CreditRules.ArtistOf(a);
            var x = Scan.JsJson.Parse(CreditStore.AboutJson(f).ToJsonString()) as JsObj ?? new JsObj();
            x["mbid"] = f.Mbid; x["name"] = f.Name; x["type"] = f.Type;
            o["artist"] = x;
        }
        if (L(job["search"]) is { Count: 2 } s && s[0] is JsObj found) o["found"] = CreditRules.FoundMbid(found, Js.Str(s[1]));
        if (L(job["wikidata"]) is { Count: 2 } w && w[0] is JsObj data)
        {
            o["wikidata_id"] = CreditRules.WikidataId(Js.Str(w[1]));
            o["wikidata"] = CreditRules.WikidataPhoto(data, CreditRules.WikidataId(Js.Str(w[1])) ?? "");
            o["wikidata_site"] = CreditRules.WikidataSite(data, CreditRules.WikidataId(Js.Str(w[1])) ?? "");
        }
        if (job["fanart"] is JsObj fa) o["fanart"] = CreditRules.FanartPhoto(fa);
        if (L(job["deezer"]) is { Count: 2 } d && d[0] is JsObj dz) o["deezer"] = CreditRules.DeezerPhoto(dz, Js.Str(d[1]));
        if (job["url"] is string url)
        {
            var key = CreditRules.PhotoKey(url);
            o["key"] = key;
            o["back"] = key != null ? Covers.ForeignUrl(key) : null;
        }
        return o;
    }
}
