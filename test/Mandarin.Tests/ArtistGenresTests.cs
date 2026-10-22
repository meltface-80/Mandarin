using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// An act's genres on its page (bug list item 139; CreditRoutes.GenresOf): those its albums are tagged with, the most
/// used first, the same genre in another case counted as one and spelled as most of the library spells it; an act with
/// none tagged, none. The outside sources stood in for by one that knows nothing.
/// </summary>
public sealed class ArtistGenresTests
{
    [Test]
    public async Task An_act_s_genres_from_its_albums_the_most_used_first()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        var lib = Fixtures.MakeLibrary();
        var albums = new[] { ("Debut", "Jangle Pop", 300), ("Second", "Indie Rock", 350), ("Third", "indie rock", 400), ("Fourth", "Indie Rock", 420), ("Untagged", "", 450) };
        foreach (var (album, genre, freq) in albums)
        {
            var tags = new Dictionary<string, object> { ["title"] = album + " track", ["artist"] = "The Chips", ["album"] = album, ["track"] = 1, ["date"] = "1990" };
            if (genre.Length > 0) tags["genre"] = genre;
            Fixtures.Gen(Path.Combine(lib.Music, "The Chips", album, "01.flac"), seconds: 1, freq: freq, tags: tags);
        }
        Fixtures.Gen(Path.Combine(lib.Music, "Plain Act", "Only", "01.flac"), seconds: 1, freq: 500, tags: new Dictionary<string, object>
        {
            ["title"] = "Only track", ["artist"] = "Plain Act", ["album"] = "Only", ["track"] = 1, ["date"] = "1990",
        });
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = none.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base, ["lastfmBaseUrl"] = none.Base,
        }, lib);
        async Task<string[]> Genres(string name) =>
            [.. JsonNode.Parse((await s.Api("artist?name=" + Uri.EscapeDataString(name))).Text)!["genres"].Items().Select(g => g?.GetValue<string>() ?? "")];

        Assert.Equal(["Indie Rock", "Jangle Pop"], await Genres("The Chips"));
        Assert.Empty(await Genres("Plain Act"));
    }
}
