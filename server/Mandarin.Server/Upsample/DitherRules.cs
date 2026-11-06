// DitherRules.cs — the dither measured, for the tests (bug list item 301; RulesCommand's "dither"). A tone is
// quantised as a track is (Dither.cs), and what it differs from the tone by is the quantiser's noise: its power in the
// audio band, from 20 to 50 kHz and in all, in dB below full scale, from a Kaiser-windowed transform.
using Mandarin.Server.Tags;
using Jv = Mandarin.Server.Playback.Jv;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Upsample;

internal static class DitherRules
{
    /*
     * { rate, bits, real?, shape?, amp?, log2? } → { band_db, above_db, all_db, depth, order, on_grid, held }: a 997 Hz
     * tone at [amp] (half scale) made at [rate] in [bits]-bit words, the DAC's [real] bits and [shape] (Dither.cs);
     * whether every sample came out on the grid of the depth it is dithered at, and how many were held at full scale.
     */
    public static JsObj Run(JsObj job)
    {
        var rate = (long)TJs.ToNumber(job["rate"]);
        var bits = (int)TJs.ToNumber(job["bits"]);
        var real = Dither.BitsOf(job["real"]);
        var shape = Dither.Of(job["shape"]);
        var amp = job["amp"] is double a ? a : 0.5;
        var log2 = job["log2"] is double l ? (int)l : 16;
        var n = 1 << log2;
        var (left, _) = Dither.For(rate, bits, shape, real);
        var depth = Dither.Depth(bits, real);
        var grid = Math.Pow(2, depth - 1);
        var re = new double[n]; var im = new double[n];
        var onGrid = true;
        for (var i = 0; i < n; i++)
        {
            var x = amp * Math.Sin(2 * Math.PI * 997 * i / rate);
            var y = left.Next(x);
            var g = y * grid;
            if (Math.Abs(g - Math.Round(g)) > 1e-9) onGrid = false;
            // The word as it is written, and back: the noise as the DAC is given it.
            var w = Dither.Word(y) / 2147483648.0;
            re[i] = (w - x) * Kaiser(i, n, 38);
        }
        var fft = new Fft(log2);
        fft.Forward(re, im);
        double energy = 0;
        for (var i = 0; i < n; i++) energy += Kaiser(i, n, 38) * Kaiser(i, n, 38);
        double Band(double lo, double hi)
        {
            double s = 0;
            for (long k = 1; k < n / 2; k++)
            {
                var f = (double)k * rate / n;
                if (f < lo || f > hi) continue;
                var j = fft.BitReverse(k);
                s += (re[j] * re[j] + im[j] * im[j]) * 2 / (energy * n);
            }
            // Against a full-scale sine's power (½).
            return Math.Round(10 * Math.Log10(s / 0.5 + 1e-300), 1);
        }
        return Jv.Obj(("band_db", Band(20, 20000)), ("above_db", Band(20000, Math.Min(50000, rate / 2.0))), ("all_db", Band(20, rate / 2.0)),
            ("depth", (double)depth), ("order", (double)Dither.Order(Dither.At(shape, rate))), ("on_grid", onGrid), ("held", (double)left.Held));
    }

    // A Kaiser window's [i]th of [n] points, its shape [beta].
    private static double Kaiser(int i, int n, double beta)
    {
        var r = 2.0 * i / (n - 1) - 1;
        return I0(beta * Math.Sqrt(Math.Max(0, 1 - r * r))) / I0(beta);
    }

    // The modified Bessel function of the first kind, of order 0, by its series.
    private static double I0(double x)
    {
        double sum = 1, term = 1, q = x * x / 4;
        for (var k = 1; k < 200; k++)
        {
            term *= q / (k * k);
            sum += term;
            if (term < sum * 1e-17) break;
        }
        return sum;
    }
}
