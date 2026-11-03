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
namespace Mandarin.Server.Upsample;

internal sealed class DsdChain
{
    /* What full-scale PCM is in the modulation: SACD's 50%. */
    public const double Level = 0.5;

    /* The rate the chain starts from. */
    public const int InRate = 705600;

    private const int Half = 16;   // each doubling's delay, in its output samples; its filter has 2 * Half + 1 taps

    private static readonly double[] Even, Odd;
    private readonly double[][] hist;   // each doubling's last inputs, newest last
    private readonly DsdModulator mod;
    private readonly int stages;
    private long skip;                  // output samples still to drop: the doublings' delay
    private readonly List<double> pending = [];

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
        Even = [.. Enumerable.Range(0, Half + 1).Select(i => h[2 * i])];
        Odd = [.. Enumerable.Range(0, Half).Select(i => h[2 * i + 1])];
    }

    /* A chain to [dsdRate] (2822400, 5644800 or 11289600), the modulator shaped by [ntf]. */
    public DsdChain(int dsdRate, DsdNtf ntf)
    {
        stages = dsdRate switch { 2822400 => 2, 5644800 => 3, 11289600 => 4, _ => throw new ArgumentOutOfRangeException(nameof(dsdRate)) };
        hist = [.. Enumerable.Range(0, stages).Select(_ => new double[Half + 1])];
        mod = new DsdModulator(ntf);
        skip = Half * ((1L << stages) - 1);
    }

    public int Factor => 1 << stages;
    public DsdModulator Modulator => mod;

    /* [x] (705.6 kHz, ±1 full scale) through the chain; whole bytes of bits handed to [bits] as they are made. */
    public void Push(ReadOnlySpan<double> x, Action<ReadOnlySpan<byte>> bits)
    {
        Through(x);
        Emit(pending.Count / 8 * 8, bits);
    }

    /*
     * The doublings' delay flushed out with silence, and the track's last bits made: [frames] at 705.6 kHz in all,
     * [frames] times the factor bits; a last part-byte is filled out by the modulator running on into silence.
     */
    public void Finish(long frames, Action<ReadOnlySpan<byte>> bits)
    {
        Through(new double[Half + 1]);
        var left = frames * Factor - Emitted;
        if (left <= 0) { pending.Clear(); return; }
        var take = (int)Math.Min(left, pending.Count);
        pending.RemoveRange(take, pending.Count - take);
        while (pending.Count % 8 != 0) pending.Add(0);
        Emit(pending.Count, bits);
        Emitted = frames * Factor;
    }

    /* The bits made so far, in samples. */
    public long Emitted { get; private set; }

    // [x] scaled to SACD's level and doubled to the DSD rate, the doublings' delay dropped, onto what waits.
    private void Through(ReadOnlySpan<double> x)
    {
        var cur = new double[x.Length];
        for (var i = 0; i < x.Length; i++) cur[i] = x[i] * Level;
        for (var s = 0; s < stages; s++) cur = Double(cur, hist[s]);
        var from = 0;
        if (skip > 0) { from = (int)Math.Min(skip, cur.Length); skip -= from; }
        pending.AddRange(cur.AsSpan(from).ToArray());
    }

    // The first [count] samples waiting (a multiple of 8) made bits.
    private void Emit(int count, Action<ReadOnlySpan<byte>> bits)
    {
        if (count == 0) return;
        var x = new double[count];
        pending.CopyTo(0, x, 0, count);
        pending.RemoveRange(0, count);
        var b = new byte[count / 8];
        mod.Run(x, b);
        Emitted += count;
        bits(b);
    }

    // [x] doubled: y[2m] from the even taps over x[m - i], y[2m + 1] from the odd ones; [h] the last inputs before x.
    private static double[] Double(double[] x, double[] h)
    {
        var all = new double[h.Length + x.Length];
        Array.Copy(h, all, h.Length);
        Array.Copy(x, 0, all, h.Length, x.Length);
        var y = new double[2 * x.Length];
        for (var m = 0; m < x.Length; m++)
        {
            var at = h.Length + m;      // x[m] in all
            double e = 0, o = 0;
            for (var i = 0; i <= Half; i++) e += Even[i] * all[at - i];
            for (var i = 0; i < Half; i++) o += Odd[i] * all[at - i];
            y[2 * m] = e; y[2 * m + 1] = o;
        }
        Array.Copy(all, all.Length - h.Length, h, 0, h.Length);
        return y;
    }

    private static double I0(double x)
    {
        double sum = 1, t = 1;
        for (var k = 1; k < 200; k++) { t *= x / (2 * k); t *= x / (2 * k); sum += t; if (t < sum * 1e-18) break; }
        return sum;
    }
}
