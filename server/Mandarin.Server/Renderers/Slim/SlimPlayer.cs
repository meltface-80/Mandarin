// SlimPlayer.cs — one SlimProto player connected (bug list item 312): who it is, and the stream it is playing, told
// to it by strm and followed by what it says (STAT). A track set is the player's stream stopped and that track's
// started, to wait until Play; the next, started once the player has read the last of the one before (STMd) — it plays
// into it from its own buffer, one stream on into the next, as Lyrion Music Server plays a Squeezebox gapless. It
// says when the next has begun playing (STMs), when it is paused and goes on (STMp, STMr), when all it had is played
// (STMu); how far into the track it is, in each STAT, asked for every second (strm 't').
using System.Net.Sockets;
using static Mandarin.Server.Renderers.Slim.SlimFrames;

namespace Mandarin.Server.Renderers.Slim;

internal sealed class SlimPlayer
{
    public static string IdOf(string mac) => "SLIM_" + mac.Replace(":", "", StringComparison.Ordinal).ToUpperInvariant();

    private readonly object gate = new();
    private readonly Action<string> log;
    private NetworkStream? net;
    private Timer? heartbeat;
    private string? named;

    public string Id { get; }
    public Helo Helo { get; private set; }
    public string Ip { get; private set; }
    public bool Connected { get; private set; } = true;

    /* Its name: as it was named (setd 0), else its model's. */
    public string Name => named is { Length: > 0 } n ? n : Helo.Caps().Pairs.TryGetValue("ModelName", out var m) && m.Length > 0 ? m : "Squeezelite";

    // What it is playing: the track playing, the stream it was last given (that track, or the next once given), the next.
    private string current = "", streaming = "", next = "";
    private bool streamRead, loaded, playWanted;
    private string state = "STOPPED";
    private uint elapsedMs;
    private long elapsedAt;
    private double offset;   // where in the track its stream began: 0, or a seek's point (item 313)
    private double volume = 100;
    private bool muted;
    private string? lastError;

    /* What went wrong since last asked (a track it couldn't play), said once. */
    public string? TakeError() { lock (gate) { var e = lastError; lastError = null; return e; } }

    public SlimPlayer(string id, Helo helo, string ip, NetworkStream net, Action<string> log)
    {
        Id = id; Helo = helo; Ip = ip; this.net = net; this.log = log;
    }

    /* Connected again (the same player, by its MAC): this connection now. */
    public SlimPlayer Reconnected(Helo helo, string ip, NetworkStream stream)
    {
        lock (gate) { Helo = helo; Ip = ip; net = stream; Connected = true; }
        return this;
    }

    /* Said hello: asked its name, its outputs on, its volume as it was, and asked how it is every second. */
    public void Hello()
    {
        Send(Setd(0));
        Send(Aude(true, true));
        Send(Audg(muted ? 0 : volume / 100));
        heartbeat?.Dispose();
        heartbeat = new Timer(_ => Send(Strm('t', interval: (uint)Environment.TickCount)), null, 1000, 1000);
        log($"[slimproto] {Name} ({Ip}) connected: {Helo.Capabilities}");
    }

    public void Named(string name) { if (name.Trim().Length > 0) named = name.Trim(); }

    public void Disconnected(byte reason) { lock (gate) { if (reason != 0) lastError = $"{Name} lost the stream (disconnect {reason})"; } }

    /* The connection on [socket] ended: gone, unless it has connected again since (true where gone). */
    public bool Gone(Socket socket)
    {
        lock (gate)
        {
            if (net != null && !ReferenceEquals(net.Socket, socket)) return false;
            Connected = false; net = null;
            heartbeat?.Dispose(); heartbeat = null;
            if (state == "PLAYING") state = "STOPPED";
            return true;
        }
    }

    public void Halt() { heartbeat?.Dispose(); heartbeat = null; }

    private void Send(byte[] frame)
    {
        NetworkStream? n;
        lock (gate) n = net;
        if (n == null) return;
        try { lock (n) n.Write(frame); }
        catch (Exception e) when (e is IOException or ObjectDisposedException or SocketException) { /* its connection ends, and Gone says so */ }
    }

    /* What it says of itself. */
    public void Heard(Stat s)
    {
        string? nextToSend = null;
        var sendUnpause = false;
        lock (gate)
        {
            if (s.Event != "STMf") { elapsedMs = s.ElapsedMs; elapsedAt = Environment.TickCount64; }
            switch (s.Event)
            {
                case "STMs":   // a track has begun playing: the next, where it was given
                    if (streaming != current && streaming.Length > 0) { current = streaming; offset = 0; if (next == current) next = ""; }
                    state = "PLAYING";
                    break;
                case "STMl":   // buffered enough to start: started, where Play was asked for
                    loaded = true;
                    if (playWanted) { playWanted = false; sendUnpause = true; }
                    break;
                case "STMd":   // the last of its stream read: the next started, where there is one
                    streamRead = true;
                    if (next.Length > 0 && streaming == current) nextToSend = next;
                    break;
                case "STMp": if (state == "PLAYING") state = "PAUSED_PLAYBACK"; break;
                case "STMr": if (state == "PAUSED_PLAYBACK" || loaded) state = "PLAYING"; break;
                case "STMu":   // all it had is played: the end, where nothing more was given
                    if (streamRead && streaming == current) state = "STOPPED";
                    break;
                case "STMn": lastError = $"{Name} couldn't play the track"; state = "STOPPED"; break;
            }
            if (nextToSend != null) { streaming = nextToSend; streamRead = false; }
        }
        if (nextToSend != null) Send(StreamOf(nextToSend, autostart: '1'));
        if (sendUnpause) Send(Strm('u'));
    }

