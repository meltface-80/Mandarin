// ScoreCommand.cs — `mandarin-server score` (v0.8.19): the scorer (Score.cs)
// asked directly, a line of JSON in and a line out, so the tests can hold it
// to lib/identify/score.js over many albums at once (test/Mandarin.Tests/IdentifyCsharpTests.cs).
//
//   { "fn": "decide", "album": {…}, "candidates": [{…}, …] }
//      → { status, ambiguous, scored: [{ candidate (with parts and pairs), distance }] }
//   { "fn": "names", "names": ["…", …] }
//      → { names: [{ tidy, bare, clean, cmp, edition_year, disc }] }
//   { "fn": "pairs", "pairs": [[a, b], …] }
//      → { pairs: [{ string, title, levenshtein, suspect }] }
//   { "fn": "share" | "similar" | "days" | "labels", … } (v0.8.20): Extras/ExtrasCommand.cs
//   { "fn": "writeups" | "blob", … } (v0.8.21), { "fn": "backup" | "artfind", … } (v0.8.22): Extras/ExtrasCommand.cs
//   { "fn": "autoeq", "index"?: md, "profile"?: text } (v0.8.26): Extras/AutoEq.cs
//   { "fn": "xml" | "didl" | "moves" | "topology" | "soap", … } (v0.8.37): Playback/SonosCommand.cs
//   { "fn": "description" | "protocolinfo" | "gena" | "profiles", … } (v0.8.37): Renderers/RendererCommand.cs
//   { "fn": "plans" | "gain" | "dsp" | "sign" | "radio" | "math", … } (v0.8.38): Playback/StreamCommand.cs
//   { "fn": "mounts" | "versions" | "soapcall" | "labelnames" | "phoneplays" | "uris", … } (v0.8.50): RulesCommand.cs
//   { "fn": "fromnames", "files": [[path, [root, …]], …] } (v0.8.50): what a file's folders and name say (Scan/ScanNames.cs)
//      → { names: [{ artist, album, year, disc, track, title }] }
//   { "fn": "dates", "dates": [tag], "releases": [common], "albums": [[[date, …], year]], "days": [[year, tagDate, mbDay]], "keys": [date] }
//      (v0.8.50): a date tag, a track's release date, an album's, a looked-up day laid over it, the sort's key
//      (Tags/TagReader.cs, Scan/Scanner.cs, Library.cs) → { dates, releases: [{ year, date }], albums, days, keys }
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
                    // v0.8.20's ports (Extras/ExtrasCommand.cs).
                    // AutoEq's files read (v0.8.26, Extras/AutoEq.cs): { index } → { rows }, { profile } → { preamp, bands } or { error }.
                    case "autoeq":
                        if (job["index"] is string md) o["rows"] = Extras.AutoEq.ParseIndex(md);
                        if (job["profile"] is string text)
                        {
                            try { var (preamp, bands) = Extras.AutoEq.ParseProfile(text); o["preamp"] = preamp; o["bands"] = bands; }
                            catch (Extras.AutoEqError e) { o["error"] = e.Message; }
                        }
                        break;
                    case "share" or "similar" or "days" or "labels" or "writeups" or "blob" or "backup" or "artfind":
                        o = Extras.ExtrasCommand.Run(Js.Str(job["fn"]), job);
                        break;
                    // The Sonos ports of stage 2 (v0.8.37, Playback/SonosCommand.cs).
                    case "xml" or "didl" or "moves" or "topology" or "soap":
                        o = Playback.SonosCommand.Run(Js.Str(job["fn"]), job);
                        break;
                    // The UPnP renderers' logic (v0.8.37, Renderers/RendererCommand.cs).
                    case "description" or "protocolinfo" or "gena" or "profiles":
                        o = Renderers.RendererCommand.Run(Js.Str(job["fn"]), job);
                        break;
                    // Stream plans, ReplayGain, DSP, signing, the radio's memory (v0.8.38).
                    case "plans" or "gain" or "dsp" or "sign" or "radio" or "math":
                        o = Playback.StreamCommand.Run(Js.Str(job["fn"]), job);
                        break;
                    // Small rules of the server (v0.8.50, RulesCommand.cs).
                    case var f when RulesCommand.Fns.Contains(f):
                        o = RulesCommand.Run(f, job);
                        break;
                    case "fromnames":
                        o["names"] = L(job["files"]).Select(f0 =>
                        {
                            var f = L(f0);
                            var n = ScanNames.FromNames(Js.Str(f.Count > 0 ? f[0] : ""), L(f.Count > 1 ? f[1] : null).Select(Js.Str).ToList());
                            var x = new JsObj();
                            x["artist"] = n.Artist; x["album"] = n.Album; x["year"] = n.Year; x["disc"] = n.Disc; x["track"] = n.Track; x["title"] = n.Title;
                            return (object?)x;
                        }).ToList();
                        break;
                    case "dates":
                        o["dates"] = L(job["dates"]).Select(v => (object?)TagReader.DateOf(v)).ToList();
                        o["releases"] = L(job["releases"]).Select(c =>
                        {
                            var (y, d) = TagReader.ReleaseDateOf(c as JsObj ?? new JsObj());
                            var x = new JsObj();
                            x["year"] = y; x["date"] = d;
                            return (object?)x;
                        }).ToList();
                        o["albums"] = L(job["albums"]).Select(a0 => { var a = L(a0); return (object?)Scanner.AlbumDateOf(L(a.Count > 0 ? a[0] : null), a.Count > 1 ? a[1] : null); }).ToList();
                        o["days"] = L(job["days"]).Select(d0 => { var d = L(d0); return (object?)Library.ReleaseDate(d.Count > 0 && d[0] is double y ? (long)y : null, d.Count > 1 ? d[1] as string : null, d.Count > 2 ? d[2] as string : null); }).ToList();
                        o["keys"] = L(job["keys"]).Select(k => (object?)Library.DateKey(k as string)).ToList();
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
