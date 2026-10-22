using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An act's similar acts for its page (bug list item 137; Credits/SimilarRoute.cs): with no Last.fm key, Deezer's
/// related acts, each with whether the library has them and a picture (Deezer's here), twelve at most; asked again,
/// as kept (Deezer not asked twice). Deezer stood in for.
/// </summary>
public sealed class SimilarArtistsTests
{
    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task Deezer_s_related_acts_without_a_Last_fm_key_those_in_the_library_marked_each_with_a_picture()
    {
        Needs.Server(); Needs.Ffmpeg();
        var asked = 0;
        await using var deezer = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            if (path == "/search/artist") return Json(ctx, """{ "data": [{ "id": 11, "name": "Artist A", "nb_fan": 5000 }] }""");
            if (path == "/artist/11/related") { Interlocked.Increment(ref asked); return Json(ctx, """
                { "data": [
                  { "id": 12, "name": "Artist B", "picture_medium": "https://e-cdns-images.dzcdn.net/images/artist/b/250x250.jpg" },
                  { "id": 13, "name": "Somebody Else", "picture_medium": "https://e-cdns-images.dzcdn.net/images/artist/c/250x250.jpg" }
                ] }
                """); }
            return Task.FromResult(ctx.Response.StatusCode = 404);
        });
        await using var s = await Session.Started(new Dictionary<string, object?> { ["deezerBaseUrl"] = deezer.Base });
        async Task<JsonNode> Similar() => JsonNode.Parse((await s.Api("artist/similar?name=" + Uri.EscapeDataString("Artist A"))).Text)!;

        var r = await Similar();
        Assert.Equal("Deezer", r.Str("source"));
        var acts = r["artists"]!.AsArray();
        Assert.Equal(["Artist B", "Somebody Else"], acts.Select(a => a.Str("name") ?? "").ToArray());
        Assert.True(acts[0].Bool("in_library"), "Artist B: in the library");
        Assert.False(acts[1].Bool("in_library"), "Somebody Else: not");
        Assert.All(acts, a => Assert.StartsWith("u-", a.Str("photo_key")));
        await Similar();
        Assert.Equal(1, asked);
        Assert.Equal(400, (await s.Api("artist/similar")).Status);
    }
}
