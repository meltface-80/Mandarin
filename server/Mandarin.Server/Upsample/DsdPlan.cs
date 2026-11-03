// DsdPlan.cs — PCM sent to a device as DSD (bug list items 243, 259): a device's Output set to PCM as DSD (DSD64,
// DSD128 or DSD256) has each track of the library that isn't DSD already made DSD by the modulator of item 242
// (DsdChain.cs) as it plays, and sent as a DSF as it is made (MadeAsPlayed.cs).
//
// A track of 44.1 kHz's family goes to 705.6 kHz as it is; one of 48 kHz's to 768 kHz as it is, and DSD of 48 kHz's
// family (3.072, 6.144 or 12.288 MHz), where the device takes PCM at the rate that DSD rides on as DoP (192, 384 or
// 768 kHz: item 261); else from the 44.1 kHz rate below its own (48 → 44.1, 96 → 88.2…), by SoX's resampler at its
// finest, as before. A DSP setting, which runs on PCM, keeps the device on PCM; a
// stream of Qobuz's or Tidal's comes as it comes.
using System.Globalization;
using System.Text.Json.Nodes;
using Mandarin.Server.Tags;
using Jv = Mandarin.Server.Playback.Jv;

namespace Mandarin.Server.Upsample;

internal static class DsdPlan
{
    /* The DSD multiples a device can be sent: 64 (2.8224 MHz), 128 and 256. */
    public static readonly int[] Multiples = [64, 128, 256];

    /* A setting's multiple: 64, 128 or 256 (a number), else null (Off). */
    public static int? Of(object? v) => v is double d && Multiples.Any(m => m == d) ? (int)d : null;

    /*
     * The rate a track at [rate] is made DSD from: its own; or, one of 48 kHz's family made DSD of 44.1 kHz's
     * ([base] 44100), the 44.1 kHz rate below it; 0 for none.
     */
    public static long FromRate(long rate, int @base = 44100) =>
        rate <= 0 ? 0 : rate % 44100 == 0 && rate <= 352800 ? rate
        : rate % 48000 == 0 && rate <= 384000 ? (@base == 48000 ? rate : rate / 48000 * 44100) : 0;

    /* The family DSD[n] is made in for a track at [rate] to [target]: 48000 for one of 48 kHz's where the device takes PCM at n × 3 kHz (DoP's carrier); else 44100. */
    public static int BaseFor(long rate, int n, object? target) =>
        rate > 0 && rate % 48000 == 0 && rate <= 384000 && Jv.Get(target, "rates") is List<object?> rates && rates.Exists(r => Jv.Num(r) == n * 3000.0) ? 48000 : 44100;

    /* DSD[n]'s rate in Hz in the family of [base] (44100 or 48000). */
    public static int DsdRate(int n, int @base) => n * (@base == 48000 ? 48000 : 44100);

    /* [plan], made for [target] for the track [t] at [path], made DSD where the device is set to it and takes it; else as it was. */
    public static JsObj Mark(JsObj plan, object? target, object? t, string path)
    {
        if (target == null || Of(Jv.Get(target, "dsd_out")) is not { } n) return plan;
        if (Playback.StreamPlans.ServiceOf(path) != null || Playback.StreamPlans.IsDsd(t) || Jv.T(plan["dsp"])) return plan;
        if (Jv.Get(target, "dsd") is not List<object?> takes || !takes.Exists(x => Jv.Num(x) == n)) return plan;
        if (Jv.Get(Jv.Get(target, "dsdMimes"), "dsf") is not string mime || mime.Length == 0) return plan;
        // A plan's track says sampleRate; a library row (a queue's, Playback/Items.cs) sample_rate.
        var rate = (long)Jv.Or(Jv.Num(Jv.Get(t, "sampleRate")), Jv.Or(Jv.Num(Jv.Get(t, "sample_rate")), 0));
        if (FromRate(rate) == 0) return plan;
        var family = BaseFor(rate, n, target);
        var o = Jv.Obj(("transcode", true), ("hq", true), ("mime", mime), ("ext", "dsf"), ("rate", (double)rate), ("bits", 1.0),
            ("dsd", (double)n), ("dsdUp", (double)n), ("inRate", (double)rate), ("reason", $"DSD{n} from PCM, made as it plays"));
        if (family == 48000) o["dsdBase"] = 48000.0;
        if (Jv.T(plan["gain"])) o["gain"] = plan["gain"];
        // Its way to 705.6 (or 768) kHz in the shape the device's filter asks (item 248): minimum phase or gentle; else standard.
        if (Shape.OfFilter(Jv.Get(target, "filter")) is { } shape) o["shape"] = shape;
        return o;
    }

    /* The cache's name ends so for a DSF made from PCM: DSD[n], "x48" after it in 48 kHz's family ([base]). */
    public static string Suffix(int n, int @base = 44100) => "-dsd" + n + (@base == 48000 ? "x48" : "");

    /* Whether the cache's [key] is a DSF's. */
    public static bool IsDsf(string key) => Multiples.Any(m => key.EndsWith(Suffix(m), StringComparison.Ordinal) || key.EndsWith(Suffix(m, 48000), StringComparison.Ordinal));

    /*
     * The job for [src] by [p] into [dest] (UpsampleCommand.cs): ffmpeg decoding it to 64-bit float stereo at the
     * rate it is made from (the gain on it, and SoX's resampler for 48 kHz's family made DSD of 44.1 kHz's), the DSF
     * written at DSD[p.DsdUp]'s rate in its family as it is made, its length [seconds] long (the track's, as the library has it).
     */
    public static JsonObject Job(string src, ConvPlan p, string dest, bool soxr, double seconds)
    {
        var own = (long)p.InRate;
        var from = FromRate(own, p.DsdBase);
        var dsdRate = DsdRate(p.DsdUp, p.DsdBase);
        if (from == 0 || p.DsdUp == 0) throw new InvalidOperationException($"no rate DSD is made from ({p.InRate} Hz)");
        var filters = new List<string>();
        if (p.Gain != 0) filters.Add($"volume=volume={Jv.Str(p.Gain)}dB:precision=double");
        if (from != own && soxr) filters.Add($"aresample=resampler=soxr:precision=33:osr={from.ToString(CultureInfo.InvariantCulture)}");
        var decode = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error", "-i", src, "-map", "0:a:0", "-vn");
        if (filters.Count > 0) { decode.Add("-af"); decode.Add(string.Join(",", filters)); }
        foreach (var a in new[] { "-ac", "2", "-ar", from.ToString(CultureInfo.InvariantCulture), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) decode.Add(a);
        return new JsonObject
        {
            ["ffmpeg"] = Transcoder.Bin, ["decode"] = decode, ["rate"] = from, ["factor"] = DsdChain.InRateFor(dsdRate) / from,
            ["frames"] = (long)Math.Round(seconds * from), ["dsd"] = dsdRate, ["out"] = dest, ["shape"] = p.Shape,
        };
    }
}
