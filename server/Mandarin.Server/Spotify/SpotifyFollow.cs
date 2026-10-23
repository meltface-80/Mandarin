// SpotifyFollow.cs — what the room does as Spotify plays, pauses and stops on Mandarin's Soloist (bug list item 142;
// SpotifyLive.Follow acts on it). A rule of its own, with no room or Soloist in it, so the tests can ask it everything
// (`mandarin-server score`, { fn: "spotify" }: SpotifyCommand.cs).
namespace Mandarin.Server.Spotify;

/* What the room's state is, as far as the rule needs it: whether it plays Spotify's stream, and its own state. */
internal sealed record SpotifyRoom(bool Live, string State);

internal static class SpotifyFollow
{
    /* How long a room is given to start Spotify's stream before it counts as having moved on to other music. */
    public const int StartingMs = 15_000;

    /*
     * What to do, given what Spotify does now ([playback]: playing, paused or idle), what it did when last followed
     * ([last]), the room chosen for it ([want], "" for none), the room it was started in ([playingIn], null for none),
     * that room's state, and whether that room was started less than StartingMs ago ([starting]):
     *   "no-room"      playing, but no room is chosen
     *   "start"        play the stream in [want] (it isn't playing there, or Spotify plays again after the room moved on)
     *   "wait"         the room is still starting the stream
     *   "moved-on"     the room went on to other music while Spotify played: Spotify paused, the room forgotten
     *   "resume-room"  Spotify plays again after a pause: the room plays on
     *   "room-paused"  the room was paused or stopped outside Mandarin while Spotify played: Spotify paused too
     *   "pause-room"   Spotify paused: the room pauses
     *   "stop-room"    Spotify stopped, or another device was chosen: the room stops, and is forgotten
     *   "forget"       Spotify stopped, and the room plays other music: only forgotten
     *   "none"         nothing to do
     */
    public static string Decide(string playback, string last, string want, string? playingIn, SpotifyRoom? room, bool starting)
    {
        bool live = room?.Live == true;
        bool halted = room?.State is "paused" or "stopped";
        switch (playback)
        {
            case "playing":
                if (want == "") return "no-room";
                if (playingIn != want) return "start";
                if (starting && (!live || halted)) return "wait";
                // Off the stream: moved on while Spotify played; or Spotify played again, after a pause or a stop, from the Spotify app.
                if (!live) return last == "playing" ? "moved-on" : "start";
                if (halted) return last == "paused" ? "resume-room" : "room-paused";
                return "none";
            case "paused":
                return playingIn != null && live && !halted ? "pause-room" : "none";
            default:
                if (playingIn == null) return "none";
                return live ? "stop-room" : "forget";
        }
    }
}
