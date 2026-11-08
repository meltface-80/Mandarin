// Guard.cs — the Bridge's port has no sign-in (a Raspberry Pi just flashed has no Mandarin to sign in to), so what may
// change it is kept to what Mandarin and the Bridge's own page send (item 352). A web page open in a browser on the home
// network could send a plain form's POST to it without the browser asking first: the Bridge took any body as JSON, so
// such a page could rename it, change its DAC, move a Pi to another Wi-Fi network or have it install an older release.
// Now a POST is taken only as application/json (which a page on another site can't send without the browser asking
// first, and the Bridge never says yes), and only from its own page where the browser names where it comes from
// (Origin). Mandarin's server and the Bridge's page send both already. An update is never to an older release (Update.cs).
namespace Mandarin.Bridge;

internal static class Guard
{
    /* Why request [r] may not change anything; null where it may (anything but a POST may: GETs change nothing). */
    public static string? Refused(Http.Request r)
    {
        if (r.Method != "POST") return null;
        var type = (r.Header("content-type") ?? "").Split(';')[0].Trim();
        if (!type.Equals("application/json", StringComparison.OrdinalIgnoreCase) && !type.EndsWith("+json", StringComparison.OrdinalIgnoreCase))
            return "only JSON (application/json) is taken";
        var origin = r.Header("origin");
        if (string.IsNullOrEmpty(origin)) return null;   // not a browser's page: Mandarin's server, curl
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var o)) return "from another site";
        var host = r.Header("host") ?? "";
        var own = o.IsDefaultPort ? o.Host : o.Host + ":" + o.Port;
        return own.Equals(host, StringComparison.OrdinalIgnoreCase) || o.Host.Equals(host, StringComparison.OrdinalIgnoreCase) && o.IsDefaultPort ? null : "from another site";
    }

    /* Whether release [tag] ("mandarin-bridge-v0.3.2") is older than [running] ("0.3.2"); test-bridge, and a version not read, never are. */
    public static bool Older(string tag, string running)
    {
        const string prefix = "mandarin-bridge-v";
        if (!tag.StartsWith(prefix, StringComparison.Ordinal)) return false;
        static Version? Read(string v) => Version.TryParse(v.Split('-', '+')[0], out var x) ? x : null;
        return Read(tag[prefix.Length..]) is { } t && Read(running) is { } r && t < r;
    }
}
