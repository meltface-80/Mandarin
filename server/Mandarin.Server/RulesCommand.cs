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
//   { fn: "cpu", decides: [{ linux, taskset, cores, env, dsp }], places: [{ kind, tools, raise, cores, env, bin, args }],
//     expands, compacts }                                                  Cpu.cs, Cpu.Place.cs
//      → { decides: [{ split, playback, background, core, slots }], places: [command line], expands, compacts }
//   { fn: "auth", locals, uas, clients: [[remote, x-forwarded-for]], tailnet, aways: [{ port, set, own, ifaces }],
//     powers: [{ env, mac }] }                                            Auth.cs, Front.cs, PhoneRoutes.cs, PowerRoutes.cs
//      → { locals, names, clients, tailnet, aways, powers }
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

    public static readonly string[] Fns = ["mounts", "versions", "soapcall", "labelnames", "phoneplays", "uris", "cpu", "auth"];

    public static JsObj Run(string fn, JsObj job) => fn switch
    {
        "mounts" => MountFns(job),
        "versions" => VersionFns(job),
        "soapcall" => SoapCalls(job).GetAwaiter().GetResult(),
        "labelnames" => LabelNameFns(job),
        "phoneplays" => new JsObj { ["plays"] = Each(job["tracks"], t => Downloads.PhonePlays(new Downloads.Track(0, S(O(t)["path"]), S(O(t)["codec"]), 0, N(O(t)["bits"]), N(O(t)["channels"]), 0, 0))) },
        "cpu" => CpuFns(job),
        "auth" => AuthFns(job),
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

    /* A split decided as Cpu.Decide decides it, from a case's cores and its PLAYBACK_CORES / PLAYBACK_CORE. */
    private static (bool Split, int[] Cores, int[] Playback, int[] Background, int? Core) Decided(object? c, bool taskset) =>
        Cpu.Decide(O(c)["linux"] is not false, taskset, L(O(c)["cores"]).Select(x => (int)N(x)).ToArray(),
            TJs.IsNullish(O(O(c)["env"])["PLAYBACK_CORES"]) ? null : S(O(O(c)["env"])["PLAYBACK_CORES"]),
            TJs.IsNullish(O(O(c)["env"])["PLAYBACK_CORE"]) ? null : S(O(O(c)["env"])["PLAYBACK_CORE"]), TJs.Truthy(O(c)["dsp"]));

    private static List<object?> Ints(IEnumerable<int> l) => l.Select(x => (object?)(double)x).ToList();

    private static JsObj CpuFns(JsObj job) => new()
    {
        ["decides"] = Each(job["decides"], c =>
        {
            var d = Decided(c, O(c)["taskset"] is not false);
            return new JsObj { ["split"] = d.Split, ["playback"] = Ints(d.Playback), ["background"] = Ints(d.Background), ["core"] = d.Core is { } k ? (double)k : null, ["slots"] = (double)Cpu.SlotsFor(d.Background) };
        }),
        ["places"] = Each(job["places"], c =>
        {
            var t = O(O(c)["tools"]);
            var tools = (TJs.Truthy(t["taskset"]), TJs.Truthy(t["nice"]), TJs.Truthy(t["ionice"]));
            var d = Decided(c, tools.Item1);
            var kind = S(O(c)["kind"]) switch { "background" => CpuKind.Background, "ahead" => CpuKind.Ahead, _ => CpuKind.Playback };
            var line = Cpu.ChainFor(kind, tools, d.Split, d.Playback, d.Background, raised: S(O(c)["kind"]) == "realtime" && TJs.Truthy(O(c)["raise"]));
            line.Add(S(O(c)["bin"]));
            line.AddRange(L(O(c)["args"]).Select(S));
            return line.Select(x => (object?)x).ToList();
        }),
        ["expands"] = Each(job["expands"], x => Ints(Cpu.Expand(S(x)))),
        ["compacts"] = Each(job["compacts"], x => Cpu.Compact(L(x).Select(v => (int)N(v))))
    };

    /* A request from [remote], with what a proxy said it came from. */
    private static HttpContext RequestFrom(object? remote, object? forwarded)
    {
        var ctx = new DefaultHttpContext();
        ctx.Connection.RemoteIpAddress = System.Net.IPAddress.Parse(S(remote));
        if (!TJs.IsNullish(forwarded)) ctx.Request.Headers["X-Forwarded-For"] = S(forwarded);
        return ctx;
    }

    private static JsObj AuthFns(JsObj job) => new()
    {
        ["locals"] = Each(job["locals"], ip => Auth.IsLocal(S(ip))),
        ["names"] = Each(job["uas"], ua => Auth.DeviceNameFromUA(S(ua))),
        ["clients"] = Each(job["clients"], c => Auth.ClientIp(RequestFrom(At(c, 0), At(c, 1)))),
        ["tailnet"] = Each(job["tailnet"], ip => Playback.Topology.IsCgnat(S(ip))),
        ["aways"] = Each(job["aways"], c => PlaybackRoutes.AwayAddress((int)N(O(c)["port"]), TJs.IsNullish(O(c)["set"]) ? null : S(O(c)["set"]),
            TJs.IsNullish(O(c)["own"]) ? null : S(O(c)["own"]), O(c)["ifaces"] ?? new JsObj())),
        ["powers"] = Each(job["powers"], c => Scan.JsJson.Parse(Library.PowerInfo(k => TJs.IsNullish(O(O(c)["env"])[k]) ? null : S(O(O(c)["env"])[k]), TJs.Truthy(O(c)["mac"])).ToJsonString()))
    };
}
