// DsdChain.cs — one channel from 705.6 kHz PCM to DSD bits (bug list item 242).
//
// The whole-track upsampler (WholeTrack.cs) takes a track to 705.6 kHz, sixteen times a CD's rate, with nothing above
// the original band. From there to DSD64 (2.8224 MHz), DSD128 or DSD256 is two, three or four doublings, each a
// half-band filter: a Kaiser-windowed sinc of 33 taps, flat to far above the audio band and keeping the images of the
// doubling 100 dB and more down, where the modulator's own noise is a hundred times louder. Each doubling delays the
// signal by 16 of its samples; the chain drops that delay at the start and flushes it at the end, so its output is
// exactly the input's length times the factor.
//
// Full-scale PCM is half the modulation, SACD's level ("0 dB SACD"): the headroom the loop needs to stay steady, and
// what a DSD-capable DAC expects to play at the same loudness as PCM.
//
// A half-band filter's even taps are nothing but its centre (sinc(n / 2) is zero at every even n but 0): so an even
// output is its input as it is, delayed, and only the odd outputs are filtered, by the odd taps, which are the same
// either side of the centre and so are added in pairs before they are multiplied (item 251: 8 multiplications for two
// outputs, where 33 were done; the doublings had been 60% of the making). Each doubling works in an array of its own,
// kept from one push to the next (its last inputs at the front, then the new ones), and what waits for the modulator
// likewise: nothing of megabytes is made anew, and nothing is cut from the front of a list. Given a [sink], the chain
// runs its modulator on a thread of its own, fed through a short queue, so that the doublings of the next samples and
// the modulation of these go on at once; the bits are the same, in the same order.
namespace Mandarin.Server.Upsample;

internal sealed class DsdChain
{
    /* What full-scale PCM is in the modulation: SACD's 50%. */
    public const double Level = 0.5;

    /* The rate the chain starts from. */
    public const int InRate = 705600;

    private const int Half = 16;   // each doubling's delay, in its output samples; its filter has 2 * Half + 1 taps

    private static readonly double[] Odd;   // the odd taps' first half: tap i and tap 2 * Half - 1 - i alike
    private const int H = Half + 1;     // the inputs a doubling keeps from the push before
    private readonly double[][] work;   // each doubling's inputs (its last H, then the new), and the last one's output after H
    private readonly DsdModulator mod;
    private readonly int stages;
    private long skip;                  // output samples still to drop: the doublings' delay
    private double[] pending = new double[1 << 16];   // made, not yet through the modulator
    private int waiting;                // how many of pending wait (fewer than 8 between pushes)
    private long queued;                // samples handed to the modulator
    private readonly System.Collections.Concurrent.BlockingCollection<double[]>? toModulator;
    private readonly Task? modulating;
    private readonly Action<ReadOnlySpan<byte>>? sink;

    static DsdChain()
    {
        // The half-band filter: sinc(n / 2) under a Kaiser window, gain 2 (a doubling's zeros put back); its even
        // taps (the centre and the zeros of the sinc but one) make the even outputs, its odd taps the odd ones.
        const double beta = 10;
        var h = new double[2 * Half + 1];
        for (var n = 0; n < h.Length; n++)
        {
            var t = n - Half;
            var sinc = t == 0 ? 1 : Math.Sin(Math.PI * t / 2) / (Math.PI * t / 2);
            var r = (double)t / Half;
            h[n] = sinc * I0(beta * Math.Sqrt(Math.Max(0, 1 - r * r))) / I0(beta);
        }
        // The even taps are the centre's 1 and nothing else, as a half-band filter's are (sin(πk) is not quite 0 in
        // doubles; it is 0). The odd taps are symmetric: the first half of them is all there is to keep.
        Odd = [.. Enumerable.Range(0, Half / 2).Select(i => h[2 * i + 1])];
    }

