// Gaussian.cs — the three Gaussian filters' taps (bug list item 298), for StreamUpsample.cs.
//
// Each is linear phase, and rolls off along a Gaussian's integral: its response is ½·erfc((f − c) / (σ√2)), with f, c
// and σ fractions of the source's Nyquist frequency. A roll-off as smooth as that has an impulse whose ringing dies
// away along a Gaussian, so a click rings for a millisecond or two where a sinc's rings for ten. The three, after
// HQPlayer's descriptions of its own Gaussian filters (the designs here are Mandarin's own):
//   Gaussian:        c 0.932, σ 0.0159: flat to 19.75 kHz for a CD, −0.5 dB at 20 kHz, −100 dB at the source's Nyquist
//                    (an apodizing filter); 1.8 ms of ringing before a click.
//   Gaussian steep:  c 1, σ 0.0045: flat to 21.8 kHz for a CD and −6 dB at the Nyquist frequency, its response there
//                    symmetrical, so every sample of the source comes out as it went in (not apodizing); −100 dB by
//                    22.5 kHz; 5.9 ms of ringing before a click.
//   Gaussian hi-res: c 0.70, σ 0.0707: for 88.2 kHz and up, whose band ends far above hearing: flat to 25.9 kHz for a
//                    96 kHz source, −99 dB at its Nyquist; 0.2 ms of ringing.
// The response is laid on a grid eight times the filter's length and brought back by the transform (the frequency
// sampling method); its middle, [TapsIn] × factor + 1 long, is kept under a Kaiser window (β 8), which takes off what
// lies beyond with nothing of the band.
namespace Mandarin.Server.Upsample;

internal static class Gaussian
{
    /* The roll-off's middle and width, as fractions of the source's Nyquist frequency, for [kind]. */
    public static (double C, double Sigma) Edge(Shape.Kind kind) => kind switch
    {
        Shape.Kind.Gaussian => (0.932, 0.0159),
        Shape.Kind.GaussianSteep => (1.0, 0.0045),
        Shape.Kind.GaussianHires => (0.70, 0.0707),
        _ => throw new ArgumentException("not a Gaussian filter: " + kind),
    };

    private const double KaiserBeta = 8;

    /* The filter's taps for an upsampling by [factor], [length] of them (odd), their sum [factor]. */
    public static double[] Taps(int factor, Shape.Kind kind, int length)
    {
        var (c, sigma) = Edge(kind);
        var half = (length - 1) / 2;
        var bits = 1;
        while ((1L << bits) < 8L * length) bits++;
        var ft = new Fft(bits);
        var n = (int)ft.Length;
        var re = new double[n];
        var im = new double[n];
        // The response at each bin (its frequency a fraction of the source's Nyquist), laid in the transform's order.
        var nyq = 0.5 / factor;
        for (var k = 0; k < n; k++)
        {
            var f = Math.Abs((k <= n / 2 ? k : k - n) / (double)n) / nyq;
            re[ft.BitReverse(k)] = 0.5 * Erfc((f - c) / (sigma * Math.Sqrt(2)));
        }
        ft.Inverse(re, im);
        // The zero-phase impulse is centred on 0; its middle, delayed by [half], under the window.
        var h = new double[length];
        double sum = 0;
        for (var i = 0; i < length; i++)
        {
            var t = i - half;
            var r = (double)t / half;
            h[i] = re[((t % n) + n) % n] * I0(KaiserBeta * Math.Sqrt(Math.Max(0, 1 - r * r))) / I0(KaiserBeta);
            sum += h[i];
        }
        for (var i = 0; i < length; i++) h[i] *= factor / sum;
        return h;
    }

    /* The complementary error function, to some fifteen figures: a series near 0, a continued fraction beyond 2. */
    public static double Erfc(double x)
    {
        if (x < 0) return 2 - Erfc(-x);
        if (x < 2)
        {
            // erf(x) = 2/√π Σ (−1)^k x^(2k+1) / (k! (2k+1))
            double term = x, sum = x, x2 = x * x;
            for (var k = 1; k < 60; k++)
            {
                term *= -x2 / k;
                var add = term / (2 * k + 1);
                sum += add;
                if (Math.Abs(add) < 1e-17 * Math.Abs(sum)) break;
            }
            return 1 - 2 / Math.Sqrt(Math.PI) * sum;
        }
        if (x > 27) return 0;
        // erfc(x) = e^(−x²)/√π · 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + …))))), by Lentz's method.
        const double tiny = 1e-300;
        double fr = x, cc = x, d = 0;
        for (var k = 1; k < 300; k++)
        {
            var a = k / 2.0;
            d = x + a * d; d = Math.Abs(d) < tiny ? tiny : d; d = 1 / d;
            cc = x + a / cc; cc = Math.Abs(cc) < tiny ? tiny : cc;
            var delta = cc * d;
            fr *= delta;
            if (Math.Abs(delta - 1) < 1e-16) break;
        }
        return Math.Exp(-x * x) / Math.Sqrt(Math.PI) / fr;
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
