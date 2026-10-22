using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// The albums' credits and the acts behind them (bug list item 129, server/Mandarin.Server/Credits/):
/// who played, sang, wrote and made an album, read from its files' tags and from MusicBrainz's release;
/// a band's members and a person's bands, and the act's links, from MusicBrainz's artist; its picture
/// from Wikidata, FanArt.tv or Deezer. The rules through `mandarin-server score`; then the routes on a
/// tagged album, with MusicBrainz, Wikidata and Deezer stood in for.
/// </summary>
public sealed class CreditsTests
{
    private const string Band = "0b3e1a0c-6c4e-4e7b-9f3e-1d2c3b4a5f60", Jerome = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f", Natalie = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
        Novi = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b", Robert = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c", Peter = "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d",
        Release = "6b7c8d9e-0f1a-4b2c-9d4e-5f6a7b8c9d0e";

    private static string Artist(string id, string name) => $$"""{ "id": "{{id}}", "name": "{{name}}", "sort-name": "{{name}}", "type": "Person", "disambiguation": "" }""";

    // A release as MusicBrainz answers it with its recordings', works' and artists' relations (inc=…recording-level-rels+work-level-rels).
    private static readonly string ReleaseJson = $$"""
    {
      "id": "{{Release}}", "title": "In My Tribe", "date": "1987-07-27",
      "artist-credit": [{ "name": "Ten Thousand Maniacs", "joinphrase": "", "artist": { "id": "{{Band}}", "name": "Ten Thousand Maniacs" } }],
      "relations": [
        { "type": "producer", "target-type": "artist", "direction": "backward", "attributes": [], "artist": {{Artist(Peter, "Peter Asher")}} },
        { "type": "design/illustration", "target-type": "artist", "direction": "backward", "attributes": [], "artist": {{Artist(Jerome, "Jerome Augustyniak")}}, "target-credit": "" },
        { "type": "amazon asin", "target-type": "url", "url": { "resource": "https://www.amazon.com/" } }
      ],
      "media": [{ "position": 1, "tracks": [
        { "position": 2, "title": "Hey Jack Kerouac", "recording": { "id": "r2", "relations": [
          { "type": "instrument", "target-type": "artist", "direction": "backward", "attributes": ["viola", "guest"], "artist": {{Artist(Novi, "Novi Novog")}} },
          { "type": "instrument", "target-type": "artist", "direction": "backward", "attributes": ["drums (drum set)"], "artist": {{Artist(Jerome, "Jerome Augustyniak")}} }
        ] } },
        { "position": 1, "title": "What's the Matter Here?", "recording": { "id": "r1", "relations": [
          { "type": "instrument", "target-type": "artist", "direction": "backward", "attributes": ["drums (drum set)"], "artist": {{Artist(Jerome, "Jerome Augustyniak")}} },
          { "type": "vocal", "target-type": "artist", "direction": "backward", "attributes": ["lead vocals"], "artist": {{Artist(Natalie, "Natalie Merchant")}} },
          { "type": "performance", "target-type": "work", "direction": "forward", "attributes": [], "work": { "id": "w1", "title": "What's the Matter Here?", "relations": [
            { "type": "composer", "target-type": "artist", "direction": "backward", "attributes": [], "artist": {{Artist(Natalie, "Natalie Merchant")}} },
            { "type": "composer", "target-type": "artist", "direction": "backward", "attributes": [], "artist": {{Artist(Robert, "Robert Buck")}} }
          ] } }
        ] } }
      ] }]
    }
    """;

