using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An artist's page made right (bug list item 133, the owner's notes on 131): the official site Wikidata keeps rather
/// than an old one MusicBrainz marks ended; a band's members as Wikipedia lists them (those in it now, or a band that
/// ended its last line-up), not everyone who ever played in it; and a member's own page with their bands' albums from
/// their years in them, where it said "0 albums". The rules through `mandarin-server score`, then the route with
/// MusicBrainz stood in for.
/// </summary>
public sealed class ArtistEnrichmentTests
{
    private const string Maiden = "ca891d65-d9b0-4258-89f7-e6ba29d83767", Gers = "e2d3b2bf-04b6-4a3f-8a8f-4b0f1f1c1a01", Harris = "e2d3b2bf-04b6-4a3f-8a8f-4b0f1f1c1a02",
        Day = "e2d3b2bf-04b6-4a3f-8a8f-4b0f1f1c1a03", Old = "e2d3b2bf-04b6-4a3f-8a8f-4b0f1f1c1a04";

    private static string Person(string id, string name) => $$"""{ "id": "{{id}}", "name": "{{name}}", "type": "Person" }""";

    private static readonly string MaidenJson = $$"""
    {
      "id": "{{Maiden}}", "name": "Iron Maiden", "type": "Group", "life-span": { "begin": "1975-12-25", "ended": false }, "area": { "name": "United Kingdom" },
      "relations": [
        { "type": "member of band", "direction": "backward", "attributes": ["lead vocals"], "begin": "1975", "end": "1976", "ended": true, "artist": {{Person(Day, "Paul Day")}} },
        { "type": "member of band", "direction": "backward", "attributes": ["bass guitar", "original"], "begin": "1975", "end": null, "ended": false, "artist": {{Person(Harris, "Steve Harris")}} },
        { "type": "member of band", "direction": "backward", "attributes": ["guitar"], "begin": "1990", "end": null, "ended": false, "artist": {{Person(Gers, "Janick Gers")}} },
        { "type": "official homepage", "direction": "forward", "ended": true, "url": { "resource": "https://old.ironmaiden.example/" } },
        { "type": "discogs", "direction": "forward", "ended": false, "url": { "resource": "https://www.discogs.com/artist/251595" } }
      ]
    }
    """;

    private static readonly string GersJson = $$"""
    {
      "id": "{{Gers}}", "name": "Janick Gers", "type": "Person", "life-span": { "begin": "1957-01-27", "ended": false },
      "relations": [
        { "type": "member of band", "direction": "forward", "attributes": ["guitar"], "begin": "1990", "end": null, "ended": false, "artist": { "id": "{{Maiden}}", "name": "Iron Maiden", "type": "Group" } }
      ]
    }
    """;

    private static readonly string OldJson = $$"""
    {
      "id": "{{Old}}", "name": "Old Band", "type": "Group", "life-span": { "begin": "1980", "end": "1990-06", "ended": true },
      "relations": [
        { "type": "member of band", "direction": "backward", "attributes": ["drums"], "begin": "1980", "end": "1985", "ended": true, "artist": {{Person("e2d3b2bf-04b6-4a3f-8a8f-4b0f1f1c1a05", "Early Drummer")}} },
        { "type": "member of band", "direction": "backward", "attributes": ["guitar"], "begin": "1982", "end": "1990", "ended": true, "artist": {{Person("e2d3b2bf-04b6-4a3f-8a8f-4b0f1f1c1a06", "Last Guitarist")}} }
      ]
    }
    """;

    private static Task<JsonNode> Run(object job) => Score.Run(job);

    [Test]
    public async Task An_ended_link_passed_over_and_Wikidata_s_site_the_preferred_one_still_current()
    {
        var a = (await Run(new { fn = "credits", artist = JsonNode.Parse(MaidenJson) }))["artist"]!;
        Assert.Null(a["links"].Str("official"));
        Assert.Equal("https://www.discogs.com/artist/251595", a["links"].Str("discogs"));
        var w = await Run(new
        {
            fn = "credits",
            wikidata = new object[]
            {
                JsonNode.Parse("""
                { "entities": { "Q1": { "claims": { "P856": [
                  { "rank": "deprecated", "mainsnak": { "datavalue": { "value": "https://deprecated.example/" } } },
                  { "rank": "normal", "qualifiers": { "P582": [{ "datavalue": { "value": { "time": "+2020-00-00T00:00:00Z" } } }] }, "mainsnak": { "datavalue": { "value": "https://ended.example/" } } },
                  { "rank": "normal", "mainsnak": { "datavalue": { "value": "https://normal.example/" } } },
                  { "rank": "preferred", "mainsnak": { "datavalue": { "value": "https://aawilliams.music/" } } }
                ] } } } }
                """)!,
                "https://www.wikidata.org/wiki/Q1",
            },
        });
        Assert.Equal("https://aawilliams.music/", w.Str("wikidata_site"));
    }

    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task A_band_s_members_now_or_its_last_line_up_and_a_member_s_page_with_the_band_s_albums_from_their_years()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var mb = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            var q = ctx.Request.Query["query"].ToString();
            string Found(string id, string name) => $$"""{ "artists": [{ "id": "{{id}}", "name": "{{name}}" }] }""";
            return path == "/artist/" + Maiden ? Json(ctx, MaidenJson)
                : path == "/artist/" + Gers ? Json(ctx, GersJson)
                : path == "/artist/" + Old ? Json(ctx, OldJson)
                : path == "/artist/" && q.Contains("Janick Gers", StringComparison.Ordinal) ? Json(ctx, Found(Gers, "Janick Gers"))
                : path == "/artist/" && q.Contains("Iron Maiden", StringComparison.Ordinal) ? Json(ctx, Found(Maiden, "Iron Maiden"))
                : path == "/artist/" && q.Contains("Old Band", StringComparison.Ordinal) ? Json(ctx, Found(Old, "Old Band"))
                : path == "/artist/" ? Json(ctx, """{ "artists": [] }""")
                : Task.FromResult(ctx.Response.StatusCode = 404);
        });
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        var lib = Fixtures.MakeLibrary();
        foreach (var (album, year, freq) in new[] { ("Powerslave", "1984", 300), ("Fear of the Dark", "1992", 350) })
            Fixtures.Gen(Path.Combine(lib.Music, "Iron Maiden", album, "01.flac"), seconds: 1, freq: freq, tags: new Dictionary<string, object>
            {
                ["title"] = album + " track", ["artist"] = "Iron Maiden", ["album"] = album, ["track"] = 1, ["date"] = year,
            });
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base, ["lastfmBaseUrl"] = none.Base,
        }, lib);
        async Task<JsonNode> Artist(string name) => JsonNode.Parse((await s.Api("artist?name=" + Uri.EscapeDataString(name))).Text)!;
        string?[] Names(JsonNode? list) => [.. list.Items().Select(m => m.Str("name"))];

        var maiden = await Artist("Iron Maiden");
        Assert.True(maiden.Bool("known"));
        Assert.Equal(["Steve Harris", "Janick Gers"], Names(maiden["members"]));
        Assert.Null(maiden["links"].Str("official"));

        var gers = await Artist("Janick Gers");
        Assert.Equal(["Iron Maiden"], Names(gers["member_of"]));
        var groups = gers["band_albums"]!.AsArray();
        Assert.Single(groups);
        Assert.Equal("Iron Maiden", groups[0].Str("band"));
        Assert.Equal(["Fear of the Dark"], groups[0]!["albums"].Items().Select(a => a.Str("title")));

        var old = await Artist("Old Band");
        Assert.Equal(["Last Guitarist"], Names(old["members"]));
    }
}
