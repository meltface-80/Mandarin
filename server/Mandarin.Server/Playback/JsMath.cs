// JsMath.cs — Math.sin, Math.cos, Math.pow and Math.log10 as the Node server
// computes them (v0.8.38), for the ports in this folder.
//
// .NET's Math functions call the C library's, which round differently from
// V8's in the last bit for a few inputs in a hundred (pow for one in ten). The
// DSP's curve and headroom, and ReplayGain's levels, are built on them, and a
// last bit can move a number across a rounding and change a cache name. So
// these are V8's own (src/base/ieee754.cc), which are fdlibm's, line for line:
// the same constants, the same order of operations, the same argument
// reduction — and, in pow, V8's own bracketing of its last division, which
// isn't fdlibm's. Doubles in .NET are IEEE doubles with no hidden extra
// precision and no fused multiply-add, as in V8 on x64, so the results are
// the same bits as Node's there (checked against Node 22 over millions of
// arguments, special values and huge ones included). Node built for arm64
// (Apple silicon) rounds a few in the last bit differently, its compiler
// fusing a multiply and an add inside fdlibm; .NET never fuses on its own, so
// these give the same bits on every machine, x64 Node's.
//
// fdlibm's notice, which goes with it:
//   Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
//   Developed at SunSoft, a Sun Microsystems, Inc. business.
//   Permission to use, copy, modify, and distribute this
//   software is freely granted, provided that this notice
//   is preserved.
namespace Mandarin.Server.Playback;

internal static class JsMath
{
    private static int Hi(double x) => (int)(BitConverter.DoubleToInt64Bits(x) >> 32);
    private static uint Lo(double x) => (uint)BitConverter.DoubleToInt64Bits(x);
    private static double Words(int hi, uint lo) => BitConverter.Int64BitsToDouble(((long)hi << 32) | lo);
    private static double SetHi(double x, int hi) => Words(hi, Lo(x));
    private static double SetLo(double x, uint lo) => Words(Hi(x), lo);
    private static double Bits(ulong b) => BitConverter.UInt64BitsToDouble(b);

    /* Math.imul(a, b): the low 32 bits of the product, signed. */
    public static int Imul(int a, int b) => unchecked(a * b);

    // ------------------------------------------------------------ sin, cos

    private static double KernelSin(double x, double y, int iy)
    {
        const double half = 0.5;
        double S1 = Bits(0xBFC5555555555549), S2 = Bits(0x3F8111111110F8A6), S3 = Bits(0xBF2A01A019C161D5),
            S4 = Bits(0x3EC71DE357B1FE7D), S5 = Bits(0xBE5AE5E68A2B9CEB), S6 = Bits(0x3DE5D93A5ACFD57C);
        var ix = Hi(x) & 0x7fffffff;
        if (ix < 0x3e400000 && (int)x == 0) return x;   // |x| < 2**-27
        double z = x * x, v = z * x;
        double r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
        if (iy == 0) return x + v * (S1 + z * r);
        return x - ((z * (half * y - v * r) - y) - v * S1);
    }

    private static double KernelCos(double x, double y)
    {
        const double one = 1.0;
        double C1 = Bits(0x3FA555555555554C), C2 = Bits(0xBF56C16C16C15177), C3 = Bits(0x3EFA01A019CB1590),
            C4 = Bits(0xBE927E4F809C52AD), C5 = Bits(0x3E21EE9EBDB4B1C4), C6 = Bits(0xBDA8FAE9BE8838D4);
        var ix = Hi(x) & 0x7fffffff;
        if (ix < 0x3e400000 && (int)x == 0) return one;   // |x| < 2**-27
        var z = x * x;
        var r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
        if (ix < 0x3FD33333) return one - (0.5 * z - (z * r - x * y));   // |x| < 0.3
        var qx = ix > 0x3fe90000 ? 0.28125 : Words(ix - 0x00200000, 0);   // x > 0.78125 : x/4
        var hz = 0.5 * z - qx;
        var a = one - qx;
        return a - (hz - (z * r - x * y));
    }

    // 2/π in 24-bit pieces, for the reduction of large arguments.
    private static readonly int[] TwoOverPi =
    [
        0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7,
        0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C,
        0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11,
        0x8B5A0A, 0x6D1F6D, 0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7,
        0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E,
        0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B
    ];

    // The high words of n·π/2, n = 1…32.
    private static readonly int[] NPio2Hw =
    [
        0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB, 0x402C463A, 0x402F6A7A,
        0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B, 0x403C463A, 0x403DD85A, 0x403F6A7A,
        0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C, 0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB,
        0x404858EB, 0x404921FB
    ];