    // A band as MusicBrainz answers it with its artist and URL relations: a member twice (left, came back), its links.
    private static readonly string BandJson = $$"""
    {
      "id": "{{Band}}", "name": "Ten Thousand Maniacs", "type": "Group", "disambiguation": "US alternative rock band",
      "life-span": { "begin": "1981", "end": null, "ended": false }, "area": { "name": "United States" },
      "relations": [
        { "type": "member of band", "target-type": "artist", "direction": "backward", "attributes": ["drums (drum set)", "original"], "begin": "1981", "end": null, "ended": false, "artist": {{Artist(Jerome, "Jerome Augustyniak")}} },
        { "type": "member of band", "target-type": "artist", "direction": "backward", "attributes": ["lead vocals", "original"], "begin": "1981", "end": "1993", "ended": true, "artist": {{Artist(Natalie, "Natalie Merchant")}} },
        { "type": "member of band", "target-type": "artist", "direction": "backward", "attributes": ["lead vocals"], "begin": "2019", "end": "2019", "ended": true, "artist": {{Artist(Natalie, "Natalie Merchant")}} },
        { "type": "wikidata", "target-type": "url", "direction": "forward", "attributes": [], "url": { "resource": "https://www.wikidata.org/wiki/Q1361578" } },
        { "type": "official homepage", "target-type": "url", "direction": "forward", "attributes": [], "url": { "resource": "https://www.maniacs.com/" } },
        { "type": "wikidata", "target-type": "url", "direction": "forward", "attributes": [], "url": { "resource": "https://www.wikidata.org/wiki/Q999" } }
      ]
    }
    """;

    // A person, from the other side: the bands it was in (forward).
    private static readonly string PersonJson = $$"""
    {
      "id": "{{Natalie}}", "name": "Natalie Merchant", "type": "Person", "life-span": { "begin": "1963-10-26", "ended": false },
      "relations": [
        { "type": "member of band", "target-type": "artist", "direction": "forward", "attributes": ["lead vocals"], "begin": "1981", "end": "1993", "ended": true, "artist": { "id": "{{Band}}", "name": "Ten Thousand Maniacs", "type": "Group" } }
      ]
    }
    """;

    private const string WikidataJson = """
    { "entities": { "Q1361578": { "id": "Q1361578", "claims": { "P18": [{ "mainsnak": { "snaktype": "value", "property": "P18", "datavalue": { "value": "10,000 Maniacs 1987.jpg", "type": "string" } } }] } } } }
    """;

    private const string DeezerJson = """
    { "data": [{ "name": "Ten Thousand Maniacs Tribute", "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/aaa/1000x1000.jpg" },
      { "name": "Ten Thousand Maniacs", "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist//1000x1000.jpg" },
      { "name": "ten thousand MANIACS", "picture_xl": "https://e-cdns-images.dzcdn.net/images/artist/bbb/1000x1000.jpg" }] }
    """;

    private const string Photo = "https://commons.wikimedia.org/wiki/Special:FilePath/10%2C000_Maniacs_1987.jpg?width=640";

    private static Task<JsonNode> Run(object job) => Score.Run(job);
    private static IEnumerable<string?> Names(JsonNode? rows) => rows.Items().Select(r => r.Str("name"));
    private static JsonNode? Row(JsonNode? rows, string name) => rows.Items().First(r => r.Str("name") == name);

    [Test]
    public async Task The_files_own_tags_name_the_players_with_their_instruments_and_those_who_made_the_record()
    {
        var r = await Run(new
        {
            fn = "credits", tracks = 2,
            tags = new object[]
            {
                new object[] { 1, new Dictionary<string, string[]>
                {
                    ["PERFORMER"] = ["Jerome Augustyniak (drums, percussion)", "Natalie Merchant (lead vocals)", "Robert Buck (guitar)"],
                    ["PRODUCER"] = ["Peter Asher"], ["COMPOSER"] = ["Natalie Merchant; Robert Buck"], ["TITLE"] = ["What's the Matter Here?"],
                } },
                new object[] { 2, new Dictionary<string, string[]>
                {
                    ["PERFORMER"] = ["Jerome Augustyniak (drums, percussion)", "Novi Novog (viola)"],
                    ["----:COM.APPLE.ITUNES:ENGINEER"] = ["George Massenburg"], ["TMCL"] = ["{\"piano\":[\"Dennis Drew\"]}"],
                } },
            },
        });
        var rows = r["rows"];
        // The players first (on every track before those on some), then the writers, then those who made the record.
        Assert.Equal(["Jerome Augustyniak", "Dennis Drew", "Natalie Merchant", "Novi Novog", "Robert Buck", "George Massenburg", "Peter Asher"], Names(rows));
        Assert.Equal(["Drums", "Percussion"], Row(rows, "Jerome Augustyniak").Strs("roles"));
        Assert.Empty(Row(rows, "Jerome Augustyniak")!["tracks"].Items());
        Assert.Equal(["Lead vocals", "Composer"], Row(rows, "Natalie Merchant").Strs("roles"));
        Assert.Equal([1.0], Row(rows, "Natalie Merchant")!["tracks"].Items().Select(t => (double)t!));
        Assert.Equal(["Piano"], Row(rows, "Dennis Drew").Strs("roles"));
        Assert.Equal(["Engineer"], Row(rows, "George Massenburg").Strs("roles"));
        Assert.Equal(["Guitar", "Composer"], Row(rows, "Robert Buck").Strs("roles"));
        Assert.All(rows.Items(), x => Assert.Equal("tags", x.Str("source")));
        // The title names no one.
        Assert.DoesNotContain(r["credits"].Items(), c => c.Str("name") == "What's the Matter Here?");
    }

