// Hub.Heard.cs — whether music is playing now, as the Album Scanner asks it (Identify/AlbumScanner.cs, bug list item
// 411): it starts no album while anything plays.
namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    // A playing room or phone last heard from this long ago at most (a phone reports every ten seconds while it plays,
    // a room is asked every few); a track loading this long at most.
    private const double HeardMs = 120_000, LoadingMs = 30_000;

    /*
     * Rooms and phones playing now: playing and heard from lately, or loading a track. A phone told to play that never
     * answers (its app closed), or one gone quiet mid-track, isn't held to be playing for ever, as Playing() would.
     */
    public int PlayingNow()
    {
        var now = Now();
        lock (Gate) return State.Values.Count(s => s.State == "playing" && now - s.At < HeardMs || s.State == "loading" && now - s.At < LoadingMs);
    }
}
