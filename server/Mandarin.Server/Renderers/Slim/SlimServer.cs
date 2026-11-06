// SlimServer.cs — Mandarin as a SlimProto server (bug list item 312): where a Squeezelite player, a Squeezebox or a
// Mandarin Bridge finds Mandarin and is played. A player asks who serves SlimProto by a UDP broadcast to port 3483
// ('e') and is answered (SlimFrames.Discovered); it then connects to TCP 3483, says hello (HELO) and keeps saying how
// it is doing (STAT). Each player connected is a SlimPlayer, kept here by its id; the server's word every second or
// so (strm 't') keeps it connected, as a player that hears nothing for half a minute goes looking again.
using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace Mandarin.Server.Renderers.Slim;

internal sealed class SlimServer : IDisposable
{
    /* SLIMPROTO_PORT: the port played on (3483, SlimProto's; 0, none: SlimProto off). */
    public static int PortFromEnvironment => int.TryParse(Environment.GetEnvironmentVariable("SLIMPROTO_PORT"), out var p) && p >= 0 ? p : SlimFrames.Port;

    private readonly TcpListener tcp;
    private readonly UdpClient? udp;
    private readonly CancellationTokenSource stop = new();
    private readonly ConcurrentDictionary<string, SlimPlayer> players = new();
    private readonly Action<string> log;
    private readonly Action<SlimPlayer> seen;

    /* The port it listens on (the one asked for, or the one given where 0 was a test's "any"). */
    public int Port { get; }

    private SlimServer(TcpListener tcp, UdpClient? udp, Action<string> log, Action<SlimPlayer> seen)
    {
        this.tcp = tcp; this.udp = udp; this.log = log; this.seen = seen;
        Port = ((IPEndPoint)tcp.LocalEndpoint).Port;
    }

    /* Listening at [port] (TCP, and UDP for discovery, answered as [name] with Mandarin at [httpPort]); null where the
       port can't be had. [seen] is told of each player as it says hello and as it says how it is. */
    public static SlimServer? Start(int port, string name, int httpPort, Action<string> log, Action<SlimPlayer> seen)
    {
        TcpListener? tcp = null;
        try
        {
            tcp = new TcpListener(IPAddress.Any, port);
            tcp.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            tcp.Start();
        }
        catch (SocketException e) { log($"[slimproto] port {port} can't be had ({e.Message}): Squeezelite players and Mandarin Bridges can't find Mandarin"); tcp?.Stop(); return null; }
        UdpClient? udp = null;
        try
        {
            udp = new UdpClient(AddressFamily.InterNetwork);
            udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            udp.Client.Bind(new IPEndPoint(IPAddress.Any, ((IPEndPoint)tcp.LocalEndpoint).Port));
        }
        catch (SocketException e) { log($"[slimproto] discovery on UDP {port} can't be had ({e.Message}): a player must be given Mandarin's address"); udp?.Dispose(); udp = null; }
        var s = new SlimServer(tcp, udp, log, seen);
        _ = s.Accept();
        if (udp != null) _ = s.Answer(name, httpPort);
        log($"[slimproto] Squeezelite players and Mandarin Bridges play from port {s.Port}");
        return s;
    }

    /* The player of [id] connected now, or null. */
    public SlimPlayer? Get(string id) => players.TryGetValue(id, out var p) && p.Connected ? p : null;

    /* Every player connected now. */
    public IReadOnlyList<SlimPlayer> All => [.. players.Values.Where(p => p.Connected)];

    private async Task Answer(string name, int httpPort)
    {
        var reply = SlimFrames.Discovered(("NAME", name), ("JSON", httpPort.ToString(System.Globalization.CultureInfo.InvariantCulture)), ("VERS", Server.Version), ("UUID", "mandarin"));
        while (!stop.IsCancellationRequested)
        {
            UdpReceiveResult r;
            try { r = await udp!.ReceiveAsync(stop.Token); }
            catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException) { return; }
            catch (SocketException) { continue; }
            if (r.Buffer.Length == 0 || r.Buffer[0] != (byte)'e') continue;   // a player asking; our own answer is 'E'
            try { await udp!.SendAsync(reply, r.RemoteEndPoint, stop.Token); }
            catch (Exception e) when (e is SocketException or OperationCanceledException or ObjectDisposedException) { /* that player asks again */ }
        }
    }

    private async Task Accept()
    {
        while (!stop.IsCancellationRequested)
        {
            TcpClient c;
            try { c = await tcp.AcceptTcpClientAsync(stop.Token); }
            catch (Exception e) when (e is OperationCanceledException or ObjectDisposedException) { return; }
            catch (SocketException) { continue; }
            c.NoDelay = true;
            _ = Serve(c);
        }
    }

    /* One player's connection, frame by frame (four letters, a 4-byte length, the rest), until it goes. */
    private async Task Serve(TcpClient c)
    {
        SlimPlayer? player = null;
        var socket = c.Client;   // kept: the connection gone, this is how its player knows it was this one
        using (c)
        {
            var net = c.GetStream();
            var head = new byte[8];
            try
            {
                while (!stop.IsCancellationRequested)
                {
                    await net.ReadExactlyAsync(head, stop.Token);
                    var op = Encoding.ASCII.GetString(head, 0, 4);
                    var length = (int)BinaryPrimitives.ReadUInt32BigEndian(head.AsSpan(4));
                    if (length is < 0 or > 1 << 20) break;
                    var body = new byte[length];
                    await net.ReadExactlyAsync(body, stop.Token);
                    if (op == "HELO")
                    {
                        if (SlimFrames.ReadHelo(body) is not { } helo) break;
                        var ip = ((IPEndPoint)c.Client.RemoteEndPoint!).Address.MapToIPv4().ToString();
                        player = players.AddOrUpdate(SlimPlayer.IdOf(helo.Mac), id => new SlimPlayer(id, helo, ip, net, log), (_, was) => was.Reconnected(helo, ip, net));
                        player.Hello();
                        seen(player);
                    }
                    else if (player == null) break;   // a player says hello first
                    else if (op == "STAT" && SlimFrames.ReadStat(body) is { } stat) player.Heard(stat);   // its state is asked of it each second (Players.Poll)
                    else if (op == "SETD" && body.Length > 1 && body[0] == 0) { player.Named(Encoding.UTF8.GetString(body, 1, body.Length - 1).TrimEnd('\0')); seen(player); }
                    else if (op == "DSCO") player.Disconnected(body.Length > 0 ? body[0] : (byte)0);
                    else if (op == "BYE!") break;
                }
            }
            catch (Exception e) when (e is IOException or OperationCanceledException or ObjectDisposedException or EndOfStreamException or SocketException) { /* gone */ }
        }
        if (player != null && player.Gone(socket)) { log($"[slimproto] {player.Name} has gone"); seen(player); }
    }

    public void Dispose()
    {
        stop.Cancel();
        try { tcp.Stop(); } catch (SocketException) { /* stopped */ }
        udp?.Dispose();
        foreach (var p in players.Values) p.Halt();
    }
}
