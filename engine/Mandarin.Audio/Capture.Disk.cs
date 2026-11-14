// Capture.Disk.cs — a capture's bytes on their way to disk (item 412, Capture.cs): the playback thread copies what the
// device took into a ring and goes on; the capture's own thread writes it out, in order with what happens to the
// files at the byte it happens (a part opened, a part closed with its header and sidecar, a part let go), and says
// where the capture is (CaptureState.cs) at each change and each second it records. A new start or a failure is a new
// generation: whatever the last one left unwritten is let go, its part file with it.
using System.Text.Json.Nodes;

namespace Mandarin.Audio;

internal sealed partial class Capture
{
    private abstract record Op(int Gen, long At);
    private sealed record OpenOp(int Gen, long At, string Path, byte[] Header) : Op(Gen, At);
    private sealed record CloseOp(int Gen, long At, string Part, string Wav, byte[] Header, string Sidecar, int N, string Reason, long Frames, bool InParts) : Op(Gen, At);
    private sealed record DiscardOp(int Gen, long At) : Op(Gen, At);
    private sealed record EndOp(int Gen, long At) : Op(Gen, At);

    private byte[]? ring;
    private long written, drained;                  // bytes into the ring, and out of it to disk, since the start
    private int gen;
    private readonly List<Op> ops = [];
    private readonly AutoResetEvent wake = new(false);
    private Thread? disk;
    private bool dirty;                             // something new to say

    // A new generation (lock held): nothing the last left unwritten is written; the disk's thread started.
    private void Restart()
    {
        gen++;
        ops.Clear();
        written = drained = 0;
        if (disk != null) return;
        disk = new Thread(DiskLoop) { IsBackground = true, Name = "capture" };
        disk.Start();
    }

    private void Queue(Op op) => ops.Add(op);

    private void Wake() => wake.Set();

    // [bytes] into the ring (lock held): false where there isn't room, the disk behind.
    private bool Put(ReadOnlySpan<byte> bytes)
    {
        var r = ring;
        if (r == null || written + bytes.Length - drained > r.Length) return false;
        int at = (int)(written % r.Length);
        int first = Math.Min(bytes.Length, r.Length - at);
        bytes[..first].CopyTo(r.AsSpan(at));
        if (first < bytes.Length) bytes[first..].CopyTo(r);
        written += bytes.Length;
        return true;
    }

    private void DiskLoop()
    {
        FileStream? file = null;
        string? path = null;
        int fileGen = 0;
        long said = 0;
        for (;;)
        {
            wake.WaitOne(250);
            for (;;)
            {
                byte[]? r;
                long from, to;
                Op? op;
                int g;
                lock (gate)
                {
                    g = gen; r = ring; from = drained;
                    op = ops.Count > 0 ? ops[0] : null;
                    to = op?.At ?? written;
                }
                // A generation let go: its part unfinished, gone.
                if (file != null && fileGen != g) Discard(ref file, path);
                try
                {
                    if (to > from)
                    {
                        int n = (int)Math.Min(to - from, 1 << 20);
                        if (file != null && r != null) WriteRing(file, r, from, n);
                        lock (gate) if (gen == g) drained = from + n;
                        continue;
                    }
                    if (op == null) break;
                    switch (op)
                    {
                        case OpenOp o:
                            Discard(ref file, path);
                            file = new FileStream(o.Path, FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
                            file.Write(o.Header);
                            (path, fileGen) = (o.Path, o.Gen);
                            break;
                        case CloseOp c:
                            Closed(c, file);
                            file = null; path = null;
                            break;
                        case DiscardOp:
                            Discard(ref file, path);
                            break;
                        case EndOp:
                            lock (gate) if (gen == op.Gen && state == "finishing") { state = "done"; dirty = true; }
                            break;
                    }
                    lock (gate) if (gen == g && ops.Count > 0 && ops[0] == op) ops.RemoveAt(0);
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                    Discard(ref file, path);
                    lock (gate) if (gen == g) Fail("couldn't write the recording: " + e.Message);
                }
            }
            Say(ref said);
        }
    }

    // Part [c] finished: its header's lengths, its name, its sidecar; then it is said to be done.
    private void Closed(CloseOp c, FileStream? file)
    {
        if (file == null) return;
        file.Seek(0, SeekOrigin.Begin);
        file.Write(c.Header);
        file.Dispose();
        File.Move(c.Part, c.Wav, true);
        File.WriteAllText(c.Wav + ".json", c.Sidecar);
        lock (gate)
        {
            if (gen != c.Gen) return;
            if (c.InParts) waiting[c.N] = c.Frames;
            if (state == "finishing" && c.Reason != "part") state = "done";
            dirty = true;
        }
        log($"capture: part {c.N} done, {c.Frames} frames ({c.Reason})");
    }

    private static void Discard(ref FileStream? file, string? path)
    {
        if (file == null) return;
        try { file.Dispose(); } catch (IOException) { /* gone with it */ }
        file = null;
        if (path != null) TryDelete(path);
    }

    // [n] bytes of the ring from stream position [from] onto [file].
    private static void WriteRing(FileStream file, byte[] r, long from, int n)
    {
        int at = (int)(from % r.Length);
        int first = Math.Min(n, r.Length - at);
        file.Write(r, at, first);
        if (first < n) file.Write(r, 0, n - first);
    }

    // Where it is, said where it changed, and each second it records; the ring let go once nothing is left to write.
    private void Say(ref long said)
    {
        JsonObject? s = null;
        lock (gate)
        {
            var now = Environment.TickCount64;
            if (dirty || state == "recording" && now - said >= 1000)
            {
                dirty = false; said = now;
                s = StatusLocked();
            }
            if (!Busy && ops.Count == 0 && written == drained) ring = null;
        }
        if (s == null) return;
        s["ev"] = "capture";
        emit(s.ToJsonString());
    }
}
