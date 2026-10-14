namespace Mandarin.Tests;

/// <summary>
/// Favourites: the heart on an album, kept on the server by the album's identity, listed newest first,
/// and still there after the library reloads (test/favourites.test.js, in C#).
/// </summary>
public sealed class FavouritesTests
{
    [Test]
    public async Task Favourites()
    {
        await using var s = await Session.Started();
        var cd = (await s.Album("Album One"))!;
        var hi = (await s.Album("Hi Res"))!;
        Assert.Null(cd["favourite"]);
        Assert.Empty((await s.Api("favourites")).J["albums"].Items());

        var r = await s.Api("favourites", new { offset = cd.Num("offset"), on = true });
        Assert.Equal(200, r.Status);
        Assert.True(r.Json.Bool("favourite"));
        await Task.Delay(5);
        r = await s.Api("favourites", new { offset = hi.Num("offset"), on = true });
        Assert.True(r.Json.Bool("favourite"));
        // Newest heart first, and the heart shows on the album itself and in every list.
        Assert.Equal(["Hi Res", "Album One"], Titles((await s.Api("favourites")).J));
        Assert.True((await s.Api("album?offset=" + cd.Num("offset"))).J["album"].Bool("favourite"));
        Assert.True((await s.Album("Album One")).Bool("favourite"));

        // Survives the library being rebuilt from the files.
        await s.Server.Reload();
        Assert.Equal(["Hi Res", "Album One"], Titles((await s.Api("favourites")).J));

        r = await s.Api("favourites", new { offset = cd.Num("offset"), on = false });
        Assert.False(r.Json.Bool("favourite"));
        Assert.Equal(["Hi Res"], Titles((await s.Api("favourites")).J));
        Assert.Null((await s.Api("album?offset=" + cd.Num("offset"))).J["album"]?["favourite"]);
        Assert.Equal(404, (await s.Api("favourites", new { offset = 999999, on = true })).Status);
    }

    private static string[] Titles(System.Text.Json.Nodes.JsonNode j) => [.. j["albums"].Items().Select(a => a.Str("title") ?? "")];
}
