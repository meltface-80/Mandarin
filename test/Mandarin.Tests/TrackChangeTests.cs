namespace Mandarin.Tests;

/// <summary>
/// A track picked from the queue is a new track to the play history (Playback/Hub.cs ApplyState): what a command
/// shows at once, before the player says (Players.Commands.cs and Phones.Commands.cs Optimistic), is a new state, the
/// one kept never changed in place. Changed in place, the player's next word was compared with what the command had
/// already written, saw no new track and kept the last one's "played": the track picked was never in the history.
/// </summary>
public sealed class TrackChangeTests
{
    [Test]
    public async Task A_track_picked_from_the_queue_is_played_as_its_own()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await Session.Started();
        var cd = (await s.Album("Album One"))!;
        var zoneId = (await s.Api("phone/hello", new { name = "Pixel 8" })).J.Str("zone_id");
        Assert.Equal(200, (await s.Api("play", new { offset = cd.Num("offset"), zone_or_output_id = zoneId, kind = "play_now" })).Status);
        async Task Say(int index, double position) =>
            await s.Api("phone/state", new { index, position, duration = 60, state = "playing", volume = 40 });
        long Plays() => Convert.ToInt64(s.Server.Scalar("SELECT COUNT(*) FROM plays"), System.Globalization.CultureInfo.InvariantCulture);

        await Say(0, 2);
        await Say(0, 31);
        await Session.Until(() => Task.FromResult(Plays() == 1), 10000, "Song 1 played");

        // Song 2 picked from the queue: shown at once, then the phone says it plays it.
        Assert.Equal(200, (await s.Api("play-from-here", new { zone_or_output_id = zoneId, queue_item_id = 2 })).Status);
        await Say(1, 0);
        await Say(1, 31);
        await Session.Until(() => Task.FromResult(Plays() == 2), 10000, "Song 2 played");
        Assert.Equal("Song 2", Convert.ToString(s.Server.Scalar("SELECT title FROM plays ORDER BY id DESC LIMIT 1"), System.Globalization.CultureInfo.InvariantCulture));
    }
}
