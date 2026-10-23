using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// One artist however an album credits them (bug list item 151). MusicBrainz credits Disillusioned to "Mariana Semkina",
/// the name on its sleeve, while the artist is Marjana Semkina, one entry, one id; Mandarin knew acts only by name, so
/// the credit became a second artist and the album "appeared on" Marjana's page. Names Mandarin's lookups found to share
/// a MusicBrainz id are now one artist, written as MusicBrainz names them, or as most of the library does.
/// </summary>
public sealed class SameArtistTests
{
    private const string Marjana = "0f3a9d0c-1111-4a1b-9c1d-5e7a6b8c9d0e";

    [Test]
    public async Task Names_that_share_a_MusicBrainz_id_are_one_artist_written_one_way()
    {
        var r = await Score.Run(new
        {
            fn = "same",
            kept = new object?[]
            {
                new object?[] { "marjana semkina", "Marjana Semkina", Marjana, "Marjana Semkina" },
                new object?[] { "mariana semkina", "Mariana Semkina", Marjana, null },
                // Two artists called Nirvana (two ids): the name says nothing about which, so it is left alone.
                new object?[] { "nirvana", "Nirvana", "id-us", null },
                new object?[] { "nirvana", "Nirvana", "id-uk", null },
                new object?[] { "nirvana uk", "Nirvana (UK)", "id-uk", null },
                // No MusicBrainz name kept: the spelling most of the library uses.
                new object?[] { "prince", "Prince", "id-p", null },
                new object?[] { "artist formerly known as prince", "The Artist Formerly Known as Prince", "id-p", null },
            },
            albums = new[] { "Marjana Semkina", "Marjana Semkina", "Mariana Semkina", "Nirvana", "Nirvana (UK)", "Prince", "Prince", "The Artist Formerly Known as Prince" },
            artists = new[] { "Mariana Semkina", "Marjana Semkina", "Mariana Semkina & Iamthemorning", "Nirvana", "Nirvana (UK)", "The Artist Formerly Known as Prince", "Someone Else" },
        });
        Assert.Equal(["Marjana Semkina", "Marjana Semkina", "Marjana Semkina & Iamthemorning", "Nirvana", "Nirvana (UK)", "Prince", "Someone Else"],
            r["same"]!.AsArray().Select(x => (string)x!).ToArray());
    }

    [Test]
    public async Task An_album_credited_under_another_name_is_in_the_artist_s_discography_and_the_artists_list_has_them_once()
    {
        Needs.Server(); Needs.Ffmpeg();
        // MusicBrainz, as it answers: either name found as the one artist, whose own name is Marjana Semkina.
        await using var mb = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            ctx.Response.ContentType = "application/json";
            return path == "/artist/" + Marjana ? ctx.Response.WriteAsync($$"""{ "id": "{{Marjana}}", "name": "Marjana Semkina", "type": "Person", "relations": [] }""")
                : path == "/artist/" ? ctx.Response.WriteAsync($$"""{ "artists": [{ "id": "{{Marjana}}", "name": "Marjana Semkina", "score": 100, "aliases": [{ "name": "Mariana Semkina", "type": "Artist name" }] }] }""")
                : Task.FromResult(ctx.Response.StatusCode = 404);
        });
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        var lib = Fixtures.MakeLibrary();
        foreach (var (album, credit) in new[] { ("Sleepwalking", "Marjana Semkina"), ("SIRIN", "Marjana Semkina"), ("Disillusioned", "Mariana Semkina") })
            Fixtures.Gen(Path.Combine(lib.Music, "Marjana Semkina", album, "01.flac"), seconds: 1, freq: 300, tags: new Dictionary<string, object>
            {
                ["title"] = album + " one", ["artist"] = "Marjana Semkina", ["album_artist"] = credit, ["album"] = album, ["track"] = 1, ["date"] = "2021",
            });
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base, ["lastfmBaseUrl"] = none.Base,
        }, lib);

        // Before anything is looked up: two names, two artists, as before.
        var before = (await s.Api("artists")).J["artists"]!.AsArray().Select(a => (string)a!["name"]!).ToList();
        Assert.Equal(["Mariana Semkina", "Marjana Semkina"], before.Where(n => n.Contains("Semkina")).Order().ToArray());

        // Each name looked up (as its page, or the background finder, does): MusicBrainz says they are one artist.
        await s.Api("artist?name=" + Uri.EscapeDataString("Marjana Semkina"));
        await s.Api("artist?name=" + Uri.EscapeDataString("Mariana Semkina"));

        List<string> names = [];
        for (var i = 0; i < 100; i++)
        {
            names = (await s.Api("artists")).J["artists"]!.AsArray().Select(a => (string)a!["name"]!).Where(n => n.Contains("Semkina")).ToList();
            if (names.SequenceEqual(["Marjana Semkina"])) break;
            await Task.Delay(100);
        }
        Assert.Equal(["Marjana Semkina"], names);
        var own = (await s.Api("artist-albums?artist=" + Uri.EscapeDataString("Marjana Semkina"))).J;
        Assert.Equal(["Disillusioned", "SIRIN", "Sleepwalking"], own["primary"]!.AsArray().Select(a => (string)a!["title"]!).Order().ToArray());
        Assert.Empty(own["featured"]!.AsArray());
        var dis = await s.Album("Disillusioned");
        Assert.Equal("Marjana Semkina", (string?)dis!["subtitle"]);   // the album written under the artist too
    }
}
