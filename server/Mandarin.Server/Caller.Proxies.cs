// Caller.Proxies.cs — the proxies whose word on who asked is believed (item 362, the security audit's fourth finding).
//
// The built-in Tailscale engine (Admin/Tailscale.cs) forwards the tailnet's requests to a port of its own on this
// machine, opened for it alone (EnginePort), naming each caller's tailnet address in X-Forwarded-For; the proxies the
// owner names in TRUSTED_PROXIES (addresses or ranges: 127.0.0.1 for an nginx or a `tailscale serve` here, a proxy
// elsewhere on the network) are believed as well. A request from this machine naming a caller through anything else
// (a raw forward, a tunnel, a proxy passing the client's own header on) is unknown, never home, and the log says once
// how to trust a proxy of the owner's.
using System.Net;

namespace Mandarin.Server;

internal static partial class Caller
{
    private static List<IPNetwork> trusted = [];
    private static int warned;

    /* The log's word on a proxy not trusted taken as said already: a command that answers in JSON on its output (RulesCommand). */
    public static void Hush() => warned = 1;

    /* The port on 127.0.0.1 the built-in Tailscale engine forwards to: only it is sent there (0 until opened). */
    public static int EnginePort { get; set; }

    /* The proxies named in the configuration's trusted_proxies (TRUSTED_PROXIES): addresses and ranges; what isn't one is said and left out. */
    public static void Trust(System.Text.Json.Nodes.JsonNode? proxies)
    {
        var list = new List<IPNetwork>();
        foreach (var p in (proxies as System.Text.Json.Nodes.JsonArray ?? []).Select(x => x?.GetValue<string>()?.Trim()).OfType<string>().Where(x => x.Length > 0))
        {
            if (IPNetwork.TryParse(p.Contains('/') ? p : p + (p.Contains(':') ? "/128" : "/32"), out var n)) list.Add(n);
            else Server.Log($"[auth] TRUSTED_PROXIES: {p} is not an address or a range; left out");
        }
        trusted = list;
    }

    /* Whether [ctx] came through a proxy whose word on who asked is believed: the engine's own port, or a proxy named. */
    public static bool Trusted(HttpContext ctx)
    {
        var a = ctx.Connection.RemoteIpAddress;
        if (a == null) return false;
        if (a.IsIPv4MappedToIPv6) a = a.MapToIPv4();
        if (EnginePort > 0 && ctx.Connection.LocalPort == EnginePort && IPAddress.IsLoopback(a)) return true;
        foreach (var n in trusted) if (n.Contains(a)) return true;
        return false;
    }

    /* Whether [h] names a caller, or says it came through a proxy, as a proxy's headers do. */
    private static bool NamesCaller(IHeaderDictionary h) =>
        h.ContainsKey("X-Forwarded-For") || h.ContainsKey("X-Real-IP") || h.ContainsKey("Forwarded") || h.ContainsKey("X-Forwarded-Host");

    // A request from this machine ([from]) naming a caller through no trusted proxy: unknown, said once.
    private static string Untrusted(string from)
    {
        if (Interlocked.Exchange(ref warned, 1) == 0)
            Server.Log($"[auth] a request from {from} named who asked through a proxy that isn't trusted: taken as the internet, never home. A proxy of yours on this machine: TRUSTED_PROXIES=127.0.0.1");
        return Unknown;
    }
}
