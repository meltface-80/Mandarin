// MqaPlan.cs — an MQA track sent untouched to a DAC that decodes MQA (bug list item 418).
//
// A device's Output in Audio Devices has "This DAC decodes MQA" (mqa_dac; off by default). For a room with it on, a
// track whose samples carry MQA's signalling (MqaStore.cs) goes as the file itself, at its own rate and depth: no
// upsampling, no DSD made from it, no DSP or EQ, no ReplayGain or levelling, no headroom, no dither, no filter. Where
// the device doesn't take the file's container, it goes repacked as FLAC with the same samples (StreamPlans.Repack:
// exact, no dither), which keeps the signalling too. Its stream address says so (?mqa=1), so the one playing it knows:
// the engine (a sound device on this server) applies no volume to it (Engine.cs: Untouched.cs), a Squeezelite is set
// to unity gain while it plays (SlimPlayer.cs), and a Mandarin Bridge is told in its request
// (X-Mandarin-Untouched: mqa) and applies no software volume to it. Its volume is fixed at 100% where Mandarin's
// would be in software; a DAC's own volume, after its decoding, is its own. Now playing says so (Note).
//
// A room without the setting plays an MQA file as PCM, undecoded, as MQA is meant to play on any DAC, with all its
// usual processing; so does one whose device can't take the file's rate or depth (nothing untouched could reach it).
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;

namespace Mandarin.Server.Mqa;

internal static class MqaPlan
{
    public const string Note = "MQA: sent untouched to the DAC";
    public const string Header = "X-Mandarin-Untouched";

    /* The device's setting, in its stream target (Players.TargetFor). */
    public static bool DacDecodes(JsObj? target) => target != null && target["mqa_dac"] is true;

    /*
     * The plan for [info] (path, codec, sampleRate, bitsPerSample, channels), an MQA track (MqaStore), to [target]
     * with This DAC decodes MQA on: the file as it is, or repacked sample for sample; null where the device has it off,
     * or can take nothing of it untouched.
     */
    public static JsObj? For(object? info, JsObj? target, bool mqa)
    {
        if (!mqa || !DacDecodes(target)) return null;
        // The device as it is, with nothing of its own processing: Original, no DSP, nothing made as it plays.
        var plain = Jv.Obj(("name", target!["name"]), ("rates", target["rates"]), ("maxBits", target["maxBits"]), ("containers", target["containers"]),
            ("dsd", new List<object?>()), ("mode", "original"), ("bits", "auto"), ("id", target["id"]));
        var p = StreamPlans.RendererPlan(info, plain);
        if (Jv.T(p["transcode"]) && !Jv.T(p["exact"])) return null;
        p["mqa"] = true;
        p["reason"] = Note;
        return p;
    }

    /* A stream address that says its track goes untouched to an MQA DAC (?mqa=1). */
    public static bool Untouched(string? uri)
    {
        if (string.IsNullOrEmpty(uri)) return false;
        var q = uri.IndexOf('?', StringComparison.Ordinal);
        if (q < 0) return false;
        var end = uri.IndexOf('#', q);
        foreach (var part in (end < 0 ? uri[(q + 1)..] : uri[(q + 1)..end]).Split('&'))
            if (part == "mqa=1") return true;
        return false;
    }

    /* The request header a Mandarin Bridge reads it by, for [uri]'s stream: "" where it isn't untouched. */
    public static string HeaderFor(string? uri) => Untouched(uri) ? Header + ": mqa\r\n" : "";
}
