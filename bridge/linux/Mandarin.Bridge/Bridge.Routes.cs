// Bridge.Routes.cs — what the Bridge answers over HTTP: /dac.json for Mandarin, /update and /log (Update.cs, Kept.cs:
// item 291), and its own web page (Web.cs) with what that page reads and sets. Mandarin plays it over SlimProto
// (Slim.cs, item 316): the UPnP description, control and eventing it answered before are gone.
using System.Text.Json.Nodes;

namespace Mandarin.Bridge;

internal sealed partial class Bridge
{
    private const string Json = "application/json";

    private Http.Response Route(Http.Request r)
    {
        var p = r.Path;
        if (p == "/dac.json" && r.Method == "GET") return Http.Response.Text(200, DacJson().ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }), Json);
        if (p == "/" && r.Method is "GET" or "HEAD") return Http.Response.Text(200, Web.Page, "text/html; charset=\"utf-8\"");
        if (p == "/api/state" && r.Method == "GET") return Http.Response.Text(200, State().ToJsonString(), Json);
        if (p == "/api/settings" && r.Method == "POST") return Settings(r);
        if (p == "/api/wifi" && wifi != null) return r.Method == "POST" ? Join(r) : Http.Response.Text(200, wifi.State().ToJsonString(), Json);
        if (p == "/update" && r.Method == "POST") return Updated(r);
        if (p == "/log" && r.Method == "GET") return Http.Response.Text(200, Kept.Text(), "text/plain; charset=utf-8");
        return Http.Response.Text(404, "");
    }

    // Updated to Mandarin's release {tag} (Update.cs): begun, or why not.
    private Http.Response Updated(Http.Request r)
    {
        string tag;
        try { tag = (string?)(JsonNode.Parse(r.Text) as JsonObject)?["tag"] ?? ""; }
        catch (System.Text.Json.JsonException) { tag = ""; }
        var (ok, why) = update.Start(tag);
        return Http.Response.Text(ok ? 202 : 409, (ok ? update.State() : new JsonObject { ["error"] = why }).ToJsonString(), Json);
    }

    /* What the web page shows: the Bridge, the DACs and the one played to, what plays, and the Mandarin it is played by. */
    private JsonObject State()
    {
        var d = Dac;
        var c = slim.Current;
        var now = player.Now();
        var line = d == null ? "No USB DAC plugged in" : player.Error ?? slim.TransportState() switch
        {
            "PLAYING" => "Playing" + (now is { } n ? " · " + Describe(n) : ""),
            "PAUSED_PLAYBACK" => "Paused",
            "TRANSITIONING" => "Loading…",
            _ => "Ready",
        };
        return new JsonObject
        {
            ["name"] = store.Name, ["version"] = Program.Version + " (" + Program.Commit + ")", ["address"] = BaseUrl(), ["status"] = line, ["dsd_mode"] = store.DsdMode,
            ["dac"] = d?.Key, ["dacs"] = new JsonArray([.. dacs.Select(x => (JsonNode)new JsonObject
            {
                ["key"] = x.Key, ["name"] = x.Name, ["maker"] = x.Maker,
                ["takes"] = (x.Rates.Count > 0 ? $"{x.Rates.Min() / 1000.0:0.#}–{x.Rates.Max() / 1000.0:0.#} kHz" : "no PCM rates") + (x.Bits.Count > 0 ? $", up to {x.Bits.Max()}-bit" : "")
                    + (x.Native.Count > 0 ? ", native DSD" + x.Native.Max() : x.Dop.Count > 0 ? ", DSD" + x.Dop.Max() + " as DoP" : ""),
            })]),
            ["track"] = c == null ? null : new JsonObject { ["title"] = c.Title, ["artist"] = c.Artist, ["album"] = c.Album, ["state"] = slim.TransportState() },
            ["joined"] = slim.Joined,
            ["wifi"] = wifi == null ? null : new JsonObject { ["setup"] = wifi.Hotspot, ["error"] = wifi.LastError },
            ["mandarin"] = slim.Server is { } at ? new JsonObject { ["at"] = at.ToString(), ["seconds_ago"] = (int)(DateTime.UtcNow - slim.LastHeard).TotalSeconds } : null,
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
        _ = Task.Run(() => wifi!.Join(ssid, password));   // Mandarin found again on the network joined (Slim.cs)
        return Http.Response.Text(202, new JsonObject { ["joining"] = ssid }.ToJsonString(), Json);
    }

    // The web page's settings: the name on the network, the DAC played to, and how DSD goes. Each change a hello again.
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
        slim.Rehello();
        return Http.Response.Text(200, State().ToJsonString(), Json);
    }
}
