// LastfmCommand.cs — the Last.fm client run step by step through `mandarin-server
// score` (RulesCommand.cs), against a Last.fm the test serves, for the tests that
// asked lib/lastfm.js directly (test/lastfm.test.js; v0.8.50, stage 7 part 6):
//
//   { fn: "lastfm", base, key, steps: [{ similar: artist } | { albums: [artist, count, wanted?] } | { both: artist }
//     | { start: artist } | { wait: true } | { key: k } | { tick: ms } | { clear: true }], picks: [images], sites: [urls] }
//      → { results, picks, sites }: each step's — similar artists { artist, url, artists }; similar albums
//        { artist, albums } (asked for while `wanted` artists are still wanted); two askings at once; one
//        begun and its answer later; a failure as { error, code }; the key changed, the clock moved on,
//        everything forgotten (null); and the picture picked from each list, the link kept of each address
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Extras;

using Js = Mandarin.Server.Tags.Js;

internal static class LastfmCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsonNode? Node(object? v) => Js.Json(v) is { } text ? JsonNode.Parse(text) : null;

    private static JsObj Similar(LastfmSimilar s) => new()
    {
        ["artist"] = s.Artist, ["url"] = s.Url,
        ["artists"] = s.Artists.Select(a => (object?)new JsObj { ["name"] = a.Name, ["url"] = a.Url, ["match"] = a.Match, ["image"] = a.Image }).ToList()
    };

    private static async Task<object?> Answer(Func<Task<object?>> f)
    {
        try { return await f(); }
        catch (LastfmError e) { return new JsObj { ["error"] = e.Message, ["code"] = e.Code is int n ? (double)n : e.Code }; }
    }

    public static JsObj Run(JsObj job)
    {
        var key = Js.Str(job["key"]);
        long offset = 0;
        var lf = new Lastfm(Js.Str(job["base"]), () => key, "Mandarin/0") { Clock = () => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + offset };
        Task<object?>? begun = null;
        var results = new List<object?>();
        foreach (var st0 in L(job["steps"]))
        {
            var st = st0 as JsObj ?? new JsObj();
            if (st.Has("similar")) results.Add(Answer(async () => Similar(await lf.SimilarArtists(Js.Str(st["similar"])))).GetAwaiter().GetResult());
            else if (st["albums"] is List<object?> a)
            {
                var left = a.Count > 2 && a[2] is double w ? (int)w : int.MaxValue;
                results.Add(Answer(async () =>
                {
                    var (artist, albums) = await lf.SimilarAlbums(Js.Str(a[0]), (int)Js.ToNumber(a[1]), () => left-- > 0);
                    return new JsObj { ["artist"] = artist, ["albums"] = albums.Select(x => (object?)new JsObj { ["title"] = x.Title, ["artist"] = x.Artist, ["url"] = x.Url, ["image"] = x.Image }).ToList() };
                }).GetAwaiter().GetResult());
            }
            else if (st.Has("both"))
            {
                var name = Js.Str(st["both"]);
                var two = Task.WhenAll(Answer(async () => Similar(await lf.SimilarArtists(name))), Answer(async () => Similar(await lf.SimilarArtists(name)))).GetAwaiter().GetResult();
                results.Add(two.ToList());
            }
            else if (st.Has("start")) { var name = Js.Str(st["start"]); begun = Answer(async () => Similar(await lf.SimilarArtists(name))); results.Add(null); }
            else if (st.Has("wait")) results.Add(begun?.GetAwaiter().GetResult());
            else if (st.Has("key")) { key = Js.Str(st["key"]); results.Add(null); }
            else if (st.Has("tick")) { offset += (long)Js.ToNumber(st["tick"]); results.Add(null); }
            else if (st.Has("clear")) { lf.Clear(); results.Add(null); }
            else throw new JsError("unknown step");
        }
        return new JsObj
        {
            ["results"] = results,
            ["picks"] = L(job["picks"]).Select(p => (object?)Lastfm.PickImage(Node(p))).ToList(),
            ["sites"] = L(job["sites"]).Select(u => (object?)Lastfm.SiteUrl(Node(u))).ToList()
        };
    }
}
