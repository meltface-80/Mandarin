// Capture.cs — a recording of exactly what the engine hands the device (item 412), for Mandarin's bit-perfect check:
// Mandarin Bridge for Linux asks for it at its /capture, the Android Bridge's API (bridge/android/…/Capture.kt), and
// the server compares it sample by sample with what it sent. Made only when asked, never by itself.
//
// The bytes are those the device took (TapSink.cs), after every conversion the engine makes. They are written as the
// Android Bridge writes them (CaptureFiles.cs): a WAV in the engine's 32-bit word beside its sidecar.
//
//   {"cmd":"capture","dir":"…","seconds":30,"part":0,"after_flush":false,"tool":"Mandarin Bridge 0.3.11","about":{…}}
//              start, from the next byte the device takes (refused while one runs); up to two minutes in one piece. With
//              "part" and "after_flush" (item 286): the whole of a track, from the first byte after the stream is next
//              flushed or opened afresh (the track played again from its start), in parts of [part] seconds, each begun
//              on the byte after the last part's: [dir]/capture-N.wav and .wav.json, else [dir]/capture.wav
//   {"cmd":"capture_stop"}         stopped; what was recorded is kept and finished
//   {"cmd":"capture_drop","n":2}   part N let go (fetched)
//   {"ev":"capture","answer":"start","ok":true,"state":…}   the answer to each, with where it is (CaptureState.cs)
//   {"ev":"capture","state":…}                              where it is, at each change and each second it records
//
// The playback thread hands the bytes over and goes on: they are copied into a ring here and written to disk by a thread
// of the capture's own, in order with what happens to the files (a part opened, closed, let go), so a slow disk (a
// Pi's SD card) never holds the device up; one that can't keep up fails the recording, never the music. The stream
// changing format, a drain or a release ends it: a WAV has one format.
using System.Text.Json.Nodes;

namespace Mandarin.Audio;

internal sealed partial class Capture(Action<string> emit, Action<string> log)
{
    public const int MaxSeconds = 120;
    public const int MaxWhole = 6 * 3600;           // a recording in parts: the longest track
    private const int WaitingMax = 3;               // parts done but not fetched: more, and nothing is collecting them
    private const int RingBytes = 32 << 20;         // bytes taken but not yet on disk: more, and the disk can't keep up

    /* A stream the device was opened for: each opening its own [Id]. */
    public sealed record Fed(int Id, int Rate, int Channels, OutFormat Format)
    {
        public int FrameBytes => 4 * Channels;
        public string Kind => Format switch { OutFormat.Pcm => "pcm", OutFormat.Dop => "dop", _ => "dsd" };
    }

    private readonly object gate = new();
    private volatile bool listening;                // armed or recording: all the playback thread looks at otherwise
    public bool Listening => listening;

    /* The device's underruns so far (TapSink sets it). */
    public Func<long> Xruns { get; set; } = () => 0;

    private string state = "idle", why = "";
    private string dir = "", tool = "";
    private JsonObject about = [];
    private int seconds, partSeconds;               // partSeconds 0: one file (capture.wav)
    private bool afterFlush, flushedSinceArmed;
    private Fed? current;                           // what the device is open at; null while it's closed
    private int armedOn;                            // the stream when armed: another begins it, as a flush does
    private Fed? stream;                            // the recording's
    private long target, taken, partTarget, partTaken;
    private int partN;
    private double startedAt;
    private long xrunsBefore;
    private List<(long Frame, string Why)> interruptions = [];
    private readonly SortedDictionary<int, long> waiting = [];   // parts done, not yet let go: their frames

    private string PartFile(int n) => Path.Combine(dir, partSeconds > 0 ? $"capture-{n}.wav.part" : "capture.wav.part");
    private string Wav(int n) => Path.Combine(dir, partSeconds > 0 ? $"capture-{n}.wav" : "capture.wav");

    /* Starts one: false while one is armed, recording or finishing. */
    public bool Start(string into, int secs, int part, bool flush, string by, JsonObject said)
    {
        lock (gate) if (Busy) return false;
        // The last one's files let go before the lock: the playback thread may want it meanwhile.
        Directory.CreateDirectory(into);
        foreach (var f in Directory.GetFiles(into, "capture*")) TryDelete(f);
        lock (gate)
        {
            if (Busy) return false;
            partSeconds = part > 0 ? Math.Clamp(part, 1, MaxSeconds) : 0;
            seconds = Math.Clamp(secs, 1, partSeconds > 0 ? MaxWhole : MaxSeconds);
            afterFlush = flush; flushedSinceArmed = false; armedOn = current?.Id ?? 0;
            (dir, tool, about) = (into, by, said);
            why = ""; taken = target = partTaken = partTarget = 0; partN = 0; stream = null;
            interruptions = [];
            waiting.Clear();
            Restart();
            ring ??= GC.AllocateUninitializedArray<byte>(RingBytes);
            state = "armed"; listening = true; dirty = true;
        }
        log($"capture: armed for {seconds} s" + (partSeconds > 0 ? $" in parts of {partSeconds} s" : "") + (afterFlush ? ", from the next flush" : ""));
        Wake();
        return true;
    }

    private bool Busy => state is "armed" or "recording" or "finishing";

    /* Stops one that runs: what was recorded is finished and kept. */
    public void Stop()
    {
        lock (gate)
        {
            if (state == "armed") { listening = false; state = "idle"; dirty = true; }
            else if (state == "recording") Finish("stopped");
        }
        Wake();
    }

    /* Part [n] let go, once fetched: false where there's none. */
    public bool Drop(int n)
    {
        lock (gate)
        {
            if (!waiting.Remove(n)) return false;
            TryDelete(Wav(n)); TryDelete(Wav(n) + ".json");
            dirty = true;
        }
        Wake();
        return true;
    }

