// Bridge.Routes.cs — what the Bridge answers over HTTP: its description and the services' SCPDs, their control (SOAP)
// and eventing (GENA), /dac.json for Mandarin, and its own web page (Web.cs) with what that page reads and sets.
using System.Text.Json.Nodes;

namespace Mandarin.Bridge;

internal sealed partial class Bridge
{
    private const string Json = "application/json";

    private Http.Response Route(Http.Request r)
    {
        var p = r.Path;
        if (p == "/description.xml" && r.Method is "GET" or "HEAD") return Http.Response.Text(200, Scpd.Description(store.Name, store.Udn, Environment.MachineName));
        if (p.StartsWith("/scpd/", StringComparison.Ordinal) && r.Method == "GET")
            return p switch
            {
                "/scpd/AVTransport.xml" => Http.Response.Text(200, Scpd.AvTransport),
                "/scpd/RenderingControl.xml" => Http.Response.Text(200, Scpd.RenderingControl),
                "/scpd/ConnectionManager.xml" => Http.Response.Text(200, Scpd.ConnectionManager),
                _ => Http.Response.Text(404, ""),
            };
        if (p.StartsWith("/control/", StringComparison.Ordinal) && r.Method == "POST") return Control(r, p["/control/".Length..]);
        if (p.StartsWith("/event/", StringComparison.Ordinal) && r.Method is "SUBSCRIBE" or "UNSUBSCRIBE") return Subscribe(r, p["/event/".Length..]);
        if (p == "/dac.json" && r.Method == "GET") return Http.Response.Text(200, DacJson().ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }), Json);
        if (p == "/" && r.Method is "GET" or "HEAD") return Http.Response.Text(200, Web.Page, "text/html; charset=\"utf-8\"");
        if (p == "/api/state" && r.Method == "GET") return Http.Response.Text(200, State().ToJsonString(), Json);
        if (p == "/api/settings" && r.Method == "POST") return Settings(r);
        if (p == "/api/wifi" && wifi != null) return r.Method == "POST" ? Join(r) : Http.Response.Text(200, wifi.State().ToJsonString(), Json);
        return Http.Response.Text(404, "");
    }

    private Http.Response Control(Http.Request r, string service)
    {
        LastControl = (r.From, DateTime.UtcNow);
        var type = service switch { "AVTransport" => Scpd.Avt, "RenderingControl" => Scpd.Rcs, "ConnectionManager" => Scpd.Cms, _ => null };
        if (type == null) return Http.Response.Text(404, "");
        Xml.Action? action;
        try { action = Xml.ParseSoap(r.Text); }
        catch (System.Xml.XmlException) { action = null; }
        if (action == null) return Http.Response.Text(400, Soap.FaultText(402, "Invalid Args"));
        try { return Http.Response.Text(200, Soap.Response(type, action.Name, renderer.Handle(service, action))); }
        catch (Fault f) { return Http.Response.Text(500, Soap.FaultText(f.Code, f.Description)); }
    }

    private Http.Response Subscribe(Http.Request r, string service)
    {
        var ev = service switch { "AVTransport" => renderer.Avt, "RenderingControl" => renderer.Rcs, "ConnectionManager" => renderer.Cms, _ => null };
        if (ev == null) return Http.Response.Text(404, "");
        var sid = r.Header("sid");
        if (r.Method == "UNSUBSCRIBE") return Http.Response.Text(sid != null && ev.Unsubscribe(sid) ? 200 : 412, "");
        Func<string> initial = service switch { "AVTransport" => renderer.AvtInitial, "RenderingControl" => Renderer.RcsInitial, _ => renderer.CmsInitial };
        if (ev.Subscribe(sid, r.Header("callback"), r.Header("timeout"), initial) is not { } got) return Http.Response.Text(412, "");
        return new Http.Response(200, [], Headers: new() { ["SID"] = got.Sid, ["TIMEOUT"] = "Second-" + got.Seconds });
    }

    /* What the web page shows: the Bridge, the DACs and the one played to, what plays, and who last played to it. */
    private JsonObject State()
    {
        var d = Dac;
        var c = renderer.Current;
        var now = player.Now();
        var line = d == null ? "No USB DAC plugged in" : player.Error ?? renderer.TransportState() switch
        {
            "PLAYING" => "Playing" + (now is { } n ? " · " + Describe(n) : ""),
            "PAUSED_PLAYBACK" => "Paused",
            "TRANSITIONING" => "Loading…",
            _ => "Ready",
        };
        return new JsonObject
        {
            ["name"] = store.Name, ["version"] = Program.Version, ["address"] = BaseUrl(), ["status"] = line, ["dsd_mode"] = store.DsdMode,
            ["dac"] = d?.Key, ["dacs"] = new JsonArray([.. dacs.Select(x => (JsonNode)new JsonObject
            {
                ["key"] = x.Key, ["name"] = x.Name, ["maker"] = x.Maker,
                ["takes"] = (x.Rates.Count > 0 ? $"{x.Rates.Min() / 1000.0:0.#}–{x.Rates.Max() / 1000.0:0.#} kHz" : "no PCM rates") + (x.Bits.Count > 0 ? $", up to {x.Bits.Max()}-bit" : "")
                    + (x.Native.Count > 0 ? ", native DSD" + x.Native.Max() : x.Dop.Count > 0 ? ", DSD" + x.Dop.Max() + " as DoP" : ""),
            })]),
            ["track"] = c == null ? null : new JsonObject { ["title"] = c.Didl.Title, ["artist"] = c.Didl.Artist, ["album"] = c.Didl.Album, ["art"] = c.Didl.ArtUri, ["state"] = renderer.TransportState() },
            ["joined"] = renderer.Joined,
            ["wifi"] = wifi == null ? null : new JsonObject { ["setup"] = wifi.Hotspot, ["error"] = wifi.LastError },
            ["control"] = LastControl is { } lc ? new JsonObject { ["from"] = lc.From, ["seconds_ago"] = (int)(DateTime.UtcNow - lc.At).TotalSeconds } : null,
            ["dac_json"] = DacJson(),
        };
    }

    private static string Describe((double Rate, string Kind, int Dsd) n) => n.Kind switch
    {
        "dsd" => $"native DSD{n.Dsd}",
        "dop" => $"DSD{n.Dsd} as DoP",
        _ => $"{n.Rate / 1000:0.#} kHz",
    };

    // The home network joined (in the background: the page was reached over the setup network, which closes as it does).
    private Http.Response Join(Http.Request r)
    {
        if (JsonNode.Parse(r.Text is { Length: > 0 } t ? t : "{}") is not JsonObject o || o["ssid"] is not JsonValue sv || !sv.TryGetValue<string>(out var ssid) || ssid.Length == 0)
            return Http.Response.Text(400, "{\"error\":\"which network?\"}", Json);
        var password = o["password"] is JsonValue pv && pv.TryGetValue<string>(out var pw) ? pw : "";
        _ = Task.Run(() => { if (wifi!.Join(ssid, password)) ssdp.Alive(); });
        return Http.Response.Text(202, new JsonObject { ["joining"] = ssid }.ToJsonString(), Json);
    }

    // The web page's settings: the name on the network, the DAC played to, and how DSD goes. Each change announced at once.
    private Http.Response Settings(Http.Request r)
    {
        if (JsonNode.Parse(r.Text is { Length: > 0 } t ? t : "{}") is not JsonObject o) return Http.Response.Text(400, "{\"error\":\"not JSON\"}", Json);
        if (o["name"] is JsonValue n && n.TryGetValue<string>(out var name))
        {
            if (name.Trim().Length is 0 or > 64) return Http.Response.Text(400, "{\"error\":\"a name of 1 to 64 characters\"}", Json);
            store.Name = name;
        }
        if (o["dac"] is JsonValue dv && dv.TryGetValue<string>(out var key)) store.Dac = key;
        if (o["dsd_mode"] is JsonValue mv && mv.TryGetValue<string>(out var mode)) store.DsdMode = mode;
        lastCaps = "-";   // said again, whatever changed
        Look();
        ssdp.Alive();
        return Http.Response.Text(200, State().ToJsonString(), Json);
    }
}
