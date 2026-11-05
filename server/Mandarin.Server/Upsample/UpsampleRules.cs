// UpsampleRules.cs — the upsampler measured, for the tests (bug list items 237, 259; RulesCommand's "upsample").
// Tones are made at the input rate, faded in and out, upsampled a block at a time (StreamUpsample.cs), and set against
// the same tones worked out exactly at the output rate: what differs is the upsampler's error, in dB below full scale.
using Mandarin.Server.Tags;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Upsample;

internal static class UpsampleRules
{
    /*
     * { rate, factor, seconds, tones: [[hz, amplitude]], shape? } → { error_db, leak_db, frames, out_frames, blocks_db }:
     * the error over the middle (a second in from each end), the left leaking into the right, the output's length, and
     * how far the output differs when the input comes in other blocks. With gains: true, each tone's level out against
     * its level in, in dB ({ gains_db }); with impulse: true, a click in the middle instead of the tones, and its
     * ringing before and after it ({ pre_db, post_db, pre_energy_db }). With fft: n, the transform against the DFT
     * done by hand on n points: { fft_db, round_trip_db }.
     */
    public static JsObj Run(JsObj job)
    {
        if (job["fft"] is double fn) return FftCheck((int)fn);
        if (job["taps"] is true) return TapsMeasured(job);
        var rate = (int)TJs.ToNumber(job["rate"]);
        var factor = (int)TJs.ToNumber(job["factor"]);
        var kind = Shape.Of(job["shape"] as string);
        if (job["impulse"] is true) return Impulse(rate, factor, kind);
        var seconds = TJs.ToNumber(job["seconds"]);
        var tones = (job["tones"] as List<object?> ?? []).Select(t => t as List<object?> ?? []).Select(t => (Hz: TJs.ToNumber(t[0]), Amp: TJs.ToNumber(t[1]))).ToArray();
        var frames = (long)(seconds * rate);
        var fade = (long)(0.25 * rate);
        double Signal(double t, long i, long n) => Envelope(i, n, fade) * tones.Sum(x => x.Amp * Math.Sin(2 * Math.PI * x.Hz * t));
        var left = new double[frames]; var right = new double[frames];
        for (long i = 0; i < frames; i++) { left[i] = Signal((double)i / rate, i, frames); right[i] = -0.5 * left[i]; }

        var (y, yr) = Upsampled(left, right, factor, kind, new Random(259));
        var (z, _) = Upsampled(left, right, factor, kind, new Random(7));
        double leak = 0, blocks = 0;
        for (long i = 0; i < y.LongLength; i++)
        {
            leak = Math.Max(leak, Math.Abs(yr[i] + 0.5 * y[i]));
            blocks = Math.Max(blocks, Math.Abs(y[i] - z[i]));
        }
        // The middle, against the tones worked out exactly at the output rate.
        var outRate = (double)rate * factor;
        double err = 0;
        for (var i = (long)outRate; i < y.LongLength - (long)outRate; i++)
            err = Math.Max(err, Math.Abs(y[i] - Signal(i / outRate, i / factor, frames)));
        var o = new JsObj
        {
            ["error_db"] = Db(err), ["leak_db"] = Db(leak), ["blocks_db"] = Db(blocks),
            ["frames"] = (double)frames, ["out_frames"] = (double)y.LongLength,
        };
        if (job["gains"] is true) o["gains_db"] = Gains(y, outRate, seconds, tones);
        return o;
    }

    // [left] and [right] through the upsampler, pushed in blocks of sizes drawn from [rnd]: the two channels out.
    private static (double[] L, double[] R) Upsampled(double[] left, double[] right, int factor, Shape.Kind kind, Random rnd)
    {
        var l = new List<double>(left.Length * factor);
        var r = new List<double>(left.Length * factor);
        var up = new StreamUpsample(factor, kind, (a, b, n) => { l.AddRange(a.AsSpan(0, n)); r.AddRange(b.AsSpan(0, n)); });
        for (var at = 0; at < left.Length;)
        {
            var n = Math.Min(left.Length - at, 1 + rnd.Next(20000));
            up.Push(left.AsSpan(at, n), right.AsSpan(at, n));
            at += n;
        }
        up.Finish();
        return ([.. l], [.. r]);
    }

