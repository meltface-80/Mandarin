// StreamUpsample.cs — PCM upsampled a block at a time (bug list item 259), as it plays.
//
// Upsampled whole (item 237), a track had nothing to give until the end of it had been read; here the filter is a
// fixed one, [TapsIn] of the input's samples long (46 ms at 44.1 kHz), run by overlap-save: each block of the input,
// with the filter's length of the block before it, is taken to the frequency domain at its own rate, its spectrum laid
// [factor] times over onto the output's grid (what putting zeros between its samples does), multiplied by the
// filter's, and brought back; the outputs the block before can't reach are kept. The two channels go together, the
// left the real part and the right the imaginary: the filter is real, so neither leaks into the other.
//
// The filter's shapes (Shape.cs; the three Gaussian ones are Gaussian.cs's, item 298). Standard: flat to [Shape.StandardPass] of the input's Nyquist frequency, down
// along a raised cosine to nothing at it, its phase linear: ringing either side of a transient. Gentle: the same from
// [Shape.GentlePass], twice as wide a slope, the ringing half as long. Minimum phase: Standard's levels with the one
// phase that puts all the ringing after a transient (by the cepstrum). Each is the ideal response's impulse under a
// Kaiser window (β 12: some 120 dB down beyond the band), worked out once for each factor and kept.
//
// Long and very long (item 317): Standard's design, 16384 and 65536 of the input's samples long, rolling off from
// 0.99 and 0.995 of its Nyquist frequency under a Kaiser window of β 18: flat to 21.8 and 21.9 kHz for a CD, 270 and
// 284 dB down from 22.1 kHz. Their blocks are as much longer, so they run no slower; their filters take longer to
// make at a track's start (0.15 and 0.6 s at ×16) and more memory while it plays.
//
// The linear filters delay the signal by half their length; that much is dropped from the start and made up at the
// end with silence, so the output is exactly [factor] times the input's length and in time with it. The minimum-phase
// filter has no such delay to take off.
using System.Collections.Concurrent;

namespace Mandarin.Server.Upsample;

internal sealed class StreamUpsample
{
    /* The filter's length in the input's samples. */
    public const int TapsIn = 2048;

    /* The filter of [kind]'s length in the input's samples: the long ones' their own (item 317), the rest [TapsIn]. */
    public static int TapsFor(Shape.Kind kind) => kind switch { Shape.Kind.Long => 8 * TapsIn, Shape.Kind.VeryLong => 32 * TapsIn, _ => TapsIn };

    // The long ones' roll-off (item 317): from 0.99 and 0.995 of the source's Nyquist frequency, under a Kaiser window of β 18.
    private const double LongPass = 0.99, VeryLongPass = 0.995, LongBeta = 18;

    private const double KaiserBeta = 12;

    private sealed record Filter(double[] Re, double[] Im, int[] Map, int Delay, int NIn, int NOut);

    private static readonly ConcurrentDictionary<(int Factor, Shape.Kind Kind), Filter> Filters = new();

    private readonly int factor;
    private readonly Filter f;
    private readonly Fft fin, fout;
    private readonly int keep, fresh;            // input frames carried from the block before, and new ones a block
    private readonly double[] left, right;       // the input window: [keep] old frames, then up to [fresh] new
    private readonly double[] xre, xim, yre, yim;
    private readonly double[] outL, outR;
    private int filled;
    private int done;                            // the current block's outputs handed on already (by a Drain)
    private long frames, emitted, drop;
    private readonly Action<double[], double[], int> output;

    /* An upsampler by [factor] (a power of two, 2 to 16) in [kind], its output handed to [output] (left, right, count). */
    public StreamUpsample(int factor, Shape.Kind kind, Action<double[], double[], int> output)
    {
        if (factor < 2 || factor > 16 || (factor & (factor - 1)) != 0) throw new ArgumentException("the factor must be 2, 4, 8 or 16");
        this.factor = factor;
        this.output = output;
        f = Filters.GetOrAdd((factor, kind), k => Design(k.Factor, k.Kind));
        fin = new Fft(Log2(f.NIn));
        fout = new Fft(Log2(f.NOut));
        keep = TapsFor(kind);
        fresh = f.NIn - keep;
        left = new double[f.NIn]; right = new double[f.NIn];
        xre = new double[f.NIn]; xim = new double[f.NIn];
        yre = new double[f.NOut]; yim = new double[f.NOut];
        outL = new double[fresh * factor]; outR = new double[fresh * factor];
        drop = f.Delay;
    }

