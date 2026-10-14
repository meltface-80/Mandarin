using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Home's first row (v0.6.0-RC4): Album of the day is the same album for every device from 00:01, gone
/// from all of them once played; "Not played in 6 months" offers nothing until Mandarin has six months
/// of listening (test/home-rows.test.js, in C#).
/// </summary>
public sealed class HomeRowsTests
{
    // The day's key ("2026-10-3"), turning over at 00:01: a minute taken off, as the server keys it.
    private static string DayKey(DateTime d) { var x = d.AddMinutes(-1); return $"{x.Year}-{x.Month}-{x.Day}"; }

    private static long Now => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    [Test]
    public async Task Album_of_the_day_and_Not_played_in_6_months()
    {
        await using var s = await Session.Started();
        async Task<JsonNode> Get(string p) => (await s.Api(p)).J;
        await Session.Until(async () => (await Get("status")).Num("index_count") == 3, 10000, "the three albums");

        // Nothing played yet: no selection, said so.
        var u = await Get("home/unplayed?months=6&count=30");
        Assert.Empty(u["albums"].Items());
        Assert.True(u.Bool("no_history"));

        // Album of the day: the same answer to everyone, with the day it is for.
        var a1 = await Get("home/album-of-the-day");
        var a2 = await Get("home/album-of-the-day");
        Assert.False(string.IsNullOrEmpty(a1["album"].Str("title")));
        Assert.Equal(a1["album"].Num("offset"), a2["album"].Num("offset"));
        Assert.False(a1.Bool("played"));
        Assert.Equal(DayKey(DateTime.Now), a1.Str("day"));

        // Played: gone, for every device that asks; the day still said.
        var id = (long)a1["album"].Num("offset")!.Value;
        var album = await Get("album?offset=" + id);
        var t = album["tracks"]![0]!;
        void Play(long ts) => s.Server.InsertPlay(id, t["track_id"]?.GetValue<long>(), t.Str("title") ?? "", t.Str("artist") ?? "", album["album"].Str("title") ?? "", "TEST", ts);
        Play(Now);
        var a3 = await Get("home/album-of-the-day");
        Assert.Null(a3["album"]);
        Assert.True(a3.Bool("played"));
        Assert.Equal(a1.Str("day"), a3.Str("day"));

        // A day's listening isn't six months: still nothing, and when it will be.
        u = await Get("home/unplayed?months=6&count=30");
        Assert.Empty(u["albums"].Items());
        Assert.True(u.Bool("no_history"));
        Assert.True(u.Num("ready_at") > Now);

        // Six months and more of listening: the albums not heard lately are offered.
        Play(Now - 200L * 24 * 3600 * 1000);
        u = await Get("home/unplayed?months=6&count=30");
        Assert.False(u.Bool("no_history"));
        Assert.NotEmpty(u["albums"].Items());
        Assert.True(!u["albums"].Items().Any(x => x.Num("offset") == id), "the album just played isn't offered");

        // The library changes (an album added, the scan run) and the server is restarted, as an update
        // does: still the same day's album, still played — not a new one in its place (v0.6.0-RC8).
        for (int i = 1; i <= 2; i++)
            Fixtures.Gen(Path.Combine(s.Lib.Music, "Artist N", "New Arrival", $"0{i}.flac"), freq: 300 + 100 * i,
                tags: new Dictionary<string, object> { ["title"] = $"N{i}", ["artist"] = "Artist N", ["album"] = "New Arrival", ["track"] = i });
        await s.Api("library/rescan", new { });
        await Session.Until(async () => (await Get("status")).Num("index_count") == 4, 30000, "the new album");
        var a4 = await Get("home/album-of-the-day");
        Assert.Null(a4["album"]);
        Assert.True(a4.Bool("played"));
        Assert.True(a1.Str("day") == s.Server.Setting("album_of_the_day").Str("day"), "the day's choice kept, for the same day");
        await s.Server.Stop();

        await using var srv2 = await new TestServer(s.Server.Port, s.Lib.Music, s.Lib.Data, new Dictionary<string, object?> { ["serverIp"] = "127.0.0.1", ["sonosHosts"] = Array.Empty<string>() }).Start();
        var token2 = await Session.SignIn(srv2.Base);
        a4 = (await Http.Get(srv2.Base + "/api/home/album-of-the-day", new Dictionary<string, string> { ["Authorization"] = "Bearer " + token2 })).J;
        Assert.True(a4["album"] == null, "still played after a restart");
        Assert.True(a4.Bool("played"));
        Assert.Equal(a1.Str("day"), a4.Str("day"));
        Assert.True(a1.Str("day") == srv2.Setting("album_of_the_day").Str("day"), "the same day's choice, kept across the restart");
    }
}
