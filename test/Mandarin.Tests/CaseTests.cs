using System.Text.Json;

namespace Mandarin.Tests;

/// <summary>
/// Capitals don't make a different thing (v0.6.3): "Rock" and "rock" are one genre, "If I Fell" and
/// "if i fell" one title to the match score, "The A Team" and "the a team" one album and one artist.
/// The server's lists asked as the pages ask them, its scorer through `mandarin-server score`
/// (test/case.test.js, in C#).
/// </summary>
public sealed class CaseTests
{
    private static string Fold(string? s) => (s ?? "").ToLowerInvariant();

    [Test]
    public async Task One_genre_whatever_its_capitals_shown_as_most_of_the_library_writes_it()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var s = await LibraryServer.Start(Fixtures.MakeLibrary());
        var ids = s.Server.Rows("SELECT id FROM albums ORDER BY id").Select(r => r["id"]).ToList();
        Assert.True(ids.Count >= 3);
        void Set(string[] genres, object? id) => s.Server.Exec("UPDATE albums SET genres = $1 WHERE id = $2", JsonSerializer.Serialize(genres), id);
        Set(["Rock", "Jazz"], ids[0]);
        Set(["rock"], ids[1]);
        Set(["Rock", "ROCK"], ids[2]);
        await s.Reload();
        var rock = (await s.GetJ("/api/filters/genres"))["genres"].Items().Where(g => Fold(g.Str("title")) == "rock").Select(g => (g.Str("title"), g.Str("subtitle"))).ToArray();
        Assert.Equal([("Rock", "3 albums")], rock);
        Assert.True((await s.Album(ids[2]!))["album"].Strs("genres").SequenceEqual(["Rock"]), "one album's two spellings are one genre");
        var facet = (await s.GetJ("/api/library/facets"))["facets"].Items().First(f => f.Str("id") == "genre")!;
        Assert.Equal([("Rock", 3.0)], facet["values"].Items().Where(v => Fold(v.Str("value")) == "rock").Select(v => (v.Str("value"), v.Num("count"))).ToArray());
    }

    [Test]
    public async Task Names_to_the_match_score()
    {
        var pairs = (await Score.Run(new { fn = "pairs", pairs = new[] { new[] { "If I Fell", "if i fell" }, ["Tales From Topographic Oceans", "Tales from Topographic Oceans"] } }))["pairs"]!;
        Assert.Equal(0, pairs[0].Num("title"));
        Assert.Equal(0, pairs[1].Num("string"));
    }

    [Test]
    public async Task Names_to_the_librarys_identity_one_album_one_artist()
    {
        Needs.Server(); Needs.Ffmpeg();
        var lib = Fixtures.MakeLibrary();
        void T(string p, string title, string artist, string album, int track) =>
            Fixtures.Gen(Path.Combine(lib.Music, p), seconds: 1, tags: new Dictionary<string, object> { ["title"] = title, ["artist"] = artist, ["album"] = album, ["track"] = track });
        T("Siouxsie/A Team/01.flac", "One", "Siouxsie And The Banshees", "The A Team", 1);
        T("Siouxsie/A Team/02.flac", "Two", "siouxsie and the banshees", "the a team", 2);
        T("Siouxsie/Other/01.flac", "Three", "SIOUXSIE AND THE BANSHEES", "Other", 1);
        await using var s = await LibraryServer.Start(lib);
        var team = (await s.Albums()).Where(a => Fold(a.Str("title")) == "the a team").ToList();
        Assert.True(team.Count == 1, "one album");
        Assert.Equal(2, (await s.Album(team[0]["offset"]!.ToJsonString()))["tracks"].Items().Count());
        var primary = (await s.GetJ("/api/artist-albums?artist=" + Uri.EscapeDataString("siouxsie and the banshees")))["primary"].Items();
        Assert.True(primary.Select(a => Fold(a.Str("title"))).Order(StringComparer.Ordinal).SequenceEqual(["other", "the a team"]), "one artist");
    }
}
