// ScoreCommand.cs — `mandarin-server score` (v0.8.19): the scorer (Score.cs)
// asked directly, a line of JSON in and a line out, so the tests can hold it
// to lib/identify/score.js over many albums at once (test/identify-csharp.test.js).
//
//   { "fn": "decide", "album": {…}, "candidates": [{…}, …] }
//      → { status, ambiguous, scored: [{ candidate (with parts and pairs), distance }] }
//   { "fn": "names", "names": ["…", …] }
//      → { names: [{ tidy, bare, clean, cmp, edition_year, disc }] }
//   { "fn": "pairs", "pairs": [[a, b], …] }
//      → { pairs: [{ string, title, levenshtein, suspect }] }
using Mandarin.Server.Scan;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Identify;

using Js = Mandarin.Server.Tags.Js;

internal static class ScoreCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];

    public static int Run()
    {
        var input = new StreamReader(Console.OpenStandardInput(), new System.Text.UTF8Encoding(false));
        var output = new StreamWriter(Console.OpenStandardOutput(), new System.Text.UTF8Encoding(false)) { AutoFlush = false, NewLine = "\n" };
        string? line;
        while ((line = input.ReadLine()) != null)
        {
            if (line.Length == 0) continue;
            var o = new JsObj();
            try
            {
                var job = JsJson.Parse(line) as JsObj ?? new JsObj();
                switch (Js.Str(job["fn"]))
                {
                    case "decide":
                        {
                            var album = job["album"] as JsObj ?? new JsObj();
                            var v = Score.Decide(album, L(job["candidates"]).OfType<JsObj>());
                            o["status"] = v.Status;
                            o["ambiguous"] = v.Ambiguous;
                            o["scored"] = v.ScoredList.Select(s =>
                            {
                                var x = new JsObj();
                                x["candidate"] = Score.Kept(s);
                                x["distance"] = s.Distance;
                                return (object?)x;
                            }).ToList();
                            o["why"] = v.Best != null ? Score.Why(v.Best.Parts, album["year"]).Select(w => (object?)w).ToList() : new List<object?>();
                            o["exact"] = v.Best != null && Score.Exact(v.Best.Parts);
                            o["unasked"] = v.Best != null && Score.AppliesUnasked(v.Best.Distance);
                            break;
                        }
                    case "names":
                        o["names"] = L(job["names"]).Select(n =>
                        {
                            var x = new JsObj();
                            x["tidy"] = Score.Tidy(n);
                            x["bare"] = Score.Bare(n);
                            x["clean"] = Score.Clean(n);
                            x["cmp"] = Score.Cmp(n);
                            x["edition_year"] = Score.EditionYear(n);
                            x["disc"] = Score.DiscOf(n);
                            return (object?)x;
                        }).ToList();
                        break;
                    case "pairs":
                        o["pairs"] = L(job["pairs"]).Select(p0 =>
                        {
                            var p = L(p0);
                            object? a = p.Count > 0 ? p[0] : Undef.V, b = p.Count > 1 ? p[1] : Undef.V;
                            var x = new JsObj();
                            x["string"] = Score.StringDist(a, b);
                            x["title"] = Score.TitleDist(a, b);
                            x["levenshtein"] = Score.Levenshtein(Js.IsNullish(a) ? "" : Js.Str(a), Js.IsNullish(b) ? "" : Js.Str(b));
                            x["suspect"] = Score.ArtistSuspect(a, b);
                            return (object?)x;
                        }).ToList();
                        break;
                    default:
                        o["error"] = "unknown fn";
                        break;
                }
            }
            catch (Exception e)
            {
                o = new JsObj();
                o["error"] = e.GetType().Name + ": " + e.Message;
            }
            output.WriteLine(Js.Json(o));
        }
        output.Flush();
        return 0;
    }
}
