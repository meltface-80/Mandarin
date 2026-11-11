// Engine.cs — one sound device, played to.
//
//   decoder thread   ffmpeg decodes each track to 32-bit PCM (WAV, so its rate
//                    is read from the header) straight into the buffer below.
//                    The next track follows into the same buffer with nothing
//                    between them (gapless).
//   the buffer       up to a minute or more of audio ahead of the device, so a
//                    busy server (a library scan, an import) never reaches it.
//   playback thread  takes from the buffer and writes to the device, on its
//                    own core at a raised priority where allowed. It allocates
//                    nothing and does nothing else.
//
// Where the device is comes from the device itself (ALSA's delay: what it has
// still to play), not a clock.
using System.Diagnostics;
using System.Text;

namespace Mandarin.Audio;

internal enum PlayState { Stopped, Transitioning, Playing, Paused }

// Where a track starts in the buffer, and its format.
internal sealed record Mark(long Byte, string Uri, double Offset, int Rate, int Channels, OutFormat Fmt = OutFormat.Pcm);

internal sealed partial class Engine
{
    // The buffer. 64 MB is 3 minutes at 44.1 kHz, 21 s at 384 kHz (stereo,
    // 32-bit). HISTORY is kept behind the playback point so a device that
    // can't pause can be handed again what it threw away.
    private const int Capacity = 64 << 20;
    private const int History = 4 << 20;
    private readonly byte[] ring = GC.AllocateArray<byte>(Capacity, pinned: true);
    private long writeBytes, readBytes;
    private long endBytes = -1;                       // where the queue ends, once known
    private readonly List<Mark> marks = [];
    private readonly object gate = new();

    private readonly ISink sink;
    private readonly string ffmpeg;
    private readonly int core;
    private readonly Action<string> emit;
    private readonly Action<string> log;

    private int generation;                           // a new play: everything before it let go
    private PlayState state = PlayState.Stopped;
    private string? nextUri;
    private volatile float gain = 1f;
    private Process? decoder;
    private Thread? decodeThread;
    private readonly Thread playThread;

    // What the playback thread last saw, for the position.
    private long playedBytes;                         // of the buffer, as heard
    private long publishedTicks;
    private long xrunsReported;

    public Engine(ISink sink, string ffmpeg, int core, Action<string> emit, Action<string> log)
    {
        this.sink = sink; this.ffmpeg = ffmpeg; this.core = core; this.emit = emit; this.log = log;
        playThread = new Thread(PlayLoop) { IsBackground = true, Name = "playback" };
        playThread.Start();
        var reporter = new Thread(ReportLoop) { IsBackground = true, Name = "position" };
        reporter.Start();
    }

    // ------------------------------------------------------------ commands

    public void Play(string uri, double offset, bool paused)
    {
        int gen;
        lock (gate)
        {
            gen = ++generation;
            KillDecoder();
            writeBytes = readBytes = playedBytes = 0;
            endBytes = -1; failedNext = null;
            marks.Clear();
            nextUri = null;
            state = paused ? PlayState.Paused : PlayState.Transitioning;
            Monitor.PulseAll(gate);
        }
        decodeThread = new Thread(() => DecodeLoop(gen, uri, offset)) { IsBackground = true, Name = "decoder" };
        decodeThread.Start();
        Report(true);
    }

    public void Next(string? uri) { lock (gate) { nextUri = string.IsNullOrEmpty(uri) ? null : uri; Monitor.PulseAll(gate); } }

    public void Pause()
    {
        lock (gate)
        {
            if (state is PlayState.Playing or PlayState.Transitioning) { state = PlayState.Paused; Monitor.PulseAll(gate); }
        }
        Report(true);
    }

    public void Resume()
    {
        lock (gate)
        {
            if (state == PlayState.Paused) { state = marks.Count > 0 && readBytes > 0 ? PlayState.Playing : PlayState.Transitioning; Monitor.PulseAll(gate); }
        }
        Report(true);
    }

    public void Stop()
    {
        lock (gate)
        {
            generation++;
            KillDecoder();
            writeBytes = readBytes = playedBytes = 0;
            endBytes = -1; failedNext = null;
            marks.Clear();
            nextUri = null;
            state = PlayState.Stopped;
            Monitor.PulseAll(gate);
        }
        Report(true);
    }

    public void SetGain(double g) => gain = (float)Math.Clamp(g, 0, 1);

    // ------------------------------------------------------------ decoding