    // Each of [tones]' level in [y] (at [outRate]) against its level in, in dB, over the whole seconds but the first and last.
    private static List<object?> Gains(double[] y, double outRate, double seconds, (double Hz, double Amp)[] tones)
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
            out_.Add(Db(2 * Math.Sqrt(a * a + b * b) / n / amp));
        }
        return out_;
    }

    /*
     * A click (one sample of 0.5) in the middle of four seconds at [rate], upsampled by [factor] in [kind]: the most
     * the output rings more than a millisecond before and after the click, and the share of its energy before the
     * click (more than one input sample before), in dB against the output's peak and its whole.
     */
    private static JsObj Impulse(int rate, int factor, Shape.Kind kind)
    {
        var frames = 4 * rate;
        var left = new double[frames]; var right = new double[frames];
        left[frames / 2] = 0.5; right[frames / 2] = -0.25;
        var (y, _) = Upsampled(left, right, factor, kind, new Random(1));
        var p = (long)frames / 2 * factor;   // the click's own time at the output rate
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
            ["pre_db"] = Db(pre / peak), ["post_db"] = Db(post / peak),
            ["pre_energy_db"] = 10 * Math.Log10(Math.Max(before, 1e-300) / all),
        };
    }

    /*
     * { taps: true, rate, factor, shape, at: [hz] } → { gains_db, pre_ms, keeps_db, length } (item 298): the filter itself,
     * its response at each frequency (an exact DFT of its taps), how long before a click it rings above −120 dB of its
     * peak, and how far from nothing its taps are at every [factor]th place but the middle (where a filter keeps the
     * source's samples as they were, they are nothing).
     */
    private static JsObj TapsMeasured(JsObj job)
    {
        var rate = TJs.ToNumber(job["rate"]);
        var factor = (int)TJs.ToNumber(job["factor"]);
        var h = StreamUpsample.Taps(factor, Shape.Of(job["shape"] as string));
        var mid = (h.Length - 1) / 2;
        var outRate = rate * factor;
        var gains = new List<object?>();
        foreach (var f in job["at"] as List<object?> ?? [])
        {
            double re = 0, im = 0, w = 2 * Math.PI * TJs.ToNumber(f) / outRate;
            for (var i = 0; i < h.Length; i++) { var (sn, cs) = Math.SinCos(w * (i - mid)); re += h[i] * cs; im -= h[i] * sn; }
            gains.Add(Db(Math.Sqrt(re * re + im * im) / factor));
        }
        var peak = h.Max(Math.Abs);
        var first = Array.FindIndex(h, v => Math.Abs(v) > 1e-6 * peak);
        double keeps = 0;
        for (var i = mid % factor; i < h.Length; i += factor) if (i != mid) keeps = Math.Max(keeps, Math.Abs(h[i]));
        return new JsObj
        {
            ["gains_db"] = gains, ["pre_ms"] = (mid - first) / outRate * 1000, ["keeps_db"] = Db(keeps / Math.Abs(h[mid])), ["length"] = (double)h.Length,
        };
    }

    // Up and down over [fade] frames at each end (a Hann half), so the tones start and stop without a click.
    private static double Envelope(long i, long n, long fade)
    {
        if (i < fade) return 0.5 - 0.5 * Math.Cos(Math.PI * i / fade);
        if (i >= n - fade) return 0.5 - 0.5 * Math.Cos(Math.PI * (n - 1 - i) / fade);
        return 1;
    }

    internal static double Db(double x) => x <= 0 ? -400 : 20 * Math.Log10(x);

    // The transform against a DFT done by hand, and a round trip back to the start.
    private static JsObj FftCheck(int n)
    {
        var bits = System.Numerics.BitOperations.Log2((uint)n);
        var fft = new Fft(bits);
        var rnd = new Random(236);
        double[] re = new double[n], im = new double[n];
        for (var i = 0; i < n; i++) { re[i] = rnd.NextDouble() - 0.5; im[i] = rnd.NextDouble() - 0.5; }
        double[] r0 = (double[])re.Clone(), i0 = (double[])im.Clone();
        fft.Forward(re, im);
        double worst = 0;
        for (var k = 0; k < n; k++)
        {
            double sr = 0, si = 0;
            for (var t = 0; t < n; t++)
            {
                var (s, c) = Math.SinCos(-2 * Math.PI * ((long)k * t % n) / n);
                sr += r0[t] * c - i0[t] * s; si += r0[t] * s + i0[t] * c;
            }
            var at = fft.BitReverse(k);
            worst = Math.Max(worst, Math.Max(Math.Abs(re[at] - sr), Math.Abs(im[at] - si)));
        }
        fft.Inverse(re, im);
        double back = 0;
        for (var i = 0; i < n; i++) back = Math.Max(back, Math.Max(Math.Abs(re[i] - r0[i]), Math.Abs(im[i] - i0[i])));
        return new JsObj { ["fft_db"] = Db(worst / n), ["round_trip_db"] = Db(back) };
    }
}
