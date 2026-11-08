// Covers.Reach.cs — where a picture from elsewhere may be fetched from (item 353, the security audit's second finding).
//
// A "u-" cover key carries any http or https address (CoversDrawn.cs), and the server fetched whatever it named:
// anyone who could ask for a cover (a signed-in device, or a speaker's own address) could have the server ask the home
// network's devices, the machine's own services or a cloud's metadata address (169.254.169.254) for what only it can
// reach. Now every connection the fetcher makes, each redirect's too, is to an address checked as it is made: the
// host's addresses looked up, those on this machine or the home network (loopback, private, link-local, carrier-grade
// NAT, multicast and the like, IPv4 and IPv6) refused, and the connection made to one that was checked, so a name that
// answers differently the second time (DNS rebinding) gets nowhere. Two exceptions, both the owner's own: the Sonos
// speakers' addresses (a track queued from the Sonos app has its cover on the speaker, http://<speaker>:1400/getaa…),
// and the hosts named in ART_HOSTS (art_hosts: a radio station's server on the home network, say).
using System.Net;
using System.Net.Sockets;

namespace Mandarin.Server;

internal static partial class Covers
{
    // The hosts named in art_hosts (ART_HOSTS), as written: names or addresses.
    private static HashSet<string> artHosts = new(StringComparer.OrdinalIgnoreCase);

    /* The hosts a picture may come from although they are on this network: the configuration's art_hosts. */
    public static void TrustHosts(System.Text.Json.Nodes.JsonNode? hosts) =>
        artHosts = new HashSet<string>((hosts as System.Text.Json.Nodes.JsonArray ?? []).Select(h => h?.GetValue<string>()).OfType<string>().Where(h => h.Length > 0), StringComparer.OrdinalIgnoreCase);

    /* The connection to [host] for a picture: to one of its addresses that may be reached, or why not (refused). */
    private static async ValueTask<Stream> Reach(SocketsHttpConnectionContext ctx, CancellationToken ct)
    {
        var host = ctx.DnsEndPoint.Host.Trim('[', ']');
        var all = IPAddress.TryParse(host, out var literal) ? [literal] : await Dns.GetHostAddressesAsync(host, ct);
        var ok = all.Where(a => May(host, a)).ToArray();
        if (ok.Length == 0) throw new HttpRequestException($"{host} is on this machine or its network: a picture isn't fetched from there");
        var s = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await s.ConnectAsync(ok, ctx.DnsEndPoint.Port, ct);
            return new NetworkStream(s, ownsSocket: true);
        }
        catch { s.Dispose(); throw; }
    }

    /* Whether address [a] of [host] may be fetched from: anywhere on the internet, the speakers, and the hosts named. */
    private static bool May(string host, IPAddress a)
    {
        if (artHosts.Contains(host) || artHosts.Contains(a.ToString())) return true;
        if (Playback.Hub.Current is { } hub && hub.SpeakerHosts.Contains(a.IsIPv4MappedToIPv6 ? a.MapToIPv4().ToString() : a.ToString())) return true;
        return !Internal(a);
    }

    /* Whether [a] is on this machine or a private network: anything but the open internet. */
    public static bool Internal(IPAddress a)
    {
        if (a.IsIPv4MappedToIPv6) a = a.MapToIPv4();
        if (a.AddressFamily == AddressFamily.InterNetwork)
        {
            var b = a.GetAddressBytes();
            return b[0] is 0 or 10 or 127 || b[0] >= 224                       // this network, private, loopback, multicast and reserved
                || b[0] == 100 && (b[1] & 0xC0) == 64                            // carrier-grade NAT, and Tailscale (100.64.0.0/10)
                || b[0] == 169 && b[1] == 254                                    // link-local, a cloud's metadata
                || b[0] == 172 && (b[1] & 0xF0) == 16                            // private
                || b[0] == 192 && (b[1] == 168 || b[1] == 0 && b[2] == 0)        // private, IETF's own
                || b[0] == 198 && (b[1] & 0xFE) == 18;                           // benchmarking
        }
        if (IPAddress.IsLoopback(a) || a.Equals(IPAddress.IPv6Any) || a.IsIPv6LinkLocal || a.IsIPv6SiteLocal || a.IsIPv6Multicast) return true;
        var v6 = a.GetAddressBytes();
        if ((v6[0] & 0xFE) == 0xFC) return true;                                 // unique local (fc00::/7)
        return v6.Take(12).All(x => x == 0);                                     // an IPv4 address written as IPv6 (::a.b.c.d)
    }
}
