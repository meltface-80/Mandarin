// GenaClient.cs — UPnP eventing (GENA), the client side (lib/renderers/gena.js,
// v0.8.49, stage 6 part 3): SUBSCRIBE to a service's event URL with a callback
// address here; the device answers with a subscription id (SID) and a
// lifetime, and from then on POSTs a NOTIFY to the callback whenever its
// state variables change. Renewed before it runs out; UNSUBSCRIBEd on the way
// out. The NOTIFY itself is read by Gena.cs (v0.8.37) and answered by
// Players.cs (NOTIFY /upnp/event/<id>, before the gate).
using Mandarin.Server.Playback;

namespace Mandarin.Server.Renderers;

internal static class GenaClient
{
    public sealed record Subscription(string Sid, double Expires);

    private static string Header(System.Net.Http.Headers.HttpResponseHeaders h, string name) =>
        h.TryGetValues(name, out var v) ? string.Join(",", v) : "";

    /* → { sid, expires }, or an error when the device said no. */
    public static async Task<Subscription> Subscribe(string eventUrl, string callbackUrl)
    {
        var r = await SoapHttp.Request(eventUrl, "SUBSCRIBE", [("CALLBACK", $"<{callbackUrl}>"), ("NT", "upnp:event"), ("TIMEOUT", $"Second-{Gena.TimeoutS}")]);
        var sid = Header(r.Headers, "SID");
        if (r.Status != 200 || sid.Length == 0) throw new RendererError($"SUBSCRIBE answered {r.Status}", double.NaN);
        return new Subscription(sid, Hub.Now() + Gena.Seconds(Header(r.Headers, "TIMEOUT")) * 1000);
    }

    public static async Task<Subscription> Renew(string eventUrl, string sid)
    {
        var r = await SoapHttp.Request(eventUrl, "SUBSCRIBE", [("SID", sid), ("TIMEOUT", $"Second-{Gena.TimeoutS}")]);
        if (r.Status != 200) throw new RendererError($"renew answered {r.Status}", double.NaN);
        var next = Header(r.Headers, "SID");
        return new Subscription(next.Length > 0 ? next : sid, Hub.Now() + Gena.Seconds(Header(r.Headers, "TIMEOUT")) * 1000);
    }

    /* Best effort: a device that has gone can't be told. */
    public static async Task Unsubscribe(string eventUrl, string sid)
    {
        try { await SoapHttp.Request(eventUrl, "UNSUBSCRIBE", [("SID", sid)], 3000); }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException or UriFormatException) { /* gone */ }
    }
}
