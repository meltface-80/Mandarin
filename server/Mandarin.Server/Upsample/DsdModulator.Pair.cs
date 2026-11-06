// DsdModulator.Pair.cs — the two channels' modulators run together, one in each lane of a 128-bit vector (item 319).
//
// A channel's modulator is a loop each sample of which waits on the one before, so one core runs it no faster for
// being given more to do beside it: run alone, the left and the right took a core each. Here one core runs both, the
// left in a vector's first lane and the right in its second, each lane the very arithmetic Run4 does for a channel
// alone (the same fused multiply-adds, in the same order): the same bits, from half the cores. Only the seventh order's
// four sections are run so; any other, each channel's Run, the two at once.
using System.Runtime.Intrinsics;

namespace Mandarin.Server.Upsample;

internal sealed partial class DsdModulator
{
    /* [xl] and [xr], alike in length, made bits into [bl] and [br] by [l] and [r], modulators of the same design. */
    public static void RunPair(DsdModulator l, DsdModulator r, ReadOnlySpan<double> xl, ReadOnlySpan<double> xr, Span<byte> bl, Span<byte> br)
    {
        if (l.s.Length != 4 || l.Generic || r.Generic || !Vector128.IsHardwareAccelerated)
        {
            var (xa, xb) = (xl.ToArray(), xr.ToArray());
            var (ba, bb) = (new byte[bl.Length], new byte[br.Length]);
            Parallel.Invoke(() => l.Run(xa, ba), () => r.Run(xb, bb));
            ba.CopyTo(bl); bb.CopyTo(br);
            return;
        }
        static Vector128<double> Two(double a, double b) => Vector128.Create(a, b);
        static Vector128<double> F(Vector128<double> a, Vector128<double> b, Vector128<double> c) => Vector128.FusedMultiplyAdd(a, b, c);
        DsdNtf.Section c0 = l.s[0], c1 = l.s[1], c2 = l.s[2], c3 = l.s[3];
        Vector128<double> a0 = Two(l.s1[0], r.s1[0]), a1 = Two(l.s1[1], r.s1[1]), a2 = Two(l.s1[2], r.s1[2]), a3 = Two(l.s1[3], r.s1[3]);
        Vector128<double> b0 = Two(l.s2[0], r.s2[0]), b1 = Two(l.s2[1], r.s2[1]), b2 = Two(l.s2[2], r.s2[2]), b3 = Two(l.s2[3], r.s2[3]);
        var sum = Two(l.w, r.w);
        var most = Two(l.Most, r.Most);
        Vector128<double> B10 = Vector128.Create(c0.B1), B11 = Vector128.Create(c1.B1), B12 = Vector128.Create(c2.B1), B13 = Vector128.Create(c3.B1);
        Vector128<double> B20 = Vector128.Create(c0.B2), B21 = Vector128.Create(c1.B2), B22 = Vector128.Create(c2.B2), B23 = Vector128.Create(c3.B2);
        Vector128<double> nA10 = Vector128.Create(-c0.A1), nA11 = Vector128.Create(-c1.A1), nA12 = Vector128.Create(-c2.A1), nA13 = Vector128.Create(-c3.A1);
        Vector128<double> nA20 = Vector128.Create(-c0.A2), nA21 = Vector128.Create(-c1.A2), nA22 = Vector128.Create(-c2.A2), nA23 = Vector128.Create(-c3.A2);
        Vector128<double> k10 = Vector128.Create(l.k1[0]), k11 = Vector128.Create(l.k1[1]), k12 = Vector128.Create(l.k1[2]), k13 = Vector128.Create(l.k1[3]);
        Vector128<double> k20 = Vector128.Create(l.k2[0]), k21 = Vector128.Create(l.k2[1]), k22 = Vector128.Create(l.k2[2]), k23 = Vector128.Create(l.k2[3]);
        var kw = Vector128.Create(l.kw);
        var zero = Vector128<double>.Zero;
        var one = Vector128.Create(1.0);
        var guard = Vector128.Create(Guard);
        for (var k = 0; k < xl.Length; k += 8)
        {
            int bitsL = 0, bitsR = 0;
            for (var j = 0; j < 8; j++)
            {
                var v = Two(xl[k + j], xr[k + j]) + sum;
                var a = Vector128.Abs(v);
                most = Vector128.Max(most, a);
                var e = Vector128.CopySign(one, v) - v;
                var neg = (int)v.ExtractMostSignificantBits();   // a lane's sign: its bit is 0
                bitsL |= (~neg & 1) << j;
                bitsR |= ((~neg >> 1) & 1) << j;
                // As Run4, lane by lane: the running sums of the old states, each section's part of them.
                Vector128<double> p0 = zero + a0, p1 = p0 + a1, p2 = p1 + a2, p3 = p2 + a3;
                var r10 = F(B10, zero, F(nA10, p0, b0)); var r20 = F(B20, zero, nA20 * p0);
                var r11 = F(B11, p0, F(nA11, p1, b1)); var r21 = F(B21, p0, nA21 * p1);
                var r12 = F(B12, p1, F(nA12, p2, b2)); var r22 = F(B22, p1, nA22 * p2);
                var r13 = F(B13, p2, F(nA13, p3, b3)); var r23 = F(B23, p2, nA23 * p3);
                a0 = F(k10, e, r10); b0 = F(k20, e, r20);
                a1 = F(k11, e, r11); b1 = F(k21, e, r21);
                a2 = F(k12, e, r12); b2 = F(k22, e, r22);
                a3 = F(k13, e, r13); b3 = F(k23, e, r23);
                sum = F(kw, e, (((zero + r10) + r11) + r12) + r13);
                if (Vector128.GreaterThanAny(a, guard))
                {
                    // A lane overloaded: its states cleared, as Run4 clears a channel's, the other's kept.
                    var over = Vector128.GreaterThan(a, guard);
                    a0 = Vector128.ConditionalSelect(over, zero, a0); a1 = Vector128.ConditionalSelect(over, zero, a1);
                    a2 = Vector128.ConditionalSelect(over, zero, a2); a3 = Vector128.ConditionalSelect(over, zero, a3);
                    b0 = Vector128.ConditionalSelect(over, zero, b0); b1 = Vector128.ConditionalSelect(over, zero, b1);
                    b2 = Vector128.ConditionalSelect(over, zero, b2); b3 = Vector128.ConditionalSelect(over, zero, b3);
                    sum = Vector128.ConditionalSelect(over, zero, sum);
                    if (a[0] > Guard) l.Resets++;
                    if (a[1] > Guard) r.Resets++;
                }
            }
            bl[k / 8] = (byte)bitsL;
            br[k / 8] = (byte)bitsR;
        }
        (l.s1[0], l.s1[1], l.s1[2], l.s1[3], r.s1[0], r.s1[1], r.s1[2], r.s1[3]) = (a0[0], a1[0], a2[0], a3[0], a0[1], a1[1], a2[1], a3[1]);
        (l.s2[0], l.s2[1], l.s2[2], l.s2[3], r.s2[0], r.s2[1], r.s2[2], r.s2[3]) = (b0[0], b1[0], b2[0], b3[0], b0[1], b1[1], b2[1], b3[1]);
        (l.w, r.w) = (sum[0], sum[1]);
        (l.Most, r.Most) = (most[0], most[1]);
    }
}
