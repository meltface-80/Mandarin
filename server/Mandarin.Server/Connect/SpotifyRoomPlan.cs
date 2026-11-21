// SpotifyRoomPlan.cs — Spotify's live stream made for the room it plays in (bug list item 501), as that room's library
// tracks are made for it: Spotify's sound is 44.1 kHz (16- or 24-bit, carried in 24), and the room's plan for such a
// track says what it is sent. A streamer that upsamples (×2, ×4, Max) gets it upsampled to that rate by Mandarin's own
// upsampler (Upsample/StreamUpsample.cs), in the filter chosen for it; one that doesn't take 44.1 kHz gets it at the
// rate it takes; a Sonos room, FLAC at 44.1 kHz and 24 bits. The room's EQ and room correction are not applied to it.
//
// The plan rides in the stream's signed address (?r=rate&b=bits&u=factor&f=filter), so the stream (SpotifyStream.cs)
// is made as it was planned for the room, whichever device fetches it.
using System.Globalization;
using Mandarin.Server.Playback;
using Mandarin.Server.Tags;
using Mandarin.Server.Upsample;

namespace Mandarin.Server.Connect;

/* What the room is sent: its rate, its depth, the upsampler's factor (1: none) and filter (null: the standard one). */
internal sealed record RoomSound(int Rate, int Bits, int Factor, string? Shape)
{
    /* Spotify's sound as it comes: FLAC, 44.1 kHz, 24 bits. */
    public static readonly RoomSound AsItComes = new(Soloist.Rate, 24, 1, null);

    /* The address's query that carries it ("" for the sound as it comes). */
    public string Query()
    {
        if (this == AsItComes) return "";
        var q = $"?r={Rate.ToString(CultureInfo.InvariantCulture)}&b={Bits.ToString(CultureInfo.InvariantCulture)}";
        if (Factor > 1) q += "&u=" + Factor.ToString(CultureInfo.InvariantCulture);
        if (Shape != null) q += "&f=" + Uri.EscapeDataString(Shape);
        return q;
    }

    /* Said plainly: "upsampled ×4 to 176.4 kHz, 24-bit", "44.1 kHz, 24-bit". */
    public string Words()
    {
        var khz = (Rate / 1000.0).ToString("0.#", CultureInfo.InvariantCulture) + " kHz";
        var up = Factor > 1 ? $"upsampled ×{Factor.ToString(CultureInfo.InvariantCulture)} to {khz}" : khz;
        return $"{up}, {Bits.ToString(CultureInfo.InvariantCulture)}-bit" + (Shape != null ? " (" + Upsample.Shape.Words(Shape) + ")" : "");
    }
}

internal static class SpotifyRoomPlan
{
    private static readonly int[] Depths = [16, 24, 32];

    /* A Spotify track as the plans see one. */
    private static JsObj Source() => Jv.Obj(("path", "spotify-live.flac"), ("codec", "flac"), ("sampleRate", (double)Soloist.Rate),
        ("bitsPerSample", 24.0), ("channels", 2.0));

    /* What a room with [target] (Hub.TargetFor: null for Sonos) is sent. */
    public static RoomSound For(object? target)
    {
        var p = StreamPlans.Plan(Source(), target);
        if (!Jv.T(p["transcode"])) return RoomSound.AsItComes;
        var rate = (int)Jv.Num(p["rate"]);
        var bits = (int)Jv.Num(p["bits"]);
        if (rate <= 0) rate = Soloist.Rate;
        if (Array.IndexOf(Depths, bits) < 0) bits = 24;
        var factor = Jv.T(p["upsampled"]) ? (int)Jv.Num(p["upsampled"]) : 1;
        if (factor > 1 && (!MadeAsPlayed.Power(factor) || rate != Soloist.Rate * factor)) factor = 1;   // not one the upsampler takes: ffmpeg's resampler
        var shape = factor > 1 ? Upsample.Shape.ForTrack(target, Soloist.Rate) : null;
        return new RoomSound(rate, bits, factor, shape);
    }

    /* The sound asked for in a stream's address (RoomSound.Query); what it can't be, as it comes. */
    public static RoomSound Read(IQueryCollection q)
    {
        static int Int(string s) => int.TryParse(s, NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0;
        var bits = Int(q["b"].ToString()) is var b && Array.IndexOf(Depths, b) >= 0 ? b : q["bits"].ToString() == "16" ? 16 : 24;
        var rate = Int(q["r"].ToString()) is var r && r is >= 8000 and <= 768000 ? r : Soloist.Rate;
        var factor = Int(q["u"].ToString()) is var u && MadeAsPlayed.Power(u) && rate == Soloist.Rate * u ? u : 1;
        var f = q["f"].ToString();
        var shape = factor > 1 && f != "" && Upsample.Shape.Word(Upsample.Shape.Of(f)) is { } w ? w : null;
        return new RoomSound(rate, bits, factor, shape);
    }
}
