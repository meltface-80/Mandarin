// SlimRuns.cs — a Mandarin Bridge played one continuous stream of PCM (item 322), over SlimProto. A Squeezelite is
// given each track's file to fetch and decode (SlimPlayer.cs); a Bridge whose hello says
// ContinuousPcm=1 is given PCM made here instead: a run, one stream (SlimStream.cs), the queue's tracks decoded (and
// upsampled, or whatever its Output asks) one on into the next while they are of one format, so the Bridge only plays
// what comes and its DAC is never let go between them. Where the next track is of another rate or depth, the run
// ends with the last sample of the one before and the next begins a run of its own, given to the Bridge ahead: it
// goes on into it, its DAC settling at the new rate on a moment of silence first (the engine's, Engine.Settle.cs). A
// DSD track goes as its file, a run of its own. The track being heard, and how far into it, is read from where the
// Bridge says it is in its run (its STAT) and where each track began in it; a Bridge is told each track as it comes
// to it (mtrk), for its screen, and Players.cs is told to read it again at once ([changed]), so the track after it is
// set while there is time to make it into the run. What Players.cs asks of a renderer is answered as SlimPlayer does.
using static Mandarin.Server.Renderers.Slim.SlimFrames;

namespace Mandarin.Server.Renderers.Slim;

internal sealed class SlimRuns(string playerId, Action<byte[]> send, Action<string> log, Action<string> error, Action changed)
{
    /* A track in a run: the address it is known by, the one it is made from (a seek's, begun part-way), where in the run it begins (s), where in the track. */
    internal sealed record Entry(string Uri, string Fetch, double Start, double Offset);

    /* A stream the Bridge is given: PCM made here ([Pcm]), or a track's file as it is. */
    internal sealed class Run(int serial, PcmFormat? pcm, Entry first)
    {
        public int Serial { get; } = serial;
        public PcmFormat? Pcm { get; } = pcm;
        public List<Entry> Entries { get; } = [first];
        public bool Ended;                                       // the last of it given (made to its end, or the file read)
        public long Frames;                                      // PCM made and sent so far
        public int Maker;                                        // which asking for it is making it (the last: one asked again)
        public CancellationTokenSource Gone { get; } = new();   // let go: another track set, a seek, a stop
        public double Seconds => Pcm is { } f ? (double)Frames / f.Rate : 0;
    }

    private readonly object gate = new();
    private readonly Dictionary<string, string> metas = new(StringComparer.Ordinal);   // each track's DIDL, by its address
    private int serial;
    private Run? playing, streaming;     // the run being heard, and the last given (the same, or the one after it)
    private (string Uri, string Meta)? next, last;   // the track set to follow, not yet in a run; the last heard, after a stop
    private string state = "STOPPED";
    private bool loaded, playWanted, fresh;
    private uint elapsedMs;
    private long elapsedAt;
    private int heard = -1;              // the entry of the playing run the Bridge was last told of

    /* The run [n] of this player, given and not let go; null for any other. */
    public Run? Get(int n) { lock (gate) return playing is { } p && p.Serial == n && !p.Gone.IsCancellationRequested ? p : streaming is { } s && s.Serial == n && !s.Gone.IsCancellationRequested ? s : null; }

    private Run NewRun(string uri, string fetch, double offset) =>
        new(++serial, PcmFormat.Of(uri, metas.GetValueOrDefault(uri, "")), new Entry(uri, fetch, 0, offset));

    private void LetGo() { playing?.Gone.Cancel(); streaming?.Gone.Cancel(); }

    private double Elapsed() => ((double)elapsedMs + (state == "PLAYING" ? Environment.TickCount64 - elapsedAt : 0)) / 1000;

    // The entry of [r] heard [t] s in, and its place.
    private static (Entry Entry, int Index) At(Run r, double t)
    {
        var i = 0;
        for (var k = 1; k < r.Entries.Count; k++) if (r.Entries[k].Start <= t) i = k;
        return (r.Entries[i], i);
    }

    /* strm s for [r]: its PCM's address and format, or its file's. */
    private byte[] Strm(Run r, char autostart)
    {
        var e = r.Entries[0];
        var headers = SlimPlayer.Headers(metas.GetValueOrDefault(e.Uri, ""));
        return r.Pcm is { } f ? SlimPlayer.Request(SlimStream.For(e.Fetch, playerId, r.Serial), f.Strm, headers, autostart)
            : SlimPlayer.Request(e.Fetch, SlimPlayer.FormatOf(new Uri(e.Fetch).AbsolutePath), headers, autostart);
    }

