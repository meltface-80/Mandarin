// RulesCommand.cs — small rules of the server asked directly, through
// `mandarin-server score` (Identify/ScoreCommand.cs), a line of JSON in and a
// line out (v0.8.50, stage 7 part 5): what the tests of lib/'s copies asked
// those copies, asked of the C# server's own now that they are gone.
//
//   { fn: "mounts", mountinfo, dataDir, hints: [[dir, entries, docker]] }  Mounts.cs
//      → { mounts: [{ path, type, waiting }], hints }
//   { fn: "versions", pairs: [[a, b]], extracts: [[file, dest]], builds: [[informational, assembly]] }  Admin/Updater.cs, BuildVersion.cs
//      → { cmp, extracted, built }
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
//     powers: [{ env, mac }] }                                            Auth.cs, Server.cs, PhoneRoutes.cs, PowerRoutes.cs
//      → { locals, names, clients, tailnet, aways, powers }
//   { fn: "register", data, steps: [{ seen } | { rename: [id, name] } | { caps: [id, user] } | { verified: [id, rate, bits] }
//     | { forget } | { get } | { name } | { wait: ms }] }                  Playback/Register.cs, DeviceRoutes.cs
//      → { results }: each step's, on the database in [data] (made by `mandarin-server db`), opened afresh each time
//   { fn: "ssdp", sonos: [{ usn, server }], seeds, ids, heard: [text] }   Renderers/Ssdp.cs, Discovery.cs, SsdpListen.cs
//      → { sonos, seeds, ids, alive }
//   { fn: "engine", steps }                                               Local/EngineCommand.cs: the engine's driver from a script
//   { fn: "local", linux: [root, dev], mac: json, hw: [[location, root]], ids, amplitude: [[pct, muted]] }
//      → { devices, hidden, mac, hw, ids, amplitude }                    Local/LocalDevices.cs, EngineOutput.cs
//   { fn: "scorecall" | "itunes" | "mbpack", … }                          Identify/ScoreCalls.cs
//   { fn: "logos", … }                                                    Extras/LogosCommand.cs: the label-logo finder, step by step
//   { fn: "lastfm", … }                                                   Extras/LastfmCommand.cs: the Last.fm client, step by step
//   { fn: "shelf", buckets: [sortArtist], shelves: [[{ id, title, artist, sortArtist, genres, image_key, year }]] }
//      → { buckets, shelves: [{ genres, albums, sig }] }                  ShelfRoutes.cs
//   { fn: "addresses", ips, hosts, art: [[url, loopbackTaken]], connect: [{ url, loopbackTaken, proxy }], linkplay: [base] }
//      → { inward, private, hosts, art: [null | refusal], connect: [status | refusal], linkplay: [status | "refused: …"] }
//                                                                          Addresses.cs, Renderers/LinkPlay.cs
using System.Net;
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

    public static readonly string[] Fns = ["mounts", "versions", "soapcall", "labelnames", "phoneplays", "uris", "cpu", "auth", "register", "ssdp", "engine", "local", "scorecall", "itunes", "logos", "lastfm", "shelf", "mbpack", "addresses"];

    public static JsObj Run(string fn, JsObj job) => fn switch
    {
        "mounts" => MountFns(job),
        "versions" => VersionFns(job),
        "soapcall" => SoapCalls(job).GetAwaiter().GetResult(),
        "labelnames" => LabelNameFns(job),
        "phoneplays" => new JsObj { ["plays"] = Each(job["tracks"], t => Downloads.PhonePlays(new Downloads.Track(0, S(O(t)["path"]), S(O(t)["codec"]), 0, N(O(t)["bits"]), N(O(t)["channels"]), 0, 0))) },
        "cpu" => CpuFns(job),
        "auth" => AuthFns(job),
        "logos" => Extras.LogosCommand.Run(job),
        "lastfm" => Extras.LastfmCommand.Run(job),
        "shelf" => ShelfFns(job),
        "register" => RegisterFns(job),
        "local" => LocalFns(job),
        "addresses" => AddressFns(job).GetAwaiter().GetResult(),
        // The identification's rules by name, and the iTunes client from a script (Identify/ScoreCalls.cs).
        "scorecall" => Identify.ScoreCalls.Run(job),
        "itunes" => Identify.ScoreCalls.ITunesSteps(job).GetAwaiter().GetResult(),
        "mbpack" => Identify.ScoreCalls.PackSteps(job).GetAwaiter().GetResult(),
        // The audio engine's driver run from a script (Local/EngineCommand.cs).
        "engine" => Local.EngineCommand.Run(job).GetAwaiter().GetResult(),
        "ssdp" => new JsObj
        {
            ["sonos"] = Each(job["sonos"], a => Renderers.Ssdp.IsSonos(new Renderers.SsdpAnswer("", S(O(a)["usn"]), "", S(O(a)["server"]), ""))),
            ["seeds"] = Each(job["seeds"], x => Renderers.RendererDiscovery.SeedLocation(TJs.IsNullish(x) ? null : S(x))),
            ["ids"] = Each(job["ids"], x => Renderers.RendererDiscovery.IdFor(TJs.IsNullish(x) ? null : S(x))),
            ["alive"] = Each(job["heard"], x => Renderers.SsdpListen.Alive(Playback.Topology.ParseHeaders(System.Text.Encoding.UTF8.GetBytes(S(x)))))
        },
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
        ["extracted"] = Each(job["extracts"], p => Admin.Updater.Extract(S(At(p, 0)), S(At(p, 1)))),
        ["built"] = Each(job["builds"], p => BuildVersion.Parse(TJs.IsNullish(At(p, 0)) ? null : S(At(p, 0)), System.Version.TryParse(S(At(p, 1)), out var v) ? v : null))
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

    /* A device's row as registry.js's row() gives it. */
    private static object? DeviceJson(Playback.DeviceRecord? d) => d == null ? null : new JsObj
    {
        ["id"] = d.Id, ["kind"] = d.Kind, ["family"] = d.Family, ["network_name"] = d.NetworkName, ["name"] = d.Name,
        ["manufacturer"] = d.Manufacturer, ["model"] = d.Model, ["ip"] = d.Ip, ["caps"] = d.Caps, ["first_seen"] = d.FirstSeen
    };

    private static JsObj RegisterFns(JsObj job)
    {
        var results = new List<object?>();
        foreach (var step0 in L(job["steps"]))
        {
            var step = O(step0);
            if (step["wait"] is double ms) { Thread.Sleep((int)ms); results.Add(null); continue; }
            using var c = Scan.ScanCommand.OpenDb(S(job["data"]));
            if (step["seen"] is JsObj s)
            {
                results.Add(DeviceJson(Playback.Register.Seen(c, new Playback.SeenInfo
                {
                    Id = S(s["id"]), Kind = S(s["kind"]), Family = s["family"] as string, NetworkName = s["network_name"] as string,
                    Manufacturer = s["manufacturer"] as string, Model = s["model"] as string, Ip = s["ip"] as string,
                    Caps = s["caps"] as JsObj, Playable = s["playable"] as bool?
                })));
            }
            else if (step["rename"] is List<object?> rn) { Playback.Register.Rename(c, S(At(rn, 0)), At(rn, 1) as string); results.Add(null); }
            else if (step["caps"] is List<object?> cp) results.Add(Library.DeviceUserCaps(c, S(At(cp, 0)), At(cp, 1) as JsObj));
            else if (step["verified"] is List<object?> v)
            {
                Playback.Register.MarkVerified(c, S(At(v, 0)), At(v, 1) is double r ? r : null, At(v, 2) is double b ? b : null);
                results.Add(null);
            }
            else if (step.Has("forget")) { Playback.Register.Forget(c, S(step["forget"])); results.Add(null); }
            else if (step.Has("get")) results.Add(DeviceJson(Playback.Register.Get(c, S(step["get"]))));
            else if (step.Has("name")) results.Add(Playback.Register.NameOf(c, S(step["name"])));
            else throw new JsError("unknown step");
        }
        return new JsObj { ["results"] = results };
    }

    /* Shelf's rules: the letter an artist is filed under; the list built from albums as given, and its signature. */
    private static JsObj ShelfFns(JsObj job) => new()
    {
        ["buckets"] = Each(job["buckets"], v => Library.ShelfBucket(v as string)),
        ["shelves"] = Each(job["shelves"], list =>
        {
            var shelf = Library.BuildShelf(L(list).Select(O).Select(a => new Album
            {
                Id = N(a["id"]), Title = S(a["title"]), Artist = S(a["artist"]), SortArtist = S(a["sortArtist"]), ImageKey = S(a["image_key"]),
                Genres = L(a["genres"]).Select(S).ToList(), Year = TJs.IsNullish(a["year"]) ? null : N(a["year"])
            }).ToList());
            return new JsObj { ["genres"] = Scan.JsJson.Parse(shelf.Genres.ToJsonString()), ["albums"] = Scan.JsJson.Parse(shelf.Albums.ToJsonString()), ["sig"] = shelf.Sig };
        })
    };

    /* A device as the register takes it (what listing this computer's devices says of each). */
    private static object? SeenJson(Playback.SeenInfo d) => new JsObj
    {
        ["id"] = d.Id, ["kind"] = d.Kind, ["family"] = d.Family, ["network_name"] = d.NetworkName, ["manufacturer"] = d.Manufacturer,
        ["model"] = d.Model, ["location"] = d.Location, ["caps"] = d.Caps, ["playable"] = d.Playable
    };

    private static JsObj LocalFns(JsObj job)
    {
        var o = new JsObj();
        if (job["linux"] is List<object?> lx)
        {
            var list = Local.LocalDevices.ListLinux(S(At(lx, 0)), S(At(lx, 1)));
            o["devices"] = list.Devices.Select(SeenJson).ToList();
            o["hidden"] = (double)list.Hidden;
        }
        if (job["mac"] is string mac) o["mac"] = Local.LocalDevices.ParseMac(mac, job["mac_engine"] as string).Select(SeenJson).ToList();
        o["hw"] = Each(job["hw"], h => Local.LocalDevices.HwParams(S(At(h, 0)), S(At(h, 1))) is { } p ? new JsObj { ["rate"] = p.Rate, ["format"] = p.Format } : null);
        o["ids"] = Each(job["ids"], k => Local.LocalDevices.IdOf(S(k)));
        o["amplitude"] = Each(job["amplitude"], a => Local.EngineOutput.Amplitude(N(At(a, 0)), TJs.Truthy(At(a, 1))));
        return o;
    }

    /* Where the server may go (Addresses.cs): the rules; a cover's address checked, and its connection made; a LinkPlay player asked over HTTPS. */
    private static async Task<JsObj> AddressFns(JsObj job)
    {
        var o = new JsObj
        {
            ["inward"] = Each(job["ips"], v => Addresses.Inward(IPAddress.Parse(S(v)))),
            ["private"] = Each(job["ips"], v => Addresses.Private(IPAddress.Parse(S(v)))),
            ["hosts"] = Each(job["hosts"], h => Addresses.PrivateHost(S(h)))
        };
        var art = new List<object?>();
        foreach (var a in L(job["art"]))
        {
            try { await Addresses.CheckArt(new Uri(S(At(a, 0))), TJs.Truthy(At(a, 1)), CancellationToken.None); art.Add(null); }
            catch (AddressRefused e) { art.Add(e.Message); }
        }
        o["art"] = art;
        var connect = new List<object?>();
        foreach (var c in L(job["connect"]).Select(O))
        {
            var proxy = c["proxy"] as string;
            using var http = new HttpClient(new SocketsHttpHandler { ConnectCallback = Addresses.ArtConnect(TJs.Truthy(c["loopbackTaken"])), UseProxy = proxy != null, Proxy = proxy != null ? new WebProxy(proxy) : null });
            try { using var r = await http.GetAsync(S(c["url"])); connect.Add((double)(int)r.StatusCode); }
            catch (HttpRequestException e) { connect.Add(e.InnerException is AddressRefused r ? r.Message : "fetch failed"); }
        }
        o["connect"] = connect;
        var linkplay = new List<object?>();
        foreach (var b in L(job["linkplay"]))
        {
            try { linkplay.Add(await Renderers.LinkPlay.Command(S(b), "getStatusEx") is { } j ? j : "not LinkPlay"); }
            catch (HttpRequestException e) { linkplay.Add("refused: " + (e.InnerException?.GetType().Name ?? e.Message)); }
        }
        o["linkplay"] = linkplay;
        return o;
    }
}
