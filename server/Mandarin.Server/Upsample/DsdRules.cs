// DsdRules.cs — the PCM-to-DSD modulator measured, for the tests (bug list item 242; RulesCommand's "dsdmod").
//
// The bits are read back as ±1 and their spectrum taken under a Kaiser window (its side lobes far below anything
// measured, so a tone's skirts don't pass for noise): the noise from 20 Hz to 20 kHz, the tone's own bins aside, in
// dB below a full-scale sine (±1, the most the modulation goes; SACD's 0 dB is half of it, 6 dB down).
using Mandarin.Server.Tags;
using TJs = Mandarin.Server.Tags.Js;

namespace Mandarin.Server.Upsample;

internal static class DsdRules
{
    /*
     * { ntf: [order, rate, hinf] } → { peak, on_circle, predicted_db }: the design itself.
     * { rate, order, hinf, amp, hz, signal: "tone" | "tones" | "noise", seconds } → { noise_db, tone_db, resets, most }:
     *   the modulator alone, the signal made at the DSD rate (amp the peak, of ±1).
     * { chain: rate, amp, hz, seconds } → { noise_db, tone_db, samples, frames, resets }: 705.6 kHz PCM through the
     *   whole chain (DsdChain.cs: SACD's level, the doublings), its length and its noise.
     */
    public static JsObj Run(JsObj job)
    {
        if (job["ntf"] is List<object?> d)
        {
            var (order, rate, hinf) = ((int)TJs.ToNumber(d[0]), TJs.ToNumber(d[1]), TJs.ToNumber(d[2]));
            var ntf = new DsdNtf(order, rate / 2 / 20000, hinf);
            var onCircle = ntf.Zeros.All(z => Math.Abs(z.Magnitude - 1) < 1e-12);
            return new JsObj { ["peak"] = ntf.Peak(), ["on_circle"] = onCircle, ["sections"] = (double)ntf.Sections.Count };
        }
        if (job["chain"] is double cr) return Chain((int)cr, Num(job, "amp", 1), Num(job, "hz", 997), Num(job, "seconds", 1));
        var dsd = (int)Num(job, "rate", 2822400);
        var mod = new DsdModulator(new DsdNtf((int)Num(job, "order", 7), dsd / 2.0 / 20000, Num(job, "hinf", 1.4)));
        var n = Pow2(dsd * Num(job, "seconds", 1));
        var amp = Num(job, "amp", 0.5);
        var hz = Num(job, "hz", 997);
        var x = Signal(job["signal"] as string ?? "tone", n, dsd, amp, hz);
        var bits = new byte[n / 8];
        mod.Run(x, bits);
        var (noise, tone) = Measure(bits, n, dsd, hz);
        return new JsObj { ["noise_db"] = noise, ["tone_db"] = tone, ["resets"] = (double)mod.Resets, ["most"] = mod.Most };
    }

    private static double Num(JsObj j, string k, double or) => j[k] is double v ? v : or;

    private static int Pow2(double atLeast) => 1 << (int)Math.Ceiling(Math.Log2(atLeast));

    // [n] samples at [rate] of: a sine at [hz]; three tones summing to [amp] at their peak; or noise held under [amp]
    // and low-passed to 20 kHz (music's way: most of its weight low), each faded in so the loop starts at rest.
    private static double[] Signal(string kind, int n, int rate, double amp, double hz)
    {
        var x = new double[n];
        var fade = rate / 100;
        double Env(int k) => k < fade ? 0.5 - 0.5 * Math.Cos(Math.PI * k / fade) : 1;
        switch (kind)
        {
            case "tones":
                for (var k = 0; k < n; k++)
                    x[k] = Env(k) * amp * (0.5 * Math.Sin(2 * Math.PI * 997 * k / rate) + 0.3 * Math.Sin(2 * Math.PI * 7001 * k / rate) + 0.2 * Math.Sin(2 * Math.PI * 18997 * k / rate));
                break;
            case "noise":
                var rnd = new Random(242);
                double y1 = 0, y2 = 0, y3 = 0, most = 0;
                var a = Math.Exp(-2 * Math.PI * 20000.0 / rate);
                var raw = new double[n];
                for (var k = 0; k < n; k++)
                {
                    y1 = a * y1 + (1 - a) * (rnd.NextDouble() * 2 - 1);
                    y2 = a * y2 + (1 - a) * y1;
                    y3 = a * y3 + (1 - a) * y2;
                    raw[k] = y3; most = Math.Max(most, Math.Abs(y3));
                }
                for (var k = 0; k < n; k++) x[k] = Env(k) * amp * raw[k] / most;
                break;
            default:
                for (var k = 0; k < n; k++) x[k] = Env(k) * amp * Math.Sin(2 * Math.PI * hz * k / rate);
                break;
        }
        return x;
    }