    private void DecodeLoop(int gen, string uri, double offset)
    {
        var any = false;   // a track decoded whole: one that fails after it is the next's failure, never this one's (Engine.Marks.cs)
        try
        {
            for (;;)
            {
                if (!DecodeTrack(gen, uri, offset)) return;
                lock (gate)
                {
                    if (gen != generation) return;
                    emit(Json.Obj("ev", "decoded", "uri", uri)); any = true;
                    // Nothing given yet: the device is still playing what it
                    // holds, and the next track usually arrives meanwhile.
                    while (gen == generation && nextUri == null && SecondsAhead() > 0.25) Monitor.Wait(gate, 50);
                    if (gen != generation) return;
                    if (nextUri != null) { uri = nextUri; nextUri = null; offset = 0; continue; }
                    endBytes = writeBytes;           // the end: what is left plays out
                    Monitor.PulseAll(gate);
                    return;
                }
            }
        }
        catch (Exception e)
        {
            if (any) NextFailed(gen, e.Message); else Fail(gen, e.Message);
        }
    }

    // One track into the buffer. True when it was decoded to the end.
    private bool DecodeTrack(int gen, string uri, double offset)
    {
        if (Dsd.IsDsd(uri) || RawPcm.Of(uri) != null) return DecodeHere(gen, uri, offset);   // DSD as DSD, never made PCM (items 256, 284); Mandarin's raw PCM (322)
        var args = new List<string> { "-hide_banner", "-loglevel", "error", "-nostdin" };
        if (offset > 0) { args.Add("-ss"); args.Add(offset.ToString("0.###", System.Globalization.CultureInfo.InvariantCulture)); }
        args.AddRange(["-i", uri, "-map", "0:a:0", "-vn", "-ac", "2", "-c:a", "pcm_s32le", "-f", "wav", "pipe:1"]);
        var psi = new ProcessStartInfo(ffmpeg) { RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
        foreach (var a in args) psi.ArgumentList.Add(a);
        Process proc;
        lock (gate)
        {
            if (gen != generation) return false;
            proc = Process.Start(psi) ?? throw new Exception("couldn't start the decoder");
            decoder = proc;
        }
        var err = new StringBuilder();
        proc.ErrorDataReceived += (_, e) => { if (e.Data != null && err.Length < 4000) lock (err) err.AppendLine(e.Data); };
        proc.BeginErrorReadLine();

        var input = proc.StandardOutput.BaseStream;
        var head = new byte[1 << 16];
        int got = 0;
        Wav.Format? fmt = null;
        long wrote = 0;
        try
        {
            while (fmt == null)
            {
                int n = input.Read(head, got, head.Length - got);
                if (n <= 0) break;
                got += n;
                fmt = Wav.Parse(head.AsSpan(0, got));
                if (fmt == null && got == head.Length) throw new Exception("the stream isn't audio Mandarin can read");
            }
            if (fmt != null)
            {
                if (fmt.Bits != 32) throw new Exception("unexpected PCM from the decoder");
                lock (gate)
                {
                    if (gen != generation) return false;
                    marks.Add(new Mark(writeBytes, uri, offset, fmt.Rate, fmt.Channels));
                    Monitor.PulseAll(gate);
                }
                // What came with the header.
                if (Put(gen, head.AsSpan(fmt.Start, got - fmt.Start)) < 0) return false;
                wrote += got - fmt.Start;
                var buf = new byte[1 << 16];
                for (;;)
                {
                    int n = input.Read(buf, 0, buf.Length);
                    if (n <= 0) break;
                    long w = Put(gen, buf.AsSpan(0, n));
                    if (w < 0) return false;
                    wrote += w;
                }
            }
        }
        catch (IOException) { /* killed: a new play or a stop */ }
        proc.WaitForExit();
        lock (gate) { if (decoder == proc) decoder = null; if (gen != generation) return false; }
        if (proc.ExitCode != 0 && wrote == 0)
        {
            string line;
            lock (err) line = err.ToString().Trim().Split('\n').LastOrDefault(l => l.Trim().Length > 0) ?? $"the decoder stopped ({proc.ExitCode})";
            throw new Exception("couldn't play the track: " + StripTag(line.Trim()));
        }
        return true;
    }

    // Whole frames only are counted; a part-frame waits in the buffer for the
    // rest (the buffer is bytes). Blocks while the buffer is full. -1: let go.
    private long Put(int gen, ReadOnlySpan<byte> data)
    {
        int at = 0;
        while (at < data.Length)
        {
            int n;
            lock (gate)
            {
                for (;;)
                {
                    if (gen != generation) return -1;
                    long free = Capacity - History - (writeBytes - readBytes);
                    if (free > 0) { n = (int)Math.Min(free, data.Length - at); break; }
                    Monitor.Wait(gate, 100);
                }
            }
            // Copied under the gate, checked against the play it is for: a
            // decoder being let go must not write into the next play's audio.
            lock (gate)
            {
                if (gen != generation) return -1;
                int idx = (int)(writeBytes % Capacity);
                int first = Math.Min(n, Capacity - idx);
                data.Slice(at, first).CopyTo(ring.AsSpan(idx));
                if (n > first) data.Slice(at + first, n - first).CopyTo(ring.AsSpan(0));
                writeBytes += n;
                Monitor.PulseAll(gate);
            }
            at += n;
        }
        return data.Length;
    }

    private void KillDecoder()
    {
        var d = decoder;
        decoder = null;
        if (d == null) return;
        try { if (!d.HasExited) d.Kill(); } catch { /* gone */ }
    }

    // ------------------------------------------------------------ playing

    private unsafe void PlayLoop()
    {
        string granted = Libc.FavourThisThread(core);
        log("playback thread: " + granted);
        byte* basePtr = (byte*)System.Runtime.CompilerServices.Unsafe.AsPointer(ref ring[0]);
        var scratch = GC.AllocateArray<byte>(1 << 16, pinned: true);
        byte* scratchPtr = (byte*)System.Runtime.CompilerServices.Unsafe.AsPointer(ref scratch[0]);
        int myGen = -1;
        bool devicePaused = false;
        for (;;)
        {
            int gen; long from; int len; Mark? mark; bool end;
            lock (gate)
            {
                for (;;)
                {
                    gen = generation;
                    if (gen != myGen)
                    {
                        // A new play or a stop: what the device holds goes,
                        // and stopped, the device is let go for other programs.
                        myGen = gen;
                        if (devicePaused) { sink.Pause(false); devicePaused = false; }
                        if (sink.Rate != 0) sink.Drop();
                        if (state == PlayState.Stopped) sink.Release();
                    }
                    if (state == PlayState.Paused)
                    {
                        if (!devicePaused && sink.Rate != 0)
                        {
                            if (!sink.Pause(true))
                            {
                                // Can't hold it: throw away what it has and
                                // hand it over again on play.
                                long held = sink.Delay() * 4 * sink.Channels;
                                sink.Drop();
                                readBytes = Math.Max(Math.Max(0, writeBytes - (Capacity - History)), readBytes - held);
                                playedBytes = readBytes;
                            }
                            devicePaused = true;
                        }
                        Monitor.Wait(gate, 100);
                        continue;
                    }
                    if (devicePaused) { sink.Pause(false); devicePaused = false; }
                    if (state == PlayState.Stopped) { Monitor.Wait(gate, 200); continue; }
                    end = endBytes >= 0 && readBytes >= endBytes;
                    if (end) break;
                    if (writeBytes > readBytes) break;
                    Monitor.Wait(gate, 20);
                }
                // The track whose bytes these are, and how much to take.
                mark = MarkAt(readBytes);
                long limit = endBytes >= 0 ? endBytes : writeBytes;
                // Up to the next track's first byte: a new format starts there.
                for (int i = 0; i < marks.Count; i++)
                    if (marks[i].Byte > readBytes) { limit = Math.Min(limit, marks[i].Byte); break; }
                from = readBytes;
                int frame = 4 * (mark?.Channels ?? 2);
                int maxBytes = frame * Math.Max(1024, (mark?.Rate ?? 44100) / 20);   // a twentieth of a second
                len = (int)Math.Min(limit - from, Math.Min(maxBytes, scratch.Length));
                len -= len % frame;
            }
            if (end)
            {
                // The last of it plays out, then the device is let go.
                try { sink.Drain(); } catch (Exception e) { log("drain: " + e.Message); }
                lock (gate)
                {
                    if (gen == generation)
                    {
                        state = PlayState.Stopped;
                        endBytes = -1; marks.Clear(); writeBytes = readBytes = playedBytes = 0;
                        emit(failedNext is { } why ? Json.Obj("ev", "error", "message", why) : Json.Obj("ev", "ended")); failedNext = null;
                    }
                }
                Report(true);
                continue;
            }
            if (mark == null || len <= 0) { Thread.Sleep(5); continue; }
            try
            {
                if (sink.Rate != mark.Rate || sink.Channels != mark.Channels || sink.Format != mark.Fmt)
                {
                    // A new format: what the device holds plays out first, and from one to another the DAC is let settle (Engine.Settle.cs).
                    var change = sink.Rate != 0;
                    if (change) sink.Drain();
                    sink.Open(mark.Rate, mark.Channels, mark.Fmt);
                    emit(Json.Obj("ev", "format", "rate", mark.Rate, "channels", mark.Channels, "format", Dsd.AlsaName(mark.Fmt) + (mark.Fmt == OutFormat.Dop ? " (DoP)" : "")));
                    if (change) Settle(mark, basePtr + from % Capacity);
                }
                int idx = (int)(from % Capacity);
                int contiguous = Math.Min(len, Capacity - idx);
                byte* src = basePtr + idx;
                float g = mark.Fmt == OutFormat.Pcm ? gain : 1f;   // DSD's bits are never scaled
                if (g != 1f || contiguous < len)
                {
                    // Scaled (or wrapping round the buffer's end): through the scratch.
                    Buffer.MemoryCopy(src, scratchPtr, scratch.Length, contiguous);
                    if (contiguous < len) Buffer.MemoryCopy(basePtr, scratchPtr + contiguous, scratch.Length - contiguous, len - contiguous);
                    if (g != 1f) Scale(scratchPtr, len, g);
                    src = scratchPtr;
                }
                int frameBytes = 4 * mark.Channels;
                int frames = len / frameBytes;
                int done = 0;
                while (done < frames)
                {
                    int n = sink.Write(src + done * frameBytes, frames - done);
                    done += n;
                    lock (gate)
                    {
                        if (gen != generation) break;
                        readBytes = from + (long)done * frameBytes;
                        playedBytes = readBytes - sink.Delay() * frameBytes;
                        publishedTicks = Stopwatch.GetTimestamp();
                        if (state == PlayState.Transitioning) state = PlayState.Playing;
                        Monitor.PulseAll(gate);
                    }
                    if (state == PlayState.Paused) break;
                }
                if (sink.Xruns != xrunsReported)
                {
                    xrunsReported = sink.Xruns;
                    emit(Json.Obj("ev", "xrun", "count", xrunsReported));
                }
            }
            catch (DeviceException e) { Fail(gen, e.Message); }
            catch (Exception e) { Fail(gen, "the device stopped: " + e.Message); }
        }
    }

    private void Fail(int gen, string message)
    {
        lock (gate)
        {
            if (gen != generation) return;
            generation++;
            KillDecoder();
            state = PlayState.Stopped;
            writeBytes = readBytes = playedBytes = 0; endBytes = -1; marks.Clear(); failedNext = null;
            Monitor.PulseAll(gate);
        }
        try { sink.Drop(); } catch { /* the device went with it */ }
        emit(Json.Obj("ev", "error", "message", message));
        Report(true);
    }

    // ------------------------------------------------------------ the position

    private void ReportLoop()
    {
        for (;;) { Thread.Sleep(200); Report(false); }
    }

    private string lastReport = "";

    private void Report(bool force)
    {
        string line;
        lock (gate)
        {
            var m = MarkAt(Math.Max(0, playedBytes));
            string st = state switch
            {
                PlayState.Playing => "PLAYING", PlayState.Paused => "PAUSED_PLAYBACK",
                PlayState.Transitioning => "TRANSITIONING", _ => "STOPPED"
            };
            double seconds = 0;
            if (m != null)
            {
                double bps = 4.0 * m.Channels * m.Rate;
                double heard = Math.Max(0, playedBytes - m.Byte) / bps;
                // Between two writes the device moves on by the clock.
                if (state == PlayState.Playing && publishedTicks != 0)
                    heard += Math.Min(0.25, Stopwatch.GetElapsedTime(publishedTicks).TotalSeconds);
                seconds = m.Offset + heard;
            }
            line = Json.Obj("ev", "pos", "state", st, "uri", m?.Uri ?? "", "seconds", Math.Round(seconds, 3),
                "rate", sink.Rate, "channels", sink.Channels, "ahead", Math.Round(SecondsAhead(), 1));
        }
        if (force || line != lastReport) { lastReport = line; emit(line); }
    }

    private static string StripTag(string s) => s.StartsWith('[') && s.Contains(']') ? s[(s.IndexOf(']') + 1)..].Trim() : s;
}
