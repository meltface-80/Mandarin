using System.Text.Json.Nodes;

namespace Mandarin.Tests;

/// <summary>
/// The Artists wall's find (bug list item 130; LibraryRoutes.Browse.cs, /api/artists?q=): the acts whose name has the
/// words in it, accents, case and spacing aside, the whole library's and not a page's; each find an answer of its own.
/// </summary>
public sealed class ArtistsFindTests
{
    [Test]
    public async Task Artists_found_by_part_of_the_name_accents_and_case_aside()
    {
        await using var s = await Session.Started();
        async Task<JsonNode> Get(string q) => JsonNode.Parse((await s.Api("artists?sort=az" + q)).Text)!;
        string[] Names(JsonNode j) => [.. j["artists"].Items().Select(a => a.Str("name")!)];

        var all = await Get("");
        Assert.Equal(new[] { "Artist A", "Artist B" }, Names(all));
        var b = await Get("&q=%C3%81RTIST%20b");
        Assert.Equal(new[] { "Artist B" }, Names(b));
        Assert.Equal(1, b.Num("total"));
        var both = await Get("&q=tist");
        Assert.Equal(new[] { "Artist A", "Artist B" }, Names(both));
        var none = await Get("&q=zz");
        Assert.Empty(Names(none));
        Assert.Equal(0, none.Num("total"));
        // Asked again unfound, the whole list: a find is kept as its own answer, not another's.
        Assert.Equal(new[] { "Artist A", "Artist B" }, Names(await Get("")));
        Assert.Equal(new[] { "Artist B" }, Names(await Get("&q=%C3%81RTIST%20b")));
    }
}
