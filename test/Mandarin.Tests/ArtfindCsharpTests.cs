using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The album editor's cover search (v0.8.22): the server's (Extras/ArtFind.cs) held to
/// lib/library/artfind.js — the same names compared the same way, and whole searches over the same
/// canned catalogue answers ending in the same candidates, scored, ordered and cut alike; odd answers
/// doing the same there as here. Through `mandarin-server score`; the route runs in FrontTests. The Node
/// server's answers are kept (test/golden/artfind-csharp.json), the cases asked as data
/// (artfind-csharp.cases.json) (test/artfind-csharp.test.js, in C#).
/// </summary>
public sealed class ArtfindCsharpTests(ArtfindCsharpTests.Book book) : IClassFixture<ArtfindCsharpTests.Book>
{
    /// <summary>test/golden/artfind-csharp.json, every kept answer asked for by the class's end.</summary>
    public sealed class Book() : KeptBook("artfind-csharp");

    private static readonly Lazy<JsonObject> Cases = new(() => Golden.Cases("artfind-csharp"));
    private static JsonArray C(string name) => (JsonArray)Cases.Value[name]!.DeepClone();

    private static Task<JsonNode> Csharp(JsonObject job) { job["fn"] = "artfind"; return Golden.Score(job); }

    // Each answer the Node server's (kept), the first that isn't shown with its case.
    private void Same(string what, JsonArray cases, JsonNode? got) =>
        book.Kept.Same(what, [.. cases.Select((_, i) => (object?)(what + " " + i))], [.. cases], [.. got!.AsArray()]);

    [Test]
    public async Task Names_compared_as_artfind_js_compares_them()
    {
        Needs.Server();
        var output = await Csharp(new JsonObject { ["bares"] = C("NAMES"), ["looses"] = C("NAMES"), ["texts"] = C("PAIRS"), ["artists"] = C("PAIRS"), ["matches"] = C("MATCHES"), ["cases"] = new JsonArray() });
        Same("bare", C("NAMES"), output["bare"]);
        Same("loose", C("NAMES"), output["loose"]);
        Same("sameText", C("PAIRS"), output["text"]);
        Same("sameArtist", C("PAIRS"), output["artist"]);
        Same("trackMatch", C("MATCHES"), output["tracks"]);
        // Track names compared without their brackets and edition notes; nothing to compare, no score.
        Assert.Equal(1, output["tracks"]![0]!.GetValue<double>());
        Assert.Null(output["tracks"]![1]);
    }

    [Test]
    public async Task Whole_searches_over_the_same_answers_end_in_the_same_candidates()
    {
        Needs.Server();
        var cases = C("CASES");
        var output = await Csharp(new JsonObject { ["cases"] = cases.DeepClone() });
        Same("find", new JsonArray([.. cases.Select(c => c!["album"]?.DeepClone())]), output["found"]);
        var found = output["found"]!.AsArray();
        // The searches said something worth checking: sure picks, cut at twelve, dead groups gone.
        Assert.Equal("https://is1.example/1/1200x1200bb.jpg", found[0]?["sure"].Str("url"));
        Assert.Equal(1, found[0]?["sure"]?["match"].Num("tracks"));
        Assert.Equal(2, found[0]?["candidates"]!.AsArray().Count);
        // A title-and-artist match with no track list is only a suggestion; the right tracks under the wrong artist aren't sure.
        Assert.Null(found[1]?["sure"]);
        Assert.Equal("https://dz.example/9.jpg", found[1]?["candidates"]?[0].Str("url"));
        Assert.Null(found[2]?["sure"]);
        Assert.Single(found[2]?["candidates"]!.AsArray()!);
        Assert.Equal(12, found[3]?["candidates"]!.AsArray().Count);
        Assert.Equal(12, found[8]?["candidates"]!.AsArray().Count);
        Assert.True(found[9]?["candidates"].Items().Select(c => c.Str("url")).SequenceEqual(["https://coverartarchive.org/release-group/has/front-1200"]), "a release group with no cover isn't offered");
    }
}
