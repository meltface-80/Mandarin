// Ssdp.cs — one M-SEARCH, every answer (lib/renderers/ssdp.js, v0.8.49,
// stage 6 part 3). The Sonos search (Playback/SonosTopology.cs) keeps only
// Sonos answers; this one keeps them all — a media renderer can be anything,
// a WiiM, a Chord Poly, an AVR, a TV — and each is told apart from its
// description afterwards. Sonos players answer this search too; they are
// recognised by their RINCON_ ids and left to the Sonos code.
using System.Net;
using System.Net.Sockets;
using System.Text;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal sealed record SsdpAnswer(string Location, string Usn, string St, string Server, string Address, bool Quiet = false);

internal static class Ssdp
{
    private const string SsdpAddr = "239.255.255.250";
    private const int SsdpPort = 1900;
    public const string MediaRenderer = "urn:schemas-upnp-org:device:MediaRenderer:1";

    /* Every device that answers, from every LAN address the machine has (or the pinned one), one per USN. */
    public static async Task<List<SsdpAnswer>> Search(string? bindIp, int mx = 2, int attempts = 3)
    {
        var froms = Topology.SearchAddresses(bindIp is { Length: > 0 } ? bindIp : null, Undef.V).Select(a => a is string s ? s : null).ToList();
        var lists = await Task.WhenAll(froms.Select(a => SearchFrom(a, mx, attempts)));
        var out_ = new List<SsdpAnswer>();
        foreach (var a in lists.SelectMany(l => l))
        {
            var key = a.Usn.Length > 0 ? a.Usn : a.Location;
            if (!out_.Any(x => (x.Usn.Length > 0 ? x.Usn : x.Location) == key)) out_.Add(a);
        }
        return out_;
    }

    private static async Task<List<SsdpAnswer>> SearchFrom(string? bindAddr, int mx, int attempts)
    {
        var found = new List<SsdpAnswer>();
        var msg = Encoding.ASCII.GetBytes("M-SEARCH * HTTP/1.1\r\n" + $"HOST: {SsdpAddr}:{SsdpPort}\r\n" + "MAN: \"ssdp:discover\"\r\n" + $"MX: {mx}\r\n" + $"ST: {MediaRenderer}\r\n\r\n");
        UdpClient sock;
        try
        {
            sock = new UdpClient(AddressFamily.InterNetwork);
            sock.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            sock.Client.Bind(new IPEndPoint(bindAddr != null ? IPAddress.Parse(bindAddr) : IPAddress.Any, 0));
            try
            {
                sock.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 4);
                if (bindAddr != null) sock.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastInterface, IPAddress.Parse(bindAddr).GetAddressBytes());
            }
            catch (SocketException) { /* best effort */ }
        }
        catch (Exception e) when (e is SocketException or FormatException) { return found; }
        using (sock)
        {
            var until = DateTime.UtcNow.AddMilliseconds((mx + 1) * 1000);
            var dest = new IPEndPoint(IPAddress.Parse(SsdpAddr), SsdpPort);
            var sending = Task.Run(async () =>
            {
                for (var n = 0; n < attempts; n++)
                {
                    try { await sock.SendAsync(msg, msg.Length, dest); } catch (SocketException) { /* the next one, or none */ }
                    if (n + 1 < attempts) await Task.Delay(250);
                }
            });
            while (DateTime.UtcNow < until)
            {
                using var cts = new CancellationTokenSource(until - DateTime.UtcNow);
                UdpReceiveResult r;
                try { r = await sock.ReceiveAsync(cts.Token); }
                catch (OperationCanceledException) { break; }
                catch (SocketException) { break; }
                var h = Topology.ParseHeaders(r.Buffer);
                static string S(object? v) => Jv.T(v) ? Jv.Str(v) : "";
                if (!System.Text.RegularExpressions.Regex.IsMatch(S(h[""]), "^HTTP/1\\.1 200", System.Text.RegularExpressions.RegexOptions.IgnoreCase) || S(h["location"]).Length == 0) continue;
                var key = S(h["usn"]).Length > 0 ? S(h["usn"]) : S(h["location"]);
                if (found.Any(x => (x.Usn.Length > 0 ? x.Usn : x.Location) == key)) continue;
                found.Add(new SsdpAnswer(S(h["location"]), S(h["usn"]), S(h["st"]), S(h["server"]), r.RemoteEndPoint.Address.ToString()));
            }
            try { await sending; } catch (Exception e) when (e is SocketException or ObjectDisposedException) { /* closed */ }
        }
        return found;
    }

    public static bool IsSonos(SsdpAnswer a) =>
        a.Usn.Contains("RINCON_", StringComparison.OrdinalIgnoreCase) || a.Server.Contains("sonos", StringComparison.OrdinalIgnoreCase);
}
