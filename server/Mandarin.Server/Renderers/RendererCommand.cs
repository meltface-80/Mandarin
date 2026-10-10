// RendererCommand.cs — v0.8.37's ports of the UPnP renderers' logic (stage 2a)
// asked directly, through `mandarin-server score` (Identify/ScoreCommand.cs),
// a line of JSON in and a line out, so the tests hold them to the Node
// server's (test/renderers-csharp.test.js):
//
//   { fn: "description", xml: [text], urls: [{ rel, base? }], short: [serviceType], cases: [{ xml, location? }] }
//      → { xml: [tree | null], urls: [href | null], short: [name], parsed: [record | null] }
//   { fn: "protocolinfo", sinks: [sink], mimes: [mime] } → { sinks: [{ mimes, containers, rates, raw }], containers: [name | null] }
//   { fn: "gena", bodies: [body], timeouts: [header] } → { timeout_s, notify: [{ name: value }], seconds: [n] }
//   { fn: "profiles", lookups: [{ device? }], records: [{ record? }] }
//      → { rates, bits, dsd, floor, profiles, local, profile: [profile | { threw }], effective: [chips | { threw }] }
//
// A key left out stands for undefined, which JSON can't carry in a list. A
// profile's patterns are written as profiles.js writes them (String(re)).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

using Js = Mandarin.Server.Tags.Js;
using Xml = Mandarin.Server.Playback.Xml;

internal static class RendererCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static List<object?> Each(object? list, Func<object?, object?> f) => L(list).Select(f).ToList();
    private static List<object?> Nums(double[] a) => a.Select(x => (object?)x).ToList();

    public static JsObj Run(string fn, JsObj job) => fn switch
    {
        "description" => DescriptionFns(job),
        "protocolinfo" => ProtocolInfoFns(job),
        "gena" => GenaFns(job),
        "profiles" => ProfilesFns(job),
        _ => throw new JsError("unknown fn")
    };

    /* lib/xml.js's parse, new URL as description.js resolves with it, shortType and parseDescription. */
    private static JsObj DescriptionFns(JsObj job)
    {
        var o = new JsObj();
        o["xml"] = Each(job["xml"], t => Xml.Parse(t));
        o["urls"] = Each(job["urls"], u0 =>
        {
            var u = O(u0);
            return WebUrl.Href(Js.Str(u["rel"]), u["base"] is Undef ? null : Js.Str(u["base"]));
        });
        o["short"] = Each(job["short"], t => Description.ShortType(t));
        o["parsed"] = Each(job["cases"], c0 => { var c = O(c0); return Description.Parse(c["xml"], c["location"]); });
        return o;
    }

    /* lib/renderers/protocolinfo.js's parseSink and containerOf. */
    private static JsObj ProtocolInfoFns(JsObj job)
    {
        var o = new JsObj();
        o["sinks"] = Each(job["sinks"], s => ProtocolInfo.ParseSink(s));
        o["containers"] = Each(job["mimes"], m => ProtocolInfo.ContainerOf(m));
        return o;
    }

    /* lib/renderers/gena.js's parseNotify, the TIMEOUT header read (seconds) and TIMEOUT_S. */
    private static JsObj GenaFns(JsObj job)
    {
        var o = new JsObj();
        o["timeout_s"] = Gena.TimeoutS;
        o["notify"] = Each(job["bodies"], b => Gena.ParseNotify(b));
        o["seconds"] = Each(job["timeouts"], t => Gena.Seconds(t));
        return o;
    }

    /* lib/renderers/profiles.js: its tables, profileFor and effective (a throw as { threw: true }). */
    private static JsObj ProfilesFns(JsObj job)
    {
        var o = new JsObj();
        o["rates"] = Nums(Profiles.Rates);
        o["bits"] = Nums(Profiles.Bits);
        o["dsd"] = Nums(Profiles.Dsd);
        var floor = new JsObj();
        floor["rates"] = Nums(Profiles.FloorRates);
        floor["bits"] = Nums(Profiles.FloorBits);
        o["floor"] = floor;
        o["profiles"] = Profiles.All.Select(p => (object?)Profiles.ToJs(p)).ToList();
        o["local"] = Profiles.ToJs(Profiles.Local);
        o["profile"] = Each(job["lookups"], a => Guard(() => Profiles.ToJs(Profiles.For(O(a)["device"]))));
        o["effective"] = Each(job["records"], r => Guard(() => Profiles.Effective(O(r)["record"])));
        return o;
    }

    private static object? Guard(Func<object?> f)
    {
        try { return f(); }
        catch (JsError)
        {
            var x = new JsObj();
            x["threw"] = true;
            return x;
        }
    }
}
