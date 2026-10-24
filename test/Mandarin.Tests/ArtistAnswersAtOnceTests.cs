using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An artist's page, and the similar albums at its foot, answered at once from what is kept (CreditFinder.cs,
/// Lastfm.Kept.cs): an act not looked up yet is waited for a second at most, the lookup going on behind; one that
/// failed (MusicBrainz out of reach) isn't looked up again for an hour, so the page doesn't wait on it at each visit,
/// as it did (2.2 s each); and Last.fm's similar albums, ten calls and three to four seconds, are kept in the
/// database too, so the server started again (an update) doesn't ask Last.fm again. MusicBrainz and Last.fm stood in for.
/// </summary>
public sealed class ArtistAnswersAtOnceTests
{
    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task An_artist_s_page_waits_a_second_at_most_and_not_again_on_a_lookup_that_failed()
    {
        Needs.Server(); Needs.Ffmpeg();
        var asked = 0;
        // MusicBrainz slow, then out of reach: four seconds, then 503.
        await using var mb = await FakeServer.Start(async ctx =>
        {
            if ((ctx.Request.Path.Value ?? "").StartsWith("/artist", StringComparison.Ordinal)) Interlocked.Increment(ref asked);
            await Task.Delay(4000);
            ctx.Response.StatusCode = 503;
        });
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base, ["lastfmBaseUrl"] = none.Base,
        });
        var page = "artist?name=" + Uri.EscapeDataString("Artist A");

        var t = Stopwatch.StartNew();
        var first = (await s.Api(page)).J;
        Assert.True(t.ElapsedMilliseconds < 3000, $"the page waited {t.ElapsedMilliseconds} ms on MusicBrainz");
        Assert.False(first.Bool("known"));
        Assert.Equal("Artist A", first.Str("name"));
        // The lookup goes on behind, and fails.
        await Session.Until(() => Task.FromResult(s.Server.Logs.Any(l => l.Contains("[credits] Artist A: HTTP 503", StringComparison.Ordinal))), 15000, "the lookup's failure");

        t.Restart();
        var again = (await s.Api(page)).J;
        Assert.True(t.ElapsedMilliseconds < 1000, $"the page waited {t.ElapsedMilliseconds} ms again");
        Assert.False(again.Bool("known"));
        Assert.Equal(1, Volatile.Read(ref asked));
    }

    [Test]
    public async Task Last_fm_s_similar_albums_are_kept_through_a_restart()
    {
        Needs.Server(); Needs.Ffmpeg();
        var calls = 0;
        await using var fm = await FakeServer.Start(ctx =>
        {
            Interlocked.Increment(ref calls);
            var method = ctx.Request.Query["method"].ToString();
            var artist = ctx.Request.Query["artist"].ToString();
            if (method == "artist.getSimilar")
                return Json(ctx, """{ "similarartists": { "@attr": { "artist": "Artist A" }, "artist": [{ "name": "Artist B", "match": "1", "url": "https://www.last.fm/music/Artist+B" }, { "name": "Nobody Here", "match": "0.5", "url": "https://www.last.fm/music/Nobody+Here" }] } }""");
            if (method == "artist.getTopAlbums")
                return Json(ctx, $$"""{ "topalbums": { "album": [{ "name": "{{(artist == "Artist B" ? "Hi Res" : "Elsewhere")}}", "artist": { "name": "{{artist}}" }, "url": "https://www.last.fm/music/x" }] } }""");
            return Json(ctx, """{ "error": 6, "message": "not here" }""");
        });
        await using var s = await Session.Started(new Dictionary<string, object?> { ["lastfmBaseUrl"] = fm.Base, ["lastfmKey"] = "k" });
        static List<string?> Titles(JsonNode j) => [.. j["albums"].Items().Select(a => a.Str("title"))];
        var path = "lastfm/similar-albums?artist=" + Uri.EscapeDataString("Artist A");

        var first = (await s.Api(path)).J;
        Assert.Equal(["Hi Res", "Elsewhere"], Titles(first));
        Assert.Equal("Hi Res", first["albums"]![0]!["album"].Str("title"));
        var asked = Volatile.Read(ref calls);
        Assert.Equal(3, asked);
        Assert.Equal(Titles(first), Titles((await s.Api(path)).J));
        Assert.Equal(asked, Volatile.Read(ref calls));

        // Started again, as an update does: kept, Last.fm not asked.
        await s.Server.Restart(s.Token);
        var after = (await s.Api(path)).J;
        Assert.Equal(Titles(first), Titles(after));
        Assert.Equal("Hi Res", after["albums"]![0]!["album"].Str("title"));
        Assert.Equal(asked, Volatile.Read(ref calls));
        // The artist's page's similar albums, from the same answers.
        Assert.Equal(Titles(first), Titles((await s.Api("artist/similar-albums?name=" + Uri.EscapeDataString("Artist A"))).J));
        Assert.Equal(asked, Volatile.Read(ref calls));
    }
}