    /* The track [uri] set: what it played let go, this one given, to wait until Play. */
    public void SetUri(string uri, string meta)
    {
        Run? r = null;
        lock (gate)
        {
            LetGo();
            metas.Clear(); metas[uri] = meta;
            next = last = null;
            if (uri.Length > 0) { r = NewRun(uri, uri, 0); last = (uri, meta); }
            playing = streaming = r;
            loaded = playWanted = false; fresh = r != null; heard = -1;
            state = "STOPPED"; elapsedMs = 0; elapsedAt = Environment.TickCount64;
        }
        send(SlimFrames.Strm('q'));
        if (r != null) { log($"[slimproto] run {r.Serial}: {(r.Pcm is { } f ? "PCM " + f : "the file as it is")}"); send(Strm(r, '0')); }
    }

    /* The track to follow: made into the run being made where it is of its format, else a run of its own once that one ends. */
    public void SetNextUri(string uri, string meta)
    {
        lock (gate) { if (uri.Length > 0) metas[uri] = meta; next = uri.Length > 0 ? (uri, meta) : null; }
        Advance();
    }

    // The next given as a run of its own: once the run given has ended and is being heard.
    private void Advance()
    {
        Run r;
        lock (gate)
        {
            if (next is not { } n || streaming is not { Ended: true } s || playing != s || state == "STOPPED") return;
            r = NewRun(n.Uri, n.Uri, 0);
            next = null; streaming = r;
        }
        log($"[slimproto] run {r.Serial} given ahead: {(r.Pcm is { } f ? "PCM " + f : "the file as it is")}");
        send(Strm(r, '1'));
    }

    // ------------------------------------------------------------ the stream's maker (SlimStream.cs)

    /* [r] begun, or asked for again (a Bridge that lost it part-way): made again from its first track, the same bytes,
       by this asking alone. Which it is, and the tracks in it so far. */
    public (int Maker, IReadOnlyList<Entry> Entries) Begin(Run r) { lock (gate) { r.Frames = 0; r.Ended = false; return (++r.Maker, [.. r.Entries]); } }

    /* The [i]th track of [r] begun now, where it has been made to. */
    public void Starts(Run r, int maker, int i) { lock (gate) if (maker == r.Maker && i > 0 && i < r.Entries.Count) r.Entries[i] = r.Entries[i] with { Start = r.Seconds }; }

    public void Made(Run r, int maker, long frames) { lock (gate) if (maker == r.Maker) r.Frames += frames; }

    /* The track after [r]'s last, made into it: the one set to follow, where it is of [r]'s format; null where [r] ends
       here (one of another format, or nothing set while the last of it plays out). Waited for until then. */
    public async Task<Entry?> NextInto(Run r, int maker, CancellationToken ct)
    {
        for (;;)
        {
            lock (gate)
            {
                if (r.Gone.IsCancellationRequested || streaming != r || maker != r.Maker) return null;
                if (next is { } n)
                {
                    if (PcmFormat.Of(n.Uri, n.Meta) != r.Pcm) return null;
                    var e = new Entry(n.Uri, n.Uri, r.Seconds, 0);
                    r.Entries.Add(e);
                    next = null;
                    return e;
                }
                if (playing == r && state == "PLAYING" && r.Seconds - Elapsed() < 1) return null;
            }
            await Task.Delay(100, ct);
        }
    }

    /* [r] made to its end: the next, where one is set, given as a run of its own. */
    public void Ended(Run r, int maker)
    {
        lock (gate) { if (maker != r.Maker) return; r.Ended = true; }
        Advance();
    }

    // ------------------------------------------------------------ what the Bridge says

