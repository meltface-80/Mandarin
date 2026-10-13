// RulesCommand.cs — small rules of the server asked directly, through
// `mandarin-server score` (Identify/ScoreCommand.cs), a line of JSON in and a
// line out (v0.8.50, stage 7 part 5): what the tests of lib/'s copies asked
// those copies, asked of the C# server's own now that they are gone.
//
//   { fn: "mounts", mountinfo, dataDir, hints: [[dir, entries, docker]] }  Mounts.cs
//      → { mounts: [{ path, type, waiting }], hints }
//   { fn: "versions", pairs: [[a, b]], extracts: [[file, dest]] }         Admin/Updater.cs
//      → { cmp, extracted }
//   { fn: "soapcall", calls: [{ url, service, action, args, wait }] }     Playback/SoapHttp.cs
//      → { results: [{ out } | { error }] }, one after another, each [wait] ms after the last
//   { fn: "labelnames", canonical, keys, not_labels, folders: [[dir, roots, depth]] }  Names.cs
//      → { canonical, keys, not_labels, folders }
//   { fn: "phoneplays", tracks: [{ path, codec, channels, bits }] }       Downloads.cs
//      → { plays }
//   { fn: "uris", uris }                                                  Playback/Phones.Commands.cs
//      → { tracks }: the library track each stream address names, or null
using Mandarin.Server.Tags;

namespace Mandarin.Server;

using TJs = Mandarin.Server.Tags.Js;

internal static class RulesCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static object? At(object? list, int i) { var l = L(list); return i < l.Count ? l[i] : null; }
    private static string S(object? v) => TJs.IsNullish(v) ? "" : TJs.Str(v);
    private static long N(object? v) => TJs.IsNullish(v) ? 0 : (long)TJs.ToNumber(v);
    private static List<object?> Each(object? list, Func<object?, object?> f) => L(list).Select(f).ToList();
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();

    public static readonly string[] Fns = ["mounts", "versions", "soapcall", "labelnames", "phoneplays", "uris"];

    public static JsObj Run(string fn, JsObj job) => fn switch
    {
        "mounts" => MountFns(job),
        "versions" => VersionFns(job),
        "soapcall" => SoapCalls(job).GetAwaiter().GetResult(),
        "labelnames" => LabelNameFns(job),
        "phoneplays" => new JsObj { ["plays"] = Each(job["tracks"], t => Downloads.PhonePlays(new Downloads.Track(0, S(O(t)["path"]), S(O(t)["codec"]), 0, N(O(t)["bits"]), N(O(t)["channels"]), 0, 0))) },
        "uris" => new JsObj { ["tracks"] = Each(job["uris"], u => Playback.Phones.TrackIdFromUri(TJs.IsNullish(u) ? null : TJs.Str(u)) is { } id ? (double)id : null) },
        _ => throw new JsError("unknown fn")
    };

    private static JsObj MountFns(JsObj job)
    {
        var mounts = Mounts.MusicMounts(S(job["dataDir"]), S(job["mountinfo"]));
        return new JsObj
        {
            ["mounts"] = mounts.Select(m => (object?)new JsObj { ["path"] = m.Path, ["type"] = m.Type, ["waiting"] = m.Waiting }).ToList(),
            ["hints"] = Each(job["hints"], h => Mounts.HintFor(S(At(h, 0)), mounts, (int)N(At(h, 1)), TJs.Truthy(At(h, 2))))
        };
    }

    private static JsObj VersionFns(JsObj job) => new()
    {
        ["cmp"] = Each(job["pairs"], p => (double)Admin.Updater.CmpVer(At(p, 0), At(p, 1))),
        ["extracted"] = Each(job["extracts"], p => Admin.Updater.Extract(S(At(p, 0)), S(At(p, 1))))
    };

    private static async Task<JsObj> SoapCalls(JsObj job)
    {
        var results = new List<object?>();
        foreach (var c in L(job["calls"]))
        {
            if (N(O(c)["wait"]) is var wait and > 0) await Task.Delay((int)wait);
            var x = new JsObj();
            try { x["out"] = await Playback.SoapHttp.Call(S(O(c)["url"]), S(O(c)["service"]), S(O(c)["action"]), O(c)["args"] as JsObj); }
            catch (Playback.UPnPError e) { x["error"] = e.Message; }
            results.Add(x);
        }
        return new JsObj { ["results"] = results };
    }

    private static JsObj LabelNameFns(JsObj job) => new()
    {
        ["canonical"] = Each(job["canonical"], n => Names.CanonicalLabelName(TJs.IsNullish(n) ? null : TJs.Str(n))),
        ["keys"] = Each(job["keys"], n => Names.LabelKey(TJs.IsNullish(n) ? null : TJs.Str(n))),
        ["not_labels"] = Each(job["not_labels"], n => Names.IsLikelyNotALabel(TJs.IsNullish(n) ? null : TJs.Str(n))),
        ["folders"] = Each(job["folders"], f => Names.LabelFromFolder(S(At(f, 0)), L(At(f, 1)).Select(S).ToList(), (int)N(At(f, 2))))
    };
}
