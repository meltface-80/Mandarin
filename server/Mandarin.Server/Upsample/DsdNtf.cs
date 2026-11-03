// DsdNtf.cs — the noise transfer function of the PCM-to-DSD modulator (bug list item 242): where its noise goes.
//
// A one-bit modulator's error is huge (the whole signal is rounded to ±1); what makes DSD work is that the loop pushes
// almost all of it out of the audio band. The noise transfer function says how: zeros on the unit circle inside the
// band, where the noise is held down, and poles that keep the loop stable by letting the noise out above it no
// louder than [Hinf] (Lee's rule: 1.5 or less for a one-bit quantiser; less is steadier, more is quieter in the band).
//
// The zeros are the optimal ones for the order (the roots of its Legendre polynomial, spread across the band: the
// integrated noise in the band is least), the poles a Butterworth high-pass's, its corner moved until the gain out
// of band is exactly Hinf. The function is a ratio of monic polynomials, held as second-order sections (and one
// first-order section for an odd order), each 1 + b1 z^-1 + b2 z^-2 over 1 + a1 z^-1 + a2 z^-2.
using System.Numerics;

namespace Mandarin.Server.Upsample;

internal sealed class DsdNtf
{
    /* One section: (1 + B1 z^-1 + B2 z^-2) / (1 + A1 z^-1 + A2 z^-2). */
    public readonly record struct Section(double B1, double B2, double A1, double A2);

    public IReadOnlyList<Section> Sections { get; }
    public Complex[] Zeros { get; }
    public Complex[] Poles { get; }

    /* The function of [order] for an oversampling of [osr] (the DSD rate's Nyquist over the band's edge). */
    public DsdNtf(int order, double osr, double hinf)
    {
        if (order is < 1 or > 9) throw new ArgumentOutOfRangeException(nameof(order));
        Zeros = [.. LegendreRoots(order).Select(x => Complex.FromPolarCoordinates(1, Math.PI * x / osr))];
        // The high-pass's corner, by halves, until the gain out of band is Hinf.
        double lo = 1e-4, hi = 3;
        for (var i = 0; i < 80; i++)
        {
            var mid = (lo + hi) / 2;
            if (Peak(Zeros, PolesAt(order, mid)) > hinf) hi = mid; else lo = mid;
        }
        Poles = PolesAt(order, lo);
        Sections = ToSections(Zeros, Poles);
    }

    /* |NTF(e^jw)| at the angle [w]. */
    public double Gain(double w)
    {
        var z = Complex.FromPolarCoordinates(1, w);
        var g = Complex.One;
        foreach (var q in Zeros) g *= z - q;
        foreach (var p in Poles) g /= z - p;
        return g.Magnitude;
    }

    /* The most |NTF| is anywhere on the circle. */
    public double Peak() => Peak(Zeros, Poles);

    private static double Peak(Complex[] zeros, Complex[] poles)
    {
        double most = 0;
        for (var i = 0; i <= 4000; i++)
        {
            var z = Complex.FromPolarCoordinates(1, Math.PI * i / 4000);
            var g = Complex.One;
            foreach (var q in zeros) g *= z - q;
            foreach (var p in poles) g /= z - p;
            most = Math.Max(most, g.Magnitude);
        }
        return most;
    }

    // A Butterworth high-pass's poles of [order], its corner at [wc] (radians a sample), by the bilinear transform.
    private static Complex[] PolesAt(int order, double wc)
    {
        var oc = 2 * Math.Tan(wc / 2);
        return [.. Enumerable.Range(0, order).Select(k =>
        {
            var lp = Complex.FromPolarCoordinates(1, Math.PI * (2 * k + order + 1) / (2 * order));
            var s = oc / lp;
            return (2 + s) / (2 - s);
        })];
    }

    // The roots of the Legendre polynomial of [n], in -1..1, by Newton's method from Chebyshev's nodes.
    private static double[] LegendreRoots(int n)
    {
        var roots = new double[n];
        for (var i = 0; i < n; i++)
        {
            var x = Math.Cos(Math.PI * (i + 0.75) / (n + 0.5));
            for (var it = 0; it < 100; it++)
            {
                double p0 = 1, p1 = x;
                for (var k = 2; k <= n; k++) (p0, p1) = (p1, ((2 * k - 1) * x * p1 - (k - 1) * p0) / k);
                var dp = n * (x * p1 - p0) / (x * x - 1);
                var dx = p1 / dp;
                x -= dx;
                if (Math.Abs(dx) < 1e-16) break;
            }
            roots[i] = n == 1 ? 0 : x;
        }
        return [.. roots.Order()];
    }

    // The zeros and poles paired into sections: each conjugate pair of zeros with a conjugate pair of poles (nearest
    // the band first), the real zero with the real pole.
    private static List<Section> ToSections(Complex[] zeros, Complex[] poles)
    {
        const double eps = 1e-12;
        var zu = zeros.Where(c => c.Imaginary > eps).OrderBy(c => c.Phase).ToList();
        var pu = poles.Where(c => c.Imaginary > eps).OrderBy(c => c.Phase).ToList();
        var zr = zeros.Where(c => Math.Abs(c.Imaginary) <= eps).ToList();
        var pr = poles.Where(c => Math.Abs(c.Imaginary) <= eps).ToList();
        var s = new List<Section>();
        for (var i = 0; i < zu.Count; i++)
            s.Add(new Section(-2 * zu[i].Real, zu[i].Magnitude * zu[i].Magnitude, -2 * pu[i].Real, pu[i].Magnitude * pu[i].Magnitude));
        for (var i = 0; i < zr.Count; i++) s.Add(new Section(-zr[i].Real, 0, -pr[i].Real, 0));
        return s;
    }
}