    // π/2 in pieces of 24 bits.
    private static readonly double[] PIo2 =
    [
        Bits(0x3FF921FB40000000), Bits(0x3E74442D00000000), Bits(0x3CF8469880000000), Bits(0x3B78CC5160000000),
        Bits(0x39F01B8380000000), Bits(0x387A252040000000), Bits(0x36E3822280000000), Bits(0x3569F31D00000000)
    ];

    /* __kernel_rem_pio2: x (nx pieces of 24 bits, scaled by 2^e0) reduced by π/2, to two doubles; n mod 8. */
    private static int KernelRemPio2(double[] x, double[] y, int e0, int nx)
    {
        const double zero = 0.0, one = 1.0, two24 = 16777216.0, twon24 = 5.96046447753906250000e-08;
        const int jk = 4;   // init_jk[2]: two doubles' worth
        var iq = new int[20];
        double[] f = new double[20], fq = new double[20], q = new double[20];
        int jp = jk;
        int jx = nx - 1;
        int jv = (e0 - 3) / 24;
        if (jv < 0) jv = 0;
        int q0 = e0 - 24 * (jv + 1);
        int i, j, k, n, ih, carry;
        double z, fw;

        j = jv - jx;
        int m = jx + jk;
        for (i = 0; i <= m; i++, j++) f[i] = j < 0 ? zero : TwoOverPi[j];
        for (i = 0; i <= jk; i++)
        {
            for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
            q[i] = fw;
        }
        int jz = jk;
        while (true)
        {
            // Distill q[] into iq[], reversed.
            for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--)
            {
                fw = (int)(twon24 * z);
                iq[i] = (int)(z - two24 * fw);
                z = q[j - 1] + fw;
            }
            z = Math.ScaleB(z, q0);
            z -= 8.0 * Math.Floor(z * 0.125);
            n = (int)z;
            z -= n;
            ih = 0;
            if (q0 > 0)
            {
                i = iq[jz - 1] >> (24 - q0);
                n += i;
                iq[jz - 1] -= i << (24 - q0);
                ih = iq[jz - 1] >> (23 - q0);
            }
            else if (q0 == 0) ih = iq[jz - 1] >> 23;
            else if (z >= 0.5) ih = 2;

            if (ih > 0)
            {
                n += 1;
                carry = 0;
                for (i = 0; i < jz; i++)
                {
                    j = iq[i];
                    if (carry == 0)
                    {
                        if (j != 0) { carry = 1; iq[i] = 0x1000000 - j; }
                    }
                    else iq[i] = 0xffffff - j;
                }
                if (q0 > 0)
                {
                    if (q0 == 1) iq[jz - 1] &= 0x7fffff;
                    else if (q0 == 2) iq[jz - 1] &= 0x3fffff;
                }
                if (ih == 2)
                {
                    z = one - z;
                    if (carry != 0) z -= Math.ScaleB(one, q0);
                }
            }

            if (z == zero)
            {
                j = 0;
                for (i = jz - 1; i >= jk; i--) j |= iq[i];
                if (j == 0)
                {
                    for (k = 1; jk >= k && iq[jk - k] == 0; k++) { }
                    for (i = jz + 1; i <= jz + k; i++)
                    {
                        f[jx + i] = TwoOverPi[jv + i];
                        for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
                        q[i] = fw;
                    }
                    jz += k;
                    continue;   // recompute
                }
            }
            break;
        }

        if (z == 0.0)
        {
            jz -= 1;
            q0 -= 24;
            while (iq[jz] == 0) { jz--; q0 -= 24; }
        }
        else
        {
            z = Math.ScaleB(z, -q0);
            if (z >= two24)
            {
                fw = (int)(twon24 * z);
                iq[jz] = (int)(z - two24 * fw);
                jz += 1;
                q0 += 24;
                iq[jz] = (int)fw;
            }
            else iq[jz] = (int)z;
        }

