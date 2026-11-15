// KissFft.cs — the real FFT Chromaprint's fingerprints are computed with (bug list item 414c, Chromaprint.cs): KISS
// FFT's kiss_fftr in single precision, step for step as chromaprint 1.5's bundled copy (3rdparty/kissfft, the build
// Debian's and Ubuntu's fpcalc use), so the spectrum, and with it every bit of a fingerprint, is the reference's. Only
// what a frame of 4096 needs is here: the complex transform of 2048 by radix 4 and 2, forward. KISS FFT is Mark
// Borgerding's, BSD-licensed.
namespace Mandarin.Server.Identify;

internal sealed class KissFft
{
    private struct Cpx { public float R, I; }

    private readonly int ncfft;                 // the complex transform's size: half the real one
    private readonly Cpx[] twiddles;
    private readonly Cpx[] super;               // kiss_fftr's super_twiddles
    private readonly List<int> factors = [];
    private readonly Cpx[] input, tmp;

    /* A real transform of [nfft] points (even, its half a product of 4s and 2s). */
    public KissFft(int nfft)
    {
        ncfft = nfft / 2;
        twiddles = new Cpx[ncfft];
        for (var i = 0; i < ncfft; i++)
        {
            var phase = -2 * Math.PI * i / ncfft;
            twiddles[i] = new Cpx { R = (float)Math.Cos(phase), I = (float)Math.Sin(phase) };
        }
        // kf_factor: powers of 4, then of 2 (no other radix is needed for a frame of 4096).
        var n = ncfft;
        var p = 4;
        while (n > 1)
        {
            while (n % p != 0)
            {
                if (p != 4) throw new ArgumentException("only radix 4 and 2", nameof(nfft));
                p = 2;
            }
            n /= p;
            factors.Add(p);
            factors.Add(n);
        }
        super = new Cpx[ncfft / 2];
        for (var i = 0; i < ncfft / 2; i++)
        {
            var phase = -Math.PI * ((double)(i + 1) / ncfft + .5);
            super[i] = new Cpx { R = (float)Math.Cos(phase), I = (float)Math.Sin(phase) };
        }
        input = new Cpx[ncfft];
        tmp = new Cpx[ncfft];
    }

    private static Cpx Mul(Cpx a, Cpx b) => new() { R = a.R * b.R - a.I * b.I, I = a.R * b.I + a.I * b.R };

    private void Work(int fout, int f, int fstride, int fi)
    {
        var p = factors[fi];
        var m = factors[fi + 1];
        var end = fout + p * m;
        var beg = fout;
        if (m == 1)
        {
            do { tmp[fout] = input[f]; f += fstride; } while (++fout != end);
        }
        else
        {
            do { Work(fout, f, fstride * p, fi + 2); f += fstride; } while ((fout += m) != end);
        }
        if (p == 4) Bfly4(beg, fstride, m);
        else Bfly2(beg, fstride, m);
    }

    private void Bfly2(int fout, int fstride, int m)
    {
        var tw = 0;
        var fout2 = fout + m;
        do
        {
            var t = Mul(tmp[fout2], twiddles[tw]);
            tw += fstride;
            tmp[fout2] = new Cpx { R = tmp[fout].R - t.R, I = tmp[fout].I - t.I };
            tmp[fout].R += t.R;
            tmp[fout].I += t.I;
            ++fout2;
            ++fout;
        } while (--m != 0);
    }

    private void Bfly4(int fout, int fstride, int m)
    {
        int tw1 = 0, tw2 = 0, tw3 = 0;
        int m2 = 2 * m, m3 = 3 * m;
        var k = m;
        do
        {
            var s0 = Mul(tmp[fout + m], twiddles[tw1]);
            var s1 = Mul(tmp[fout + m2], twiddles[tw2]);
            var s2 = Mul(tmp[fout + m3], twiddles[tw3]);
            var s5 = new Cpx { R = tmp[fout].R - s1.R, I = tmp[fout].I - s1.I };
            tmp[fout].R += s1.R;
            tmp[fout].I += s1.I;
            var s3 = new Cpx { R = s0.R + s2.R, I = s0.I + s2.I };
            var s4 = new Cpx { R = s0.R - s2.R, I = s0.I - s2.I };
            tmp[fout + m2] = new Cpx { R = tmp[fout].R - s3.R, I = tmp[fout].I - s3.I };
            tw1 += fstride;
            tw2 += fstride * 2;
            tw3 += fstride * 3;
            tmp[fout].R += s3.R;
            tmp[fout].I += s3.I;
            tmp[fout + m] = new Cpx { R = s5.R + s4.I, I = s5.I - s4.R };
            tmp[fout + m3] = new Cpx { R = s5.R - s4.I, I = s5.I + s4.R };
            ++fout;
        } while (--k != 0);
    }

    /*
     * The power spectrum of [time] (nfft samples) into [power] (nfft / 2 + 1 bins): kiss_fftr, then each bin's
     * re² + im² in single precision, as chromaprint's FFTLib::Compute has it.
     */
    public void Power(float[] time, double[] power)
    {
        for (var i = 0; i < ncfft; i++) input[i] = new Cpx { R = time[2 * i], I = time[2 * i + 1] };
        Work(0, 0, 1, 0);
        var dc = tmp[0];
        power[0] = Sq(dc.R + dc.I, 0);
        power[ncfft] = Sq(dc.R - dc.I, 0);
        for (var k = 1; k <= ncfft / 2; k++)
        {
            var fpk = tmp[k];
            var fpnk = new Cpx { R = tmp[ncfft - k].R, I = -tmp[ncfft - k].I };
            var f1k = new Cpx { R = fpk.R + fpnk.R, I = fpk.I + fpnk.I };
            var f2k = new Cpx { R = fpk.R - fpnk.R, I = fpk.I - fpnk.I };
            var tw = Mul(f2k, super[k - 1]);
            power[k] = Sq((f1k.R + tw.R) * 0.5f, (f1k.I + tw.I) * 0.5f);
            power[ncfft - k] = Sq((f1k.R - tw.R) * 0.5f, (tw.I - f1k.I) * 0.5f);
        }
    }

    private static double Sq(float r, float i) => r * r + i * i;
}
