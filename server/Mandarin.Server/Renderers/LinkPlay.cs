// LinkPlay.cs — the HTTP API WiiM (and every other LinkPlay-based player)
// answers beside UPnP (lib/renderers/linkplay.js, v0.8.49, stage 6 part 3):
// https://<ip>/httpapi.asp?command=… UPnP says what a WiiM accepts; this says
// what it IS (the name in the WiiM app, its firmware) and what it is actually
// playing, sample rate and bit depth included. The device signs its own
// certificate, so that one LAN call takes it, from a private network's
// address only (v0.9.0, Addresses.cs); older firmware answers on plain HTTP
// instead, so both are tried.
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal static class LinkPlay
{
    private static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        UseProxy = false, AllowAutoRedirect = false,
        SslOptions = { RemoteCertificateValidationCallback = (sender, _, _, errors) => Addresses.LinkPlayCert(sender, errors) }
    }) { Timeout = Timeout.InfiniteTimeSpan };

    /* One command against one base URL: the JSON as an object, or null when it isn't LinkPlay. */
    public static async Task<JsObj?> Command(string baseUrl, string cmd, int timeoutMs = 3000)
    {
        using var cts = new CancellationTokenSource(timeoutMs);
        using var res = await Http.GetAsync($"{baseUrl}/httpapi.asp?command={Uri.EscapeDataString(cmd)}", cts.Token);
        if ((int)res.StatusCode != 200) return null;
        var text = await res.Content.ReadAsStringAsync(cts.Token);
        try { return Scan.JsJson.Parse(text) as JsObj; }
        catch (JsError) { return null; }
    }

    public sealed record Probed(string Base, string DeviceName, string Project, string Firmware, string Hardware, string Uuid, string Mac);

    /* Is the device at this address LinkPlay, and what does it say about itself? `extraBases`: a description's own host:port tried too. */
    public static async Task<Probed?> Probe(string host, IEnumerable<string> extraBases, int timeoutMs = 3000)
    {
        foreach (var b in new[] { $"https://{host}", $"http://{host}" }.Concat(extraBases))
        {
            JsObj? j;
            try { j = await Command(b, "getStatusEx", timeoutMs); }
            catch (Exception e) when (e is HttpRequestException or OperationCanceledException or UriFormatException) { j = null; }
            if (j == null || !(Jv.T(j["uuid"]) || Jv.T(j["DeviceName"]) || Jv.T(j["project"]))) continue;
            static string S(object? v) => Jv.T(v) ? Jv.Str(v).Trim() : "";
            return new Probed(b, S(j["DeviceName"]), S(j["project"]), S(j["firmware"]), S(j["hardware"]), S(j["uuid"]), Jv.T(j["MAC"]) ? S(j["MAC"]) : S(j["STA_MAC"]));
        }
        return null;
    }
}
