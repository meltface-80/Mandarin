// DsdRun.cs — PCM made DSD as one stream however many files it is written to (bug list item 262).
//
// The upsampler (StreamUpsample.cs) and each channel's chain (DsdChain.cs) are made once and fed one track after
// another, so that the modulators run on from one track into the next as they would through one long track: two
// modulators started apart make different noise, and where one file of theirs gives way to the other the switch is
// a click. Each file is a window of the stream's bits: the first starts [Skip] frames in (what was fed only to start
// the filters and the modulators from the track before), each after it where the one before ends; bits made past the
// last window wait for the next. A window's DSF header is written when it is added, and it is closed, and said done,
// once both channels have filled it.
namespace Mandarin.Server.Upsample;

internal sealed class DsdRun
{
    /* A file of the run: its bytes a channel, those written, and when both are. */
    public sealed class Window(string path, long bytes, int rate, long at = -1)
    {
        public readonly string Path = path;
        public readonly long Bytes = bytes;
        public readonly long[] Written = new long[2];
        public readonly TaskCompletionSource Done = new(TaskCreationOptions.RunContinuationsAsynchronously);
        internal FileStream? File;
        internal DsfWriter? Writer;
        internal void Open()
        {
            // Restarted at a block part way into the file (item 272): written from there on, its header already there.
            File = new FileStream(Path, at >= 0 ? FileMode.OpenOrCreate : FileMode.Create, FileAccess.Write, FileShare.Read, 1 << 16);
            if (at >= 0) File.Position = at;
            Writer = new DsfWriter(File, rate, Bytes * 8, header: at < 0);
        }
        internal void Close()
        {
            Writer?.Dispose();
            File?.Dispose();
            Done.TrySetResult();
        }
    }

    private readonly int factor, dsdRate;
    private readonly long per;                       // bits a channel for each input frame
    private readonly StreamUpsample up;
    private readonly DsdChain l, r;
    private readonly System.Collections.Concurrent.BlockingCollection<(double[], double[])> toChains = new(boundedCapacity: 2);
    private readonly Task doubling;
    private readonly List<double[]> doubledL = [], doubledR = [];
    private readonly System.Collections.Concurrent.BlockingCollection<(double[], double[])> toModulators = new(boundedCapacity: 4);
    private readonly Task modulating;
    private readonly object gate = new();
    private readonly List<Window> windows = [];
    private readonly int[] at = new int[2];          // each channel's window being filled
    private readonly List<byte>[] waiting = [[], []];   // bits past the last window
    private readonly long[] skip = new long[2];
    private long pushed;

    public double Peak { get; private set; }
    public long Held { get; private set; }
    public long Resets => l.Modulator.Resets + r.Modulator.Resets;

    /* A run upsampling by [factor] in [kind] and making DSD at [dsdRate] by the modulator [mod] (DsdOut.cs; null: the seventh order). */
    public DsdRun(int factor, Shape.Kind kind, int dsdRate, string? mod = null)
    {
        this.factor = factor;
        this.dsdRate = dsdRate;
        per = (long)factor * (dsdRate / DsdChain.InRateFor(dsdRate));
        var ntf = DsdOut.Ntf(dsdRate, mod);
        // The chains' doubled samples, paired and made bits by both channels' modulators at once on a thread of their own (item 319).
        l = new DsdChain(dsdRate, ntf, x => doubledL.Add(x));
        r = new DsdChain(dsdRate, ntf, x => doubledR.Add(x));
        modulating = Task.Factory.StartNew(() =>
        {
            foreach (var (x, y) in toModulators.GetConsumingEnumerable())
            {
                byte[] bl = new byte[x.Length / 8], br = new byte[y.Length / 8];
                DsdModulator.RunPair(l.Modulator, r.Modulator, x, y, bl, br);
                lock (gate) { Bits(0, bl); Bits(1, br); }
            }
        }, TaskCreationOptions.LongRunning);
        up = new StreamUpsample(factor, kind, (a, b, n) =>
        {
            for (var i = 0; i < n; i++)
            {
                Peak = Math.Max(Peak, Math.Max(Math.Abs(a[i]), Math.Abs(b[i])));
                if (Math.Abs(a[i]) > UpsampleCommand.Most) { a[i] = Math.CopySign(UpsampleCommand.Most, a[i]); Held++; }
                if (Math.Abs(b[i]) > UpsampleCommand.Most) { b[i] = Math.CopySign(UpsampleCommand.Most, b[i]); Held++; }
            }
            toChains.Add((a.AsSpan(0, n).ToArray(), b.AsSpan(0, n).ToArray()));
        });
        // The doublings on a thread of their own, fed through a short queue: the upsampling of the next block goes on meanwhile.
        doubling = Task.Factory.StartNew(() =>
        {
            foreach (var (x, y) in toChains.GetConsumingEnumerable())
            {
                Parallel.Invoke(() => l.Push(x), () => r.Push(y));
                Pair();
                // What is made is in the file at once, for the device reading it as it grows.
                lock (gate) foreach (var w in windows) if (!w.Done.Task.IsCompleted) w.File?.Flush();
            }
        }, TaskCreationOptions.LongRunning);
    }

