// DsdPlan.cs — PCM sent to a device as DSD (bug list items 243, 259): a device's Output set to PCM as DSD (DSD64,
// DSD128 or DSD256) has each track of the library that isn't DSD already made DSD by the modulator of item 242
// (DsdChain.cs) as it plays, and sent as a DSF as it is made (MadeAsPlayed.cs).
//
// A track of 44.1 kHz's family goes to 705.6 kHz as it is; one of 48 kHz's to 768 kHz as it is, and DSD of 48 kHz's
// family (3.072, 6.144 or 12.288 MHz), where the device takes PCM at the rate that DSD rides on as DoP (192, 384 or
// 768 kHz: item 261); else from the 44.1 kHz rate below its own (48 → 44.1, 96 → 88.2…), by SoX's resampler at its
// finest, as before. A stream of Qobuz's or Tidal's comes as it comes. A DSP setting runs on the PCM it is made from,
// at the track's own rate, before anything else is done to it (item 263; before, it kept the device on PCM).
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
        if (Playback.StreamPlans.ServiceOf(path) != null || Playback.StreamPlans.IsDsd(t)) return plan;
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
        if (Jv.T(plan["dsp"])) o["dsp"] = plan["dsp"];   // its part at the track's rate (Playback/Dsp.cs), which names the file too
        // Its way to 705.6 (or 768) kHz in the shape the device's filter asks (items 248, 298), the one for the track's rate.
        if (Shape.ForTrack(target, rate) is { } shape) o["shape"] = shape;
        return o;
    }

    /*
     * What a track at [own] Hz is decoded through before it is upsampled (item 263): the gain in 64-bit float, then the
     * DSP's headroom and bands at its own rate (Playback/Dsp.cs), then, made [to] another rate, SoX's resampler; null for nothing.
     */
    public static string? Before(ConvPlan p, long own, long? to, bool soxr = true)
    {
        var o = new List<string>();
        if (p.Gain != 0) o.Add($"volume=volume={Jv.Str(p.Gain)}dB:precision=double");
        if (p.Dsp != null) o.AddRange(Playback.Dsp.Filters(Jv.Get(p.Dsp, "dsp"), (double)own, (double)(to ?? own), soxr, Jv.Get(p.Dsp, "headroom")));
        else if (to is { } r && soxr) o.Add($"aresample=resampler=soxr:precision=33:osr={r.ToString(CultureInfo.InvariantCulture)}");
        return o.Count > 0 ? string.Join(",", o) : null;
    }

    /* The cache's name ends so for a DSF made from PCM: DSD[n], "x48" after it in 48 kHz's family ([base]); "j": joined to its album's neighbours (item 262). */
    public static string Suffix(int n, int @base = 44100) => "-dsd" + n + (@base == 48000 ? "x48" : "") + Joins.Mark;

    /* Whether the cache's [key] is a DSF's. */
    public static bool IsDsf(string key) => Multiples.Any(m => key.EndsWith(Suffix(m), StringComparison.Ordinal) || key.EndsWith(Suffix(m, 48000), StringComparison.Ordinal));

    /* A DSF's block of 4096 bytes a channel in frames of the rate [p] is made from; 0 where it is resampled to it (nothing joined: item 262). */
    public static long BlockFrames(ConvPlan p)
    {
        var own = (long)p.InRate;
        var from = FromRate(own, p.DsdBase);
        return from == 0 || from != own || p.DsdUp == 0 ? 0 : DsfWriter.Block * 8L / (DsdRate(p.DsdUp, p.DsdBase) / from);
    }

    /* The DSF's size in bytes for track [id] by [p], [seconds] long (the header says it before the first bit is made; Streams.cs sends it so). */
    public static long FileBytes(long id, ConvPlan p, double seconds)
    {
        var from = FromRate((long)p.InRate, p.DsdBase);
        var b = BlockFrames(p);
        var join = b > 0 ? Joins.For(id, from, b) : Joins.None;
        var samples = (join.Carry + Joins.Frames(seconds, from) - join.Cut) * (DsdRate(p.DsdUp, p.DsdBase) / from);
        return DsfWriter.Size(samples);
    }

    /* A run's DSF size in bytes by [p], [seconds] long at the rate it is made from, nothing joined (AlbumRun.cs, item 300). */
    public static long RunBytes(ConvPlan p, double seconds)
    {
        var from = FromRate((long)p.InRate, p.DsdBase);
        return from == 0 ? 0 : DsfWriter.Size(Joins.Frames(seconds, from) * (DsdRate(p.DsdUp, p.DsdBase) / from));
    }

    /*
     * The job for [src] by [p] into [dest] (UpsampleCommand.cs): ffmpeg decoding it to 64-bit float stereo at the
     * rate it is made from (Before: levelled, the DSP run on it, and SoX's resampler for 48 kHz's family made DSD of 44.1 kHz's), the DSF
     * written at DSD[p.DsdUp]'s rate in its family as it is made, its length [seconds] long (the track's, as the library
     * has it); [join], its album's neighbours either side (Joins.cs, item 262), decoded as it is.
     */
    public static JsonObject Job(string src, ConvPlan p, string dest, bool soxr, double seconds, Joins.Join? join = null)
    {
        var own = (long)p.InRate;
        var from = FromRate(own, p.DsdBase);
        var dsdRate = DsdRate(p.DsdUp, p.DsdBase);
        if (from == 0 || p.DsdUp == 0) throw new InvalidOperationException($"no rate DSD is made from ({p.InRate} Hz)");
        var decode = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error", "-i", src, "-map", "0:a:0", "-vn");
        var conv = p.Dsp != null ? Playback.Convolution.For(Jv.Get(p.Dsp, "dsp"), own) : null;   // a room correction at its rate (item 258)
        if (Before(p, own, from != own ? from : null, soxr) is { } pre) { decode.Add("-af"); decode.Add(conv != null ? Playback.Convolution.Graph(pre, conv, own, soxr) : pre); }
        foreach (var a in new[] { "-ac", "2", "-ar", from.ToString(CultureInfo.InvariantCulture), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) decode.Add(a);
        var o = new JsonObject
        {
            ["ffmpeg"] = Transcoder.Bin, ["decode"] = decode, ["rate"] = from, ["factor"] = DsdChain.InRateFor(dsdRate) / from,
            ["frames"] = Joins.Frames(seconds, from), ["dsd"] = dsdRate, ["out"] = dest, ["shape"] = p.Shape,
        };
        Joins.Into(o, join, decode, src, from);
        return o;
    }
}
