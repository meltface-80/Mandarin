using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An act's similar albums for the foot of its page (bug list item 140; Credits/SimilarRoute.cs): with no Last.fm key,
/// the library's albums by the acts Deezer relates, one each, each with the album to open; an act Deezer relates that
/// the library hasn't, left out. With a key, Last.fm's that the library has, never one it hasn't (the owner's call: none
/// that leave the app); none of those, Deezer's as without a key. Deezer and Last.fm stood in for.
/// </summary>
public sealed class ArtistSimilarAlbumsTests
{
    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task Without_a_Last_fm_key_the_library_s_albums_by_the_acts_Deezer_relates()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var deezer = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            if (path == "/search/artist") return Json(ctx, """{ "data": [{ "id": 11, "name": "Artist A", "nb_fan": 5000 }] }""");
            if (path == "/artist/11/related") return Json(ctx, """
                { "data": [
                  { "id": 12, "name": "Somebody Else", "picture_medium": "https://e-cdns-images.dzcdn.net/images/artist/c/250x250.jpg" },
                  { "id": 13, "name": "Artist B", "picture_medium": "https://e-cdns-images.dzcdn.net/images/artist/b/250x250.jpg" }
                ] }
                """);
            return Task.FromResult(ctx.Response.StatusCode = 404);
        });
        await using var s = await Session.Started(new Dictionary<string, object?> { ["deezerBaseUrl"] = deezer.Base });

        var r = JsonNode.Parse((await s.Api("artist/similar-albums?name=" + Uri.EscapeDataString("Artist A"))).Text)!;
        Assert.True(r.Bool("enabled"));
        Assert.Equal("Deezer", r.Str("source"));
        var albums = r["albums"]!.AsArray();
        var only = Assert.Single(albums)!;
        Assert.Equal("Artist B", only.Str("artist"));
        Assert.NotNull(only["album"]);
        Assert.Equal(only.Str("title"), only["album"].Str("title"));
        Assert.Equal(400, (await s.Api("artist/similar-albums")).Status);
    }

    [Test]
    public async Task With_Last_fm_s_albums_none_the_library_has_the_library_s_by_the_acts_Deezer_relates()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var deezer = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            if (path == "/search/artist") return Json(ctx, """{ "data": [{ "id": 11, "name": "Artist A", "nb_fan": 5000 }] }""");
            if (path == "/artist/11/related") return Json(ctx, """{ "data": [{ "id": 13, "name": "Artist B", "picture_medium": "https://e-cdns-images.dzcdn.net/images/artist/b/250x250.jpg" }] }""");
            return Task.FromResult(ctx.Response.StatusCode = 404);
        });
        // Last.fm's similar albums: one the library hasn't, its Last.fm page all there is of it.
        await using var fm = await FakeServer.Start(ctx =>
        {
            var method = ctx.Request.Query["method"].ToString();
            if (method == "artist.getSimilar")
                return Json(ctx, """{ "similarartists": { "@attr": { "artist": "Artist A" }, "artist": [{ "name": "Nobody Here", "match": "1", "url": "https://www.last.fm/music/Nobody+Here" }] } }""");
            if (method == "artist.getTopAlbums")
                return Json(ctx, """{ "topalbums": { "album": [{ "name": "Elsewhere", "artist": { "name": "Nobody Here" }, "url": "https://www.last.fm/music/Nobody+Here/Elsewhere" }] } }""");
            return Json(ctx, """{ "error": 6, "message": "not here" }""");
        });
        await using var s = await Session.Started(new Dictionary<string, object?> { ["deezerBaseUrl"] = deezer.Base, ["lastfmBaseUrl"] = fm.Base, ["lastfmKey"] = "k" });

        var r = JsonNode.Parse((await s.Api("artist/similar-albums?name=" + Uri.EscapeDataString("Artist A"))).Text)!;
        Assert.Equal("Deezer", r.Str("source"));
        var only = Assert.Single(r["albums"]!.AsArray())!;
        Assert.Equal("Artist B", only.Str("artist"));
        Assert.NotNull(only["album"]);
        // The album's page's similar albums: Last.fm's that the library has, here none.
        var page = JsonNode.Parse((await s.Api("lastfm/similar-albums?artist=" + Uri.EscapeDataString("Artist A"))).Text)!;
        Assert.Empty(page["albums"]!.AsArray());
    }
}
