// Fft.cs — the fast Fourier transform the upsampler runs on (bug list items 237, 259, StreamUpsample.cs).
//
// A power-of-two length, complex, in place, in 64-bit floats, on all the cores but none of the server's own work.
// Forward is decimation in frequency: the input in natural order, the spectrum left in bit-reversed order. Inverse is
// decimation in time: the spectrum taken in bit-reversed order, the signal left in natural order and scaled by 1/n.
// Between the two the caller moves bins about by their bit-reversed places (BitReverse), so neither transform ever
// reorders the whole array: at 2^28 points that is a minute saved and no second array of 4 GB.
//
// The twiddles, e^(-2πi m/n) for m below n/2, come from two tables of about √n each, the coarse step and the fine
// step multiplied together: at 2^29 points a few hundred kilobytes, not the four gigabytes a full table would take,
// and as exact (each entry is Math.SinCos's, the product one rounding more).
namespace Mandarin.Server.Upsample;

internal sealed class Fft
{
    private readonly int log2;
    private readonly long n;
    private readonly int fineBits;
    private readonly double[] fineRe, fineIm, coarseRe, coarseIm;

    /* A transform of 2^[log2] points (1 to 30). */
    public Fft(int log2)
    {
        if (log2 is < 1 or > 30) throw new ArgumentOutOfRangeException(nameof(log2));
        this.log2 = log2;
        n = 1L << log2;
        var half = n / 2;
        fineBits = Math.Max(1, (log2 - 1) / 2);
        var fine = 1L << fineBits;
        var coarse = Math.Max(1, half >> fineBits);
        fineRe = new double[fine]; fineIm = new double[fine];
        for (long j = 0; j < fine; j++) (fineIm[j], fineRe[j]) = Angle(j);
        coarseRe = new double[coarse]; coarseIm = new double[coarse];
        for (long j = 0; j < coarse; j++) (coarseIm[j], coarseRe[j]) = Angle(j << fineBits);
    }

    public long Length => n;

    // e^(-2πi m/n) as (sin, cos), sin negative: the forward transform's.
    private (double Sin, double Cos) Angle(long m)
    {
        var (s, c) = Math.SinCos(2 * Math.PI * m / n);
        return (-s, c);
    }

    /* The twiddle e^(-2πi m/n), m below n/2. */
    private (double Re, double Im) W(long m)
    {
        var f = m & ((1L << fineBits) - 1);
        var c = m >> fineBits;
        double ar = coarseRe[c], ai = coarseIm[c], br = fineRe[f], bi = fineIm[f];
        return (ar * br - ai * bi, ar * bi + ai * br);
    }

    /* Where bin [k] of the natural order sits in the bit-reversed order (and the other way round). */
    public long BitReverse(long k)
    {
        ulong x = (ulong)k;
        x = ((x >> 1) & 0x5555555555555555UL) | ((x & 0x5555555555555555UL) << 1);
        x = ((x >> 2) & 0x3333333333333333UL) | ((x & 0x3333333333333333UL) << 2);
        x = ((x >> 4) & 0x0F0F0F0F0F0F0F0FUL) | ((x & 0x0F0F0F0F0F0F0F0FUL) << 4);
        x = ((x >> 8) & 0x00FF00FF00FF00FFUL) | ((x & 0x00FF00FF00FF00FFUL) << 8);
        x = ((x >> 16) & 0x0000FFFF0000FFFFUL) | ((x & 0x0000FFFF0000FFFFUL) << 16);
        x = (x >> 32) | (x << 32);
        return (long)(x >> (64 - log2));
    }

    /* Forward, in place: [re]/[im] in natural order in, the spectrum in bit-reversed order out. */
    public void Forward(double[] re, double[] im)
    {
        Check(re, im);
        for (var len = n; len >= 2; len >>= 1) Stage(re, im, len, inverse: false);
    }

    /* Inverse, in place: the spectrum in bit-reversed order in, the signal in natural order out, scaled by 1/n. */
    public void Inverse(double[] re, double[] im)
    {
        Check(re, im);
        for (long len = 2; len <= n; len <<= 1) Stage(re, im, len, inverse: true);
        var scale = 1.0 / n;
        Parallel.For(0, Chunks(n), Options, c =>
        {
            var (from, to) = Range(c, n);
            for (var i = from; i < to; i++) { re[i] *= scale; im[i] *= scale; }
        });
    }

    private void Check(double[] re, double[] im)
    {
        if (re.LongLength != n || im.LongLength != n) throw new ArgumentException($"the arrays must be {n} long");
    }

    // One stage of butterflies over blocks of [len]: the n/2 of them shared out among the cores in runs.
    private void Stage(double[] re, double[] im, long len, bool inverse)
    {
        var half = len / 2;
        var mask = half - 1;
        var halfBits = System.Numerics.BitOperations.Log2((ulong)half);
        var step = n / len;                        // the twiddle's stride for this stage
        var count = n / 2;
        Parallel.For(0, Chunks(count), Options, c =>
        {
            var (from, to) = Range(c, count);
            for (var b = from; b < to; b++)
            {
                var j = b & mask;
                var i = ((b >> halfBits) << (halfBits + 1)) + j;
                var k = i + half;
                var (wr, wi) = W(j * step);
                if (inverse) wi = -wi;
                if (!inverse)
                {
                    // Decimation in frequency: (a + b, (a − b)·w).
                    double ar = re[i], ai = im[i], br = re[k], bi = im[k];
                    re[i] = ar + br; im[i] = ai + bi;
                    double dr = ar - br, di = ai - bi;
                    re[k] = dr * wr - di * wi; im[k] = dr * wi + di * wr;
                }
                else
                {
                    // Decimation in time: (a + b·w, a − b·w).
                    double br = re[k] * wr - im[k] * wi, bi = re[k] * wi + im[k] * wr;
                    double ar = re[i], ai = im[i];
                    re[i] = ar + br; im[i] = ai + bi;
                    re[k] = ar - br; im[k] = ai - bi;
                }
            }
        });
    }

    // The work in runs of 2^16, so the cores share it and each run stays in its cache.
    private const long Run = 1 << 16;
    private static long Chunks(long count) => (count + Run - 1) / Run;
    private static (long From, long To) Range(long c, long count) => (c * Run, Math.Min(count, (c + 1) * Run));

    /* How many cores it may take (the whole-track work runs in a process of its own, placed by Cpu.cs). */
    public static ParallelOptions Options { get; } = new() { MaxDegreeOfParallelism = Math.Max(1, Environment.ProcessorCount) };
}
