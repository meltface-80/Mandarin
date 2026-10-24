namespace Mandarin.Tests;

/// <summary>
/// Favourites: the heart on an album, kept on the server by the album's identity, listed newest first,
/// and still there after the library reloads (test/favourites.test.js, in C#). Home's rows ask the first few
/// of it and of Listen later (?count=N), not the whole list.
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

    [Test]
    public async Task Favourites_and_Listen_later_ask_count_for_the_first_few()
    {
        await using var s = await Session.Started();
        foreach (var title in new[] { "Album One", "Hi Res", "Best Of" })
        {
            var off = (await s.Album(title)).Num("offset");
            await s.Api("favourites", new { offset = off, on = true });
            await s.Api("listen-later", new { offset = off, on = true });
            await Task.Delay(5);
        }
        foreach (var list in new[] { "favourites", "listen-later" })
        {
            // No count: the whole list, newest first, as before.
            var all = await s.Api(list);
            Assert.Equal(["Best Of", "Hi Res", "Album One"], Titles(all.J));
            Assert.Equal(["albums"], all.J.AsObject().Select(kv => kv.Key));
            // Home's rows ask the first few: the same order, the same shape.
            Assert.Equal(["Best Of", "Hi Res"], Titles((await s.Api(list + "?count=2")).J));
            Assert.Equal(["Best Of"], Titles((await s.Api(list + "?count=1")).J));
            Assert.Equal(["albums"], (await s.Api(list + "?count=2")).J.AsObject().Select(kv => kv.Key));
            // More than there are, or a count of nothing: the whole list.
            Assert.Equal(3, Titles((await s.Api(list + "?count=30")).J).Length);
            Assert.Equal(3, Titles((await s.Api(list + "?count=0")).J).Length);
            Assert.Equal(3, Titles((await s.Api(list + "?count=x")).J).Length);
        }
    }

    private static string[] Titles(System.Text.Json.Nodes.JsonNode j) => [.. j["albums"].Items().Select(a => a.Str("title") ?? "")];
}
