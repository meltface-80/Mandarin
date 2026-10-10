// SonosCommand.cs — the Sonos ports of stage 2 (v0.8.37) asked directly,
// through `mandarin-server score` (Identify/ScoreCommand.cs), a line of JSON in
// and a line out, so the tests hold them to the Node server's
// (test/sonos-csharp.test.js). Where JavaScript would throw, a case answers
// { threw: true }.
//
//   { fn: "xml", docs, escapes, texts, lists }                 lib/xml.js: parse, escape, text, list
//   { fn: "didl", builds: [{ uri, meta }], docs, hms, seconds }  lib/sonos/didl.js
//   { fn: "moves", plans: [{ length, current, positions }] }     lib/sonos/queue-moves.js
//   { fn: "topology", states, channel_maps, households: [{ state, include, exclude, uids, names }],
//     headers (base64), lans, locals: [[preferred, ifs]], searches: [[bindIp, ifs]] }   lib/sonos/topology.js
//   { fn: "soap", requests: [{ service, action, args }], responses: [{ body, action }] }  lib/sonos/soap.js
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

using Js = Mandarin.Server.Tags.Js;

internal static class SonosCommand
{
    private static List<object?> L(object? v) => v as List<object?> ?? [];
    private static JsObj O(object? v) => v as JsObj ?? new JsObj();
    private static object? Arg(object? args, int i) { var l = L(args); return i < l.Count ? l[i] : Undef.V; }
    private static List<object?> Items(IEnumerable<JsObj> items) => items.Select(x => (object?)x).ToList();

    /* Each case answered on its own; one JavaScript would throw on answers { threw: true }. */
    private static List<object?> Each(object? list, Func<object?, object?> f) => L(list).Select(c =>
    {
        try { return f(c); }
        catch (JsError) { var x = new JsObj(); x["threw"] = true; return x; }
    }).ToList();

    public static JsObj Run(string fn, JsObj job) => fn switch
    {
        "xml" => XmlFns(job),
        "didl" => DidlFns(job),
        "moves" => MoveFns(job),
        "topology" => TopologyFns(job),
        "soap" => SoapFns(job),
        _ => throw new JsError("unknown fn")
    };

    private static JsObj XmlFns(JsObj job)
    {
        var o = new JsObj();
        o["trees"] = Each(job["docs"], Xml.Parse);
        o["escaped"] = Each(job["escapes"], v => Xml.Escape(v));
        o["texts"] = Each(job["texts"], v => Xml.Text(v));
        o["lists"] = Each(job["lists"], v => Xml.ListOf(v));
        return o;
    }

    private static JsObj DidlFns(JsObj job)
    {
        var o = new JsObj();
        o["built"] = Each(job["builds"], c => Didl.Build(O(c)["uri"], O(c)["meta"]));
        o["items"] = Each(job["docs"], d => Items(Didl.ParseItems(d)));
        o["hms"] = Each(job["hms"], v => Didl.Hms(v));
        o["seconds"] = Each(job["seconds"], v => Didl.ToSeconds(v));
        o["sentinel"] = Didl.CdudnSentinel;
        return o;
    }

    private static JsObj MoveFns(JsObj job)
    {
        var o = new JsObj();
        o["plans"] = Each(job["plans"], c => QueueMoves.Json(QueueMoves.PlanMoves(O(c)["length"], O(c)["current"], O(c)["positions"])));
        return o;
    }

    private static JsObj GroupJson((JsObj Coordinator, List<JsObj> Members) g)
    {
        var x = new JsObj();
        x["coordinator"] = g.Coordinator;
        x["members"] = Items(g.Members);
        return x;
    }

    private static JsObj TopologyFns(JsObj job)
    {
        var o = new JsObj();
        o["zones"] = Each(job["states"], s => Items(Topology.ParseZoneGroupState(s)));
        o["channel_maps"] = Each(job["channel_maps"], v => Topology.ParseChannelMap(v));
        o["households"] = Each(job["households"], c0 =>
        {
            var c = O(c0);
            var h = new Household(Topology.ParseZoneGroupState(c["state"]), L(c["include"]).Select(x => Js.Str(x)), L(c["exclude"]).Select(x => Js.Str(x)));
            var x = new JsObj();
            x["rooms"] = Items(h.Rooms());
            x["groups"] = h.Groups().Select(g => (object?)GroupJson(g)).ToList();
            x["signature"] = h.Signature();
            x["coordinators"] = L(c["uids"]).Select(u => (object?)h.CoordinatorOf(u)).ToList();
            x["members"] = L(c["uids"]).Select(u => (object?)h.Member(u)).ToList();
            x["allowed"] = L(c["names"]).Select(n => (object?)h.Allowed(n)).ToList();
            return x;
        });
        o["headers"] = Each(job["headers"], b => Topology.ParseHeaders(Convert.FromBase64String(Js.Str(b))));
        o["lans"] = Each(job["lans"], ifs => Items(Topology.LanAddresses(ifs)));
        o["locals"] = Each(job["locals"], a => Topology.LocalIp(Arg(a, 0), Arg(a, 1)));
        o["searches"] = Each(job["searches"], a => Topology.SearchAddresses(Arg(a, 0), Arg(a, 1)));
        return o;
    }

    private static JsObj SoapFns(JsObj job)
    {
        var o = new JsObj();
        o["requests"] = Each(job["requests"], c => Soap.BuildRequest(O(c)["service"], O(c)["action"], O(c)["args"]));
        o["responses"] = Each(job["responses"], c =>
        {
            var x = new JsObj();
            try { x["out"] = Soap.ParseResponse(O(c)["body"], O(c)["action"]); }
            catch (UPnPError e)
            {
                var err = new JsObj();
                err["code"] = e.Code;
                err["description"] = e.Description;
                err["message"] = e.Message;
                x["error"] = err;
            }
            return x;
        });
        return o;
    }
}
