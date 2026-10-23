// SpotifyNow.cs — Now Playing for a room playing Spotify's live stream (bug list item 142): the stream's address
// never changes, so what plays is Soloist's (its track, artists, album, cover, length and position), and the format
// line says what the samples have proven (SoloistProof.cs). The same shape as NowPlaying.Of's.
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Spotify;

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
            ["format"] = new JsonObject { ["kind"] = proof.StartsWith("lossless", StringComparison.Ordinal) ? "lossless" : "spotify", ["text"] = FormatText(proof) }
        };
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
