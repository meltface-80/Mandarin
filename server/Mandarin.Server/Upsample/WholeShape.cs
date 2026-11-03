// WholeShape.cs — the whole-track filter's shapes (bug list item 248): linear phase, minimum phase, or gentle.
//
// Linear phase (WholeTrack.cs's own) is the same response in level as it was: no phase shift at any frequency, and so
// its ringing, where a transient is filtered, falls evenly before and after it. Minimum phase keeps those levels and
// gives them the one phase that puts all the ringing after the transient, none before it. Gentle is linear phase with
// the roll-off begun earlier, at [GentlePass] of the Nyquist frequency: twice as wide a slope, so its ringing lasts half
// as long, at the cost of the top of the band (from 19.8 kHz for a CD, down 6 dB by 21 kHz).
//
// The minimum phase is worked out by the cepstrum, on the output's grid of bins: the filter is the whole of the
// upsampling, the band and the nothing above it to the new Nyquist frequency, and only as a whole is it made causal
// (worked out on the input's grid alone, it is causal at the input's samples and rings before a transient between
// them). The logarithm of the levels is taken back to the time domain, folded onto its positive half (the causal part,
// doubled; the rest nothing), and brought forward again; the exponential of that is the minimum-phase response.
// Where the level is nothing (above the band) the logarithm is held at [Floor], 160 dB down: the response there is
// that, not nothing, and never laid on anything (WholeTrack.cs fills only the band). A deeper floor makes a sharper
// corner in the logarithm, and the cepstrum, held to the grid, follows it less well: at 160 dB a track done in sections
// and the same done whole (two grids) agree to some 145 dB, below what a 24-bit sample holds, and what rings before a
// transient is some 180 dB down.
namespace Mandarin.Server.Upsample;

internal static class WholeShape
{
    public enum Kind { Linear, Minimum, Gentle }

    /* The fraction of the Nyquist frequency the gentle filter's roll-off begins at (the linear one's: 0.95). */
    public const double GentlePass = 0.90;

    /* The least level the minimum-phase response is worked out with: 160 dB down. */
    public const double Floor = 1e-8;

    /* A plan's "shape": "min" for minimum phase, "gentle", anything else linear. */
    public static Kind Of(string? shape) => shape switch { "min" => Kind.Minimum, "gentle" => Kind.Gentle, _ => Kind.Linear };

    /* The plan's word for [kind]: "min", "gentle", or null for linear. */
    public static string? Word(Kind kind) => kind switch { Kind.Minimum => "min", Kind.Gentle => "gentle", _ => null };

    /* A device's Output filter ("whole", "minphase", "gentle") as a plan's shape; null for linear or none. */
    public static string? OfFilter(object? filter) => filter switch { "minphase" => "min", "gentle" => "gentle", _ => null };

    /* Whether [filter] is one made ahead in one transform: whole, minimum phase, gentle. */
    public static bool MadeAhead(object? filter) => filter is "whole" or "minphase" or "gentle";

    /* The words for the filter of [shape], as Now playing says them. */
    public static string Name(string? shape) => Of(shape) switch
    {
        Kind.Minimum => "Minimum-phase filter",
        Kind.Gentle => "Gentle filter",
        _ => "Whole-track filter",
    };

    /* The same as said of a track still to be made: "whole track", "minimum phase", "gentle filter". */
    public static string Making(string? shape) => Of(shape) switch
    {
        Kind.Minimum => "minimum phase",
        Kind.Gentle => "gentle filter",
        _ => "whole track",
    };

    /*
     * [h], the levels at the input's bins 0..nIn/2, made minimum phase as the filter of the whole upsampling, worked out
     * on the output's transform [f] (the same spacing of bins, [f].Length / nIn times as many): [h] left the real
     * part, the imaginary part returned. [re] and [im] are the output transform's own arrays, used to work it out in.
     */
    public static double[] Minimum(double[] h, long nIn, Fft f, double[] re, double[] im)
    {
        var n = f.Length;
        var half = n / 2;
        var halfIn = nIn / 2;
        var scale = h.Max();
        if (scale <= 0) return new double[halfIn + 1];
        // The logarithm of the levels, every output bin (nothing above the input's band), in the bit-reversed order
        // the inverse takes.
        Parallel.For(0, n, Fft.Options, k =>
        {
            var b = k <= half ? k : n - k;
            var level = b <= halfIn ? h[b] / scale : 0;
            re[f.BitReverse(k)] = Math.Log(Math.Max(level, Floor));
            im[f.BitReverse(k)] = 0;
        });
        f.Inverse(re, im);
        // The cepstrum folded: the causal half doubled, the rest nothing.
        Parallel.For(0, n, Fft.Options, i =>
        {
            if (i > half) re[i] = 0;
            else if (i > 0 && i < half) re[i] *= 2;
            im[i] = 0;
        });
        f.Forward(re, im);
        var outIm = new double[halfIn + 1];
        Parallel.For(0, halfIn + 1, Fft.Options, k =>
        {
            var at = f.BitReverse(k);
            var mag = Math.Exp(re[at]) * scale;
            var (s, c) = Math.SinCos(im[at]);
            h[k] = mag * c;
            outIm[k] = mag * s;
        });
        return outIm;
    }
}
