using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Which album is the day's (bug list item 236, DayPick.cs). The owner's rule: one never played or last played more
/// than twelve months ago, never one played lately; for a newer listener (less than twelve months of plays) nothing
/// like what has been heard lately, by artist or by genre. Eased a step at a time where it leaves nothing; the same
/// album all day.
/// </summary>
public sealed class DayPickTests
{
    private const long Day = 86_400_000, Now = 1_800_000_000_000;

    // id, artist, genres
    private static readonly object[][] Albums =
    [
        [1, "a", new[] { "Rock" }],
        [2, "b", new[] { "Jazz" }],
        [3, "c", new[] { "rock " }],
        [4, "d", new[] { "Folk" }],
        [5, "a", new[] { "Folk" }],
    ];

    private static async Task<JsonNode> Pick(object[][] albums, object[][] plays, string day = "2027-1-15") =>
        await Score.Run(new { fn = "daypick", albums, plays, now = Now, day });

    private static long? Id(JsonNode r) => r["pick"] is JsonValue v ? (long)v.GetValue<double>() : null;

    [Test]
    public async Task A_year_of_listening_unplayed_or_not_for_a_year()
    {
        // Played first 400 days ago (so a year of listening); 2 two months ago, 3 two days ago.
        object[][] plays = [[1, Now - 400 * Day], [2, Now - 60 * Day], [3, Now - 2 * Day]];
        var seen = new HashSet<long>();
        for (var d = 1; d <= 40; d++)
        {
            var r = await Pick(Albums, plays, $"2027-2-{d}");
            Assert.Equal("not played for a year or more", r.Str("why"));
            Assert.Equal(3, r.Num("pool"));
            seen.Add(Id(r)!.Value);
        }
        // Never 2 or 3, played within the year; over the days, each of the others.
        Assert.Equal(new long[] { 1, 4, 5 }, seen.Order().ToArray());
        // The same day, the same album.
        Assert.Equal(Id(await Pick(Albums, plays)), Id(await Pick(Albums, plays)));
    }

    [Test]
    public async Task A_newer_listener_is_offered_nothing_like_what_they_have_heard_lately()
    {
        // First play 100 days ago: a newer listener. Lately (30 days): album 1, artist a, Rock.
        object[][] plays = [[2, Now - 100 * Day], [1, Now - 10 * Day]];
        var r = await Pick(Albums, plays);
        // Never 1 or 2 (played); not 3 (Rock, its case and space aside) nor 5 (artist a): 4.
        Assert.Equal(4, Id(r));
        Assert.Equal("never played, unlike recent listening", r.Str("why"));

        // Without 4, the genre is let go before the artist: 3, by an artist not heard lately.
        object[][] noFour = [.. Albums.Where(a => (int)a[0] != 4)];
        r = await Pick(noFour, plays);
        Assert.Equal(3, Id(r));
        Assert.Equal("never played, by an artist not heard lately", r.Str("why"));

        // Without 3 and 4, only artist a's other album is left unplayed.
        object[][] onlyA = [.. Albums.Where(a => (int)a[0] is 1 or 2 or 5)];
        r = await Pick(onlyA, plays);
        Assert.Equal(5, Id(r));
        Assert.Equal("never played", r.Str("why"));
    }

    [Test]
    public async Task Nothing_played_lately_is_ever_the_days_album()
    {
        // Everything played: the one not played for 30 days, never the one played five days ago.
        object[][] two = [.. Albums.Take(2)];
        var r = await Pick(two, [[1, Now - 5 * Day], [2, Now - 45 * Day]]);
        Assert.Equal(2, Id(r));
        Assert.Equal("not played for 30 days", r.Str("why"));
        // Everything played in the last 30 days: no album of the day.
        r = await Pick(two, [[1, Now - 5 * Day], [2, Now - 6 * Day]]);
        Assert.Null(Id(r));
        // Nothing played at all: any of the library.
        r = await Pick(Albums, []);
        Assert.Equal(5, r.Num("pool"));
    }
}
