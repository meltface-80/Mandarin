// DsdLowpass.cs — DSD played as PCM, its modulator's noise above the band taken off (bug list item 241).
//
// DSD64 carries its noise out of the way, above the audio band, rising from some 20 kHz to the top of its 1.4 MHz.
// A DSD-capable DAC is sent the file as it is and filters it itself; a device that takes PCM is sent PCM decoded
// from it (ffmpeg's DSD decoder at 352.8 kHz for DSD64), resampled to its rate, and everything the new rate's
// Nyquist frequency leaves in passes through: at 176.4 kHz, the modulator's noise from 20 to 88 kHz, some 40 dB
// below a half-scale tone at the top of that span. A device set to a low-pass is sent less: the track goes through
// SoX's resampler twice, down to a rate whose Nyquist frequency is a little above the cut and back up, a
// linear-phase low-pass as steep as the resampler, with no delay and no tail (so gapless play stays gapless), the
// band below the cut untouched.
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal static class DsdLowpass
{
    /* The low-passes there are: the cut in Hz, and the rate the track passes through for it (44.1 kHz's family). */
    public static readonly (double Cut, long Mid)[] Cuts = [(30000, 66150), (50000, 110250)];

    /* A device's setting as a cut: one of Cuts, or null (none: Off). */
    public static double? Of(object? setting) => setting is double d && Cuts.Any(c => c.Cut == d) ? d : null;

    /* Whether [mid] is a rate a low-pass passes through. */
    public static bool IsMid(long mid) => Cuts.Any(c => c.Mid == mid);

    /*
     * [plan], made for [target] from the track [t], marked to be low-passed where it is DSD going out as PCM, the
     * device is set to a low-pass, and the plan's rate is above the rate it passes through (below, the resampler's
     * own filter already cuts lower).
     */
    public static JsObj Mark(JsObj plan, object? target, object? t)
    {
        if (!Jv.T(plan["transcode"]) || !StreamPlans.IsDsd(t) || Of(Jv.Get(target, "dsd_lowpass")) is not { } cut) return plan;
        var mid = Cuts.First(c => c.Cut == cut).Mid;
        if (!(Jv.Num(plan["rate"]) > mid)) return plan;
        plan["lowpass"] = (double)mid;
        plan["reason"] = Jv.Str(plan["reason"]) + $" (low-passed at {Jv.Str(cut / 1000)} kHz)";
        return plan;
    }

    /* ffmpeg's arguments for a plan low-passed through [mid]: its resample preceded by one down to [mid]. */
    public static List<string> Args(List<string> args, long mid, bool soxr)
    {
        if (mid == 0) return args;
        var at = args.IndexOf("-af");
        if (at < 0 || at + 1 >= args.Count) return args;
        var graph = args[at + 1];
        var last = graph.LastIndexOf("aresample=", StringComparison.Ordinal);
        if (last < 0) return args;
        var down = $"aresample={(soxr ? "resampler=soxr:precision=33:" : "")}internal_sample_fmt=dblp:osr={mid},";
        var copy = new List<string>(args);
        copy[at + 1] = graph[..last] + down + graph[last..];
        return copy;
    }
}
