// DsdModulator.cs — PCM at the DSD rate made one bit a sample (bug list item 242): a delta-sigma modulator.
//
// Each sample is rounded to +1 or -1, and the error that leaves is fed back through the noise transfer function
// (DsdNtf.cs) so that the next samples make up for it in the audio band: the quantiser's input is the signal plus
// (NTF - 1) applied to the errors so far, which is strictly causal since NTF starts at 1. It runs in 64-bit floats as
// a cascade of second-order sections in the transposed direct form; the current error enters each only once the bit
// is chosen.
//
// A one-bit loop of high order can be overloaded: driven too hard its states grow until it no longer tracks the
// signal. The input is kept to SACD's level (full-scale PCM is half the modulation, DsdChain.cs), well inside what the
// loop takes (it was measured stable to 60%); should the quantiser's input still pass [Guard], the states are cleared
// and the loop starts again, and the reset is counted, for the log and the tests.
namespace Mandarin.Server.Upsample;

internal sealed class DsdModulator
{
    /* The quantiser's input beyond which the loop is taken to be overloaded and started again. */
    public const double Guard = 4;

    private readonly DsdNtf.Section[] s;
    private readonly double[] s1, s2;

    public DsdModulator(DsdNtf ntf)
    {
        s = [.. ntf.Sections];
        s1 = new double[s.Length]; s2 = new double[s.Length];
    }

    /* The times the loop was overloaded and started again. */
    public long Resets { get; private set; }

    /*
     * Every loop through the sections as arrays, never the seventh order's own path (Run4): for the tests, which hold
     * the two to the same bits (item 251).
     */
    public bool Generic { get; init; }

    /* The most the quantiser's input has been. */
    public double Most { get; private set; }

    /*
     * [x] (at the DSD rate, ±1 the most the modulation goes) made bits into [bits]: sample k is bit k % 8 of byte
     * k / 8, the least significant first, as DSF lays them out; set for +1. [x]'s length is a multiple of 8.
     */
    public void Run(ReadOnlySpan<double> x, Span<byte> bits)
    {
        if (s.Length == 4 && !Generic) { Run4(x, bits); return; }
        var n = s.Length;
        var most = Most;
        for (var k = 0; k < x.Length; k += 8)
        {
            var b = 0;
            for (var j = 0; j < 8; j++)
            {
                double w = 0;
                for (var i = 0; i < n; i++) w += s1[i];
                var v = x[k + j] + w;
                var a = Math.Abs(v);
                if (a > most) most = a;
                double q;
                if (v >= 0) { q = 1; b |= 1 << j; } else q = -1;
                var e = q - v;
                for (var i = 0; i < n; i++)
                {
                    var c = s[i];
                    var o = e + s1[i];
                    s1[i] = c.B1 * e - c.A1 * o + s2[i];
                    s2[i] = c.B2 * e - c.A2 * o;
                    e = o;
                }
                if (a > Guard) { Array.Clear(s1); Array.Clear(s2); Resets++; }
            }
            bits[k / 8] = (byte)b;
        }
        Most = most;
    }

    /*
     * The seventh order's four sections (three of second order and one of first) with their states and coefficients
     * held in locals rather than read from arrays at every sample (item 251): the same arithmetic in the same order as
     * Run's loops, and so the same bits.
     */
    private void Run4(ReadOnlySpan<double> x, Span<byte> bits)
    {
        DsdNtf.Section c0 = s[0], c1 = s[1], c2 = s[2], c3 = s[3];
        double a0 = s1[0], a1 = s1[1], a2 = s1[2], a3 = s1[3], b0 = s2[0], b1 = s2[1], b2 = s2[2], b3 = s2[3];
        var most = Most;
        for (var k = 0; k < x.Length; k += 8)
        {
            var b = 0;
            for (var j = 0; j < 8; j++)
            {
                var w = (((0 + a0) + a1) + a2) + a3;   // as Run sums them, from 0
                var v = x[k + j] + w;
                var a = Math.Abs(v);
                if (a > most) most = a;
                double q;
                if (v >= 0) { q = 1; b |= 1 << j; } else q = -1;
                var e = q - v;
                var o = e + a0; a0 = c0.B1 * e - c0.A1 * o + b0; b0 = c0.B2 * e - c0.A2 * o; e = o;
                o = e + a1; a1 = c1.B1 * e - c1.A1 * o + b1; b1 = c1.B2 * e - c1.A2 * o; e = o;
                o = e + a2; a2 = c2.B1 * e - c2.A1 * o + b2; b2 = c2.B2 * e - c2.A2 * o; e = o;
                o = e + a3; a3 = c3.B1 * e - c3.A1 * o + b3; b3 = c3.B2 * e - c3.A2 * o;
                if (a > Guard) { a0 = a1 = a2 = a3 = b0 = b1 = b2 = b3 = 0; Resets++; }
            }
            bits[k / 8] = (byte)b;
        }
        s1[0] = a0; s1[1] = a1; s1[2] = a2; s1[3] = a3; s2[0] = b0; s2[1] = b1; s2[2] = b2; s2[3] = b3;
        Most = most;
    }
}