    // A 705.6 kHz tone through the chain to [rate]: the noise and the tone in the band, and the length made.
    private static JsObj Chain(int rate, double amp, double hz, double seconds)
    {
        var ntf = new DsdNtf(7, rate / 2.0 / 20000, 1.4);
        var chain = new DsdChain(rate, ntf);
        var frames = (long)(seconds * DsdChain.InRate);
        var bits = new List<byte>();
        const int block = 1 << 16;
        for (long at = 0; at < frames; at += block)
        {
            var c = (int)Math.Min(block, frames - at);
            var x = new double[c];
            for (var i = 0; i < c; i++)
            {
                var k = at + i;
                var env = k < DsdChain.InRate / 100 ? 0.5 - 0.5 * Math.Cos(Math.PI * k / (DsdChain.InRate / 100.0)) : 1;
                x[i] = env * amp * Math.Sin(2 * Math.PI * hz * k / DsdChain.InRate);
            }
            chain.Push(x, b => bits.AddRange(b.ToArray()));
        }
        chain.Finish(frames, b => bits.AddRange(b.ToArray()));
        var samples = (long)bits.Count * 8;
        var n = 1 << (int)Math.Floor(Math.Log2(samples));
        var (noise, tone) = Measure([.. bits], n, rate, hz);
        return new JsObj
        {
            ["noise_db"] = noise, ["tone_db"] = tone, ["samples"] = (double)samples, ["frames"] = (double)frames,
            ["resets"] = (double)chain.Modulator.Resets,
        };
    }

    // The in-band noise and the tone of the first [n] bits, in dB below a full-scale sine.
    private static (double Noise, double Tone) Measure(byte[] bits, int n, int rate, double hz)
    {
        var fft = new Fft((int)Math.Log2(n));
        double[] re = new double[n], im = new double[n];
        const double beta = 38;
        var i0b = I0(beta);
        double wsum = 0;
        for (var k = 0; k < n; k++)
        {
            var r = 2.0 * k / (n - 1) - 1;
            var w = I0(beta * Math.Sqrt(Math.Max(0, 1 - r * r))) / i0b;
            re[k] = ((bits[k / 8] >> (k % 8)) & 1) == 1 ? w : -w;
            wsum += w * w;
        }
        fft.Forward(re, im);
        double df = (double)rate / n, noise = 0, tone = 0;
        for (long k = 1; k < n / 2; k++)
        {
            var at = fft.BitReverse(k);
            var f = k * df;
            var p = (re[at] * re[at] + im[at] * im[at]) * 2 / (wsum * n);
            if (Math.Abs(f - hz) < 40 * df || Math.Abs(f - 7001) < 40 * df || Math.Abs(f - 18997) < 40 * df) { if (Math.Abs(f - hz) < 40 * df) tone += p; continue; }
            if (f >= 20 && f <= 20000) noise += p;
        }
        return (Db(noise / 0.5), Db(tone / 0.5));
    }

    private static double Db(double x) => x <= 0 ? -400 : 10 * Math.Log10(x);

    private static double I0(double x)
    {
        double sum = 1, t = 1;
        for (var k = 1; k < 200; k++) { t *= x / (2 * k); t *= x / (2 * k); sum += t; if (t < sum * 1e-18) break; }
        return sum;
    }
}
