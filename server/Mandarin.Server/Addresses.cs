// Addresses.cs — where the server may go on someone's word (v0.9.0, the
// audit's S5 and S6, docs/specs/audit-b4-main.md).
//
// A cover from an address typed into the album editor is never fetched from
// this machine or its link (loopback, link-local such as a cloud's
// 169.254.169.254, the unspecified 0.0.0.0 that reaches this machine): the
// address is checked on every redirect hop, by its name and by what DNS answers
// for it, and again where the connection is made, so a name that answers
// differently the second time gains nothing. Addresses on the LAN are fetched
// as before. And a LinkPlay player's self-signed certificate is taken only from
// a private network's address, where a WiiM is.
using System.Net;
using System.Net.Security;
using System.Net.Sockets;

namespace Mandarin.Server;

internal sealed class AddressRefused(string message) : Exception(message);

internal static class Addresses
{
    private static IPAddress Plain(IPAddress a) => a.IsIPv4MappedToIPv6 ? a.MapToIPv4() : a;

    /* This machine or its link: loopback, link-local, unspecified (0.0.0.0/8, ::). IPv4 inside IPv6 read as IPv4. */
    public static bool Inward(IPAddress a)
    {
        a = Plain(a);
        if (IPAddress.IsLoopback(a) || a.Equals(IPAddress.IPv6Any)) return true;
        if (a.AddressFamily == AddressFamily.InterNetworkV6) return a.IsIPv6LinkLocal;
        var b = a.GetAddressBytes();
        return b[0] == 0 || (b[0] == 169 && b[1] == 254);
    }

    /* A private network's: RFC 1918, link-local, IPv6 unique local (fc00::/7), and this machine's loopback. */
    public static bool Private(IPAddress a)
    {
        a = Plain(a);
        if (IPAddress.IsLoopback(a)) return true;
        if (a.AddressFamily == AddressFamily.InterNetworkV6) return a.IsIPv6LinkLocal || a.IsIPv6UniqueLocal;
        var b = a.GetAddressBytes();
        return b[0] == 10 || (b[0] == 172 && (b[1] & 0xF0) == 16) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
    }

    /* The host of an address as an IP, its IPv6 brackets off; null for a name. */
    public static IPAddress? Literal(string host) => IPAddress.TryParse(host.Trim('[', ']'), out var ip) ? ip : null;

    /* Refused for a cover: inward, or loopback when `loopbackTaken` (the tests, whose whole world is loopback). */
    private static bool RefusedForArt(IPAddress a, bool loopbackTaken) => Inward(a) && !(loopbackTaken && IPAddress.IsLoopback(Plain(a)));

    private static AddressRefused Refusal(string host) => new($"{host} is this server's own address or its link's");

    /* Throws AddressRefused when the address names this machine or its link, as an IP or by what DNS answers for its name. */
    public static async Task CheckArt(Uri u, bool loopbackTaken, CancellationToken ct)
    {
        var host = u.Host;
        if (Literal(host) is { } ip)
        {
            if (RefusedForArt(ip, loopbackTaken)) throw Refusal(host);
            return;
        }
        IPAddress[] found;
        // A name DNS can't answer for here is left to the fetch, which says so.
        try { found = await Dns.GetHostAddressesAsync(host, ct); }
        catch (SocketException) { return; }
        if (found.Any(a => RefusedForArt(a, loopbackTaken))) throw Refusal(host);
    }

    /*
     * The connection for a cover, made only to addresses CheckArt would take.
     * A connection to a proxy (its host not the request's) is made as it is:
     * the proxy reaches the address, which CheckArt has seen.
     */
    public static Func<SocketsHttpConnectionContext, CancellationToken, ValueTask<Stream>> ArtConnect(bool loopbackTaken) => async (c, ct) =>
    {
        var to = c.DnsEndPoint;
        var proxied = c.InitialRequestMessage.RequestUri is { } ru && !string.Equals(ru.IdnHost, to.Host.Trim('[', ']'), StringComparison.OrdinalIgnoreCase);
        IPAddress[] all = Literal(to.Host) is { } ip ? [ip] : await Dns.GetHostAddressesAsync(to.Host, ct);
        var taken = proxied ? all : all.Where(a => !RefusedForArt(a, loopbackTaken)).ToArray();
        if (taken.Length == 0) throw Refusal(to.Host);
        var s = new Socket(SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
        try
        {
            await s.ConnectAsync(taken, to.Port, ct);
            return new NetworkStream(s, ownsSocket: true);
        }
        catch
        {
            s.Dispose();
            throw;
        }
    };

    /*
     * A LinkPlay player's certificate: a sound one from anywhere; its own,
     * self-signed, only from a private network's address. The host is the
     * one the connection was asked for (SslStream's target, the request's
     * where a handler hands that instead).
     */
    public static bool LinkPlayCert(object sender, SslPolicyErrors errors) =>
        errors == SslPolicyErrors.None || PrivateHost(sender switch
        {
            SslStream s => s.TargetHostName,
            HttpRequestMessage { RequestUri: { } u } => u.Host,
            _ => ""
        });

    /* A private network's host: its IP, or every address DNS answers with for its name (SSDP gives IPs; a name is rare). */
    public static bool PrivateHost(string host)
    {
        if (host.Length == 0) return false;
        if (Literal(host) is { } ip) return Private(ip);
        try
        {
            var found = Dns.GetHostAddresses(host);
            return found.Length > 0 && found.All(Private);
        }
        catch (SocketException) { return false; }
    }
}
