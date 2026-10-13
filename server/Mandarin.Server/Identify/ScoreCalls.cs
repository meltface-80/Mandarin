// ScoreCalls.cs — the identification's rules asked one by one, by name,
// through `mandarin-server score` (ScoreCommand.cs, RulesCommand.cs), for the
// tests that asked lib/identify/score.js, identifier.js and itunes.js by name
// (test/identify.test.js; v0.8.50, stage 7 part 6):
//
//   { fn: "scorecall", calls: [[name, …args]] } → { results }
//      distance(album, cand) → { distance, parts, pairs }; decide(album, cands) → { status, ambiguous, best, scored };
//      pairTracks(mine, theirs) → { pairs, cost }; exact(parts); why(parts, year); appliesUnasked(distance);
//      titleDist, stringDist, lengthDist, bare, clean, editionYear, tidy, discOf, artistSuspect, similarity;
//      APPLY, PROPOSE; minutes(hhmm, fallback); inWindow(settings, "HH:MM")
//   { fn: "itunes", base, steps: [{ search: { title, artist } } | { album: id } | { paused: true }] }
//      → { results }: each step's answer, or { error, paused } where iTunes refused
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static class ScoreCalls
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static object? At(List<object?> a, int i) => i < a.Count ? a[i] : Undef.V;

    private static JsObj ScoredJson(Score.Scored s) => new() { ["candidate"] = s.Candidate, ["distance"] = s.Distance, ["parts"] = s.Parts, ["pairs"] = s.Pairs };

    private static object? Call(List<object?> c)
    {
        var name = Js.Str(At(c, 0));
        var a = c.Skip(1).ToList();
        switch (name)
        {
            case "distance":
                {
                    var (dist, parts, pairs) = Score.Distance(O(At(a, 0)), O(At(a, 1)));
                    return new JsObj { ["distance"] = dist, ["parts"] = parts, ["pairs"] = pairs };
                }
            case "decide":
                {
                    var v = Score.Decide(O(At(a, 0)), L(At(a, 1)).Select(O));
                    return new JsObj
                    {
                        ["status"] = v.Status, ["ambiguous"] = v.Ambiguous, ["best"] = v.Best is { } b ? ScoredJson(b) : null,
                        ["scored"] = v.ScoredList.Select(s => (object?)ScoredJson(s)).ToList()
                    };
                }
            case "pairTracks":
                {
                    var (pairs, cost) = Score.PairTracks(L(At(a, 0)).Select(O).ToList(), L(At(a, 1)).Select(O).ToList());
                    return new JsObj { ["pairs"] = pairs, ["cost"] = cost.Select(x => x is { } k ? (object?)new List<object?> { k.Title, k.Length } : null).ToList() };
                }
            case "exact": return Score.Exact(At(a, 0) as JsObj);
            case "why": return Score.Why(At(a, 0), At(a, 1)).Select(x => (object?)x).ToList();
            case "appliesUnasked": return Score.AppliesUnasked(At(a, 0) is double d ? d : null);
            case "titleDist": return Score.TitleDist(At(a, 0), At(a, 1));
            case "stringDist": return Score.StringDist(At(a, 0), At(a, 1));
            case "lengthDist": return Score.LengthDist(At(a, 0), At(a, 1));
            case "bare": return Score.Bare(At(a, 0));
            case "clean": return Score.Clean(At(a, 0));
            case "editionYear": return Score.EditionYear(At(a, 0));
            case "tidy": return Score.Tidy(At(a, 0));
            case "discOf": return Score.DiscOf(At(a, 0));
            case "artistSuspect": return Score.ArtistSuspect(At(a, 0), At(a, 1));
            case "similarity": return Score.Similarity(Js.ToNumber(At(a, 0)));
            case "APPLY": return Score.Apply;
            case "PROPOSE": return Score.Propose;
            case "minutes": return Identifier.Minutes(At(a, 0), At(a, 1) is double f ? f : null);
            case "inWindow":
                {
                    var hm = Js.Str(At(a, 1)).Split(':');
                    return Identifier.InWindow(O(At(a, 0)), new DateTime(2026, 1, 1, int.Parse(hm[0], System.Globalization.CultureInfo.InvariantCulture), int.Parse(hm[1], System.Globalization.CultureInfo.InvariantCulture), 0));
                }
            default: throw new JsError("unknown call " + name);
        }
    }

    public static JsObj Run(JsObj job) => new() { ["results"] = L(job["calls"]).Select(c => Call(L(c))).ToList() };

    public static async Task<JsObj> ITunesSteps(JsObj job)
    {
        var it = new ITunes(Js.Str(job["base"]), "0", _ => { }, null, 0);
        var results = new List<object?>();
        foreach (var st0 in L(job["steps"]))
        {
            var st = O(st0);
            try
            {
                if (st["search"] is JsObj q) results.Add((await it.Search(q["title"], q["artist"])).Select(x => (object?)x).ToList());
                else if (st.Has("album")) results.Add(await it.Album(st["album"]));
                else if (st.Has("paused")) results.Add(new JsObj { ["paused"] = it.Paused, ["requests"] = (double)it.Requests });
                else throw new JsError("unknown step");
            }
            catch (LookupError e) { results.Add(new JsObj { ["error"] = e.Message, ["paused"] = e.Paused }); }
        }
        return new JsObj { ["results"] = results };
    }
}
