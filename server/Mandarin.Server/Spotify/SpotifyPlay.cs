// SpotifyPlay.cs — a Spotify album, or Spotify songs, played from Mandarin (bug list item 143): never fetched track by
// track (Spotify allows no such thing, and only Soloist gets lossless), but played by Mandarin's own Soloist, told
// through Spotify's Web API what to play, on its own device:
//
//   PUT me/player/play?device_id=<Soloist's>   { context_uri: spotify:album:…, offset: { uri: the track } }   an album
//                                              { uris: [the songs, 100 at most], offset: { position } }       the rest
//   POST me/player/queue?uri=…&device_id=…     Play next / Add to queue, while Spotify plays here
//
// and the room asked for follows it with Soloist's live stream (SpotifyLive.PlayIn, Follow), as it follows Spotify
// played from the Spotify app. Soloist not listed among the account's devices (not chosen in the Spotify app yet, or
// asleep): told on its own socket instead (activate, then play the album from its start, then skipped on to the track).
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Spotify;

internal static class SpotifyPlay
{
    public const string TrackPrefix = "spotify://track/";
    private const int Window = 100;

    public static bool IsSpotify(PlayTrack t) => t.Path.StartsWith(TrackPrefix, StringComparison.Ordinal);
    public static string UriOf(PlayTrack t) => "spotify:track:" + t.Path[TrackPrefix.Length..];

    /*
     * A list with Spotify's songs in it, cut to what can be played in one go: Spotify's are played by Soloist and the
     * rest by the room, never one after the other in the same queue, so the part the starting track belongs to.
     */
    public static (List<PlayTrack> Tracks, int Start, bool Spotify) Part(List<PlayTrack> tracks, int start)
    {
        start = Math.Clamp(start, 0, Math.Max(0, tracks.Count - 1));
        var spotify = tracks.Count > 0 && IsSpotify(tracks[start]);
        var part = tracks.Where(t => IsSpotify(t) == spotify).ToList();
        return (part, Math.Max(0, part.IndexOf(tracks[start])), spotify);
    }

    /* The Web API's body: the album from the track [start], or a window of the songs ([uris]) with [start] in it. */
    public static JsonObject Body(IReadOnlyList<string> uris, string? albumUri, int start, double seconds)
    {
        var o = new JsonObject();
        if (albumUri != null)
        {
            o["context_uri"] = albumUri;
            o["offset"] = new JsonObject { ["uri"] = uris[start] };
        }
        else
        {
            var from = Math.Clamp(start - Window / 2, 0, Math.Max(0, uris.Count - Window));
            o["uris"] = new JsonArray(uris.Skip(from).Take(Window).Select(u => (JsonNode)u).ToArray());
            o["offset"] = new JsonObject { ["position"] = start - from };
        }
        if (seconds > 0) o["position_ms"] = (long)Math.Round(seconds * 1000);
        return o;
    }

    /* The album's context when the list is that album, whole and in its order; else null (the songs are played as they are). */
    private static string? AlbumUri(Snapshot? s, List<PlayTrack> tracks, bool? shuffled)
    {
        if (shuffled == true || tracks.Count == 0 || tracks.Any(t => t.AlbumId != tracks[0].AlbumId)) return null;
        var al = s?.Find(tracks[0].AlbumId);
        if (al == null || !al.Key.StartsWith("spotify:", StringComparison.Ordinal) || al.TrackCount is { } n && n != tracks.Count) return null;
        return "spotify:album:" + al.Key["spotify:".Length..];
    }

    /* [tracks] (all Spotify's) played in [zoneId] from [startAt] ([how]: play_now, add_next, queue). */
    public static async Task<JsonObject> Play(string zoneId, List<PlayTrack> tracks, string how, double startAt, double seconds, bool? shuffled)
    {
        var svc = Jobs.Spotify;
        var player = SpotifyLive.Player;
        if (svc == null || player == null) throw new HubError(503, "Spotify plays through Spotify Soloist: set it up in Settings → Services → Spotify");
        if (!svc.Connected()) throw new HubError(409, "Sign in to Spotify in Settings → Services → Spotify");
        var uris = tracks.Select(UriOf).ToList();
        var start = (int)Math.Clamp(startAt, 0, uris.Count - 1);
        var name = SpotifyLive.Settings().DeviceName;
        var device = await svc.DeviceId(name);
        var playingHere = player.Active && player.Playback != "idle";

        if (how != "play_now" && playingHere && device != null)
        {
            foreach (var u in uris) await svc.Api.Call("POST", "me/player/queue?uri=" + Uri.EscapeDataString(u) + "&device_id=" + Uri.EscapeDataString(device));
            return new JsonObject { ["queued"] = uris.Count, ["spotify"] = true };
        }

        SpotifyLive.PlayIn(zoneId);
        var album = AlbumUri(await Library.CurrentCopy(), tracks, shuffled);
        if (device != null)
        {
            try
            {
                await svc.Api.Call("PUT", "me/player/play?device_id=" + Uri.EscapeDataString(device), Body(uris, album, start, seconds).ToJsonString());
                Server.Log($"[spotify] playing {(album != null ? "an album" : uris.Count + " songs")} on {name}");
                return new JsonObject { ["queued"] = uris.Count, ["spotify"] = true };
            }
            catch (Services.ServiceError e) when (player.SignedIn) { Server.Log("[spotify] the Web API didn't start it (" + e.Message + "): telling Soloist itself"); }
            catch (Services.ServiceError e) { throw new HubError(502, e.Message); }
        }
        if (!player.SignedIn) throw new HubError(409, $"Soloist isn't signed in to Spotify yet. At home, on the same Wi-Fi, choose \"{name}\" once in the Spotify app's devices; after that it plays from anywhere.");
        // On Soloist's own socket: it plays a context from its start only, so on to the track asked for.
        await player.Command("activate");
        await player.Play(album ?? uris[start]);
        if (album != null) for (int i = 0; i < start; i++) { await Task.Delay(250); await player.Next(); }
        Server.Log($"[spotify] playing on {name} (through Soloist itself)");
        return new JsonObject { ["queued"] = uris.Count, ["spotify"] = true };
    }
}
