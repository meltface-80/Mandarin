using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// Who an artist's page says they are is the act the library's albums are by (item 340), not whoever MusicBrainz finds
/// first by the name. The owner's nine albums by Airbag from Norway showed "Band · Spain · since 1998" and the Spanish
/// band's picture: the page's facts were looked up once by name, kept under the name, and never looked at again. Now the
/// act is the one the albums' tags or MusicBrainz matches say, else the one MusicBrainz credits with the albums' titles;
/// a name kept as another act is looked up again; and acts that share a name are each looked up as themselves.
/// MusicBrainz and Deezer stood in for.
/// </summary>
public sealed class ArtistActLookupTests
{
    private const string Norway = "0ec8e7b7-5c26-4444-ac17-64670cf32609", Spain = "5a5a5a5a-1111-4222-8333-444444444444";

    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    private static string Act(string id, string area, string begin) =>
        $$"""{ "id": "{{id}}", "name": "Airbag", "type": "Group", "disambiguation": "", "life-span": { "begin": "{{begin}}", "ended": false }, "area": { "name": "{{area}}" }, "relations": [] }""";

    // MusicBrainz: the Spanish band first for the name; the Norwegian band's for Identity and Disconnected.
    private static async Task<(FakeServer Mb, List<string> Asked)> Musicbrainz()
    {
        var asked = new List<string>();
        var mb = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            var q = Uri.UnescapeDataString(ctx.Request.QueryString.Value ?? "");
            lock (asked) asked.Add(path + q);
            if (path == "/artist/") return Json(ctx, $$"""{ "artists": [{ "id": "{{Spain}}", "name": "Airbag", "score": 100 }, { "id": "{{Norway}}", "name": "Airbag", "score": 100 }] }""");
            if (path == "/artist/" + Spain) return Json(ctx, Act(Spain, "Spain", "1998"));
            if (path == "/artist/" + Norway) return Json(ctx, Act(Norway, "Norway", "2004"));
            if (path == "/release-group/")
            {
                var norwegian = q.Contains("Identity", StringComparison.Ordinal) || q.Contains("Disconnected", StringComparison.Ordinal);
                var id = norwegian ? Norway : Spain;
                return Json(ctx, $$"""{ "release-groups": [{ "id": "rg", "title": "x", "artist-credit": [{ "name": "Airbag", "artist": { "id": "{{id}}", "name": "Airbag" } }] }] }""");
            }
            return Task.FromResult(ctx.Response.StatusCode = 404);
        });
        return (mb, asked);
    }

    private static void Album(Fixtures.Library lib, string title, int year, string? act)
    {
        for (var i = 1; i <= 2; i++)
        {
            var tags = new Dictionary<string, object> { ["title"] = $"{title} {i}", ["artist"] = "Airbag", ["album_artist"] = "Airbag", ["album"] = title, ["track"] = i, ["date"] = year.ToString(System.Globalization.CultureInfo.InvariantCulture) };
            if (act != null) tags["MUSICBRAINZ_ALBUMARTISTID"] = act;
            Fixtures.Gen(Path.Combine(lib.Music, "Airbag", title, $"0{i}.flac"), seconds: 1, freq: 300 + i * 50, tags: tags);
        }
    }

    [Test]
    public async Task Albums_with_no_MusicBrainz_id_are_the_act_MusicBrainz_credits_with_their_titles_not_the_first_of_the_name()
    {
        Needs.Server(); Needs.Ffmpeg();
        var (mb, asked) = await Musicbrainz();
        await using var _ = mb;
        await using var deezer = await FakeServer.Start(ctx => Json(ctx, """{ "data": [] }"""));
        var lib = Fixtures.MakeLibrary();
        Album(lib, "Identity", 2004, null);
        Album(lib, "Disconnected", 2016, null);
        await using var s = await LibraryServer.Start(lib, new Dictionary<string, object?> { ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = deezer.Base, ["wikidataBaseUrl"] = deezer.Base });
        await Session.Until(async () => (await s.Albums()).Count(a => a.Str("title") is "Identity" or "Disconnected") == 2, 30000, "the library");

        // Kept as the Spanish band, as the name found it before (the owner's library).
        // Once the server keeps what it knows of acts: kept as the Spanish band, as the name found it before (the owner's library).
        await Session.Until(async () => { await s.GetJ("/api/artist?name=Airbag"); try { return Convert.ToInt64(s.Server.Scalar("SELECT count(*) FROM artist_info WHERE key = 'airbag'")) == 1; } catch (Microsoft.Data.Sqlite.SqliteException) { return false; } }, 30000, "Airbag kept");
        s.Server.Exec($$"""UPDATE artist_info SET mbid = '{{Spain}}', about = '{"v":2,"area":"Spain","begin":"1998"}' WHERE key = 'airbag'""");

        JsonNode? page = null;
        await Session.Until(async () => { page = await s.GetJ("/api/artist?name=Airbag"); return page.Str("mbid") == Norway; }, 30000, "the Norwegian band");
        Assert.Equal("Norway", page.Str("area"));
        Assert.Equal("2004", page.Str("begin"));
        lock (asked) Assert.Contains(asked, a => a.StartsWith("/release-group/", StringComparison.Ordinal) && a.Contains("Identity", StringComparison.Ordinal));
        // Kept as that act from now: asked again, as it is, MusicBrainz not asked for the act again.
        int Acts() { lock (asked) return asked.Count(a => a.StartsWith("/artist/" + Norway, StringComparison.Ordinal)); }
        var n = Acts();
        Assert.Equal(Norway, (await s.GetJ("/api/artist?name=Airbag")).Str("mbid"));
        Assert.Equal(n, Acts());
    }

    [Test]
    public async Task Acts_that_share_a_name_are_each_looked_up_as_themselves_by_their_own_id()
    {
        Needs.Server(); Needs.Ffmpeg();
        var (mb, asked) = await Musicbrainz();
        await using var _ = mb;
        await using var deezer = await FakeServer.Start(ctx => Json(ctx, """{ "data": [] }"""));
        var lib = Fixtures.MakeLibrary();
        Album(lib, "Identity", 2004, Norway);
        Album(lib, "Disconnected", 2016, Norway);
        Album(lib, "Una Hora Mas", 2001, Spain);
        await using var s = await LibraryServer.Start(lib, new Dictionary<string, object?> { ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = deezer.Base, ["wikidataBaseUrl"] = deezer.Base });
        JsonNode[] acts = [];
        await Session.Until(async () => { acts = [.. (await s.GetJ("/api/artists?limit=50"))["artists"].Items().Where(a => a.Str("name") == "Airbag").Select(a => a!)]; return acts.Length == 2; }, 30000, "two Airbags");
        var norway = acts.First(a => a.Num("albumCount") == 2).Num("artist_id");
        var spain = acts.First(a => a.Num("albumCount") == 1).Num("artist_id");

        JsonNode? page = null;
        await Session.Until(async () => { page = await s.GetJ($"/api/artist?name=Airbag&artist_id={norway}"); return page.Str("mbid") == Norway; }, 30000, "the Norwegian band");
        Assert.Equal("Norway", page.Str("area"));
        await Session.Until(async () => { page = await s.GetJ($"/api/artist?name=Airbag&artist_id={spain}"); return page.Str("mbid") == Spain; }, 30000, "the Spanish band");
        Assert.Equal("Spain", page.Str("area"));
        // Each as itself again, neither in the other's place.
        Assert.Equal(Norway, (await s.GetJ($"/api/artist?name=Airbag&artist_id={norway}")).Str("mbid"));
    }
}