    [Test]
    public async Task A_release_names_who_played_on_each_recording_who_wrote_each_work_and_who_made_the_record()
    {
        var r = await Run(new { fn = "credits", tracks = 2, release = JsonNode.Parse(ReleaseJson) });
        var rows = r["rows"];
        Assert.Equal(["Jerome Augustyniak", "Natalie Merchant", "Novi Novog", "Robert Buck", "Peter Asher"], Names(rows));
        // On both tracks (the tracks in their places, not as listed): every track. The sleeve after the playing.
        Assert.Equal(["Drums", "Design"], Row(rows, "Jerome Augustyniak").Strs("roles"));
        Assert.Empty(Row(rows, "Jerome Augustyniak")!["tracks"].Items());
        Assert.Equal(Jerome, Row(rows, "Jerome Augustyniak").Str("mbid"));
        Assert.Equal(["Lead vocals", "Composer"], Row(rows, "Natalie Merchant").Strs("roles"));
        Assert.Equal([1.0], Row(rows, "Natalie Merchant")!["tracks"].Items().Select(t => (double)t!));
        // How it was played is left off ("guest"); the second track is the second, whatever the order MusicBrainz lists them in.
        Assert.Equal(["Viola"], Row(rows, "Novi Novog").Strs("roles"));
        Assert.Equal([2.0], Row(rows, "Novi Novog")!["tracks"].Items().Select(t => (double)t!));
        // The release's own relations are the whole album's; a link names no one.
        Assert.Equal(["Producer"], Row(rows, "Peter Asher").Strs("roles"));
        Assert.Empty(Row(rows, "Peter Asher")!["tracks"].Items());
        Assert.All(rows.Items(), x => Assert.Equal("musicbrainz", x.Str("source")));
        Assert.Single(r["acts"].Items());
        Assert.Equal(["Ten Thousand Maniacs", Band], r["acts"]![0].Items().Select(x => (string?)x));
    }

    [Test]
    public async Task Tags_and_a_release_together_one_row_a_name_with_MusicBrainz_s_id()
    {
        var r = await Run(new
        {
            fn = "credits", tracks = 2, release = JsonNode.Parse(ReleaseJson),
            tags = new object[] { new object[] { 2, new Dictionary<string, string[]> { ["PERFORMER"] = ["novi novog (Viola)", "Dennis Drew (keyboards)"] } } },
        });
        var rows = r["rows"];
        Assert.Single(rows.Items(), x => x.Str("key") == "novi novog");
        Assert.Equal("Novi Novog", Row(rows, "Novi Novog").Str("name"));
        Assert.Equal(Novi, Row(rows, "Novi Novog").Str("mbid"));
        Assert.Equal(["Viola"], Row(rows, "Novi Novog").Strs("roles"));
        Assert.Equal("tags", Row(rows, "Dennis Drew").Str("source"));
    }

