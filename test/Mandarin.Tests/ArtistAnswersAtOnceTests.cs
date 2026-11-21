using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An artist's page, and the similar albums at its foot, answered at once from what is kept (CreditFinder.cs,
/// Taste.Similar.cs): an act not looked up yet is waited for a second at most, the lookup going on behind; one that
/// failed (MusicBrainz out of reach) isn't looked up again for an hour, so the page doesn't wait on it at each visit,
/// as it did (2.2 s each); and Deezer's related acts, behind the similar artists and albums, are kept in the database
/// too, so the server started again (an update) doesn't ask Deezer again. MusicBrainz and Deezer stood in for.
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
        // MusicBrainz slow, then out of reach: four seconds, then 503. Every request it's asked counted.
        await using var mb = await FakeServer.Start(async ctx =>
        {
            Interlocked.Increment(ref asked);
            await Task.Delay(4000);
            ctx.Response.StatusCode = 503;
        });
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base,
        });
        var page = "artist?name=" + Uri.EscapeDataString("Artist A");

        var t = Stopwatch.StartNew();
        var first = (await s.Api(page)).J;
        Assert.True(t.ElapsedMilliseconds < 3000, $"the page waited {t.ElapsedMilliseconds} ms on MusicBrainz");
        Assert.False(first.Bool("known"));
        Assert.Equal("Artist A", first.Str("name"));
        // The lookup goes on behind, and fails.
        // Its 503 rests every MusicBrainz lookup, said once (item 396), not as a line for the act.
        await Session.Until(() => Task.FromResult(s.Server.Logs.Any(l => l.Contains("[musicbrainz] MusicBrainz turned a lookup away (HTTP 503", StringComparison.Ordinal))), 15000, "the lookup's failure");

        var failedAfter = Volatile.Read(ref asked);
        Assert.True(failedAfter >= 1, "MusicBrainz was asked");

        t.Restart();
        var again = (await s.Api(page)).J;
        Assert.True(t.ElapsedMilliseconds < 1000, $"the page waited {t.ElapsedMilliseconds} ms again");
        Assert.False(again.Bool("known"));
        // Not asked again: neither the act's lookup that failed (an hour) nor anything while MusicBrainz rests.
        await Task.Delay(1500);
        Assert.Equal(failedAfter, Volatile.Read(ref asked));
    }

    [Test]
    public async Task Deezer_s_similar_acts_are_kept_through_a_restart()
    {
        Needs.Server(); Needs.Ffmpeg();
        var calls = 0;
        await using var deezer = await FakeServer.Start(ctx =>
        {
            Interlocked.Increment(ref calls);
            var path = ctx.Request.Path.Value ?? "";
            if (path == "/search/artist") return Json(ctx, """{ "data": [{ "id": 11, "name": "Artist A", "nb_fan": 5000 }] }""");
            if (path == "/artist/11/related") return Json(ctx, """{ "data": [{ "id": 13, "name": "Artist B" }, { "id": 14, "name": "Nobody Here" }] }""");
            return Task.FromResult(ctx.Response.StatusCode = 404);
        });
        await using var s = await Session.Started(new Dictionary<string, object?> { ["deezerBaseUrl"] = deezer.Base });
        static List<string?> Titles(JsonNode j) => [.. j["albums"].Items().Select(a => a.Str("title"))];
        static List<string?> Names(JsonNode j) => [.. j["artists"].Items().Select(a => a.Str("name"))];
        var albums = "artist/similar-albums?name=" + Uri.EscapeDataString("Artist A");
        var artists = "artist/similar?name=" + Uri.EscapeDataString("Artist A");

        var first = (await s.Api(albums)).J;
        // The library's alone: "Nobody Here", which it hasn't, has none.
        Assert.Equal(["Hi Res"], Titles(first));
        Assert.Equal(["Artist B", "Nobody Here"], Names((await s.Api(artists)).J));
        var asked = Volatile.Read(ref calls);
        Assert.Equal(2, asked);
        Assert.Equal(Titles(first), Titles((await s.Api(albums)).J));
        Assert.Equal(asked, Volatile.Read(ref calls));

        // Started again, as an update does: kept, Deezer not asked.
        await s.Server.Restart(s.Token);
        var after = (await s.Api(albums)).J;
        Assert.Equal(Titles(first), Titles(after));
        Assert.Equal("Hi Res", after["albums"]![0]!["album"].Str("title"));
        Assert.Equal(["Artist B", "Nobody Here"], Names((await s.Api(artists)).J));
        Assert.Equal(asked, Volatile.Read(ref calls));
    }
}