    /* The device took [len] bytes from [data] (the playback thread). */
    public unsafe void Took(byte* data, int len)
    {
        bool wrote = false;
        lock (gate)
        {
            var o = current;
            if (o == null) return;
            if (state == "armed")
            {
                // From the stream played again from its start: its flush, or a stream opened afresh.
                if (afterFlush && !flushedSinceArmed && o.Id == armedOn) return;
                if (!Begin(o)) return;
            }
            if (state != "recording") return;
            if (o.Id != stream!.Id) { Finish("the stream changed (another rate or format)"); return; }
            long left = Math.Min(len, target - taken);
            int at = 0;
            while (left > 0 && state == "recording")
            {
                int n = (int)Math.Min(left, partTarget - partTaken);
                if (!Put(new ReadOnlySpan<byte>(data + at, n))) { Fail("the recording couldn't be written fast enough"); return; }
                wrote = true;
                taken += n; partTaken += n; at += n; left -= n;
                if (taken >= target) { Finish("done"); break; }
                // A part full: the next begun on the very next byte, nothing between them.
                if (partTaken >= partTarget) { Close("part"); if (!OpenPart(o)) break; }
            }
        }
        if (wrote) Wake();
    }

    /* The device was opened for [o]: a new stream. */
    public void Opened(Fed o)
    {
        lock (gate)
        {
            current = o;
            if (state == "recording" && o.Id != stream!.Id) Finish("the stream changed (another rate or format)");
        }
        Wake();
    }

    /* What the device held was thrown away: a new play, a seek, a stop. */
    public void Flushed()
    {
        lock (gate)
        {
            if (state == "armed") { flushedSinceArmed = true; return; }
            var o = stream;
            if (state != "recording" || o == null || taken == 0) return;
            // A second flush within its first second (a restart flushes more than once): begun again, from it.
            if (BegunAgain(o)) return;
            interruptions.Add((partTaken / o.FrameBytes, "flush"));
        }
    }

    /* The device was let go (drained, released): its stream ended. */
    public void Ended()
    {
        lock (gate)
        {
            current = null;
            if (state != "recording" || stream is not { } o) return;
            // Stopped and played again within its first second (Mandarin's restart is a stop, then the track): armed again, for that.
            if (afterFlush && partN == 1 && taken < (long)o.Rate * o.FrameBytes)
            {
                Queue(new DiscardOp(gen, written));
                taken = partTaken = 0; partN = 0; stream = null;
                state = "armed"; flushedSinceArmed = true; armedOn = -1;
                return;
            }
            Finish("the stream ended");
        }
        Wake();
    }

    // Begun again from a flush in its first second (lock held): the part's file emptied, on the disk's thread, behind the bytes already handed to it.
    private bool BegunAgain(Fed o)
    {
        if (!afterFlush || partN != 1 || taken >= (long)o.Rate * o.FrameBytes) return false;
        Queue(new DiscardOp(gen, written));
        Queue(new OpenOp(gen, written, PartFile(1), CaptureFiles.Header(o, 0)));
        taken = partTaken = 0; startedAt = Now(); xrunsBefore = Xruns(); interruptions = [];
        return true;
    }

    // The first byte (lock held): the format fixed, the first part opened. False where it can't be (a failure).
    private bool Begin(Fed o)
    {
        stream = o; target = (long)o.Rate * o.FrameBytes * seconds; taken = 0; partN = 0;
        startedAt = Now();
        if (!OpenPart(o)) return false;
        state = "recording"; dirty = true;
        return true;
    }

    // The next part's file opened (lock held): false, and failed, where it can't be.
    private bool OpenPart(Fed o)
    {
        if (partSeconds > 0 && waiting.Count >= WaitingMax) { Fail("nothing is collecting the recording"); return false; }
        partN++;
        partTarget = partSeconds > 0 ? (long)o.Rate * o.FrameBytes * partSeconds : target;
        partTaken = 0;
        var need = Math.Min(partTarget, target - taken);
        if (Free(dir) < need + (64L << 20)) { Fail($"not enough space for {need >> 20} MB"); return false; }
        Queue(new OpenOp(gen, written, PartFile(partN), CaptureFiles.Header(o, 0)));
        xrunsBefore = Xruns();
        interruptions = [];
        return true;
    }

    // The part being written finished (lock held): its header's lengths written and its sidecar beside it, on the disk's thread.
    private void Close(string reason)
    {
        var o = stream!;
        var part = new CaptureFiles.Part(partN, (taken - partTaken) / o.FrameBytes, partTaken, reason, seconds, startedAt, Math.Max(0, Xruns() - xrunsBefore), interruptions);
        Queue(new CloseOp(gen, written, PartFile(partN), Wav(partN), CaptureFiles.Header(o, partTaken),
            CaptureFiles.Sidecar(tool, about, o, part), partN, reason, partTaken / o.FrameBytes, partSeconds > 0));
    }

    // Ended (lock held): the last part finished.
    private void Finish(string reason)
    {
        listening = false;
        dirty = true;
        if (stream == null) { state = "idle"; return; }
        why = reason;
        state = "finishing";
        Close(reason);
    }

    // Failed (lock held): the part being written let go; those done are kept.
    private void Fail(string reason)
    {
        listening = false;
        why = reason; state = "failed"; dirty = true;
        Restart();
    }

    private static double Now() => Math.Round(DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0, 3);

    private static long Free(string path)
    {
        try { return new DriveInfo(path).AvailableFreeSpace; }
        catch (Exception e) when (e is IOException or ArgumentException or UnauthorizedAccessException) { return long.MaxValue; }
    }

    private static void TryDelete(string f)
    {
        try { File.Delete(f); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* left: let go next time */ }
    }
}
