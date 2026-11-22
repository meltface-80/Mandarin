// SpotifyFromLibrary.cs — a Spotify album of the library played in a room from Mandarin (bug list item 517). Spotify gives
// an app no sound of its own (its Web API has none), so every Spotify track Mandarin was asked to play failed at once
// ("Playing Spotify comes with Mandarin's next Spotify update") and a room skipped through the album in silence. Now
// the album goes to Mandarin's own Spotify player, Soloist (as Music Assistant plays Spotify losslessly): made the active
// device, told to play the album (or, from a track tapped, that track), and followed into the room it was played in, as
// Spotify Connect is (SpotifyLive.Follow): the same stream, lossless, made for the room, with Now Playing's controls. The
// room asked for stands in for Settings' Spotify Connect room until Spotify stops. A Spotify album can only play now:
// queued after other music, it is said so. Mixed with your own files in one ask, its tracks are left out and the rest plays.
using System.Text.Json.Nodes;
using Mandarin.Server.Playback;

namespace Mandarin.Server.Connect;

internal static partial class SpotifyLive
{
    private const int SignInWaitMs = 10_000;   // how long a Soloist starting is given to sign in again
    private static string? askedRoom;   // the room a Spotify album was played in from Mandarin, over Settings' room, while Spotify plays

    /// <summary>Whether [t] is a Spotify track of the library.</summary>
    public static bool IsSpotify(PlayTrack t) => t.Path.StartsWith("spotify://track/", StringComparison.Ordinal);

    /* The room the stream follows Spotify into: the one a Spotify album was played in from Mandarin, else Settings' own. */
    private static string Wanted()
    {
        lock (gate) return askedRoom ?? Settings().Room;
    }

    /* Spotify stopped or the room moved on: the room asked for no longer stands in. */
    private static void Released()
    {
        lock (gate) askedRoom = null;
    }

    /// <summary>
    /// The Spotify [tracks] of one album played now in [zoneId] by Soloist, from the [start]th: the album, or that track.
    /// What is said back to the page; a HubError where it can't (not now, or Spotify Connect not set up).
    /// </summary>
    public static async Task<JsonObject> PlayFromLibrary(Hub hub, string zoneId, List<PlayTrack> tracks, string how, int start)
    {
        if (how != "play_now") throw new HubError(409, "A Spotify album plays now in a room, through Spotify Connect: it can't be queued after other music yet");
        if (Player == null) throw new HubError(409, "Set up Spotify Connect to play Spotify in a room: Settings → Services → Spotify → Spotify Connect");
        // Soloist just (re)started (with the server, or to take a setting up) is up and signed in again within seconds: waited for.
        var p = await ReadyPlayer();
        if (p == null) throw new HubError(409, "Spotify Connect isn't signed in yet: at home, choose " + Settings().DeviceName + " once in the Spotify app's devices");
        string? key;
        using (var c = Db.Open()) key = Library.Rows(c, "SELECT key FROM albums WHERE id = $1", tracks[0].AlbumId).FirstOrDefault()?[0] as string;
        if (key == null || !key.StartsWith("spotify:", StringComparison.Ordinal)) throw new HubError(404, "That album is no longer in the library");
        start = Math.Clamp(start, 0, tracks.Count - 1);
        var uri = start == 0 ? "spotify:album:" + key["spotify:".Length..] : "spotify:track:" + tracks[start].Path["spotify://track/".Length..];
        var zone = hub.Zone(zoneId)?.ZoneId ?? zoneId;
        lock (gate) askedRoom = zone;
        // Sent, or Soloist went down in between (started again to take a setting up): once more when it is back, else said.
        if (!(await p.Command("activate") && await p.Play(uri)))
        {
            p = await ReadyPlayer();
            if (p == null || !(await p.Command("activate") && await p.Play(uri)))
                throw new HubError(503, "Spotify Connect is starting: try again in a moment");
        }
        Server.Log($"[spotify] {uri} played from Mandarin's library, in the room asked for ({zone})");
        Changed();   // the room follows now; Soloist says so too as it starts
        return new JsonObject { ["ok"] = true, ["spotify"] = true, ["uri"] = uri };
    }

    /* The current Soloist once it is up and signed in, waited for SignInWaitMs at most (it is a new one after a restart); else null. */
    private static async Task<Soloist?> ReadyPlayer()
    {
        for (var waited = 0; waited < SignInWaitMs; waited += 100)
        {
            if (Player is { Ready: true } p) return p;
            await Task.Delay(100);
        }
        return Player is { Ready: true } q ? q : null;
    }
}
