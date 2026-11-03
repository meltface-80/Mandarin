// UpsampleRules.cs — the whole-track upsampler measured, for the tests (bug list item 237; RulesCommand's
// "wholetrack"). Tones are made at the input rate, faded in and out, upsampled, and set against the same tones worked
// out exactly at the output rate: what differs is the upsampler's error, in dB below full scale.
using Mandarin.Server.Tags;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Upsample;

internal static class UpsampleRules
{
    /*
     * { rate, factor, seconds, tones: [[hz, amplitude]], max_out_bits, pass } → { error_db, peak, gain, sections, frames },
     * the error over the middle (a second in from each end). With compare: true, the same also done in sections of
     * 2^max_out_bits points and set against the whole: { error_db, joins_db }. With fft: n, the transform against
     * the DFT done by hand on n points: { fft_db, round_trip_db }. With shape ("min", "gentle", item 248) the filter
     * of that shape; with gains: true, each tone's level out against its level in, in dB ({ gains_db }); with
     * impulse: true, a click in the middle instead of the tones, and its ringing before and after it
     * ({ pre_db, post_db, pre_energy_db }: WholeShapeRules.cs).
     */
    public static JsObj Run(JsObj job)
    {
        if (job["fft"] is double fn) return FftCheck((int)fn);
        var rate = (int)TJs.ToNumber(job["rate"]);
        var factor = (int)TJs.ToNumber(job["factor"]);
        var shape = job["shape"] as string;
        if (job["impulse"] is true) return WholeShapeRules.Impulse(rate, factor, shape);
        var seconds = TJs.ToNumber(job["seconds"]);
        var tones = (job["tones"] as List<object?> ?? []).Select(t => t as List<object?> ?? []).Select(t => (Hz: TJs.ToNumber(t[0]), Amp: TJs.ToNumber(t[1]))).ToArray();
        var pass = job["pass"] is double p ? p : 0.95;
        var maxBits = job["max_out_bits"] is double mb ? (int)mb : 28;
        var frames = (long)(seconds * rate);
        var fade = (long)(0.25 * rate);
        double Signal(double t, long i, long n) => Envelope(i, n, fade) * tones.Sum(x => x.Amp * Math.Sin(2 * Math.PI * x.Hz * t));
        var left = new double[frames]; var right = new double[frames];
        for (long i = 0; i < frames; i++) { left[i] = Signal((double)i / rate, i, frames); right[i] = -0.5 * left[i]; }

        double[] Upsampled(int bits, out WholeTrack.Result r)
        {
            var outL = new double[frames * factor]; var outR = new double[frames * factor];
            long at = 0;
            var opts = shape != null ? WholeTrack.Options.For(factor, shape, bits) : new WholeTrack.Options(factor, pass, MaxOutBits: bits);
            r = WholeTrack.Run(left, right, rate, opts, (re, im, from, count, gain) =>
            {
                for (long i = 0; i < count; i++) { outL[at + i] = re[from + i] * gain; outR[at + i] = im[from + i] * gain; }
                at += count;
            });
            // The right channel is the left's -½: any leak between them shows here too.
            double leak = 0;
            for (long i = 0; i < outL.LongLength; i++) leak = Math.Max(leak, Math.Abs(outR[i] + 0.5 * outL[i]));
            Leak = Math.Max(Leak, leak);
            return outL;
        }

        Leak = 0;
        var whole = Upsampled(maxBits, out var res);
        // The middle, against the tones worked out exactly at the output rate (the gain taken off).
        var outRate = (double)rate * factor;
        var outFrames = frames * factor;
        double err = 0;
        for (var i = (long)outRate; i < outFrames - (long)outRate; i++)
            err = Math.Max(err, Math.Abs(whole[i] / res.Gain - Signal(i / outRate, i / factor, frames)));
        var o = new JsObj
        {
            ["error_db"] = Db(err), ["peak"] = res.Peak, ["gain"] = res.Gain, ["sections"] = (double)res.Sections,
            ["frames"] = (double)res.Frames, ["leak_db"] = Db(Leak),
        };
        if (job["gains"] is true) o["gains_db"] = WholeShapeRules.Gains(whole, res.Gain, outRate, seconds, tones);
        if (job["compare"] is true)
        {
            var parts = Upsampled((int)TJs.ToNumber(job["section_bits"]), out var pr);
            double d = 0;
            for (long i = 0; i < outFrames; i++) d = Math.Max(d, Math.Abs(parts[i] / pr.Gain - whole[i] / res.Gain));
            o["joins_db"] = Db(d);
            o["section_count"] = (double)pr.Sections;
        }
        return o;
    }

    private static double Leak;

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
