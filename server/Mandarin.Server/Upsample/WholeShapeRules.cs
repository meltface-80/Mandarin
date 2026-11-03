// WholeShapeRules.cs — the whole-track filter's shapes measured (bug list item 248), for the tests (UpsampleRules.cs):
// each tone's level through the filter, and a click's ringing before and after it, where a linear-phase filter rings
// on both sides and a minimum-phase one only after.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Upsample;

internal static class WholeShapeRules
{
    /*
     * Each of [tones]' level in [y] (at [outRate], [gain] on it) against its level in, in dB: each tone's sine and
     * cosine parts over the whole seconds between the first and the last, where every tone has whole cycles.
     */
    public static List<object?> Gains(double[] y, double gain, double outRate, double seconds, (double Hz, double Amp)[] tones)
    {
        var from = (long)outRate;
        var to = (long)(outRate * (Math.Floor(seconds) - 1));
        var n = to - from;
        var out_ = new List<object?>();
        foreach (var (hz, amp) in tones)
        {
            double a = 0, b = 0;
            for (var i = from; i < to; i++)
            {
                var (s, c) = Math.SinCos(2 * Math.PI * hz * i / outRate);
                a += y[i] * s; b += y[i] * c;
            }
            var level = 2 * Math.Sqrt(a * a + b * b) / n / gain;
            out_.Add(UpsampleRules.Db(level / amp));
        }
        return out_;
    }

    /*
     * A click (one sample of 0.5) in the middle of four seconds at [rate], upsampled by [factor] in [shape]: the most
     * the output rings more than a millisecond before and after the click, and the share of its energy before the
     * click (more than one input sample before), in dB against the output's peak and its whole.
     */
    public static JsObj Impulse(int rate, int factor, string? shape)
    {
        var frames = 4L * rate;
        var left = new double[frames]; var right = new double[frames];
        left[frames / 2] = 0.5; right[frames / 2] = -0.25;
        var y = new double[frames * factor];
        long at = 0;
        var r = WholeTrack.Run(left, right, rate, WholeTrack.Options.For(factor, shape, 28), (re, _, from, count, g) =>
        {
            for (long i = 0; i < count; i++) y[at + i] = re[from + i] * g;
            at += count;
        });
        var p = frames / 2 * factor;   // the click's own time at the output rate
        var peak = y.Max(Math.Abs);
        var ms = (long)(rate * factor / 1000.0);
        double pre = 0, post = 0, before = 0, all = 0;
        for (long i = 0; i < y.LongLength; i++)
        {
            var v = Math.Abs(y[i]);
            if (i < p - ms) pre = Math.Max(pre, v);
            if (i > p + ms) post = Math.Max(post, v);
            if (i < p - factor) before += v * v;
            all += v * v;
        }
        return new JsObj
        {
            ["pre_db"] = UpsampleRules.Db(pre / peak), ["post_db"] = UpsampleRules.Db(post / peak),
            ["pre_energy_db"] = 10 * Math.Log10(Math.Max(before, 1e-300) / all), ["gain"] = r.Gain,
        };
    }
}
