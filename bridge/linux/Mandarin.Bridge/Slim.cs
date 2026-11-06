// Slim.cs — Mandarin Bridge for Linux as a SlimProto player (item 316; the Android app's Slim.kt, item 315): how
// Mandarin plays it, where before it was a UPnP renderer. SlimProto is Squeezebox's and Squeezelite's, open; Mandarin is
// its server (Renderers/Slim/ on the server). The Bridge finds Mandarin by a UDP broadcast to port 3483 ('e', answered
// 'E'), or is pointed at it (--server), connects to TCP 3483, says hello (HELO: its id, what it plays, its own web port
// so Mandarin reads /dac.json, updates it and reads its log, and its UDN, the UPnP device it was) and does what
// Mandarin's strm says through the audio engine (Player.cs): 's' a track (to wait for 'u', or to start; given while
// one plays, the next, gapless), 'q' stop, 'p' pause, 'u' go on, 't' how are you. It says what happens (STAT): STMs a
// track begun, STMd its last sample decoded (Mandarin then gives the next), STMl buffered, waiting for Play, STMp,
// STMr, STMu all played, STMn a track it couldn't play, STMt with how far in. Its volume is the DAC's: audg is let be.
//
// A frame from the server: 2 bytes of length, four letters, the rest; one to it: four letters, 4 bytes of length.
using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace Mandarin.Bridge;

internal sealed class Slim
{
    public const int Port = 3483;

    /* A track: its address, and what Mandarin said of it in its request's headers (its page shows them). */
    public sealed record Item(string Uri, string Title, string Artist, string Album);

    private readonly Player player;
    private readonly Func<string> capabilities, name;
    private readonly byte[] mac;
    private readonly IPEndPoint? pointed;
    private readonly Action<string> log;
    private readonly object gate = new(), sending = new();
    private volatile bool running;
    private volatile NetworkStream? net;
    private Socket? sock;

    /* The Mandarin it is played by, while connected, and when it last said anything (a 't' every second). */
    public IPAddress? Server { get; private set; }
    public DateTime LastHeard { get; private set; }

    // What it is told and has said (under gate).
    public Item? Current { get; private set; }
    public Item? Next { get; private set; }
    private bool flushed = true, waiting, paused, sentEnded;
    private string? startedUri, decodedUri, sentDecoded, erred;

    /* How many tracks the engine has gone on to by itself, gapless (its page's details). */
    public int Joined { get; private set; }

    /* Played by [player]; its hello's [capabilities], its [name] (setd), its id from [udn]; Mandarin at [server] ("ip[:port]"), else found. */
    public Slim(Player player, Func<string> capabilities, Func<string> name, string udn, string? server, Action<string> log)
    {
        (this.player, this.capabilities, this.name, this.log) = (player, capabilities, name, log);
        var h = SHA256.HashData(Encoding.UTF8.GetBytes(udn));
        mac = h[..6];
        mac[0] = (byte)((mac[0] & 0xFC) | 0x02);   // locally administered: the same every time
        if (server is { Length: > 0 }) pointed = IPEndPoint.TryParse(server.Contains(':') ? server : server + ":" + Port, out var ep) ? ep : null;
        player.Changed += Changed;
        player.Decoded += Decoded;
        player.Ended += () => { bool say; lock (gate) { say = !sentEnded && Current != null && Next == null; sentEnded |= say; } if (say) Stat("STMu"); };
    }

    public void Start()
    {
        if (running) return;
        running = true;
        new Thread(Loop) { IsBackground = true, Name = "slimproto" }.Start();
    }

    public void Stop()
    {
        running = false;
        try { sock?.Dispose(); } catch (ObjectDisposedException) { /* gone */ }
    }

    // Found, connected and played, until stopped; found again whenever the connection ends.
    private void Loop()
    {
        while (running)
        {
            var at = pointed ?? Discover();
            if (at == null) { Thread.Sleep(5000); continue; }
            try { Connect(at); }
            catch (Exception e) when (e is IOException or SocketException or ObjectDisposedException or EndOfStreamException) { log($"[slimproto] the connection to {at} ended: {e.Message}"); }
            (Server, net) = (null, null);
            if (running) Thread.Sleep(3000);
        }
    }

