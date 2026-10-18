// SsdpListen.cs — what renderers say of themselves (v1.0.7). A renderer
// switched on, or joining the network, says so at once (NOTIFY ssdp:alive to
// 239.255.255.250:1900); before, nothing listened, and it was found by the
// next search, up to a minute later. Heard here, a MediaRenderer's word from a
// place [wanted] has no player on the network for is handed on (Devices.cs:
// its place read in a round soon, one for a burst). Sonos players are left to the Sonos code, as
// the search leaves them. Another program on this computer listening too
// (a DLNA server, say) is no matter: each hears every announcement.
using System.Net;
using System.Net.Sockets;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Renderers;

internal sealed class SsdpListen : IDisposable
{
    private const string SsdpAddr = "239.255.255.250";
    private const int SsdpPort = 1900;
    private readonly UdpClient sock;
    private readonly CancellationTokenSource stop = new();

    private SsdpListen(UdpClient sock) => this.sock = sock;

    /* Listening (null where the port can't be had: the searches find what they find, as before). */
    public static SsdpListen? Start(string? bindIp, Func<string, bool> wanted, Action<string> heard, Action<string> log)
    {
        UdpClient? sock = null;
        try
        {
            sock = new UdpClient(AddressFamily.InterNetwork);
            sock.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            sock.Client.Bind(new IPEndPoint(IPAddress.Any, SsdpPort));
            var group = IPAddress.Parse(SsdpAddr);
            var joined = 0;
            foreach (var a in Topology.SearchAddresses(bindIp is { Length: > 0 } ? bindIp : null, Undef.V))
            {
                try
                {
                    if (a is string s) sock.JoinMulticastGroup(group, IPAddress.Parse(s)); else sock.JoinMulticastGroup(group);
                    joined++;
                }
                catch (Exception e) when (e is SocketException or FormatException) { /* that address: the next */ }
            }
            // No group joined (no multicast here): what's sent to this computer itself is still heard.
            if (joined == 0) log("[renderers] announcements: no network to hear them on");
        }
        catch (SocketException e) { sock?.Dispose(); log($"[renderers] not listening for announcements: {e.Message}"); return null; }
        var l = new SsdpListen(sock);
        _ = Task.Run(() => l.Hear(wanted, heard));
        return l;
    }

    private async Task Hear(Func<string, bool> wanted, Action<string> heard)
    {
        while (!stop.IsCancellationRequested)
        {
            UdpReceiveResult r;
            try { r = await sock.ReceiveAsync(stop.Token); }
            catch (OperationCanceledException) { return; }
            catch (ObjectDisposedException) { return; }
            catch (SocketException) { continue; }
            var loc = Alive(Topology.ParseHeaders(r.Buffer));
            try { if (loc != null && wanted(loc)) heard(loc); }
            catch (Exception e) when (e is Microsoft.Data.Sqlite.SqliteException or IOException) { /* the next round finds it */ }
        }
    }

    /* A renderer's "here I am": its description's place; null for anything else (a search, a goodbye, another kind of device, a Sonos player). */
    public static string? Alive(JsObj h)
    {
        static string S(object? v) => Jv.T(v) ? Jv.Str(v) : "";
        if (!S(h[""]).StartsWith("NOTIFY ", StringComparison.OrdinalIgnoreCase)) return null;
        if (!S(h["nts"]).Equals("ssdp:alive", StringComparison.OrdinalIgnoreCase)) return null;
        if (!S(h["nt"]).Equals(Ssdp.MediaRenderer, StringComparison.OrdinalIgnoreCase)) return null;
        var loc = S(h["location"]);
        if (loc.Length == 0 || Ssdp.IsSonos(new SsdpAnswer(loc, S(h["usn"]), S(h["nt"]), S(h["server"]), ""))) return null;
        return loc;
    }

    public void Dispose()
    {
        stop.Cancel();
        sock.Dispose();
        stop.Dispose();
    }
}
