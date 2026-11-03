// WholeTrack.cs — a track upsampled in one transform (bug list item 237): the filter as long as the track itself.
//
// A resampler's filter is usually some thousands of taps; here the whole track is taken to the frequency domain in
// one FFT (Fft.cs), its spectrum laid into one [factor] times the size with nothing above the original Nyquist
// frequency, and brought back: the same as a linear-phase filter as long as the track, and no image above the
// original's band but the arithmetic's own, some 300 dB down. The two channels go together, the left the real part
// and the right the imaginary: the filter is real and even, so neither leaks into the other.
//
// The filter passes everything up to [PassFraction] of the original Nyquist frequency untouched and falls to nothing
// at it along a raised cosine, whose ringing dies away within a fraction of a second. Silence is laid on both sides
// ([GuardSeconds]) so the end of the track doesn't ring into its start.
//
// A track too long for [MaxOutPoints] (2^28 points is 4 GB: 6 minutes at 705.6 kHz) is done in sections that long,
// overlapping by the guard on each side, each one's middle kept: the error at the joins is the ringing left after the
// guard, far below the 32-bit samples it goes out as. It is then done twice: once to learn the peak, once to write.
//
// Above full scale anywhere (an upsampled track's peaks fall between the original's samples): the whole track scaled
// down to −0.1 dBFS, one gain for all of it, so nothing is clipped and nothing else changes.
//
// Three shapes (item 248). Linear, the above: no phase shift, its ringing either side of a transient. Minimum: the
// same response in level, its phase made minimum (WholeShape.cs), so that all the ringing comes after a transient and
// none before. Gentle: linear, the roll-off begun at 90% of the Nyquist frequency rather than 95%, twice as wide, so
// the ringing is half as long, at the cost of a little of the top of the band. The two channels still go together: a
// minimum-phase filter is no longer even, but it is still real, which is all the pairing needs.
namespace Mandarin.Server.Upsample;

internal static class WholeTrack
{
    /* How it is done: the factor (a power of two), the filter, the guard, the most points a transform may have, its shape. */
    public sealed record Options(int Factor, double PassFraction = 0.95, double GuardSeconds = 4, int MaxOutBits = 28, WholeShape.Kind Shape = WholeShape.Kind.Linear)
    {
        /* The options for [factor] in [shape] (a plan's "shape": "min", "gentle", or none), [maxOutBits] the most points. */
        public static Options For(int factor, string? shape, int maxOutBits) => WholeShape.Of(shape) switch
        {
            WholeShape.Kind.Gentle => new(factor, WholeShape.GentlePass, MaxOutBits: maxOutBits, Shape: WholeShape.Kind.Gentle),
            var k => new(factor, MaxOutBits: maxOutBits, Shape: k),
        };
    }

    /* What was done: frames written, sections, the peak before any gain, the gain. */
    public sealed record Result(long Frames, int Sections, double Peak, double Gain);

    /* −0.1 dBFS: the most any sample may be. */
    public static readonly double Ceiling = Math.Pow(10, -0.1 / 20);

