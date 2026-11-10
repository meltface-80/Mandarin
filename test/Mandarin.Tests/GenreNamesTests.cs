using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// Genres in English (GenreNames): an album bought from Qobuz in French is tagged "Électronique" or "Musique de chambre",
/// and shows as "Electronic" and "Chamber Music", one genre with the library's English-tagged albums; a genre asked for
/// by its French name finds them; a genre it doesn't know is left as it is. The files are never written.
/// </summary>
public sealed class GenreNamesTests
{
    [Test]
    public async Task The_library_s_French_genres_shown_in_English_one_genre_with_the_English_ones()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        var lib = Fixtures.MakeLibrary();
        var albums = new[] { ("Plastic", "Électronique", 300), ("Wires", "Electronic", 350), ("Rooms", "Musique de chambre", 400), ("Odd", "Krautrock", 450),
            ("Strings", "ŒUVRES ORCHESTRALES", 500), ("Score", "Bandes originales de films", 550), ("Night", "Trip hop", 600),
            ("Loud", "Alternatif et indé", 650), ("Quiet", "Alternative & Indie", 700) };
        foreach (var (album, genre, freq) in albums)
            Fixtures.Gen(Path.Combine(lib.Music, "The Chips", album, "01.flac"), seconds: 1, freq: freq, tags: new Dictionary<string, object>
            {
                ["title"] = album + " track", ["artist"] = "The Chips", ["album"] = album, ["track"] = 1, ["date"] = "1990", ["genre"] = genre,
            });
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = none.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base, ["lastfmBaseUrl"] = none.Base,
        }, lib);
        async Task<JsonNode> Get(string path) => JsonNode.Parse((await s.Api(path)).Text)!;

        // The genres' list: Électronique and Electronic one genre, of two albums; no French name left.
        var genres = (await Get("filters/genres"))["genres"].Items().Select(g => (g.Str("title"), g.Str("subtitle"))).ToList();
        Assert.Contains(("Electronic", "2 albums"), genres);
        Assert.Contains(("Chamber Music", "1 album"), genres);
        Assert.Contains(("Orchestral Music", "1 album"), genres);   // whatever its case and accents
        Assert.Contains(("Film Soundtracks", "1 album"), genres);
        Assert.Contains(("Alternative & Indie", "2 albums"), genres);
        // English already, or not known: as it is.
        Assert.Contains(("Krautrock", "1 album"), genres);
        Assert.Contains(("Trip hop", "1 album"), genres);
        Assert.DoesNotContain(genres, g => g.Item1 is "Électronique" or "Musique de chambre" or "ŒUVRES ORCHESTRALES" or "Bandes originales de films" or "Alternatif et indé");
        // Home's Browse by genre (its cards are these genres and these groups): no French there either.
        var groups = (await Get("home/genre-groups")).ToJsonString();
        Assert.DoesNotContain("Alternatif", groups);
        Assert.DoesNotContain("lectronique", groups);

        // An album's page and the artist's page say them in English.
        var plastic = (await Get("library/albums?count=50"))["albums"].Items().First(a => a.Str("title") == "Plastic");
        var page = await Get("album?offset=" + plastic.Num("offset"));
        Assert.Equal(["Electronic"], page["album"]!["genres"].Items().Select(g => g?.GetValue<string>()));
        var artist = await Get("artist?name=" + Uri.EscapeDataString("The Chips"));
        var theirs = artist["genres"].Items().Select(g => g?.GetValue<string>()).ToList();
        Assert.Contains("Electronic", theirs);
        Assert.Contains("Alternative & Indie", theirs);
        Assert.DoesNotContain(theirs, g => g is "Électronique" or "Alternatif et indé");

        // The genre's wall, asked for in English or by the French name a wall kept from before has: both albums.
        string[] Titles(JsonNode j) => [.. j["albums"].Items().Select(a => a.Str("title") ?? "").Order(StringComparer.Ordinal)];
        Assert.Equal(["Plastic", "Wires"], Titles(await Get("library/albums?genre=Electronic")));
        Assert.Equal(["Plastic", "Wires"], Titles(await Get("library/albums?genre=" + Uri.EscapeDataString("Électronique"))));
    }
}
