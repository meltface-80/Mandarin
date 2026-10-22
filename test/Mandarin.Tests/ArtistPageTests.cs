using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An artist's page rebuilt (bug list item 131; public/app/artist-about.js): over their albums, what they are, where
/// from and when, their links (no MusicBrainz pill, item 133), and a band's members now, each with what they played and when, a tap opening the member's
/// own page. MusicBrainz stood in for (CreditsTests' band), the page in a browser at a phone's size.
/// </summary>
public sealed class ArtistPageTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const $$ = s => [...document.querySelectorAll(s)];
          await until(() => document.querySelector("#home-view .album"));
          await sleep(400);
          window.__showArtistAlbums("Ten Thousand Maniacs");
          await until(() => document.querySelector(".artist-facts") && document.querySelector(".artist-stint"));
          const out = {
            facts: document.querySelector(".artist-facts").textContent,
            links: $$(".artist-link").map(a => [a.textContent, a.getAttribute("href"), a.target]),
            sections: $$("#album-grid .artist-section-header").map(h => h.textContent),
            members: $$(".artist-stint").map(b => [b.getAttribute("aria-label"), (b.querySelector(".artist-stint-line") || {}).textContent || ""]),
            row: getComputedStyle(document.querySelector(".artist-stint-row")).overflowX,
            round: getComputedStyle(document.querySelector(".artist-stint-art")).borderTopLeftRadius,
            tiles: $$("#album-grid .album:not(.skeleton)").length,
          };
          $$(".artist-stint").find(b => b.getAttribute("aria-label") === "Jerome Augustyniak").click();
          await until(() => /Jerome Augustyniak/.test(document.getElementById("album-count").textContent));
          out.memberTitle = document.getElementById("album-count").textContent;
          return out;
        })()
        """;

    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task Who_a_band_is_over_its_albums_its_links_and_its_members_each_opening_their_own_page()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var mb = await FakeServer.Start(ctx =>
        {
            var path = ctx.Request.Path.Value ?? "";
            return path == "/artist/" + CreditsTests.Band ? Json(ctx, CreditsTests.BandJson)
                : path == "/artist/" ? Json(ctx, $$"""{ "artists": [{ "id": "{{CreditsTests.Band}}", "name": "Ten Thousand Maniacs" }] }""")
                : Task.FromResult(ctx.Response.StatusCode = 404);
        });
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        var lib = Fixtures.MakeLibrary();
        Fixtures.Gen(Path.Combine(lib.Music, "Ten Thousand Maniacs", "In My Tribe", "01.flac"), seconds: 1, freq: 300, tags: new Dictionary<string, object>
        {
            ["title"] = "What's the Matter Here?", ["artist"] = "Ten Thousand Maniacs", ["album"] = "In My Tribe", ["track"] = 1, ["date"] = "1987",
        });
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base, ["lastfmBaseUrl"] = none.Base,
        }, lib);
        await using var b = await Browser.Launch(390, 844);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!;

        Assert.Equal("Band · United States · since 1981", (string?)r["facts"]);
        // No MusicBrainz pill (item 133); MusicBrainz's site where Wikidata has none.
        Assert.Equal(["Official site", "Wikidata"], r["links"]!.AsArray().Select(l => (string?)l![0]));
        Assert.Equal("https://www.maniacs.com/", (string?)r["links"]![0]![1]);
        Assert.True(r["links"]!.AsArray().All(l => (string?)l![2] == "_blank"), "each link opens beside the page");
        Assert.Equal(["Members"], r["sections"]!.AsArray().Select(h => (string?)h));
        // Those in the band now (item 133): Natalie Merchant left in 2019.
        Assert.Equal(1, r["members"]!.AsArray().Count);
        Assert.Equal("Jerome Augustyniak", (string?)r["members"]![0]![0]);
        Assert.Equal("Drums · since 1981", (string?)r["members"]![0]![1]);
        Assert.Equal("auto", (string?)r["row"]);
        Assert.Equal("50%", (string?)r["round"]);
        Assert.Equal(1.0, r["tiles"]!.GetValue<double>());
        Assert.Contains("Jerome Augustyniak", (string?)r["memberTitle"]);
        Assert.Empty(page.Errors);
    }
}