    /*
     * A chain to [dsdRate] (2822400, 5644800 or 11289600), the modulator shaped by [ntf]; given [sink], its modulator on
     * a thread of its own, the bits handed to [sink] there, in order (Push(x), Finish(frames)).
     */
    public DsdChain(int dsdRate, DsdNtf ntf, Action<ReadOnlySpan<byte>>? sink = null)
    {
        this.sink = sink;
        if (sink != null)
        {
            toModulator = new(boundedCapacity: 4);
            modulating = Task.Factory.StartNew(() => { foreach (var x in toModulator.GetConsumingEnumerable()) Modulate(x, sink); }, TaskCreationOptions.LongRunning);
        }
        stages = dsdRate switch { 2822400 => 2, 5644800 => 3, 11289600 => 4, _ => throw new ArgumentOutOfRangeException(nameof(dsdRate)) };
        work = [.. Enumerable.Range(0, stages + 1).Select(_ => new double[H + (1 << 16)])];
        mod = new DsdModulator(ntf);
        skip = Half * ((1L << stages) - 1);
    }

    public int Factor => 1 << stages;
    public DsdModulator Modulator => mod;

    /* [x] (705.6 kHz, ±1 full scale) through the chain; whole bytes of bits handed to [bits] as they are made. */
    public void Push(ReadOnlySpan<double> x, Action<ReadOnlySpan<byte>> bits)
    {
        Through(x);
        Hand(waiting / 8 * 8, bits);
    }

    /* [x] through the chain, its bits to the sink given at the start. */
    public void Push(ReadOnlySpan<double> x) => Push(x, sink ?? throw new InvalidOperationException("a chain without a sink is given its bits' destination at each push"));

    /* The end, as Finish(frames, bits), to the sink given at the start; once its modulator has made the last bits. */
    public void Finish(long frames) => Finish(frames, sink ?? throw new InvalidOperationException("a chain without a sink is given its bits' destination at the end"));

    /*
     * The doublings' delay flushed out with silence, and the track's last bits made: [frames] at 705.6 kHz in all,
     * [frames] times the factor bits; a last part-byte is filled out by the modulator running on into silence.
     */
    public void Finish(long frames, Action<ReadOnlySpan<byte>> bits)
    {
        Through(new double[Half + 1]);
        var left = frames * Factor - queued;
        if (left <= 0) { waiting = 0; Done(); Emitted = frames * Factor; return; }
        var take = (int)Math.Min(left, waiting);
        // Only what the track still owes, filled out with silence to a whole byte.
        var whole = (take + 7) / 8 * 8;
        Grow(ref pending, whole, waiting);
        Array.Clear(pending, take, whole - take);
        waiting = whole;
        Hand(waiting, bits);
        Done();
        Emitted = frames * Factor;
    }

    /* The bits made so far, in samples. */
    public long Emitted { get; private set; }

    /* The time spent in the doublings and in the modulator, in Stopwatch ticks (for the log and the tests, item 251). */
    public long DoublingTicks { get; private set; }
    public long ModulatorTicks { get; private set; }

    // [x] scaled to SACD's level and doubled to the DSD rate, the doublings' delay dropped, onto what waits.
    private void Through(ReadOnlySpan<double> x)
    {
        var t0 = System.Diagnostics.Stopwatch.GetTimestamp();
        Grow(ref work[0], H + x.Length, H);
        var w0 = work[0];
        for (var i = 0; i < x.Length; i++) w0[H + i] = x[i] * Level;
        for (var s = 0; s < stages; s++)
        {
            var len = x.Length << s;
            Grow(ref work[s + 1], H + 2 * len, H);
            Double(work[s], len, work[s + 1]);
            Array.Copy(work[s], len, work[s], 0, H);   // its last H inputs, for the next push
        }
        var outLen = x.Length << stages;
        var from = 0;
        if (skip > 0) { from = (int)Math.Min(skip, outLen); skip -= from; }
        Grow(ref pending, waiting + outLen - from, waiting);
        Array.Copy(work[stages], H + from, pending, waiting, outLen - from);
        waiting += outLen - from;
        DoublingTicks += System.Diagnostics.Stopwatch.GetTimestamp() - t0;
    }