    /*
     * [left] and [right] at [rate] upsampled by [o].Factor; [write] given each run of finished frames in order, the
     * left in the first array and the right in the second, from the offset for the count, and the gain to put on them.
     */
    public static Result Run(double[] left, double[] right, int rate, Options o, Action<double[], double[], long, long, double> write)
    {
        if (o.Factor < 2 || (o.Factor & (o.Factor - 1)) != 0) throw new ArgumentException("the factor must be a power of two, 2 or more");
        if (left.LongLength != right.LongLength) throw new ArgumentException("the channels must be as long as each other");
        long frames = left.LongLength;
        if (frames == 0) return new Result(0, 0, 0, 1);
        var factorBits = System.Numerics.BitOperations.Log2((uint)o.Factor);
        var guard = Math.Max(1024L, (long)(o.GuardSeconds * rate));
        // The section: the whole track and its guards where that fits, else the most that does.
        var inBits = Math.Max(2, (int)Math.Ceiling(Math.Log2(frames + 2 * guard)));
        inBits = Math.Min(inBits, o.MaxOutBits - factorBits);
        var nIn = 1L << inBits;
        var kept = nIn - 2 * guard;                       // each section's middle, the part written
        if (kept <= 0) throw new ArgumentException("too little room for the guard: allow more points");
        var sections = (int)((frames + kept - 1) / kept);

        var fIn = new Fft(inBits);
        var fOut = new Fft(inBits + factorBits);
        var nOut = fOut.Length;
        double[] inRe = new double[nIn], inIm = new double[nIn], outRe = new double[nOut], outIm = new double[nOut];
        var h = Response(nIn, rate, o.PassFraction, o.Factor);
        // Minimum phase: the same levels, a phase of their own, worked out on the output's arrays before they are used.
        var hIm = o.Shape == WholeShape.Kind.Minimum ? WholeShape.Minimum(h, nIn, fOut, outRe, outIm) : null;

        // One section done: its middle's output in outRe/outIm from guard·factor, for its length.
        (long From, long Count) Section(int s)
        {
            var start = (long)s * kept;
            var count = Math.Min(kept, frames - start);
            Array.Clear(inRe); Array.Clear(inIm);
            // Its input with the guard either side, silence where the track isn't.
            var from = start - guard;
            for (long i = 0; i < nIn; i++)
            {
                var at = from + i;
                if (at < 0 || at >= frames) continue;
                inRe[i] = left[at]; inIm[i] = right[at];
            }
            fIn.Forward(inRe, inIm);
            Array.Clear(outRe); Array.Clear(outIm);
            // Each bin to its place in the larger spectrum, the negative frequencies at the top, the filter on it.
            var halfIn = nIn / 2;
            Parallel.For(0, nIn, Fft.Options, k =>
            {
                if (k == halfIn) return;                  // the Nyquist bin: the filter is nothing there
                var g = h[k < halfIn ? k : nIn - k];
                // A real filter: the negative frequencies the positive's conjugate.
                var gi = hIm == null ? 0 : k < halfIn ? hIm[k] : -hIm[nIn - k];
                if (g == 0 && gi == 0) return;
                var f = k < halfIn ? k : k - nIn;
                var src = fIn.BitReverse(k);
                var dst = fOut.BitReverse(f >= 0 ? f : nOut + f);
                double xr = inRe[src], xi = inIm[src];
                outRe[dst] = xr * g - xi * gi; outIm[dst] = xr * gi + xi * g;
            });
            fOut.Inverse(outRe, outIm);
            return (guard * o.Factor, count * o.Factor);
        }

        static double PeakOf(double[] re, double[] im, long from, long count)
        {
            double peak = 0;
            object gate = new();
            Parallel.For(0, (count + 65535) / 65536, Fft.Options, c =>
            {
                double p = 0;
                var a = from + c * 65536; var b = Math.Min(from + count, a + 65536);
                for (var i = a; i < b; i++) p = Math.Max(p, Math.Max(Math.Abs(re[i]), Math.Abs(im[i])));
                lock (gate) peak = Math.Max(peak, p);
            });
            return peak;
        }

        double peakAll = 0;
        if (sections == 1)
        {
            var (from, count) = Section(0);
            peakAll = PeakOf(outRe, outIm, from, count);
            var gain = peakAll > Ceiling ? Ceiling / peakAll : 1;
            write(outRe, outIm, from, count, gain);
            return new Result(count, 1, peakAll, gain);
        }
        for (var s = 0; s < sections; s++)
        {
            var (from, count) = Section(s);
            peakAll = Math.Max(peakAll, PeakOf(outRe, outIm, from, count));
        }
        var g2 = peakAll > Ceiling ? Ceiling / peakAll : 1;
        long written = 0;
        for (var s = 0; s < sections; s++)
        {
            var (from, count) = Section(s);
            write(outRe, outIm, from, count, g2);
            written += count;
        }
        return new Result(written, sections, peakAll, g2);
    }

    /*
     * The filter at each input bin 0..n/2, times [factor] (the inverse transform's 1/n is the larger n's): 1 up to
     * [pass] of the Nyquist frequency, a raised cosine down to 0 at it.
     */
    private static double[] Response(long n, int rate, double pass, int factor)
    {
        var half = n / 2;
        var h = new double[half + 1];
        var nyquist = rate / 2.0;
        var edge = pass * nyquist;
        for (long k = 0; k <= half; k++)
        {
            var hz = (double)k * rate / n;
            h[k] = factor * (hz <= edge ? 1 : hz >= nyquist ? 0 : 0.5 * (1 + Math.Cos(Math.PI * (hz - edge) / (nyquist - edge))));
        }
        return h;
    }
}
