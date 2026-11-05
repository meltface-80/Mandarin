// Ssdp.cs — how a UPnP device is found (the Android app's Ssdp.kt): it listens on the multicast group for M-SEARCH
// and answers each that asks for it (a root device, a MediaRenderer, one of its services, its uuid, or everything);
// it announces itself (NOTIFY ssdp:alive) on start, every ten minutes, and whenever its description changes (a DAC
// plugged in or taken out), so Mandarin reads it afresh; and says goodbye when it stops. [location] is read each
// time: it carries the description's address, which changes with the DAC.
using System.Globalization;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Mandarin.Bridge;

internal sealed class Ssdp(string udn, Func<string?> location, Action<string> log)
{
    private static readonly IPAddress Group = IPAddress.Parse("239.255.255.250");
    private const int Port = 1900, MaxAge = 1800;
    private UdpClient? socket;
    private volatile bool running;
    private static string Server => "Linux UPnP/1.0 MandarinBridge/" + Program.Version;

    private (string Target, string Usn)[] Targets() =>
    [
        ("upnp:rootdevice", udn + "::upnp:rootdevice"), (udn, udn), (Scpd.Device, udn + "::" + Scpd.Device),
        (Scpd.Avt, udn + "::" + Scpd.Avt), (Scpd.Rcs, udn + "::" + Scpd.Rcs), (Scpd.Cms, udn + "::" + Scpd.Cms),
    ];

    public void Start()
    {
        try
        {
            var s = new UdpClient(AddressFamily.InterNetwork);
            s.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            s.Client.Bind(new IPEndPoint(IPAddress.Any, Port));
            s.JoinMulticastGroup(Group);
            s.Client.SetSocketOption(SocketOptionLevel.IP, SocketOptionName.MulticastTimeToLive, 4);
            socket = s;
        }
        catch (SocketException e) { log("[ssdp] can't listen on 1900 (" + e.Message + "): found only where Mandarin is told the address"); return; }
        running = true;
        new Thread(Listen) { IsBackground = true, Name = "ssdp" }.Start();
        Alive();
    }

    public void Stop()
    {
        if (!running) return;
        running = false;
        try { Notify("ssdp:byebye"); } catch (SocketException) { /* gone */ }
        socket?.Dispose();
    }

    private void Listen()
    {
        while (running)
        {
            UdpReceiveResult p;
            try { p = socket!.ReceiveAsync().GetAwaiter().GetResult(); }
            catch (Exception e) when (e is SocketException or ObjectDisposedException) { if (running) log("[ssdp] " + e.Message); break; }
            var text = Encoding.Latin1.GetString(p.Buffer);
            if (!text.StartsWith("M-SEARCH", StringComparison.OrdinalIgnoreCase)) continue;
            var h = Headers(text);
            if (!(h.GetValueOrDefault("man") ?? "").Contains("ssdp:discover", StringComparison.Ordinal) || h.GetValueOrDefault("st") is not { } st) continue;
            if (location() is not { } loc) continue;
            var wanted = st.Equals("ssdp:all", StringComparison.OrdinalIgnoreCase) ? Targets() : Targets().Where(t => t.Target.Equals(st, StringComparison.OrdinalIgnoreCase)).ToArray();
            foreach (var (t, usn) in wanted)
                Send($"HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age={MaxAge}\r\nDATE: {DateTime.UtcNow.ToString("r", CultureInfo.InvariantCulture)}\r\nEXT:\r\nLOCATION: {loc}\r\nSERVER: {Server}\r\nST: {t}\r\nUSN: {usn}\r\nBOOTID.UPNP.ORG: 1\r\nCONFIGID.UPNP.ORG: 1\r\n\r\n", p.RemoteEndPoint);
        }
    }

    /* "Here I am", to the group, for every target. */
    public void Alive() { if (running) Notify("ssdp:alive"); }

    private void Notify(string nts)
    {
        if (location() is not { } loc) return;
        foreach (var (t, usn) in Targets())
            Send($"NOTIFY * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nCACHE-CONTROL: max-age={MaxAge}\r\nLOCATION: {loc}\r\nNT: {t}\r\nNTS: {nts}\r\nSERVER: {Server}\r\nUSN: {usn}\r\nBOOTID.UPNP.ORG: 1\r\nCONFIGID.UPNP.ORG: 1\r\n\r\n", new IPEndPoint(Group, Port));
    }

    private void Send(string msg, IPEndPoint to)
    {
        try { var b = Encoding.Latin1.GetBytes(msg); socket?.Send(b, b.Length, to); }
        catch (Exception e) when (e is SocketException or ObjectDisposedException) { log("[ssdp] send to " + to + ": " + e.Message); }
    }

    private static Dictionary<string, string> Headers(string text)
    {
        var m = new Dictionary<string, string>();
        foreach (var l in text.Split("\r\n").Skip(1)) { var i = l.IndexOf(':'); if (i > 0) m[l[..i].Trim().ToLowerInvariant()] = l[(i + 1)..].Trim(); }
        return m;
    }
}
