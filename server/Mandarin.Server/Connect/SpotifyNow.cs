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
            ["seek_position"] = Math.Round(p.PositionNow(), MidpointRounding.AwayFromZero),
            ["track_id"] = null,
            ["album_offset"] = null,
            ["source"] = "spotify",
            ["format"] = new JsonObject { ["kind"] = proof.StartsWith("lossless", StringComparison.Ordinal) ? "lossless" : proof == "lossy" ? "lossy" : "spotify", ["text"] = NowText(proof, SpotifyLive.Sound) }
        };
    }

    /*
     * Now playing's format line (item 503): "Spotify Connect · Lossless 24/44.1", then how the room is sent it where it
     * isn't as it comes ("· FLAC 24/176.4 ↑×4 · Minimum-phase filter"), as a library track's line says it.
     */
    public static string NowText(string proof, RoomSound sound)
    {
        var text = "Spotify Connect" + proof switch
        {
            "lossless 24-bit" => " · Lossless 24/44.1",
            "lossless 16-bit" => " · Lossless 16/44.1",
            "lossy" => " · Lossy",
            _ => ""
        };
        if (sound == RoomSound.AsItComes) return text;
        var khz = Tags.Js.Num(sound.Rate / 1000.0);
        return text + $" · FLAC {sound.Bits}/{khz}" + (sound.Factor > 1 ? $" ↑×{sound.Factor}" : "") + (sound.Shape != null ? " · " + Upsample.Shape.Name(sound.Shape) : "");
    }

    /* A room playing Spotify Connect (item 503): next, previous and seek are Spotify's, whatever the device's queue says. Each its own value. */
    public static void Allow(JsonObject o, double duration)
    {
        o["is_next_allowed"] = true;
        o["is_previous_allowed"] = true;
        o["is_seek_allowed"] = duration > 0;
    }

    /* "Spotify · Lossless 24-bit/44.1 kHz", "Spotify · Lossy (not Lossless)", "Spotify" before the samples have said. */
    public static string FormatText(string proof) => proof switch
    {
        "lossless 24-bit" => "Spotify · Lossless 24-bit/44.1 kHz",
        "lossless 16-bit" => "Spotify · Lossless 16-bit/44.1 kHz",
        "lossy" => "Spotify · Lossy (not Lossless)",
        _ => "Spotify"
    };
}