        fw = Math.ScaleB(one, q0);
        for (i = jz; i >= 0; i--) { q[i] = fw * iq[i]; fw *= twon24; }
        for (i = jz; i >= 0; i--)
        {
            for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k] * q[i + k];
            fq[jz - i] = fw;
        }
        fw = 0.0;
        for (i = jz; i >= 0; i--) fw += fq[i];
        y[0] = ih == 0 ? fw : -fw;
        fw = fq[0] - fw;
        for (i = 1; i <= jz; i++) fw += fq[i];
        y[1] = ih == 0 ? fw : -fw;
        return n & 7;
    }

    /* __ieee754_rem_pio2: x − n·π/2 as y[0] + y[1]; n. */
    private static int RemPio2(double x, double[] y)
    {
        const double zero = 0.0, half = 0.5, two24 = 16777216.0;
        double invpio2 = Bits(0x3FE45F306DC9C883), pio2_1 = Bits(0x3FF921FB54400000), pio2_1t = Bits(0x3DD0B4611A626331),
            pio2_2 = Bits(0x3DD0B4611A600000), pio2_2t = Bits(0x3BA3198A2E037073), pio2_3 = Bits(0x3BA3198A2E000000),
            pio2_3t = Bits(0x397B839A252049C1);
        double z, w, t, r, fn;
        int hx = Hi(x);
        int ix = hx & 0x7fffffff;
        if (ix <= 0x3fe921fb) { y[0] = x; y[1] = 0; return 0; }   // |x| ~<= π/4
        if (ix < 0x4002d97c)
        {
            // |x| < 3π/4: n = ±1
            if (hx > 0)
            {
                z = x - pio2_1;
                if (ix != 0x3ff921fb) { y[0] = z - pio2_1t; y[1] = (z - y[0]) - pio2_1t; }
                else { z -= pio2_2; y[0] = z - pio2_2t; y[1] = (z - y[0]) - pio2_2t; }
                return 1;
            }
            z = x + pio2_1;
            if (ix != 0x3ff921fb) { y[0] = z + pio2_1t; y[1] = (z - y[0]) + pio2_1t; }
            else { z += pio2_2; y[0] = z + pio2_2t; y[1] = (z - y[0]) + pio2_2t; }
            return -1;
        }
        if (ix <= 0x413921fb)
        {
            // |x| ~<= 2^19·(π/2), medium size
            t = Math.Abs(x);
            var n = (int)(t * invpio2 + half);
            fn = n;
            r = t - fn * pio2_1;
            w = fn * pio2_1t;
            if (n < 32 && ix != NPio2Hw[n - 1]) y[0] = r - w;
            else
            {
                var j = ix >> 20;
                y[0] = r - w;
                var i = j - ((Hi(y[0]) >> 20) & 0x7ff);
                if (i > 16)
                {
                    t = r;
                    w = fn * pio2_2;
                    r = t - w;
                    w = fn * pio2_2t - ((t - r) - w);
                    y[0] = r - w;
                    i = j - ((Hi(y[0]) >> 20) & 0x7ff);
                    if (i > 49)
                    {
                        t = r;
                        w = fn * pio2_3;
                        r = t - w;
                        w = fn * pio2_3t - ((t - r) - w);
                        y[0] = r - w;
                    }
                }
            }
            y[1] = (r - y[0]) - w;
            if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -n; }
            return n;
        }
        if (ix >= 0x7ff00000) { y[0] = y[1] = x - x; return 0; }
        // Large: z = scalbn(|x|, ilogb(x) − 23), in three pieces of 24 bits.
        var e0 = (ix >> 20) - 1046;
        z = Words(ix - (e0 << 20), Lo(x));
        var tx = new double[3];
        for (var i = 0; i < 2; i++) { tx[i] = (int)z; z = (z - tx[i]) * two24; }
        tx[2] = z;
        var nx = 3;
        while (tx[nx - 1] == zero) nx--;
        var nn = KernelRemPio2(tx, y, e0, nx);
        if (hx < 0) { y[0] = -y[0]; y[1] = -y[1]; return -nn; }
        return nn;
    }

    /* Math.sin */
    public static double Sin(double x)
    {
        var ix = Hi(x) & 0x7fffffff;
        if (ix <= 0x3fe921fb) return KernelSin(x, 0.0, 0);
        if (ix >= 0x7ff00000) return x - x;
        var y = new double[2];
        var n = RemPio2(x, y);
        return (n & 3) switch
        {
            0 => KernelSin(y[0], y[1], 1),
            1 => KernelCos(y[0], y[1]),
            2 => -KernelSin(y[0], y[1], 1),
            _ => -KernelCos(y[0], y[1])
        };
    }

    /* Math.cos */
    public static double Cos(double x)
    {
        var ix = Hi(x) & 0x7fffffff;
        if (ix <= 0x3fe921fb) return KernelCos(x, 0.0);
        if (ix >= 0x7ff00000) return x - x;
        var y = new double[2];
        var n = RemPio2(x, y);
        return (n & 3) switch
        {
            0 => KernelCos(y[0], y[1]),
            1 => -KernelSin(y[0], y[1], 1),
            2 => -KernelCos(y[0], y[1]),
            _ => KernelSin(y[0], y[1], 1)
        };
    }

    // ------------------------------------------------------------ log, log10

    /* Math.log */
    public static double Log(double x)
    {
        const double zero = 0.0, two54 = 1.80143985094819840000e+16;
        double ln2_hi = Bits(0x3FE62E42FEE00000), ln2_lo = Bits(0x3DEA39EF35793C76);
        double Lg1 = Bits(0x3FE5555555555593), Lg2 = Bits(0x3FD999999997FA04), Lg3 = Bits(0x3FD2492494229359),
            Lg4 = Bits(0x3FCC71C51D8E78AF), Lg5 = Bits(0x3FC7466496CB03DE), Lg6 = Bits(0x3FC39A09D078C69F),
            Lg7 = Bits(0x3FC2F112DF3E5244);
        double hfsq, f, s, z, R, w, t1, t2, dk;
        int k, hx, i, j;
        uint lx;
        hx = Hi(x);
        lx = Lo(x);
        k = 0;
        if (hx < 0x00100000)
        {
            // x < 2**-1022
            if (((hx & 0x7fffffff) | (int)lx) == 0) return double.NegativeInfinity;   // log(±0)
            if (hx < 0) return double.NaN;   // log(−x)
            k -= 54;
            x *= two54;
            hx = Hi(x);
        }
        if (hx >= 0x7ff00000) return x + x;
        k += (hx >> 20) - 1023;
        hx &= 0x000fffff;
        i = (hx + 0x95f64) & 0x100000;
        x = SetHi(x, hx | (i ^ 0x3ff00000));   // normalise x or x/2
        k += i >> 20;
        f = x - 1.0;
        if ((0x000fffff & (2 + hx)) < 3)
        {
            // |f| < 2**-20
            if (f == zero)
            {
                if (k == 0) return zero;
                dk = k;
                return dk * ln2_hi + dk * ln2_lo;
            }
            R = f * f * (0.5 - 0.33333333333333333 * f);
            if (k == 0) return f - R;
            dk = k;
            return dk * ln2_hi - ((R - dk * ln2_lo) - f);
        }
        s = f / (2.0 + f);
        dk = k;
        z = s * s;
        i = hx - 0x6147a;
        w = z * z;
        j = 0x6b851 - hx;
        t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
        t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
        i |= j;
        R = t2 + t1;
        if (i > 0)
        {
            hfsq = 0.5 * f * f;
            if (k == 0) return f - (hfsq - s * (hfsq + R));
            return dk * ln2_hi - ((hfsq - (s * (hfsq + R) + dk * ln2_lo)) - f);
        }
        if (k == 0) return f - s * (f - R);
        return dk * ln2_hi - ((s * (f - R) - dk * ln2_lo) - f);
    }

    /* Math.log10 */
    public static double Log10(double x)
    {
        const double zero = 0.0, two54 = 1.80143985094819840000e+16;
        double ivln10 = Bits(0x3FDBCB7B1526E50E), log10_2hi = Bits(0x3FD34413509F6000), log10_2lo = Bits(0x3D59FEF311F12B36);
        int hx = Hi(x);
        uint lx = Lo(x);
        int k = 0;
        if (hx < 0x00100000)
        {
            if (((hx & 0x7fffffff) | (int)lx) == 0) return double.NegativeInfinity;
            if (hx < 0) return double.NaN;
            k -= 54;
            x *= two54;
            hx = Hi(x);
            lx = Lo(x);
        }
        if (hx >= 0x7ff00000) return x + x;
        if (hx == 0x3ff00000 && lx == 0) return zero;   // log10(1) = +0
        k += (hx >> 20) - 1023;
        var i = (int)(((uint)k & 0x80000000) >> 31);
        hx = (hx & 0x000fffff) | ((0x3ff - i) << 20);
        double y = k + i;
        x = Words(hx, lx);
        var z = y * log10_2lo + ivln10 * Log(x);
        return z + y * log10_2hi;
    }

    // ------------------------------------------------------------ pow

    /* Math.pow (and **): ±1 to the power ±∞ is NaN, as ECMAScript has always had it. */
    public static double Pow(double x, double y)
    {
        const double zero = 0.0, one = 1.0, two = 2.0, two53 = 9007199254740992.0, huge = 1.0e300, tiny = 1.0e-300;
        double[] bp = [1.0, 1.5], dp_h = [0.0, Bits(0x3FE2B80340000000)], dp_l = [0.0, Bits(0x3E4CFDEB43CFD006)];
        double L1 = Bits(0x3FE3333333333303), L2 = Bits(0x3FDB6DB6DB6FABFF), L3 = Bits(0x3FD55555518F264D),
            L4 = Bits(0x3FD17460A91D4101), L5 = Bits(0x3FCD864A93C9DB65), L6 = Bits(0x3FCA7E284A454EEF),
            P1 = Bits(0x3FC555555555553E), P2 = Bits(0xBF66C16C16BEBD93), P3 = Bits(0x3F11566AAF25DE2C),
            P4 = Bits(0xBEBBBD41C5D26BF1), P5 = Bits(0x3E66376972BEA4D0),
            lg2 = Bits(0x3FE62E42FEFA39EF), lg2_h = Bits(0x3FE62E4300000000), lg2_l = Bits(0xBE205C610CA86C39),
            ovt = 8.0085662595372944372e-0017,
            cp = Bits(0x3FEEC709DC3A03FD), cp_h = Bits(0x3FEEC709E0000000), cp_l = Bits(0xBE3E2FE0145B01F5),
            ivln2 = Bits(0x3FF71547652B82FE), ivln2_h = Bits(0x3FF7154760000000), ivln2_l = Bits(0x3E54AE0BF85DDF44);

        double z, ax, z_h, z_l, p_h, p_l, y1, t1, t2, r, s, t, u, v, w;
        int i, j, k, yisint, n, hx, hy, ix, iy;
        uint lx, ly;

        hx = Hi(x); lx = Lo(x);
        hy = Hi(y); ly = Lo(y);
        ix = hx & 0x7fffffff;
        iy = hy & 0x7fffffff;

        if ((iy | (int)ly) == 0) return one;   // x**0 = 1
        if (ix > 0x7ff00000 || (ix == 0x7ff00000 && lx != 0) || iy > 0x7ff00000 || (iy == 0x7ff00000 && ly != 0)) return x + y;   // NaN

        // yisint: 0 not an integer, 1 an odd one, 2 an even one (when x < 0).
        yisint = 0;
        if (hx < 0)
        {
            if (iy >= 0x43400000) yisint = 2;
            else if (iy >= 0x3ff00000)
            {
                k = (iy >> 20) - 0x3ff;
                if (k > 20)
                {
                    var jj = ly >> (52 - k);
                    if ((jj << (52 - k)) == ly) yisint = 2 - (int)(jj & 1);
                }
                else if (ly == 0)
                {
                    j = iy >> (20 - k);
                    if ((j << (20 - k)) == iy) yisint = 2 - (j & 1);
                }
            }
        }

        if (ly == 0)
        {
            if (iy == 0x7ff00000)
            {
                // y is ±∞
                if (((ix - 0x3ff00000) | (int)lx) == 0) return y - y;   // (±1)**±∞ is NaN
                if (ix >= 0x3ff00000) return hy >= 0 ? y : zero;
                return hy < 0 ? -y : zero;
            }
            if (iy == 0x3ff00000) return hy < 0 ? one / x : x;   // y is ±1
            if (hy == 0x40000000) return x * x;   // y is 2
            if (hy == 0x3fe00000 && hx >= 0) return Math.Sqrt(x);   // y is 0.5, x >= +0
        }

        ax = Math.Abs(x);
        if (lx == 0 && (ix == 0x7ff00000 || ix == 0 || ix == 0x3ff00000))
        {
            z = ax;   // x is ±0, ±∞, ±1
            if (hy < 0) z = one / z;
            if (hx < 0)
            {
                if (((ix - 0x3ff00000) | yisint) == 0) z = (z - z) / (z - z);   // (−1)**non-integer
                else if (yisint == 1) z = -z;
            }
            return z;
        }

        n = (hx >> 31) + 1;
        if ((n | yisint) == 0) return (x - x) / (x - x);   // (x<0)**non-integer
        s = one;
        if ((n | (yisint - 1)) == 0) s = -one;   // (−x)**odd

        if (iy > 0x41e00000)
        {
            // |y| > 2**31
            if (iy > 0x43f00000)
            {
                if (ix <= 0x3fefffff) return hy < 0 ? huge * huge : tiny * tiny;
                if (ix >= 0x3ff00000) return hy > 0 ? huge * huge : tiny * tiny;
            }
            if (ix < 0x3fefffff) return hy < 0 ? s * huge * huge : s * tiny * tiny;
            if (ix > 0x3ff00000) return hy > 0 ? s * huge * huge : s * tiny * tiny;
            t = ax - one;
            w = (t * t) * (0.5 - t * (0.3333333333333333333333 - t * 0.25));
            u = ivln2_h * t;
            v = t * ivln2_l - w * ivln2;
            t1 = SetLo(u + v, 0);
            t2 = v - (t1 - u);
        }
        else
        {
            double ss, s2, s_h, s_l, t_h, t_l;
            n = 0;
            if (ix < 0x00100000) { ax *= two53; n -= 53; ix = Hi(ax); }   // subnormal
            n += (ix >> 20) - 0x3ff;
            j = ix & 0x000fffff;
            ix = j | 0x3ff00000;
            if (j <= 0x3988E) k = 0;   // |x| < sqrt(3/2)
            else if (j < 0xBB67A) k = 1;   // |x| < sqrt(3)
            else { k = 0; n += 1; ix -= 0x00100000; }
            ax = SetHi(ax, ix);

            u = ax - bp[k];
            v = one / (ax + bp[k]);
            ss = u * v;
            s_h = SetLo(ss, 0);
            t_h = Words(((ix >> 1) | 0x20000000) + 0x00080000 + (k << 18), 0);
            t_l = ax - (t_h - bp[k]);
            s_l = v * ((u - s_h * t_h) - s_h * t_l);
            s2 = ss * ss;
            r = s2 * s2 * (L1 + s2 * (L2 + s2 * (L3 + s2 * (L4 + s2 * (L5 + s2 * L6)))));
            r += s_l * (s_h + ss);
            s2 = s_h * s_h;
            t_h = SetLo(3.0 + s2 + r, 0);
            t_l = r - ((t_h - 3.0) - s2);
            u = s_h * t_h;
            v = s_l * t_h + t_l * ss;
            p_h = SetLo(u + v, 0);
            p_l = v - (p_h - u);
            z_h = cp_h * p_h;
            z_l = cp_l * p_h + p_l * cp + dp_l[k];
            t = n;
            t1 = SetLo(((z_h + z_l) + dp_h[k]) + t, 0);
            t2 = z_l - (((t1 - t) - dp_h[k]) - z_h);
        }

        // (y1 + y2)·(t1 + t2)
        y1 = SetLo(y, 0);
        p_l = (y - y1) * t1 + y * t2;
        p_h = y1 * t1;
        z = p_l + p_h;
        j = Hi(z);
        i = (int)Lo(z);
        if (j >= 0x40900000)
        {
            // z >= 1024
            if (((j - 0x40900000) | i) != 0) return s * huge * huge;
            if (p_l + ovt > z - p_h) return s * huge * huge;
        }
        else if ((j & 0x7fffffff) >= 0x4090cc00)
        {
            // z <= −1075
            if ((((uint)j - 0xc090cc00u) | (uint)i) != 0) return s * tiny * tiny;
            if (p_l <= z - p_h) return s * tiny * tiny;
        }

        // 2**(p_h + p_l)
        i = j & 0x7fffffff;
        k = (i >> 20) - 0x3ff;
        n = 0;
        if (i > 0x3fe00000)
        {
            n = j + (0x00100000 >> (k + 1));
            k = ((n & 0x7fffffff) >> 20) - 0x3ff;
            t = Words(n & ~(0x000fffff >> k), 0);
            n = ((n & 0x000fffff) | 0x00100000) >> (20 - k);
            if (j < 0) n = -n;
            p_h -= t;
        }
        t = SetLo(p_l + p_h, 0);
        u = t * lg2_h;
        v = (p_l - (t - p_h)) * lg2 + t * lg2_l;
        z = u + v;
        w = v - (z - u);
        t = z * z;
        t1 = z - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
        // V8's own bracketing, not fdlibm's (z·t1/(t1−2) − (w + z·w)): one result
        // in twenty differs from fdlibm's in the last bit, and this is V8's.
        r = (z * t1) / ((t1 - two) - (w + z * w));
        z = one - (r - z);
        j = Hi(z);
        j += n << 20;
        if ((j >> 20) <= 0) z = Math.ScaleB(z, n);   // subnormal
        else z = SetHi(z, Hi(z) + (n << 20));
        return s * z;
    }
}