    /* The input frames taken so far. */
    public long Frames => frames;

    /* The next frames, left and right alike in length. */
    public void Push(ReadOnlySpan<double> l, ReadOnlySpan<double> r)
    {
        while (l.Length > 0)
        {
            var n = Math.Min(l.Length, fresh - filled);
            l[..n].CopyTo(left.AsSpan(keep + filled));
            r[..n].CopyTo(right.AsSpan(keep + filled));
            filled += n; frames += n;
            l = l[n..]; r = r[n..];
            if (filled == fresh) Block();
        }
    }

    /* The end: silence through the filter until every output of the [Frames] taken is out, no more. */
    public void Finish()
    {
        var want = frames * factor;
        var zeros = new double[fresh];
        while (emitted < want)
        {
            var n = fresh - filled;
            zeros.AsSpan(0, n).CopyTo(left.AsSpan(keep + filled));
            zeros.AsSpan(0, n).CopyTo(right.AsSpan(keep + filled));
            filled = fresh;
            Block(want);
        }
    }

    // One block through the filter; its outputs handed on (no more than [limit] in all).
    private void Block(long limit = long.MaxValue, bool partial = false)
    {
        left.CopyTo(xre, 0);
        right.CopyTo(xim, 0);
        fin.Forward(xre, xim);
        // The input's spectrum laid over the output's grid ([Map]: each output bin's input bin), times the filter's.
        var map = f.Map;
        for (var j = 0; j < yre.Length; j++)
        {
            var s = map[j];
            double a = xre[s], b = xim[s], c = f.Re[j], d = f.Im[j];
            yre[j] = a * c - b * d;
            yim[j] = a * d + b * c;
        }
        fout.Inverse(yre, yim);
        // The outputs of the new frames: those after the block before's, and after those a Drain handed on already.
        // Each is worked out from its input and those before it, so those of the frames in are exact however few are.
        var from = keep * factor;
        var upTo = (partial ? filled : fresh) * factor;
        if (upTo > done)
        {
            var count = upTo - done;
            var skip = (int)Math.Min(drop, count);
            drop -= skip;
            var n = (int)Math.Min(count - skip, limit - emitted);
            if (n > 0)
            {
                Array.Copy(yre, from + done + skip, outL, 0, n);
                Array.Copy(yim, from + done + skip, outR, 0, n);
                emitted += n;
                output(outL, outR, n);
            }
            done = upTo;
        }
        if (partial) return;
        // The last [keep] frames go to the front for the next block.
        Array.Copy(left, fresh, left, 0, keep);
        Array.Copy(right, fresh, right, 0, keep);
        filled = 0;
        done = 0;
    }

    /*
     * The outputs of the frames taken so far handed on now, the block not yet full (item 317): a making that goes on
     * into the next track can finish its own file with no more of the next than the filter's half, however long the
     * filter's blocks. The block is worked out with silence where its frames are still to come, and again once they are.
     */
    public void Drain()
    {
        if (filled == 0 || done >= filled * factor) return;
        Array.Clear(left, keep + filled, fresh - filled);
        Array.Clear(right, keep + filled, fresh - filled);
        Block(partial: true);
    }

    private static int Log2(int n) => System.Numerics.BitOperations.Log2((uint)n);

    /* The filter of [factor] in [kind], ready for the blocks: its spectrum on the output's grid, in the transform's order. */
    private static Filter Design(int factor, Shape.Kind kind)
    {
        var taps = Taps(factor, kind);
        var length = taps.Length;
        var nOut = 1 << (Log2(2 * length - 1) + 1);
        var nIn = nOut / factor;
        var fo = new Fft(Log2(nOut));
        var fi = new Fft(Log2(nIn));
        var re = new double[nOut];
        var im = new double[nOut];
        Array.Copy(taps, re, length);
        fo.Forward(re, im);
        // Output bin k (its place j in the transform's order) takes input bin k mod nIn (its place in the input's).
        var map = new int[nOut];
        for (var k = 0; k < nOut; k++) map[fo.BitReverse(k)] = (int)fi.BitReverse(k % nIn);
        return new Filter(re, im, map, kind == Shape.Kind.Minimum ? 0 : (length - 1) / 2, nIn, nOut);
    }

