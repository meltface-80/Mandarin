// HighRates.cs — a rate above what FLAC carries (bug list item 238): 705.6 and 768 kHz, sixteen times 44.1 and 48.
//
// FLAC's frames name rates up to 655,350 Hz; above that the rate is only in the stream's header, and neither the
// ffmpeg Mandarin's image had (Debian bookworm's 5.1: "705600 Hz not supported"; trixie's 7.1 since) nor the FLAC
// decoders most streamers carry (libFLAC before 1.4) will have it. On 2 November every track planned for a FiiO SR11 at ×16 failed so, and the
// SR11 was given nothing while the screen counted on. So a plan above 655,350 Hz goes out as WAV where the device
// takes WAV (streamed as it is made, its length unknown in its header, as a radio's is), and where it doesn't, at
// the highest rate of its family that FLAC carries and the device takes: ×8 for a CD.
//
// FLAC at the rate itself, the rate in the stream's header only, was tried (item 305): ffmpeg 7.1 writes it, but a
// Chord Poly played nothing of it and started the track again 18 s in, so WAV it stays (item 307).
using Mandarin.Server.Tags;

namespace Mandarin.Server.Playback;

internal static class HighRates
{
    /* The most FLAC carries in its frames, in Hz. */
    public const double FlacMax = 655350;

    /* [plan], made for [target] by StreamPlans.RendererPlan, fitted to what can carry it. */
    public static JsObj Fit(JsObj plan, object? target)
    {
        var rate = Jv.Num(plan["rate"]);
        if (!Jv.T(plan["transcode"]) || !(rate > FlacMax)) return plan;
        var who = Jv.Str(Jv.Or(Jv.Get(target, "name"), "this device"));
        if (TakesWav(target))
        {
            plan["mime"] = "audio/wav"; plan["ext"] = "wav"; plan["wav"] = true;
            plan["reason"] = Jv.Str(plan["reason"]) + " (as WAV: FLAC stops at 655.35 kHz)";
            return plan;
        }
        // The highest the device takes in the rate's family that FLAC carries.
        var family = rate % 44100 == 0 ? 44100 : 48000;
        var rates = (Jv.Get(target, "rates") as List<object?> ?? []).Select(Jv.Num).Where(r => r > 0 && r <= FlacMax && r % family == 0).ToList();
        if (rates.Count == 0) return plan;
        var top = rates.Max();
        var factor = Jv.Num(plan["upsampled"]) is > 0 and var f ? f : 0;
        var source = factor > 0 ? rate / factor : 0;
        plan["rate"] = top;
        if (source > 0 && top > source)
        {
            plan["upsampled"] = Math.Round(top / source);
            plan["reason"] = $"upsampled ×{Jv.Str(Math.Round(top / source))} to {Jv.Str(top / 1000)} kHz for {who} (higher needs WAV, which it doesn't take)";
        }
        else
        {
            plan["upsampled"] = Undef.V;
            plan["reason"] = $"FLAC at {Jv.Str(top / 1000)} kHz for {who} (higher needs WAV, which it doesn't take)";
        }
        return plan;
    }

    // The device's formats (what it says it plays) name WAV; none named, the usual ones, WAV among them.
    private static bool TakesWav(object? target) =>
        Jv.Get(target, "containers") is List<object?> { Count: > 0 } named ? named.Exists(c => c is string s && s is "wav" or "wave") : true;

    /*
     * ffmpeg's arguments for [plan] (StreamPlans.FfmpegArgs's): for a WAV plan, PCM in a WAV whose length is left
     * unknown in its header (-seekable 0), so a device reading it as it is written plays it to its end. A FLAC of 32
     * bits asked for as ffmpeg makes one (item 269): -strict experimental, without which 6.1 on writes 24 and says nothing.
     */
    public static List<string> Args(List<string> args, bool wav, int bits)
    {
        var at = args.IndexOf("-c:a");
        if (at < 0 || at + 1 >= args.Count || args[at + 1] != "flac") return args;
        if (!wav) return bits == 32 ? [.. args.Take(args.Count - 1), "-strict", "experimental", args[^1]] : args;
        var codec = bits == 16 ? "pcm_s16le" : bits == 32 ? "pcm_s32le" : "pcm_s24le";
        var tail = args.Skip(at + 6).ToList();             // after -c:a flac -compression_level 5 -f flac: the file
        return [.. args.Take(at), "-c:a", codec, "-f", "wav", "-seekable", "0", .. tail];
    }
}