    // The first [count] samples waiting (a multiple of 8) handed to the modulator: on its own thread where it has one.
    private void Hand(int count, Action<ReadOnlySpan<byte>> bits)
    {
        if (count == 0) return;
        var x = pending.AsSpan(0, count).ToArray();
        Array.Copy(pending, count, pending, 0, waiting - count);
        waiting -= count;
        queued += count;
        if (toModulator != null) toModulator.Add(x); else Modulate(x, bits);
    }

    // [x] made bits, handed to [bits].
    private void Modulate(double[] x, Action<ReadOnlySpan<byte>> bits)
    {
        var b = new byte[x.Length / 8];
        var t0 = System.Diagnostics.Stopwatch.GetTimestamp();
        mod.Run(x, b);
        ModulatorTicks += System.Diagnostics.Stopwatch.GetTimestamp() - t0;
        Emitted += x.Length;
        bits(b);
    }

    // The modulator's thread, where there is one, given the last and waited for.
    private void Done()
    {
        if (toModulator == null) return;
        toModulator.CompleteAdding();
        modulating!.GetAwaiter().GetResult();
    }

    /* [x] doubled once from silence, as a doubling does it (for the tests, item 251). */
    internal static double[] DoubleOnce(double[] x)
    {
        var all = new double[H + x.Length];
        Array.Copy(x, 0, all, H, x.Length);
        var y = new double[H + 2 * x.Length];
        Double(all, x.Length, y);
        return y[H..];
    }

    /* The doubling's filter in full: its 2 * Half + 1 taps as designed (for the tests). */
    internal static double[] Taps()
    {
        const double beta = 10;
        var h = new double[2 * Half + 1];
        for (var n = 0; n < h.Length; n++)
        {
            var t = n - Half;
            var sinc = t == 0 ? 1 : Math.Sin(Math.PI * t / 2) / (Math.PI * t / 2);
            var r = (double)t / Half;
            h[n] = sinc * I0(beta * Math.Sqrt(Math.Max(0, 1 - r * r))) / I0(beta);
        }
        return h;
    }

    // [a] at least [n] long, its first [keep] kept.
    private static void Grow(ref double[] a, int n, int keep)
    {
        if (a.Length >= n) return;
        var b = new double[Math.Max(n, a.Length * 2)];
        Array.Copy(a, b, keep);
        a = b;
    }

    // The [len] inputs of [all] (after its H last ones) doubled into [y] after H: y[2m] the centre's input, x[m - Half / 2];
    // y[2m + 1] the odd taps over x[m - i], paired either side of the centre.
    private static void Double(double[] all, int len, double[] y)
    {
        var odd = Odd;
        double c0 = odd[0], c1 = odd[1], c2 = odd[2], c3 = odd[3], c4 = odd[4], c5 = odd[5], c6 = odd[6], c7 = odd[7];
        for (var m = 0; m < len; m++)
        {
            var at = H + m;      // x[m] in all
            var o = c0 * (all[at] + all[at - 15]) + c1 * (all[at - 1] + all[at - 14]) + c2 * (all[at - 2] + all[at - 13]) + c3 * (all[at - 3] + all[at - 12])
                + c4 * (all[at - 4] + all[at - 11]) + c5 * (all[at - 5] + all[at - 10]) + c6 * (all[at - 6] + all[at - 9]) + c7 * (all[at - 7] + all[at - 8]);
            y[H + 2 * m] = all[at - Half / 2]; y[H + 2 * m + 1] = o;
        }
    }

    private static double I0(double x)
    {
        double sum = 1, t = 1;
        for (var k = 1; k < 200; k++) { t *= x / (2 * k); t *= x / (2 * k); sum += t; if (t < sum * 1e-18) break; }
        return sum;
    }
}
