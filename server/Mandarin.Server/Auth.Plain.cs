// Auth.Plain.cs — a request over plain http from outside the home network, said (item 367, the security audit's twelfth
// finding). Mandarin speaks plain http (a server at home has no certificate), which is safe at home and on the tailnet,
// whose own link is encrypted. A port forwarded to the internet is neither: whatever a request carries, its sign-in
// included, crosses the internet as it is. The log says so, once a day for each address, with what to do instead.
using System.Collections.Concurrent;

namespace Mandarin.Server;

internal static partial class Auth
{
    private static readonly ConcurrentDictionary<string, long> saidPlain = new();

    /* Whether [ctx] came over plain http from outside the home network and the tailnet (an unknown caller left out: a
       proxy's, which may well have been https). */
    public static bool PlainFromOutside(HttpContext ctx)
    {
        if (ctx.Request.IsHttps || ctx.Request.Headers["X-Forwarded-Proto"].ToString().Equals("https", StringComparison.OrdinalIgnoreCase)) return false;
        var ip = ClientIp(ctx);
        return ip.Length > 0 && ip != Caller.Unknown && !HomeOrTailnet(ip);
    }

    /* The log told of a plain-http request from outside, once a day for each address. */
    public static void SayPlain(HttpContext ctx)
    {
        if (!PlainFromOutside(ctx)) return;
        var ip = ClientIp(ctx);
        var now = Environment.TickCount64;
        if (saidPlain.TryGetValue(ip, out var at) && now - at < 24 * 3600 * 1000L) return;
        saidPlain[ip] = now;
        if (saidPlain.Count > 1000) saidPlain.Clear();
        Server.Log($"[auth] {ip} asked over plain http from outside your home network: what it sends, its sign-in included, crosses the internet unencrypted. Reach Mandarin away from home through Tailscale (Settings → Setup → Away from home), not a port forward");
    }
}
