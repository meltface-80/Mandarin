// SpotifyNow.cs — Now Playing for a room playing Spotify Connect's live stream (bug list items 142, 501, 503): the
// stream's address never changes, so what plays is Soloist's (its track, artists, album, cover, length and position),
// and the format line says it is Spotify Connect, what the samples have proven (SoloistProof.cs) and how the room is
// sent it (SpotifyRoomPlan.cs). The same shape as NowPlaying.Of's. And the room's controls as Spotify's (Allow).
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Connect;

internal static class SpotifyNow
{
    /* Now Playing's object for a room playing Spotify, or null when [st] isn't (NowPlaying.Of answers then). */
    public static JsonObject? Of(ZoneState st)
    {
        var p = SpotifyLive.Player;
        if (p == null || !SpotifyLive.IsLive(st)) return null;
        var t = p.Track;
        var proof = p.Proof.Says();
        return new JsonObject
        {
            ["line1"] = t.Title.Length > 0 ? t.Title : "Spotify",
            ["line2"] = t.Artists,
            ["line3"] = t.Album,
            ["artists"] = new JsonArray(Names.SplitArtists(t.Artists).Select(name => (JsonNode)new JsonObject { ["name"] = name, ["linkable"] = false }).ToArray()),
            ["image_key"] = t.Cover.Length > 0 ? NowPlaying.ForeignKey(t.Cover) : null,
            ["length"] = t.Duration > 0 ? Math.Round(t.Duration, MidpointRounding.AwayFromZero) : null,
            ["seek_position"] = Math.Round(Heard(p.PositionNow(), p.AheadMs), MidpointRounding.AwayFromZero),
            ["track_id"] = null,
            ["album_offset"] = null,
            ["source"] = "spotify",
            ["format"] = new JsonObject { ["kind"] = "lossless", ["text"] = NowText(proof, SpotifyLive.Sound) + (st.Confirmed ? " ✓" : "") },
            // Every step of the way (item 507), as a library track's (Playback/SignalPath.cs).
            ["signal"] = Signal(proof, SpotifyLive.Sound, p.Normalising, st.Sent, st.Fed, st.Confirmed)
        };
    }

    /*
     * The signal path of Spotify Connect's stream (item 507): Spotify's audio as it reached Mandarin (bit for bit or not,
     * as the samples say), Spotify's loudness normalisation where the room's levelling put it on, what Mandarin made of it
     * for the room (upsampled in its filter, resampled, or as it came), and the device's own word on what its DAC is fed,
     * checked against what it was sent, as for a file: the ✓ only where the device says so and its samples go untouched.
     */
    public static JsonObject Signal(string proof, RoomSound sound, bool normalising, SentInfo? sent, Fed? fed, bool confirmed)
    {
        var steps = new JsonArray();
        steps.Add(proof switch
        {
            "lossless 24-bit" or "lossless 16-bit" => SignalPath.Step("source", "Source", $"Spotify · FLAC {proof[9..11]}-bit 44.1 kHz, bit for bit from Spotify’s player", "lossless"),
            "not bit-perfect" when normalising => SignalPath.Step("source", "Source", "Spotify · Lossless, as asked of Spotify, its loudness normalised by Spotify’s player", "enhanced"),
            "not bit-perfect" => SignalPath.Step("source", "Source", "Spotify · Lossless, as asked of Spotify; not shown to reach Mandarin bit for bit (the log says why)", "pending"),
            _ => SignalPath.Step("source", "Source", "Spotify · Lossless, as asked of Spotify", "pending"),
        });
        string? how = null;
        if (normalising)
        {
            steps.Add(SignalPath.Step("gain", "Volume levelling", "Spotify’s own loudness normalisation, as this room’s volume levelling is on", "enhanced"));
            how = "Spotify’s loudness normalisation";
        }
        var khz = Tags.Js.Num(sound.Rate / 1000.0);
        if (sound.Factor > 1)
        {
            steps.Add(SignalPath.Step("float", "Bit depth conversion", "24-bit to 64-bit float", "enhanced"));
            var up = $"{SignalPath.Filter(sound.Shape)} ×{sound.Factor} · {sound.Bits}/{khz} kHz";
            steps.Add(SignalPath.Step("upsample", "Upsampling", up, "enhanced"));
            how = how == null ? up : up + " · " + how;
        }
        else if (sound.Rate != Soloist.Rate)
        {
            steps.Add(SignalPath.Step("resample", "Resampling", $"44.1 → {khz} kHz, by SoX at its finest", "enhanced"));
            steps.Add(SignalPath.Step("output", "Output", $"FLAC {sound.Bits}/{khz} kHz", "enhanced"));
        }
        else steps.Add(SignalPath.Step("output", "Output", $"FLAC {sound.Bits}/44.1 kHz, Spotify’s samples as they came", sound.Bits >= 24 ? "lossless" : "enhanced"));
        if (fed != null && sent != null) steps.Add(SignalPath.Fed(fed, sent));
        var lines = new JsonArray(JsonValue.Create(NowText(proof, sound) + (confirmed ? " ✓" : "")));
        if (how != null) lines.Add(JsonValue.Create(how));
        return new JsonObject { ["lines"] = lines, ["steps"] = steps };
    }

    /*
     * Now playing's format line (items 503, 506, 507): "Spotify Connect · Lossless", the quality Soloist is asked for, as the
     * Spotify app says it; "Lossless 24/44.1" where the samples prove it bit for bit (SoloistProof.cs); then how the
     * room is sent it where it isn't as it comes ("· FLAC 24/176.4 ↑×4 · Minimum-phase filter"), as a library track's line
     * says it. Never "Lossy" from the samples: they can't tell lossy from lossless that Spotify's volume has touched.
     */
    public static string NowText(string proof, RoomSound sound)
    {
        var text = "Spotify Connect" + proof switch
        {
            "lossless 24-bit" => " · Lossless 24/44.1",
            "lossless 16-bit" => " · Lossless 16/44.1",
            _ => " · Lossless"
        };
        if (sound == RoomSound.AsItComes) return text;
        var khz = Tags.Js.Num(sound.Rate / 1000.0);
        return text + $" · FLAC {sound.Bits}/{khz}" + (sound.Factor > 1 ? $" ↑×{sound.Factor}" : "") + (sound.Shape != null ? " · " + Upsample.Shape.Name(sound.Shape) : "");
    }

    /* Where the room is in the track: Soloist's position less what has been sent ahead of what is heard (item 506), never below 0. */
    public static double Heard(double position, int aheadMs) => Math.Max(0, position - aheadMs / 1000.0);

    /* A room playing Spotify Connect (item 503): next, previous and seek are Spotify's, whatever the device's queue says. Each its own value. */
    public static void Allow(JsonObject o, double duration)
    {
        o["is_next_allowed"] = true;
        o["is_previous_allowed"] = true;
        o["is_seek_allowed"] = duration > 0;
    }

    /* Settings' line: "Spotify · Lossless 24-bit/44.1 kHz, bit-perfect", "Spotify · Lossless, not bit-perfect" (the log says why), "Spotify · Lossless". */
    public static string FormatText(string proof) => proof switch
    {
        "lossless 24-bit" => "Spotify · Lossless 24-bit/44.1 kHz, bit-perfect",
        "lossless 16-bit" => "Spotify · Lossless 16-bit/44.1 kHz, bit-perfect",
        "not bit-perfect" => "Spotify · Lossless, not bit-perfect",
        _ => "Spotify · Lossless"
    };
}
