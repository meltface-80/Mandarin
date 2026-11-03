// JoinRules.cs — tracks made as they play, joined, measured against the whole they were cut from (bug list item 262;
// RulesCommand's "joins").
//
// The DSFs of the parts are laid end to end, each to its sample count, and set against the DSF of the whole: both
// low-passed to 20 kHz (a Kaiser-windowed sinc, 8191 taps at the DSD rate) around each join, the difference the
// level of what the joins added, in dB below the modulator's full scale. The modulators of the parts and of the whole
// make different bits (a modulator's bits hang on everything before them), but the same sound: their difference in
// the band is their noise, where a join made badly is a click.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Upsample;

internal static class JoinRules
{
    private const int Taps = 8191;

    /*
     * { parts: [dsf], whole: dsf, ms? } → { samples: [each part's], whole, blocks: [each part's samples, whole
     * blocks?], join_db: the worst difference within [ms] (10) of a join, rest_db: the same away from the joins }.
     */
    public static JsObj Run(JsObj job)
    {
        var parts = (job["parts"] as List<object?> ?? []).Select(x => Read(Playback.Jv.Str(x))).ToList();
        var whole = Read(Playback.Jv.Str(job["whole"]));
        var ms = job["ms"] is double m ? m : 10;
        var joined = new List<byte>[2] { [], [] };
        var joins = new List<long>();
        long at = 0;
        foreach (var p in parts)
        {
            if (at > 0) joins.Add(at);
            for (var c = 0; c < 2; c++) joined[c].AddRange(p.Bits[c]);
            at += p.Samples;
        }
        var o = new JsObj
        {
            ["samples"] = parts.Select(p => (object?)(double)p.Samples).ToList(), ["whole"] = (double)whole.Samples,
            ["blocks"] = parts.Select(p => (object?)(p.Samples % (DsfWriter.Block * 8) == 0)).ToList(),
        };
        if (at != whole.Samples) return o;
        var h = Lowpass(whole.Rate);
        var span = (long)(ms / 1000 * whole.Rate);
        var step = whole.Rate / 44100 > 0 ? whole.Rate / 44100 : 1;
        double near = 0, far = 0;
        var a = joined.Select(x => x.ToArray()).ToArray();
        for (var c = 0; c < 2; c++)
        {
            foreach (var j in joins)
                for (var k = Math.Max(Taps, j - span); k < Math.Min(whole.Samples - Taps, j + span); k += step)
                {
                    var e = Math.Abs(Filtered(a[c], k, h) - Filtered(whole.Bits[c], k, h));
                    if (e > near) { near = e; o["where"] = (double)(k - j); }
                }
            // Away from any join: what the modulators' noise alone makes of it.
            for (var k = (long)Taps; k < whole.Samples - Taps; k += step * 37)
                if (joins.All(j => Math.Abs(k - j) > 2 * span)) far = Math.Max(far, Math.Abs(Filtered(a[c], k, h) - Filtered(whole.Bits[c], k, h)));
        }
        o["join_db"] = Db(near);
        o["rest_db"] = Db(far);
        return o;
    }

    private static double Db(double x) => 20 * Math.Log10(Math.Max(x, 1e-15));

    // The low-pass's taps at [rate]: 20 kHz, Kaiser β 10, their sum 1.
    private static double[] Lowpass(int rate)
    {
        var h = new double[Taps];
        var fc = 20000.0 / rate;
        var half = (Taps - 1) / 2;
        double I0(double x) { double s = 1, t = 1; for (var k = 1; k < 60; k++) { t *= x / (2 * k) * (x / (2 * k)); s += t; } return s; }
        for (var n = 0; n < Taps; n++)
        {
            double t = n - half;
            var sinc = t == 0 ? 2 * fc : Math.Sin(2 * Math.PI * fc * t) / (Math.PI * t);
            var r = t / half;
            h[n] = sinc * I0(10 * Math.Sqrt(Math.Max(0, 1 - r * r)));
        }
        var sum = h.Sum();
        for (var n = 0; n < Taps; n++) h[n] /= sum;
        return h;
    }

    // The bits ([bytes], the earliest in the least significant bit, ±1) low-passed by [h], centred on sample [k].
    private static double Filtered(byte[] bytes, long k, double[] h)
    {
        double s = 0;
        var from = k - (Taps - 1) / 2;
        for (var n = 0; n < Taps; n++)
        {
            var i = from + n;
            var bit = (bytes[i >> 3] >> (int)(i & 7)) & 1;
            s += h[n] * (bit == 1 ? 1 : -1);
        }
        return s;
    }

    private sealed record Dsf(int Rate, long Samples, byte[][] Bits);

    // A stereo DSF: its rate, its samples a channel, and each channel's bytes, to its sample count.
    private static Dsf Read(string path)
    {
        var b = File.ReadAllBytes(path);
        var rate = BitConverter.ToInt32(b, 56);
        var samples = BitConverter.ToInt64(b, 64);
        var block = BitConverter.ToInt32(b, 72);
        var bytes = (int)((samples + 7) / 8);
        var ch = new[] { new byte[bytes], new byte[bytes] };
        var data = 92;
        for (int g = 0, done = 0; done < bytes; g++, done += block)
            for (var c = 0; c < 2; c++)
                Array.Copy(b, data + (g * 2 + c) * block, ch[c], done, Math.Min(block, bytes - done));
        return new Dsf(rate, samples, ch);
    }
}