    /* The track [uri] set: what it played stopped and forgotten, this one fetched, to wait until Play. */
    public void SetUri(string uri)
    {
        lock (gate) { current = streaming = uri; next = ""; streamRead = loaded = playWanted = false; state = "STOPPED"; elapsedMs = 0; elapsedAt = Environment.TickCount64; offset = 0; }
        Send(Strm('q'));
        if (uri.Length > 0) Send(StreamOf(uri, autostart: '0'));
    }

    /* The next after the one playing: started now where the one playing has been read to its end, else once it has. */
    public void SetNextUri(string uri)
    {
        bool now;
        lock (gate)
        {
            next = uri;
            now = uri.Length > 0 && streamRead && streaming == current && state != "STOPPED";
            if (now) { streaming = uri; streamRead = false; }
        }
        if (now) Send(StreamOf(uri, autostart: '1'));
    }

    public void Play()
    {
        bool unpause = false, again = false;
        string uri;
        lock (gate)
        {
            uri = current;
            if (state == "PAUSED_PLAYBACK") unpause = true;
            else if (state == "STOPPED" && loaded) { unpause = true; loaded = false; }
            else if (state == "STOPPED" && streaming == current && !streamRead) playWanted = true;   // still buffering: on STMl
            else if (state == "STOPPED" && uri.Length > 0) again = true;   // played to its end: from the start again
        }
        if (again) { SetUri(uri); lock (gate) playWanted = true; }
        else if (unpause) Send(Strm('u'));
    }

    public void Pause() { Send(Strm('p')); lock (gate) if (state == "PLAYING") state = "PAUSED_PLAYBACK"; }

    public void Stop()
    {
        Send(Strm('q'));
        lock (gate) { state = "STOPPED"; streaming = current; streamRead = loaded = playWanted = false; elapsedMs = 0; offset = 0; }
    }

    /* A seek (item 313): it can't seek within a stream, so the track playing is fetched again from [seconds] in
       (?ss=, Streams.From.cs), playing on where it played, waiting where it was paused; the next after it kept. */
    public void SeekTime(double seconds)
    {
        string uri;
        bool playing;
        lock (gate)
        {
            uri = current;
            if (uri.Length == 0) return;
            playing = state == "PLAYING";
            offset = Math.Max(0, seconds);
            streaming = current; streamRead = loaded = playWanted = false;
            elapsedMs = 0; elapsedAt = Environment.TickCount64;
        }
        Send(Strm('q'));
        Send(StreamOf(From(uri, seconds), autostart: playing ? '1' : '0'));
    }

    /* [uri] begun [seconds] in. */
    public static string From(string uri, double seconds) =>
        uri + (uri.Contains('?', StringComparison.Ordinal) ? "&" : "?") + "ss=" + Math.Max(0, seconds).ToString("0.###", System.Globalization.CultureInfo.InvariantCulture);

    /* As AVTransport says it: PLAYING, PAUSED_PLAYBACK, STOPPED; NO_MEDIA_PRESENT with no track. */
    public string State { get { lock (gate) return current.Length == 0 ? "NO_MEDIA_PRESENT" : state; } }

    /* The track playing, and how far into it (from its last STAT, on from there while it plays). */
    public (string Uri, double Seconds) Position
    {
        get
        {
            lock (gate)
            {
                var ms = (double)elapsedMs + (state == "PLAYING" ? Environment.TickCount64 - elapsedAt : 0);
                return (current, offset + Math.Max(0, ms) / 1000);
            }
        }
    }

    public double Volume { get { lock (gate) return volume; } }
    public bool Muted { get { lock (gate) return muted; } }

    public void SetVolume(double v) { lock (gate) volume = Math.Clamp(v, 0, 100); Send(Audg(Muted ? 0 : Volume / 100)); }
    public void SetMute(bool m) { lock (gate) muted = m; Send(Audg(m ? 0 : Volume / 100)); }

    /* strm s for [uri]: its codec by its kind, fetched from where it is (the server it is connected to, where the
       address names no other), as an HTTP request. */
    private static byte[] StreamOf(string uri, char autostart)
    {
        var u = new Uri(uri);
        var ip = System.Net.IPAddress.TryParse(u.Host, out var a) && a.AddressFamily == AddressFamily.InterNetwork
            ? System.Buffers.Binary.BinaryPrimitives.ReadUInt32BigEndian(a.GetAddressBytes()) : 0;
        var request = $"GET {u.PathAndQuery} HTTP/1.0\r\nHost: {u.Authority}\r\n\r\n";
        return Strm('s', FormatOf(u.AbsolutePath), request, (ushort)u.Port, ip, autostart: autostart);
    }

    /* A track's codec, as strm names it: FLAC, DSD (a DSF or DFF the player reads itself), else whatever its header says. */
    public static Format FormatOf(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".flac" => new Format('f'),
            ".dsf" or ".dff" => new Format('d'),
            ".mp3" => new Format('m'),
            _ => new Format('?'),
        };
    }
}
