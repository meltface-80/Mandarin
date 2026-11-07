// DsdModulator.cs — PCM at the DSD rate made one bit a sample (bug list item 242): a delta-sigma modulator.
//
// Each sample is rounded to +1 or -1, and the error that leaves is fed back through the noise transfer function
// (DsdNtf.cs) so that the next samples make up for it in the audio band: the quantiser's input is the signal plus
// (NTF - 1) applied to the errors so far, which is strictly causal since NTF starts at 1. It runs in 64-bit floats as
// a cascade of second-order sections in the transposed direct form; the current error enters each only once the bit
// is chosen.
//
// Made faster (item 319): each sample waits on the one before it, so its speed is the length of that wait. Section i
// is given the error plus the states before it (P, their running sum), so its new states are K·e plus what the old
// states alone make, and the sum the next sample is quantised against is ΣK·e plus theirs: all but one multiply-add
// worked out while the bit is still being chosen. The same arithmetic as the sections taken in turn, in another order.
//
// A one-bit loop of high order can be overloaded: driven too hard its states grow until it no longer tracks the
// signal. The input is kept to SACD's level (full-scale PCM is half the modulation, DsdChain.cs), well inside what the
// loop takes (it holds past SACD's highest level, 71.4%, to 75% and more: DsdOut.Hinf, item 255); should the quantiser's input still pass [Guard], the states are cleared
// and the loop starts again, and the reset is counted, for the log and the tests.
namespace Mandarin.Server.Upsample;

internal sealed partial class DsdModulator
{
    /* The quantiser's input beyond which the loop is taken to be overloaded and started again. */
    public const double Guard = 4;

    private readonly DsdNtf.Section[] s;
    private readonly double[] s1, s2;
    private readonly double[] k1, k2;   // each section's states' share of the error: B1 − A1, B2 − A2
    private readonly double kw;         // the sum of the k1s: the error's share of the next sample's sum
    private double w;                   // the sum of the s1s, the next sample is quantised against

    public DsdModulator(DsdNtf ntf)
    {
        s = [.. ntf.Sections];
        s1 = new double[s.Length]; s2 = new double[s.Length];
        k1 = [.. s.Select(c => c.B1 - c.A1)];
        k2 = [.. s.Select(c => c.B2 - c.A2)];
        foreach (var k in k1) kw += k;
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
        var sum = w;
        for (var k = 0; k < x.Length; k += 8)
        {
            var b = 0;
            for (var j = 0; j < 8; j++)
            {
                var v = x[k + j] + sum;
                var a = Math.Abs(v);
                if (a > most) most = a;
                var e = Math.CopySign(1.0, v) - v;
                b |= (int)((ulong)~BitConverter.DoubleToInt64Bits(v) >> 63) << j;
                // Section i's input is e + P(i − 1), its sum o = e + P(i): its states K·e plus the old states' part.
                double p = 0, r = 0;
                for (var i = 0; i < n; i++)
                {
                    var c = s[i];
                    var before = p;
                    p += s1[i];
                    var r1 = Math.FusedMultiplyAdd(c.B1, before, Math.FusedMultiplyAdd(-c.A1, p, s2[i]));
                    var r2 = Math.FusedMultiplyAdd(c.B2, before, -c.A2 * p);
                    s1[i] = Math.FusedMultiplyAdd(k1[i], e, r1);
                    s2[i] = Math.FusedMultiplyAdd(k2[i], e, r2);
                    r += r1;
                }
                sum = Math.FusedMultiplyAdd(kw, e, r);
                if (a > Guard) { Array.Clear(s1); Array.Clear(s2); sum = 0; Resets++; }
            }
            bits[k / 8] = (byte)b;
        }
        w = sum;
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
        double k10 = k1[0], k11 = k1[1], k12 = k1[2], k13 = k1[3], k20 = k2[0], k21 = k2[1], k22 = k2[2], k23 = k2[3];
        var most = Most;
        var sum = w;
        for (var k = 0; k < x.Length; k += 8)
        {
            var b = 0;
            for (var j = 0; j < 8; j++)
            {
                var v = x[k + j] + sum;
                var a = Math.Abs(v);
                if (a > most) most = a;
                var e = Math.CopySign(1.0, v) - v;
                b |= (int)((ulong)~BitConverter.DoubleToInt64Bits(v) >> 63) << j;
                // As Run's loop, in the same order: the running sums of the old states, each section's part of them.
                double p0 = 0 + a0, p1 = p0 + a1, p2 = p1 + a2, p3 = p2 + a3;
                var r10 = Math.FusedMultiplyAdd(c0.B1, 0.0, Math.FusedMultiplyAdd(-c0.A1, p0, b0)); var r20 = Math.FusedMultiplyAdd(c0.B2, 0.0, -c0.A2 * p0);
                var r11 = Math.FusedMultiplyAdd(c1.B1, p0, Math.FusedMultiplyAdd(-c1.A1, p1, b1)); var r21 = Math.FusedMultiplyAdd(c1.B2, p0, -c1.A2 * p1);
                var r12 = Math.FusedMultiplyAdd(c2.B1, p1, Math.FusedMultiplyAdd(-c2.A1, p2, b2)); var r22 = Math.FusedMultiplyAdd(c2.B2, p1, -c2.A2 * p2);
                var r13 = Math.FusedMultiplyAdd(c3.B1, p2, Math.FusedMultiplyAdd(-c3.A1, p3, b3)); var r23 = Math.FusedMultiplyAdd(c3.B2, p2, -c3.A2 * p3);
                a0 = Math.FusedMultiplyAdd(k10, e, r10); b0 = Math.FusedMultiplyAdd(k20, e, r20);
                a1 = Math.FusedMultiplyAdd(k11, e, r11); b1 = Math.FusedMultiplyAdd(k21, e, r21);
                a2 = Math.FusedMultiplyAdd(k12, e, r12); b2 = Math.FusedMultiplyAdd(k22, e, r22);
                a3 = Math.FusedMultiplyAdd(k13, e, r13); b3 = Math.FusedMultiplyAdd(k23, e, r23);
                sum = Math.FusedMultiplyAdd(kw, e, (((0 + r10) + r11) + r12) + r13);
                if (a > Guard) { a0 = a1 = a2 = a3 = b0 = b1 = b2 = b3 = 0; sum = 0; Resets++; }
            }
            bits[k / 8] = (byte)b;
        }
        s1[0] = a0; s1[1] = a1; s1[2] = a2; s1[3] = a3; s2[0] = b0; s2[1] = b1; s2[2] = b2; s2[3] = b3;
        w = sum;
        Most = most;
    }
}