    [Test]
    public async Task A_band_s_members_with_their_years_and_parts_a_person_s_bands_and_the_links()
    {
        var r = await Run(new { fn = "credits", artist = JsonNode.Parse(BandJson) });
        var a = r["artist"]!;
        Assert.Equal("Group", a.Str("type"));
        Assert.Equal("1981", a.Str("begin"));
        Assert.Equal("United States", a.Str("area"));
        var members = a["members"];
        Assert.Equal(["Jerome Augustyniak", "Natalie Merchant"], Names(members));
        Assert.Equal(["Drums"], Row(members, "Jerome Augustyniak").Strs("roles"));
        Assert.Null(Row(members, "Jerome Augustyniak").Str("end"));
        // Two stints as one: the first start, the last end.
        Assert.Equal("1981", Row(members, "Natalie Merchant").Str("begin"));
        Assert.Equal("2019", Row(members, "Natalie Merchant").Str("end"));
        Assert.Equal(["Lead vocals"], Row(members, "Natalie Merchant").Strs("roles"));
        Assert.Empty(a["member_of"].Items());
        // The first link of each kind.
        Assert.Equal("https://www.wikidata.org/wiki/Q1361578", a["links"].Str("wikidata"));
        Assert.Equal("https://www.maniacs.com/", a["links"].Str("official"));

        var p = (await Run(new { fn = "credits", artist = JsonNode.Parse(PersonJson) }))["artist"]!;
        Assert.Empty(p["members"].Items());
        Assert.Equal(["Ten Thousand Maniacs"], Names(p["member_of"]));
        Assert.Equal(Band, p["member_of"]![0].Str("mbid"));
    }

