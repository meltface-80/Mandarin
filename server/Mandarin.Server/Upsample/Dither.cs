// Dither.cs — the last bit rounded when Mandarin makes the PCM (bug list item 301): Mandarin's own, in place of
// ffmpeg's, wherever a track is made as it plays (MadeAsPlayed.cs) and a device's Output asks for it.
//
// Two choices on a device's Output. The DAC's real bits: how many bits it resolves above its own noise (20 to 23), the
// dither put in at that bit and the bits below it left at zero; or as sent, at the word's own depth. And the dither:
// flat (triangular, its noise even at every frequency: what ffmpeg did), or shaped, its noise moved above the audio
// band by error feedback, of the 3rd order or the 5th. A shaper's zeros are those that spread its noise lowest across
// 0 to 20 kHz (Schreier's optimal zeros, scaled to the band); its feedback is the noise transfer function's numerator
// with the leading 1 taken off, so that what comes out is the input plus the rounding error filtered by it. At 44.1
// and 48 kHz there is no room above the band to move the noise to (it measured 3 dB worse), so shaping is only made at
// 88.2 kHz and up; below, flat.
//
// What it makes is 32-bit samples, the word's bits at the top, for ffmpeg to encode as they are (no dither of its own).
namespace Mandarin.Server.Upsample;

internal static class Dither
{
    /* The device settings' words for a shaped dither: "ns3", "ns5"; flat by its absence. */
    public static readonly string[] Shapes = ["ns3", "ns5"];

    /* The real bits a device may be set to; as sent by its absence. */
    public const int FewestBits = 20, MostBits = 23;

    /* The lowest rate a shaped dither is made at: none at 44.1 or 48 kHz. */
    public const long ShapedFrom = 88200;

    /* A shaped dither's setting (null: flat); anything else is flat. */
    public static string? Of(object? v) => v is string s && Array.IndexOf(Shapes, s) >= 0 ? s : null;

    /* The real bits a setting holds (0: as sent). */
    public static int BitsOf(object? v) => v is double d && d >= FewestBits && d <= MostBits && d == Math.Floor(d) ? (int)d : v is int i && i >= FewestBits && i <= MostBits ? i : 0;

    /* The order of [shape]: 3, 5, or 0 for flat. */
    public static int Order(string? shape) => shape == "ns3" ? 3 : shape == "ns5" ? 5 : 0;

    /* The shape a track at [rate] is made with: [shape] at 88.2 kHz and up, flat below. */
    public static string? At(string? shape, long rate) => rate >= ShapedFrom ? Of(shape) : null;

    /* The depth the dither goes in at: [real] where it is set and under the word's [bits], else the word's. */
    public static int Depth(int bits, int real) => real > 0 && real < bits ? real : bits;

    /* Whether a device's settings ask for Mandarin's own: a shape, or real bits under the word's. */
    public static bool Asked(string? shape, int real, int bits) => Of(shape) != null || real > 0 && real < bits;

    /*
     * The cache key's part for it (Transcoder.KeyFor): "-n3"/"-n5" shaped, "-r20" the real bits; for a track with no
     * shape of its own (the standard filter) made as it plays all the same, the marks a shape's part carries ("-std",
     * the joins', "h" for a WAV's length in its header). Nothing with neither.
     */
    public static string Key(string? shape, string? dither, int real, bool wav) =>
        dither == null && real == 0 ? "" : (shape == null ? "-std" + Joins.Mark + (wav ? "h" : "") : "") + (dither != null ? "-n" + Order(dither) : "") + (real > 0 ? "-r" + real : "");

    /* In words, for Now playing's signal path: "shaped (5th order) at 20 bits", "flat at 24 bits". */
    public static string Words(string? shape, int depth) =>
        (Order(shape) is var o and > 0 ? $"shaped ({(o == 3 ? "3rd" : "5th")} order)" : "flat") + $" at {depth} bits";

    // Schreier's optimal zeros for the orders made, as fractions of the band edge (0 is a zero at DC).
    private static readonly double[][] Zeros = [[], [], [], [0, 0.7746], [], [0, 0.53847, 0.90618]];

    /* The error feedback for [order] at [rate]: the noise transfer function's numerator after its leading 1. */
    public static double[] Feedback(int order, long rate, double band = 20000)
    {
        if (order == 0) return [];
        double[] h = [1.0];
        foreach (var f in Zeros[order])
        {
            var w = 2 * Math.PI * f * band / rate;
            h = f == 0 ? Convolve(h, [1, -1]) : Convolve(h, [1, -2 * Math.Cos(w), 1]);
        }
        return h[1..];
    }

    private static double[] Convolve(double[] a, double[] b)
    {
        var c = new double[a.Length + b.Length - 1];
        for (var i = 0; i < a.Length; i++)
            for (var j = 0; j < b.Length; j++) c[i + j] += a[i] * b[j];
        return c;
    }

    /*
     * One channel's quantiser: a sample in (full scale ±1) to one on the grid of [depth] bits, triangular dither of
     * one step's width added before it is rounded, and the rounding errors before fed back through [feedback] (none:
     * flat). Seeded, so the same track is made the same each time.
     */
    public sealed class Channel(int depth, double[] feedback, ulong seed)
    {
        private readonly double step = Math.Pow(2, 1 - depth);
        private readonly double top = 1 - Math.Pow(2, 1 - depth);
        private readonly double[] errors = new double[feedback.Length];
        private int at;
        private ulong state = seed | 1;

        /* Samples held at full scale (a track's own peaks, after the shaper's noise is added). */
        public long Held { get; private set; }

        public double Next(double x)
        {
            var v = x;
            // Its errors before, newest first: v = x + Σ h[k]·e[n-1-k].
            for (var k = 0; k < feedback.Length; k++) v += feedback[k] * errors[(at - 1 - k + errors.Length * 2) % errors.Length];
            var y = Math.Round((v + (Uniform() - Uniform()) * step) / step) * step;
            if (y > top) { y = top; Held++; }
            else if (y < -1) { y = -1; Held++; }
            if (errors.Length > 0)
            {
                // A held sample's error kept to two steps, so that the shaper can't run away from it.
                errors[at] = Math.Clamp(y - v, -2 * step, 2 * step);
                at = (at + 1) % errors.Length;
            }
            return y;
        }

        // xorshift64*: a uniform in [0, 1).
        private double Uniform()
        {
            state ^= state >> 12; state ^= state << 25; state ^= state >> 27;
            return ((state * 2685821657736338717UL) >> 11) * (1.0 / (1UL << 53));
        }
    }

    /* A 32-bit word from a sample on the grid: its bits at the top. */
    public static int Word(double y) => (int)Math.Clamp(Math.Round(y * 2147483648.0), int.MinValue, int.MaxValue);

    /* The two channels' quantisers for a track made at [rate] and [bits], with [shape] and [real] bits. */
    public static (Channel Left, Channel Right) For(long rate, int bits, string? shape, int real)
    {
        var depth = Depth(bits, real);
        var fb = Feedback(Order(At(shape, rate)), rate);
        return (new Channel(depth, fb, 0x9E3779B97F4A7C15UL), new Channel(depth, fb, 0xC2B2AE3D27D4EB4FUL));
    }
}
