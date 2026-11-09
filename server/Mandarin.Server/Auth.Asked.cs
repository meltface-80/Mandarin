// Auth.Asked.cs — what the sign-in off lets in by its address alone, only
// when asked for as the owner's own browsers and apps ask (bug list item 172).
//
// With the sign-in off (Auth.Open.cs), a request from the home network or the
// tailnet needs no device. Any web page open in a browser at home sends its
// requests from such an address too, so two more things are asked of one let
// in that way:
//
//   - the server asked for by a name used at home: an address, a bare name
//     (localhost, the machine's own), or one under .local, .lan, .home,
//     .home.arpa, .internal, .localdomain, .localhost or Tailscale's .ts.net.
//     A page on another site that points its own name at the server (DNS
//     rebinding) asks for that name, and is turned away;
//   - anything but GET and HEAD sent by the server's own page or an app:
//     Sec-Fetch-Site same-origin or none, or, where a browser doesn't send it
//     (plain http to an address, the Android app, curl), no Origin or the
//     server's own. A page on another site posting to it (a form, a text/plain
//     fetch, which no browser asks about first) is turned away.
//
// A signed-in device needs neither: its cookie is SameSite=Lax and the
// server's own, so another site's page never carries it.
using System.Net;

namespace Mandarin.Server;

internal static partial class Auth
{
    /* Set on a request (ctx.Items) the sign-in off would let in by its address but doesn't: why, for the gate's 403. */
    private const string OpenRefused = "mandarin.open-refused";

    private static readonly string[] HomeSuffixes = [".local", ".lan", ".home", ".home.arpa", ".internal", ".localdomain", ".localhost", ".ts.net"];

    /* Why a request with no device isn't let in as home's, or null when it is asked for as the owner's own page or app would. */
    public static string? NotAsHome(HttpContext ctx)
    {
        var names = AskedFor(ctx);
        if (!names.All(HomeName)) return "Open Mandarin by its address, or by its name on your network";
        return FromOwnPage(ctx, names) ? null : FromElsewhere;
    }

    /* Whether a request is a read, or sent by the server's own page or an app: Sec-Fetch-Site same-origin or none, or, where
       a browser doesn't send it (plain http to an address, the Android app, curl), no Origin or the server's own. */
    private static bool FromOwnPage(HttpContext ctx, List<string> names)
    {
        var m = ctx.Request.Method;
        if (HttpMethods.IsGet(m) || HttpMethods.IsHead(m) || HttpMethods.IsOptions(m)) return true;
        var site = ctx.Request.Headers["Sec-Fetch-Site"].ToString();
        if (site.Length > 0) return site is "same-origin" or "none";
        var origin = ctx.Request.Headers.Origin.ToString();
        return origin.Length == 0 || names.Any(n => SameOrigin(origin, n));
    }

    /*
     * Why a signed-in browser's request is turned away, or null (item 363, the security audit's fifth finding): its cookie
     * is SameSite=Lax, which another site never carries, but a page on another port of the same host is the same site,
     * and a form there could post with it (a body-less POST, such as Rescan, needs no JSON). A change sent with the cookie
     * must come from the server's own page, as one let in by the sign-in off must; an app's Bearer token is never a
     * browser's, and is let be.
     */
    public static string? CookieFromElsewhere(HttpContext ctx) =>
        TokenFromCookie(ctx) && !FromOwnPage(ctx, AskedFor(ctx)) ? FromElsewhere : null;

    private const string FromElsewhere = "Mandarin's own page or app only: this came from another site";

    // The names the server was asked for by: the Host header, and a proxy's
    // X-Forwarded-Host when the proxy is on this machine (the built-in
    // Tailscale, nginx), as it is the one the browser used.
    private static List<string> AskedFor(HttpContext ctx)
    {
        var names = new List<string> { ctx.Request.Headers.Host.ToString() };
        var remote = ctx.Connection.RemoteIpAddress;
        if (remote != null && IPAddress.IsLoopback(remote.IsIPv4MappedToIPv6 ? remote.MapToIPv4() : remote))
            names.AddRange(ctx.Request.Headers["X-Forwarded-Host"].ToString().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries));
        return names;
    }

    /* A Host header naming the server as a home does: an address, a bare name, or a name under a home's own suffixes. */
    public static bool HomeName(string host)
    {
        var h = (host ?? "").Trim();
        if (h.Length == 0) return true;                          // no Host at all: HTTP/1.0, never a browser
        if (h.StartsWith('[')) return h.IndexOf(']') > 1;        // an IPv6 address, [fd7a:…]:3500
        int colon = h.LastIndexOf(':');
        if (colon >= 0) h = h[..colon];
        h = h.TrimEnd('.').ToLowerInvariant();
        if (h.Length == 0) return false;
        if (h.All(ch => char.IsAsciiDigit(ch) || ch == '.')) return IPAddress.TryParse(h, out _);
        if (!h.Contains('.')) return true;
        return HomeSuffixes.Any(s => h.EndsWith(s, StringComparison.Ordinal));
    }

    // An Origin (scheme://host[:port]) naming the same server as a Host header does, its port written or not.
    private static bool SameOrigin(string origin, string host)
    {
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var u) || u.Scheme is not ("http" or "https")) return false;
        var h = host.Trim().TrimEnd('.');
        return string.Equals(u.Authority, h, StringComparison.OrdinalIgnoreCase)
            || string.Equals($"{u.Host}:{u.Port}", h, StringComparison.OrdinalIgnoreCase);
    }


    private static bool Bearer(string h) => h.StartsWith("Bearer", StringComparison.OrdinalIgnoreCase) && h.Length > 6 && char.IsWhiteSpace(h[6]);

    /* Whether the request's device is named by the browser's cookie, not an app's Bearer token. */
    private static bool TokenFromCookie(HttpContext ctx) => !Bearer(ctx.Request.Headers.Authorization.ToString());
}
