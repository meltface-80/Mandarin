// DsdPlan.cs — PCM sent to a device as DSD (bug list item 243): a device's Output set to PCM as DSD (DSD64, DSD128 or
// DSD256) has each track of the library that isn't DSD already made DSD ahead of playing, by the modulator of item
// 242 (DsdOut.cs), and sent as a DSF.
//
// Like a whole-track upsample (item 237), a track has to be made before any of it can go; unlike one, a track not yet
// made can't go with a standard filter under the same address, a DSF promised being a DSF. So a DSD track's queue entry
// carries the PCM one beside it (the plan as it would have been): the player sends the DSF where it is made, and the
// PCM where it isn't yet when the track has to start (Renderers/Players.Dsd.cs). Tracks are made in play order.
//
// A track of 48 kHz's family reaches 705.6 kHz from the 44.1 kHz rate below its own (48 → 44.1, 96 → 88.2…), by SoX's
// resampler at its finest; 44.1 kHz's goes as it is. A DSP setting, which runs on PCM, keeps the device on PCM; a
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

    /* The 44.1 kHz family's rate a track at [rate] is made DSD from: its own, or the one below it of 48 kHz's; 0 for none. */
    public static long FromRate(long rate) =>
        rate <= 0 ? 0 : rate % 44100 == 0 && rate <= 352800 ? rate : rate % 48000 == 0 && rate <= 384000 ? rate / 48000 * 44100 : 0;

    /*
     * [plan], made for [target] for the track [t] at [path], made DSD where the device is set to it and takes it: the
     * DSF's plan, the PCM one kept to send while it is made (Pcm). Else [plan] as it was.
     */
    public static JsObj Mark(JsObj plan, object? target, object? t, string path)
    {
        if (target == null || Of(Jv.Get(target, "dsd_out")) is not { } n) return plan;
        if (Playback.StreamPlans.ServiceOf(path) != null || Playback.StreamPlans.IsDsd(t) || Jv.T(plan["dsp"])) return plan;
        if (Jv.Get(target, "dsd") is not List<object?> takes || !takes.Exists(x => Jv.Num(x) == n)) return plan;
        if (Jv.Get(Jv.Get(target, "dsdMimes"), "dsf") is not string mime || mime.Length == 0) return plan;
        // A plan's track says sampleRate; a library row (a queue's, Playback/Items.cs) sample_rate.
        var rate = (long)Jv.Or(Jv.Num(Jv.Get(t, "sampleRate")), Jv.Or(Jv.Num(Jv.Get(t, "sample_rate")), 0));
        if (FromRate(rate) == 0) return plan;
        var o = Jv.Obj(("transcode", true), ("hq", true), ("mime", mime), ("ext", "dsf"), ("rate", (double)rate), ("bits", 1.0),
            ("dsd", (double)n), ("dsdUp", (double)n), ("inRate", (double)rate), ("reason", $"DSD{n} from PCM, made ahead"));
        if (Jv.T(plan["gain"])) o["gain"] = plan["gain"];
        return o;
    }

    /*
     * [pcm], the plan sent while the track is made DSD[n]: said so, for Now playing. With the standard filter, never
     * a whole track's (item 246): that is made in the same queue as the DSF, behind it, and a track the device is to
     * be armed with must be made first; the DSF is what the device is set to, and the PCM only stands in for it.
     */
    public static JsObj Waiting(JsObj pcm, int n)
    {
        var o = Jv.CopyWithout(Jv.CopyWithout(pcm, "dsdMaking"), "whole");
        o["dsdMaking"] = (double)n;
        o["reason"] = Jv.Str(o["reason"]).Replace(" (whole track)", "", StringComparison.Ordinal) + $" (DSD{n} being made)";
        return o;
    }

    /* The Now playing badge's words for a track sent as PCM while it is made DSD[n], its making [state] (WholeJobs.State). */
    public static string Badge(int n, string? state) =>
        state is "queued" or "making" ? $" · DSD{n} being made" : state == "failed" ? $" · DSD{n} failed: see the log" : $" · DSD{n} next play";

    /* The cache's name ends so for a DSF made from PCM. */
    public static string Suffix(int n) => "-dsd" + n;

    /* Whether the cache's [key] is a DSF's. */
    public static bool IsDsf(string key) => Multiples.Any(m => key.EndsWith(Suffix(m), StringComparison.Ordinal));

    /*
     * The job for [src] by [p] into [dest] (UpsampleCommand.cs): ffmpeg decoding it to 64-bit float stereo at the
     * 44.1 kHz family's rate it is made from (the gain on it, and SoX's resampler for 48 kHz's family), the DSF written
     * at DSD[p.DsdUp]'s rate.
     */
    public static JsonObject Job(string src, ConvPlan p, string dest, bool soxr, int maxOutBits)
    {
        var own = (long)p.InRate;
        var from = FromRate(own);
        if (from == 0 || p.DsdUp == 0) throw new InvalidOperationException($"no rate DSD is made from ({p.InRate} Hz)");
        var filters = new List<string>();
        if (p.Gain != 0) filters.Add($"volume=volume={Jv.Str(p.Gain)}dB:precision=double");
        if (from != own && soxr) filters.Add($"aresample=resampler=soxr:precision=33:osr={from.ToString(CultureInfo.InvariantCulture)}");
        var decode = new JsonArray("-hide_banner", "-nostdin", "-loglevel", "error", "-i", src, "-map", "0:a:0", "-vn");
        if (filters.Count > 0) { decode.Add("-af"); decode.Add(string.Join(",", filters)); }
        foreach (var a in new[] { "-ac", "2", "-ar", from.ToString(CultureInfo.InvariantCulture), "-f", "f64le", "-c:a", "pcm_f64le", "pipe:1" }) decode.Add(a);
        return new JsonObject
        {
            ["ffmpeg"] = Transcoder.Bin, ["decode"] = decode, ["rate"] = from, ["factor"] = DsdChain.InRate / from,
            ["max_out_bits"] = maxOutBits, ["dsd"] = 44100 * p.DsdUp, ["out"] = dest,
        };
    }
}
