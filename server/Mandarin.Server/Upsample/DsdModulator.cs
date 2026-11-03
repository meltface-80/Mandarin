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

    /* The most the quantiser's input has been. */
    public double Most { get; private set; }

    /*
     * [x] (at the DSD rate, ±1 the most the modulation goes) made bits into [bits]: sample k is bit k % 8 of byte
     * k / 8, the least significant first, as DSF lays them out; set for +1. [x]'s length is a multiple of 8.
     */
    public void Run(ReadOnlySpan<double> x, Span<byte> bits)
    {
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
}