    /* The filter's taps at the output's rate: [TapsIn] × [factor] + 1, their sum [factor] (a doubling's zeros put back). */
    public static double[] Taps(int factor, Shape.Kind kind)
    {
        var length = TapsFor(kind) * factor + 1;
        // The Gaussian filters (item 298): their own design, as long as the rest.
        if (kind is Shape.Kind.Gaussian or Shape.Kind.GaussianSteep or Shape.Kind.GaussianHires) return Gaussian.Taps(factor, kind, length);
        var half = (length - 1) / 2;
        var pass = kind switch { Shape.Kind.Gentle => Shape.GentlePass, Shape.Kind.Long => LongPass, Shape.Kind.VeryLong => VeryLongPass, _ => Shape.StandardPass };
        var beta = kind is Shape.Kind.Long or Shape.Kind.VeryLong ? LongBeta : KaiserBeta;
        // In cycles a sample at the output's rate: the input's Nyquist frequency, the roll-off's middle and half-width.
        var nyq = 0.5 / factor;
        var c = (1 + pass) / 2 * nyq;
        var w = (1 - pass) / 2 * nyq;
        var h = new double[length];
        for (var n = 0; n < length; n++)
        {
            double t = n - half;
            var x = 2 * c * t;
            var sinc = t == 0 ? 1 : Math.Sin(Math.PI * x) / (Math.PI * x);
            var q = 4 * w * t;
            var rc = Math.Abs(1 - q * q) < 1e-12 ? Math.PI / 4 : Math.Cos(2 * Math.PI * w * t) / (1 - q * q);
            var r = t / half;
            h[n] = 2 * c * sinc * rc * I0(beta * Math.Sqrt(Math.Max(0, 1 - r * r))) / I0(beta);
        }
        if (kind == Shape.Kind.Minimum) h = MinimumPhase(h);
        var sum = h.Sum();
        for (var n = 0; n < length; n++) h[n] *= factor / sum;
        return h;
    }

    // [h]'s levels with the minimum phase (by the cepstrum, on a grid eight times its length), as long as [h], the
    // last eighth faded out so that nothing is cut off sharp.
    private static double[] MinimumPhase(double[] h)
    {
        var bits = Log2(8 * h.Length - 1) + 1;
        var ft = new Fft(bits);
        var n = (int)ft.Length;
        var re = new double[n];
        var im = new double[n];
        Array.Copy(h, re, h.Length);
        ft.Forward(re, im);
        // The logarithm of the levels, held off nothing at 200 dB down (in the transform's order: the inverse takes it).
        for (var j = 0; j < n; j++) { re[j] = Math.Log(Math.Max(Math.Sqrt(re[j] * re[j] + im[j] * im[j]), 1e-10)); im[j] = 0; }
        ft.Inverse(re, im);
        // The cepstrum folded: the causal half doubled, the rest nothing.
        for (var i = 0; i < n; i++)
        {
            if (i > n / 2) re[i] = 0;
            else if (i > 0 && i < n / 2) re[i] *= 2;
            im[i] = 0;
        }
        ft.Forward(re, im);
        for (var j = 0; j < n; j++)
        {
            var mag = Math.Exp(re[j]);
            var (s, c) = Math.SinCos(im[j]);
            re[j] = mag * c;
            im[j] = mag * s;
        }
        ft.Inverse(re, im);
        var o = new double[h.Length];
        var fade = h.Length / 8;
        for (var i = 0; i < o.Length; i++)
        {
            var g = i < o.Length - fade ? 1 : 0.5 + 0.5 * Math.Cos(Math.PI * (i - (o.Length - fade)) / fade);
            o[i] = re[i] * g;
        }
        return o;
    }

    // The modified Bessel function of the first kind, order 0 (the Kaiser window's).
    private static double I0(double x)
    {
        double sum = 1, term = 1;
        for (var k = 1; k < 50; k++)
        {
            term *= x / (2 * k) * (x / (2 * k));
            sum += term;
            if (term < sum * 1e-17) break;
        }
        return sum;
    }
}