    public void Heard(Stat s)
    {
        bool unpause = false, advance = false, moved = false;
        string? tell = null;
        lock (gate)
        {
            if (s.Event != "STMf") { elapsedMs = s.ElapsedMs; elapsedAt = Environment.TickCount64; }
            switch (s.Event)
            {
                case "STMs":   // a run begun: the one given after the one heard, where there is one
                    if (streaming != null && streaming != playing) { playing = streaming; heard = -1; }
                    state = "PLAYING"; fresh = false; advance = moved = true;
                    break;
                case "STMl": loaded = true; if (playWanted) { playWanted = false; unpause = true; } break;
                case "STMd": if (streaming is { Pcm: null } file) { file.Ended = true; advance = true; } break;   // a file read: what follows may be given
                case "STMp": if (state == "PLAYING") state = "PAUSED_PLAYBACK"; break;
                case "STMr": if (state == "PAUSED_PLAYBACK" || loaded) state = "PLAYING"; break;
                case "STMu":   // all of it played: stopped on the track it ended with (its position from then on is no place in the run)
                    if (streaming is { Ended: true } && streaming == playing && next == null)
                    {
                        var end = playing.Entries[^1].Uri;
                        last = (end, metas.GetValueOrDefault(end, ""));
                        playing = streaming = null;
                        state = "STOPPED";
                    }
                    break;
                case "STMn": error(Players.CouldNotPlay); state = "STOPPED"; break;
            }
            // Gone on to the next track within its run: the Bridge told what it is, for its screen.
            if (playing is { Pcm: not null } p && At(p, Elapsed()) is var (e, i) && i != heard)
            {
                if (i > 0) tell = SlimPlayer.Headers(metas.GetValueOrDefault(e.Uri, ""));
                heard = i; moved = true;
            }
        }
        if (unpause) send(SlimFrames.Strm('u'));
        if (tell != null) send(Mtrk(tell));
        if (moved) changed();
        if (advance) Advance();
    }

    // ------------------------------------------------------------ the transport

    public void Play()
    {
        bool unpause = false;
        (string Uri, string Meta)? again = null;
        lock (gate)
        {
            if (state == "PAUSED_PLAYBACK") unpause = true;
            else if (state == "STOPPED" && loaded) { unpause = true; loaded = false; }
            else if (state == "STOPPED" && fresh) playWanted = true;   // still buffering: on STMl
            else if (state == "STOPPED" && last != null) again = last;   // played to its end, or stopped: from the start again
        }
        if (again is { } a) { SetUri(a.Uri, a.Meta); lock (gate) playWanted = true; }
        else if (unpause) send(SlimFrames.Strm('u'));
    }

    public void Pause() { send(SlimFrames.Strm('p')); lock (gate) if (state == "PLAYING") state = "PAUSED_PLAYBACK"; }

    public void Stop()
    {
        send(SlimFrames.Strm('q'));
        lock (gate)
        {
            if (playing != null && At(playing, Elapsed()).Entry is var e) last = (e.Uri, metas.GetValueOrDefault(e.Uri, ""));
            LetGo();
            playing = streaming = null; next = null;
            state = "STOPPED"; loaded = playWanted = fresh = false; elapsedMs = 0;
        }
    }

    /* A seek: the track heard made again from [seconds] in, a run of its own, playing on where it played; the track
       made into the run after it (Players gave it once) set to follow again. */
    public void SeekTime(double seconds)
    {
        Run r;
        bool playOn;
        lock (gate)
        {
            if (playing is not { } p) return;
            var (e, i) = At(p, Elapsed());
            if (next == null && i + 1 < p.Entries.Count) next = (p.Entries[i + 1].Uri, metas.GetValueOrDefault(p.Entries[i + 1].Uri, ""));
            LetGo();
            var at = Math.Max(0, seconds);
            r = NewRun(e.Uri, SlimPlayer.From(e.Uri, at), at);
            playing = streaming = r;
            playOn = state == "PLAYING";
            loaded = playWanted = false; fresh = !playOn; heard = -1;
            elapsedMs = 0; elapsedAt = Environment.TickCount64;
        }
        log($"[slimproto] run {r.Serial}: the track again from {seconds.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)} s, {(r.Pcm is { } f ? "PCM " + f : "the file as it is")}");
        send(SlimFrames.Strm('q'));
        send(Strm(r, playOn ? '1' : '0'));
    }

    /* As AVTransport says it: PLAYING, PAUSED_PLAYBACK, STOPPED; NO_MEDIA_PRESENT with no track. */
    public string State { get { lock (gate) return playing == null && last == null ? "NO_MEDIA_PRESENT" : state; } }

    /* The track heard, and how far into it: where the Bridge is in its run, from where that track began in it. */
    public (string Uri, double Seconds) Position
    {
        get
        {
            lock (gate)
            {
                if (playing == null) return (last?.Uri ?? "", 0);
                var t = Elapsed();
                var (e, _) = At(playing, t);
                return (e.Uri, e.Offset + Math.Max(0, t - e.Start));
            }
        }
    }

    /* The Bridge has gone: what was being made for it let go. */
    public void Gone() { lock (gate) { LetGo(); if (state == "PLAYING") state = "STOPPED"; } }
}