    [Test]
    public async Task An_act_s_picture_from_Wikidata_FanArt_or_Deezer_and_its_address_as_the_image_route_reads_it()
    {
        var r = await Run(new
        {
            fn = "credits",
            wikidata = new object[] { JsonNode.Parse(WikidataJson)!, "https://www.wikidata.org/wiki/Q1361578" },
            fanart = JsonNode.Parse("""{ "artistthumb": [{ "url": "https://assets.fanart.tv/thumb.jpg" }] }"""),
            // Deezer's blank (no id in its address) passed over, and an act of another name.
            deezer = new object[] { JsonNode.Parse(DeezerJson)!, "Ten Thousand Maniacs" },
            search = new object[] { JsonNode.Parse($$"""{ "artists": [{ "id": "x", "name": "Ten Thousand Maniacs Tribute Band" }, { "id": "{{Band}}", "name": "Ten Thousand Maniacs" }] }""")!, "ten thousand maniacs" },
            url = Photo,
        });
        Assert.Equal("Q1361578", r.Str("wikidata_id"));
        Assert.Equal(Photo, r.Str("wikidata"));
        Assert.Equal("https://assets.fanart.tv/thumb.jpg", r.Str("fanart"));
        Assert.Equal("https://e-cdns-images.dzcdn.net/images/artist/bbb/1000x1000.jpg", r.Str("deezer"));
        Assert.Equal(Band, r.Str("found"));
        Assert.StartsWith("u-", r.Str("key"));
        Assert.Equal(Photo, r.Str("back"));
    }

    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task An_albums_credits_and_its_act_through_the_routes_found_when_first_asked()
    {
        Needs.Server(); Needs.Ffmpeg();
        var asked = new List<string>();
        string[] Asked() { lock (asked) return [.. asked]; }
        await using var mb = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            lock (asked) asked.Add(path + ctx.Request.QueryString.Value);
            return path == "/release/" + Release ? Json(ctx, ReleaseJson)
                : path == "/artist/" + Band ? Json(ctx, BandJson)
                : path == "/artist/" ? Json(ctx, """{ "artists": [] }""")
                : Task.FromResult(ctx.Response.StatusCode = 404);
        });
        await using var wikidata = await FakeServer.Start(ctx => ctx.Request.Path.Value == "/wiki/Special:EntityData/Q1361578.json"
            ? Json(ctx, WikidataJson) : Task.FromResult(ctx.Response.StatusCode = 404));
        await using var deezer = await FakeServer.Start(ctx => Json(ctx, """{ "data": [] }"""));

        var lib = Fixtures.MakeLibrary();
        var dir = Path.Combine(lib.Music, "Ten Thousand Maniacs", "In My Tribe");
        Fixtures.Gen(Path.Combine(dir, "01.flac"), seconds: 1, freq: 300, tags: new Dictionary<string, object>
        {
            ["title"] = "What's the Matter Here?", ["artist"] = "Ten Thousand Maniacs", ["album"] = "In My Tribe", ["track"] = 1, ["date"] = "1987",
            ["performer"] = "Dennis Drew (organ)", ["MUSICBRAINZ_ALBUMID"] = Release,
        });
        Fixtures.Gen(Path.Combine(dir, "02.flac"), seconds: 1, freq: 350, tags: new Dictionary<string, object>
        {
            ["title"] = "Hey Jack Kerouac", ["artist"] = "Ten Thousand Maniacs", ["album"] = "In My Tribe", ["track"] = 2, ["date"] = "1987", ["MUSICBRAINZ_ALBUMID"] = Release,
        });
        await using var s = await LibraryServer.Start(lib, new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = deezer.Base, ["wikidataBaseUrl"] = wikidata.Base,
        });
        var tables = () => s.Server.Scalar("SELECT count(*) FROM sqlite_master WHERE name = 'artist_info'");

        // Reading before anything is found makes nothing: no photo yet, no tables.
        var before = await s.GetJ("/api/artists");
        Assert.Null(before["artists"].Items().First(a => a.Str("name") == "Ten Thousand Maniacs").Str("photo_key"));
        Assert.Equal(0L, tables());

        var tribe = (await s.Albums()).First(a => a.Str("title") == "In My Tribe");
        var credits = await s.GetJ("/api/album/credits?offset=" + tribe.Num("offset"));
        Assert.Equal("musicbrainz", credits.Str("status"));
        Assert.Equal(["Jerome Augustyniak", "Dennis Drew", "Natalie Merchant", "Novi Novog", "Robert Buck", "Peter Asher"], Names(credits["credits"]));
        Assert.Null(Row(credits["credits"], "Jerome Augustyniak")!["tracks"]);
        Assert.Equal([1.0], Row(credits["credits"], "Dennis Drew")!["tracks"].Items().Select(t => (double)t!));
        Assert.Equal(["Organ"], Row(credits["credits"], "Dennis Drew").Strs("roles"));
        int Releases() => Asked().Count(a => a.StartsWith("/release/" + Release + "?fmt=json&inc=", StringComparison.Ordinal));
        Assert.Equal(1, Releases());
        // Asked again: as kept, MusicBrainz not asked twice.
        Assert.Equal("musicbrainz", (await s.GetJ("/api/album/credits?offset=" + tribe.Num("offset"))).Str("status"));
        Assert.Equal(1, Releases());

        // The act: by the release's own id for it (no search), its members, its links, Wikidata's picture.
        var band = await s.GetJ("/api/artist?name=" + Uri.EscapeDataString("Ten Thousand Maniacs"));
        Assert.True(band.Bool("known"));
        Assert.Equal(Band, band.Str("mbid"));
        Assert.Equal("Group", band.Str("type"));
        Assert.Equal(["Jerome Augustyniak", "Natalie Merchant"], Names(band["members"]));
        Assert.Equal("Wikimedia Commons", band.Str("photo_source"));
        Assert.False(band["members"]![0].Bool("in_library"));
        Assert.True(band.Bool("in_library"));
        Assert.DoesNotContain(Asked(), a => a.StartsWith("/artist/?", StringComparison.Ordinal));
        Assert.Equal("https://www.maniacs.com/", band["links"].Str("official"));

        // A member: credited on the album, with the roles there.
        var jerome = await s.GetJ("/api/artist?name=" + Uri.EscapeDataString("Jerome Augustyniak"));
        Assert.Equal(["In My Tribe"], jerome["credited_on"].Items().Select(a => a.Str("title")));
        Assert.Equal(["Drums", "Design"], jerome["credited_on"]![0].Strs("roles"));

        // The artists' wall: the act's own picture now.
        var after = await s.GetJ("/api/artists");
        var key = after["artists"].Items().First(a => a.Str("name") == "Ten Thousand Maniacs").Str("photo_key");
        Assert.NotNull(key);
        Assert.Equal(1L, tables());
        var status = await s.GetJ("/api/credits/status");
        Assert.Equal(1.0, status.Num("albums"));
    }
}
