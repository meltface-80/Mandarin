// TranscodePlans.cs — what a conversion is asked to make and how it goes (Transcoder.cs's, moved out of it for
// room, item 238): the track, the plan (its rate, depth, gain, DSP, and since item 238 whether it goes as WAV),
// and the job a reader waits on.
using JsObj = Mandarin.Server.Tags.JsObj;
using Jv = Mandarin.Server.Playback.Jv;

namespace Mandarin.Server;

internal sealed record ConvTrack(long Id, string Path, long Mtime);
internal sealed record ConvPlan(long Rate, int Bits, bool Hq, bool Exact, string Reason)
{
    // A ReplayGain in dB (0: none), and a zone's DSP: the plan's part (lib/dsp.js planPart) and the file's own rate (v0.8.40).
    public double Gain { get; init; }
    public JsObj? Dsp { get; init; }
    public double InRate { get; init; }
    // Above FLAC's rates, PCM in a WAV whose length is left open (Playback/HighRates.cs, item 238).
    public bool Wav { get; init; }
    // DSD as PCM, low-passed through this rate (Playback/DsdLowpass.cs, item 241); 0 for none.
    public long Lowpass { get; init; }
    // Made DSD at this multiple from PCM, as it plays (Upsample/DsdPlan.cs, items 243, 259); 0 for none.
    public int DsdUp { get; init; }
    // DSD[DsdUp]'s family: 44100 (2.8224 MHz and its doubles), or 48000 for a track of 48 kHz's made so (item 261).
    public int DsdBase { get; init; } = 44100;
    // A Qobuz or Tidal stream already what was planned: its FLAC frames copied as they come (v0.8.47).
    public bool Copy { get; init; }
    // The upsampling filter's shape where it isn't the standard one: "min", "gentle", or null (Upsample/Shape.cs, items 248, 259);
    // made as it plays (Upsample/MadeAsPlayed.cs).
    public string? Shape { get; init; }

    /* The plan as lib/stream.js has it, for its name and ffmpeg's arguments. */
    public JsObj ToJs()
    {
        var o = Jv.Obj(("transcode", true), ("rate", (double)Rate), ("bits", (double)Bits), ("reason", Reason));
        if (Copy) o["copy"] = true;
        if (Hq) o["hq"] = true;
        if (Exact) o["exact"] = true;
        if (Dsp != null) { o["dsp"] = Dsp; o["inRate"] = InRate; }
        if (Gain != 0) o["gain"] = Gain;
        if (Wav) o["wav"] = true;
        return o;
    }

    /* A plan of lib/stream.js's (or Playback/StreamPlans.cs's) for a conversion. */
    public static ConvPlan Of(JsObj p) => new((long)Jv.Num(p["rate"]), (int)Jv.Num(p["bits"]), Jv.T(p["hq"]), Jv.T(p["exact"]), Jv.Str(Jv.Or(p["reason"], "")))
    {
        Gain = Jv.T(p["gain"]) ? Jv.Num(p["gain"]) : 0,
        Dsp = Jv.T(p["dsp"]) ? p["dsp"] as JsObj : null,
        InRate = Jv.T(p["inRate"]) ? Jv.Num(p["inRate"]) : 0,
        Wav = Jv.T(p["wav"]),
        Lowpass = Jv.T(p["lowpass"]) ? (long)Jv.Num(p["lowpass"]) : 0,
        DsdUp = Jv.T(p["dsdUp"]) ? (int)Jv.Num(p["dsdUp"]) : 0,
        DsdBase = Jv.Num(p["dsdBase"]) == 48000 ? 48000 : 44100,
        Shape = Upsample.Shape.Word(Upsample.Shape.Of(p["shape"] as string))
    };
}

internal sealed class ConvJob
{
    public required string Key, Part, Final;
    public volatile bool Done, Failed;
    public readonly TaskCompletionSource Finished = new(TaskCreationOptions.RunContinuationsAsynchronously);
    // Woken whenever ffmpeg writes (a reader waits on it rather than polling fast).
    private TaskCompletionSource more = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public Task More => Volatile.Read(ref more).Task;
    public void Wake() => Interlocked.Exchange(ref more, new(TaskCreationOptions.RunContinuationsAsynchronously)).TrySetResult();
    // How far into the file its readers have asked for (item 271: a making is held only so far ahead of it, Upsample/Pace.cs).
    public long Wanted;
    // Where a device seeks past what is made, the making begun again there (item 272: Upsample/Resume.cs); null where it can't be.
    public Upsample.Resume? Resume;
    // Its readers so far: each one's number, the last the newest.
    public int Readers;
    public void Want(long pos)
    {
        for (var w = Interlocked.Read(ref Wanted); pos > w; w = Interlocked.Read(ref Wanted))
            if (Interlocked.CompareExchange(ref Wanted, pos, w) == w) return;
    }
}
