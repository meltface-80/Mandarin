// Hub.Heard.cs — whether music is playing now, as the Album Scanner asks it (Identify/AlbumScanner.cs, bug list item
// 411): it starts no album while anything plays.
namespace Mandarin.Server.Playback;

internal sealed partial class Hub
{
    // A playing room or phone last heard from this long ago at most (a phone reports every ten seconds while it plays,
    // a room is asked every few); a track loading this long at most (MANDARIN_HEARD_LOADING_MS: a test's shorter one).
    private const double HeardMs = 120_000;
    private static readonly double LoadingMs = double.TryParse(Environment.GetEnvironmentVariable("MANDARIN_HEARD_LOADING_MS"),
        System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var l) && l > 0 ? l : 30_000;

    /*
     * Rooms and phones playing now: playing and heard from lately, or loading a track, begun lately. A phone told to
     * play that never answers (its app closed), or one gone quiet mid-track, isn't held to be playing for ever, as
     * Playing() would; nor a room that says it is loading (a Sonos's TRANSITIONING) at every read (item 417): its state
     * is read every second or few, so it was always heard lately. Paused and stopped never count.
     */
    public int PlayingNow()
    {
        var now = Now();
        lock (Gate) return State.Values.Count(s => s.State == "playing" && now - s.At < HeardMs || s.State == "loading" && now - (s.LoadingSince > 0 ? s.LoadingSince : s.At) < LoadingMs);
    }
}
