// Tailscale.Own.cs — the owner's own tailnet, as the built-in engine knows it (item 370, the security audit's eleventh
// finding). Tailscale's range, 100.64.0.0/10, is carrier-grade NAT too, which some mobile and fibre ISPs give their
// customers, and it holds nodes shared in from other people's tailnets: with the sign-in off, all of them counted as
// home. The engine says which addresses are the nodes signed in as the server's own user (/status own_ips); while it
// runs and says so, only those are the tailnet. Without it (no engine, an engine from before, Tailscale on the host
// instead), the range, as before.


namespace Mandarin.Server.Admin;

internal sealed partial class Tailscale
{
    /* The addresses of the owner's own nodes, while the engine runs and says them; null where it doesn't. */
    public HashSet<string>? OwnIps()
    {
        lock (gate)
        {
            if (proc == null || last == null || !Mandarin.Server.Tags.Js.StrictEq(last["state"], "Running") || last["own_ips"] is not List<object?> own) return null;
            return own.OfType<string>().Select(a => a.ToLowerInvariant()).ToHashSet(StringComparer.Ordinal);
        }
    }
}
