namespace Mandarin.Tests;

/// <summary>
/// The favourites a service's watch couldn't read, rested (bug list item 234). On 2 November 125 Qobuz favourites
/// failed on every watch, every two minutes all day, a line each in the log (30,767 lines) and a request each to
/// Qobuz. One that fails rests now, 30 minutes the first time and twice as long each time after, a day at most; it is
/// said in the log the first time only; once read it is forgotten.
/// </summary>
public sealed class WatchMissesTests
{
    private const double Min = 60_000;

    [Test]
    public async Task A_favourite_that_fails_rests_longer_each_time_and_is_said_once()
    {
        object[][] steps =
        [
            ["resting", "a", 0],                 // never failed: asked for
            ["failed", "a", 0],                  // the first failure: said
            ["resting", "a", 2 * Min],           // the next watch, two minutes on: left alone
            ["resting", "a", 29 * Min],
            ["resting", "a", 30 * Min],          // its 30 minutes over: asked again
            ["failed", "a", 30 * Min],           // failed again: not said, an hour's rest
            ["resting", "a", 89 * Min],
            ["resting", "a", 90 * Min],
            ["resting", "b", 2 * Min],           // another favourite isn't held up by it
            ["read", "a", 90 * Min],             // read at last: forgotten
            ["resting", "a", 91 * Min],
            ["failed", "a", 92 * Min],           // failing afresh: said again, 30 minutes again
            ["resting", "a", 121 * Min],
            ["resting", "a", 122 * Min],
        ];
        var r = await Score.Run(new { fn = "watchmisses", steps, rests = new[] { 1, 2, 3, 6, 7, 20 } });
        var said = r["steps"]!.AsArray().Select(x => x?.GetValue<bool>()).ToArray();
        Assert.Equal(new bool?[] { false, true, true, true, false, false, true, false, false, null, false, true, true, false }, said);
        // 30 min, 1 h, 2 h, 16 h, then a day at most.
        var rests = r["rests"]!.AsArray().Select(x => x!.GetValue<double>() / Min).ToArray();
        Assert.Equal(new double[] { 30, 60, 120, 960, 1440, 1440 }, rests);
    }
}