    /* The bits of the first [frames] input frames not kept: what starts the filters and the modulators. */
    public void Skip(long frames) { lock (gate) skip[0] = skip[1] = frames * per / 8; }

    /* The next file, [frames] input frames long, at [path]: its header written now, its bits from where the last ends; or from byte [at] of it, a making restarted there. */
    public Window Add(string path, long frames, long at = -1)
    {
        var w = new Window(path, frames * per / 8, dsdRate, at);
        lock (gate)
        {
            w.Open();
            windows.Add(w);
            if (w.Bytes == 0) w.Close();
            for (var c = 0; c < 2; c++)
            {
                var held = waiting[c].ToArray();
                waiting[c].Clear();
                if (held.Length > 0) Bits(c, held);
            }
        }
        return w;
    }

    /* The next frames into the run. */
    public void Push(ReadOnlySpan<double> left, ReadOnlySpan<double> right)
    {
        up.Push(left, right);
        pushed += left.Length;
    }

    /* The end of the run: the filters and the chains flushed with silence, and every window closed. */
    public void Finish()
    {
        up.Finish();
        toChains.CompleteAdding();
        doubling.Wait();
        var frames = pushed * factor;
        Parallel.Invoke(() => l.Finish(frames), () => r.Finish(frames));
        Pair();
        toModulators.CompleteAdding();
        modulating.Wait();
        lock (gate)
            foreach (var w in windows) if (!w.Done.Task.IsCompleted) w.Close();
    }

    // What the two chains have doubled, a run each of the same length, on to the modulators.
    private void Pair()
    {
        if (doubledL.Count != doubledR.Count) throw new InvalidOperationException("the channels' doublings are out of step");
        for (var i = 0; i < doubledL.Count; i++) toModulators.Add((doubledL[i], doubledR[i]));
        doubledL.Clear(); doubledR.Clear();
    }

    // Channel [c]'s next bytes: dropped while skipped, then into its window, then waiting for the next.
    private void Bits(int c, ReadOnlySpan<byte> x)
    {
        if (skip[c] > 0)
        {
            var n = (int)Math.Min(skip[c], x.Length);
            skip[c] -= n;
            x = x[n..];
        }
        while (x.Length > 0)
        {
            if (at[c] >= windows.Count) { waiting[c].AddRange(x.ToArray()); return; }
            var w = windows[at[c]];
            var take = (int)Math.Min(w.Bytes - w.Written[c], x.Length);
            if (take > 0) { w.Writer!.Write(c, x[..take]); w.Written[c] += take; x = x[take..]; }
            if (w.Written[c] >= w.Bytes)
            {
                at[c]++;
                if (w.Written[1 - c] >= w.Bytes && !w.Done.Task.IsCompleted) w.Close();
            }
        }
    }
}