    // Mandarin's address: its answer to a broadcast 'e' on port 3483, or null after three seconds of none.
    private static IPEndPoint? Discover()
    {
        try
        {
            using var u = new UdpClient { EnableBroadcast = true };
            u.Client.ReceiveTimeout = 3000;
            u.Send("e"u8.ToArray(), new IPEndPoint(IPAddress.Broadcast, Port));
            var from = new IPEndPoint(IPAddress.Any, 0);
            var got = u.Receive(ref from);
            return got.Length > 0 && got[0] == (byte)'E' ? new IPEndPoint(from.Address, Port) : null;
        }
        catch (SocketException) { return null; }
    }

    private void Connect(IPEndPoint at)
    {
        using var s = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true, ReceiveTimeout = 35_000 };
        sock = s;
        s.Connect(at);
        using var stream = new NetworkStream(s);
        (Server, net) = (at.Address, stream);
        log($"[slimproto] connected to Mandarin at {at}");
        Hello();
        var head = new byte[2];
        while (running)
        {
            stream.ReadExactly(head);
            var len = BinaryPrimitives.ReadUInt16BigEndian(head);
            if (len < 4) throw new IOException("a short frame");
            var frame = new byte[len];
            stream.ReadExactly(frame);
            LastHeard = DateTime.UtcNow;
            Frame(Encoding.ASCII.GetString(frame, 0, 4), frame.AsSpan(4).ToArray());
        }
    }

    private void Send(string op, byte[] body)
    {
        var n = net;
        if (n == null) return;
        var b = new byte[8 + body.Length];
        Encoding.ASCII.GetBytes(op, b);
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(4), (uint)body.Length);
        body.CopyTo(b, 8);
        try { lock (sending) n.Write(b); }
        catch (Exception e) when (e is IOException or ObjectDisposedException) { log($"[slimproto] send {op}: {e.Message}"); }
    }

    /* Mandarin told again what it plays (a DAC plugged in or taken out, a new name): a hello again, where connected. */
    public void Rehello() { if (net != null) Hello(); }

    private void Hello()
    {
        var caps = Encoding.UTF8.GetBytes(capabilities());
        var b = new byte[36 + caps.Length];
        b[0] = 12;   // a Squeezelite's device id
        mac.CopyTo(b, 2);
        caps.CopyTo(b, 36);
        Send("HELO", b);
    }

    /* A STAT: [ev], with how far into the track it is. */
    private void Stat(string ev, uint timestamp = 0)
    {
        double seconds;
        lock (gate) seconds = Current != null && player.Uri == Current.Uri && !flushed ? player.Seconds : 0;
        var ms = (uint)Math.Max(0, seconds * 1000);
        var b = new byte[53];
        Encoding.ASCII.GetBytes(ev, b);
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(37), ms / 1000);
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(43), ms);
        BinaryPrimitives.WriteUInt32BigEndian(b.AsSpan(47), timestamp);
        Send("STAT", b);
    }

    private void Frame(string op, byte[] b)
    {
        switch (op)
        {
            case "strm": Strm(b); break;
            case "setd" when b.Length == 1 && b[0] == 0: Send("SETD", [0, .. Encoding.UTF8.GetBytes(name() + "\0")]); break;
            case "audg" or "aude" or "serv" or "setd": break;   // its volume is the DAC's
            default: log("[slimproto] unhandled " + op); break;
        }
    }

    private void Strm(byte[] b)
    {
        if (b.Length < 24) return;
        switch ((char)b[0])
        {
            case 't': Stat("STMt", BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(14))); break;
            case 'q':
                lock (gate) { flushed = true; waiting = paused = false; startedUri = decodedUri = sentDecoded = null; Current = Next = null; }
                player.Stop();
                Stat("STMf");
                break;
            case 'p': lock (gate) paused = true; player.Pause(); Stat("STMp"); break;
            case 'u': lock (gate) { waiting = paused = false; } player.Resume(); Stat("STMr"); break;
            case 's': Track(b); break;
        }
    }

    // strm s: the track, or (given while one plays, not after a stop) the next, gapless.
    private void Track(byte[] b)
    {
        var autostart = (char)b[1];
        var port = BinaryPrimitives.ReadUInt16BigEndian(b.AsSpan(18));
        var ip = BinaryPrimitives.ReadUInt32BigEndian(b.AsSpan(20));
        var host = ip == 0 ? Server?.ToString() : new IPAddress(b.AsSpan(20, 4)).ToString();
        if (host == null || ItemOf($"http://{host}:{port}", Encoding.Latin1.GetString(b, 24, b.Length - 24)) is not { } item) return;
        Stat("STMc");
        bool asNext;
        lock (gate)
        {
            asNext = !flushed && Current != null;
            if (asNext) Next = item;
            else { Current = item; Next = null; flushed = false; waiting = autostart == '0'; paused = false; sentEnded = false; startedUri = decodedUri = sentDecoded = erred = null; }
        }
        if (asNext) player.Next(item.Uri);
        else
        {
            player.Play(item.Uri, 0, paused: autostart == '0');
            if (autostart == '0') Stat("STMl");   // the engine fills its buffer while it waits: Play is had at once
        }
    }

    /* The track a strm s asks for: its address from the request's path, and what Mandarin said of it in its headers. */
    public static Item? ItemOf(string origin, string request)
    {
        var lines = request.Split("\r\n");
        if (lines[0].Split(' ') is not [_, var path, ..]) return null;
        string Header(string h) => lines.FirstOrDefault(l => l.StartsWith(h + ":", StringComparison.OrdinalIgnoreCase)) is { } l ? Uri.UnescapeDataString(l[(h.Length + 1)..].Trim()) : "";
        return new Item(origin + path, Header("X-Mandarin-Title"), Header("X-Mandarin-Artist"), Header("X-Mandarin-Album"));
    }

    /* A DAC plugged in while a track waited for one (Player.NoDac): played from its start, as the Android app does. */
    public void DacCame()
    {
        Item? c, n;
        lock (gate) { (c, n) = (Current, Next); if (c == null || flushed || player.Error != Player.NoDac) return; }
        player.Play(c.Uri, 0, paused: false);
        if (n != null) player.Next(n.Uri);
    }

    /* As /dac.json and its page say it: NO_MEDIA_PRESENT, STOPPED, or the engine's. */
    public string TransportState()
    {
        lock (gate)
        {
            if (Current == null) return "NO_MEDIA_PRESENT";
            if (waiting || player.Error != null) return "STOPPED";
            return player.State;
        }
    }

    // The engine said something new: what Mandarin needs to hear of it, said once.
    private void Changed()
    {
        var say = new List<string>();
        lock (gate)
        {
            // Gone on to the next track by itself: it is the current one now.
            if (Next != null && player.Uri == Next.Uri && Current?.Uri != Next.Uri) { Current = Next; Next = null; Joined++; sentEnded = false; }
            var c = Current;
            if (c != null && player.State == "PLAYING" && player.Uri == c.Uri && c.Uri != startedUri) { startedUri = c.Uri; erred = null; say.Add("STMs"); }
            if (startedUri != null && decodedUri == startedUri && sentDecoded != startedUri) { sentDecoded = startedUri; say.Add("STMd"); }
            // Paused or gone on by itself (its page): Mandarin follows.
            var nowPaused = player.State == "PAUSED_PLAYBACK" && startedUri != null;
            if (nowPaused != paused && startedUri != null) { paused = nowPaused; say.Add(nowPaused ? "STMp" : "STMr"); }
            if (player.Error is { } e && e != erred && c != null) { erred = e; say.Add("STMn"); }
        }
        foreach (var ev in say) Stat(ev);
    }

    // A track's last sample is in the engine's buffer: its stream read, said once it has begun (the next then comes).
    private void Decoded(string uri)
    {
        lock (gate) decodedUri = uri;
        Changed();
    }
}
