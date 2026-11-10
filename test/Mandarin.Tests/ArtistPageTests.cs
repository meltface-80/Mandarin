using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An artist's page rebuilt (bug list item 131; public/app/artist-about.js), now in tabs (artist-tabs.js):
/// over the tabs, what they are, where from and when, and no links; Overview open as the page opens, their albums in
/// a row (See all opening Discography) and similar artists and albums last; Discography the album grid; About a band's
/// members now, each with what they played and when, open under their heading (a tap folds them), a tap on one opening
/// the member's own page. And the page opened again drawn from what it last had, the server not asked for its albums
/// again. MusicBrainz stood in for (CreditsTests' band), the page in a browser at a phone's size.
/// </summary>
public sealed class ArtistPageTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const $$ = s => [...document.querySelectorAll(s)];
          const seen = s => $$(s).filter(e => e.getClientRects().length > 0);
          const tab = t => document.querySelector('.artist-tab[data-artist-tab="' + t + '"]');
          await until(() => document.querySelector("#home-view .album"));
          await sleep(400);
          const asked = [];
          const fetch0 = window.fetch;
          window.fetch = (u, o) => { asked.push(String(u)); return fetch0(u, o); };
          window.__showArtistAlbums("Ten Thousand Maniacs");
          await until(() => document.querySelector(".artist-facts") && document.querySelector(".artist-stint"));
          const grid = document.getElementById("album-grid");
          const out = {
            facts: document.querySelector(".artist-facts").textContent,
            links: $$(".artist-link, .artist-links").length,
            tabs: $$(".artist-tab").map(b => b.textContent),
            open: grid.dataset.artistTab,
            overview: { cards: seen(".artist-overview-album").map(b => b.getAttribute("aria-label")), tiles: seen("#album-grid .album").length,
                        stints: seen(".artist-stint").length, foot: seen(".artist-tail").length },
            footLast: grid.lastElementChild.classList.contains("artist-tail"),
          };
          document.querySelector(".artist-see-all").click();
          out.discography = { open: grid.dataset.artistTab, on: tab("discography").getAttribute("aria-selected"), tiles: seen("#album-grid .album:not(.skeleton)").length,
                              sections: seen("#album-grid .artist-section-header").map(h => h.textContent), cards: seen(".artist-overview-album").length, foot: seen(".artist-tail").length };
          tab("about").click();
          out.about = { tiles: seen("#album-grid .album").length, sections: seen("#album-grid .artist-section-header").map(h => h.textContent),
                        members: seen(".artist-stint").map(b => [b.getAttribute("aria-label"), (b.querySelector(".artist-stint-line") || {}).textContent || ""]),
                        row: getComputedStyle(document.querySelector(".artist-stint-row")).overflowX,
                        round: getComputedStyle(document.querySelector(".artist-stint-art")).borderTopLeftRadius };
          const toggle = document.querySelector(".artist-stints-toggle");
          toggle.click();
          out.folded = [seen(".artist-about .artist-stint").length, toggle.getAttribute("aria-expanded")];
          toggle.click();
          seen(".artist-stint").find(b => b.getAttribute("aria-label") === "Jerome Augustyniak").click();
          await until(() => /Jerome Augustyniak/.test(document.getElementById("album-count").textContent));
          out.memberTitle = document.getElementById("album-count").textContent;
          out.memberOpen = grid.dataset.artistTab;
          // Back to the band's page: drawn from what it had, its albums not asked for again.
          const before = asked.filter(u => u.startsWith("/api/artist-albums?artist=Ten")).length;
          document.getElementById("topbar-back").click();
          await until(() => !document.getElementById("album-count").textContent.includes("Jerome"));
          window.__showArtistAlbums("Ten Thousand Maniacs");
          await until(() => document.querySelector(".artist-facts"));
          out.askedAgain = asked.filter(u => u.startsWith("/api/artist-albums?artist=Ten")).length - before;
          out.againTitle = document.getElementById("album-count").textContent;
          return out;
        })()
        """;

    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task Who_a_band_is_over_its_tabs_its_albums_on_Overview_and_Discography_its_members_on_About()
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
        Assert.Equal(0.0, r["links"]!.GetValue<double>());   // no links
        Assert.Equal(["Overview", "Discography", "About"], r["tabs"]!.AsArray().Select(t => (string?)t));
        Assert.Equal("overview", (string?)r["open"]);
        // Overview: their albums in a row, the grid's tiles and the members waiting, similar artists and albums last.
        Assert.Equal(["In My Tribe"], r["overview"]!["cards"]!.AsArray().Select(c => (string?)c));
        Assert.Equal(0.0, r["overview"]!["tiles"]!.GetValue<double>());
        Assert.Equal(0.0, r["overview"]!["stints"]!.GetValue<double>());
        Assert.Equal(1.0, r["overview"]!["foot"]!.GetValue<double>());
        Assert.True(r["footLast"]!.GetValue<bool>(), "similar artists and albums last in the grid");
        // See all: Discography, the album grid alone.
        Assert.Equal("discography", (string?)r["discography"]!["open"]);
        Assert.Equal("true", (string?)r["discography"]!["on"]);
        Assert.Equal(1.0, r["discography"]!["tiles"]!.GetValue<double>());
        Assert.Equal(["Albums"], r["discography"]!["sections"]!.AsArray().Select(h => (string?)h));
        Assert.Equal(0.0, r["discography"]!["cards"]!.GetValue<double>());
        Assert.Equal(0.0, r["discography"]!["foot"]!.GetValue<double>());
        // About: the members, open under their heading; those in the band now (item 133: Natalie Merchant left in 2019).
        Assert.Equal(0.0, r["about"]!["tiles"]!.GetValue<double>());
        Assert.Equal(["Members · 1"], r["about"]!["sections"]!.AsArray().Select(h => (string?)h));
        Assert.Single(r["about"]!["members"]!.AsArray());
        Assert.Equal("Jerome Augustyniak", (string?)r["about"]!["members"]![0]![0]);
        Assert.Equal("Drums · since 1981", (string?)r["about"]!["members"]![0]![1]);
        Assert.Equal("auto", (string?)r["about"]!["row"]);
        Assert.Equal("50%", (string?)r["about"]!["round"]);
        Assert.Equal(0.0, r["folded"]![0]!.GetValue<double>());
        Assert.Equal("false", (string?)r["folded"]![1]);
        Assert.Contains("Jerome Augustyniak", (string?)r["memberTitle"]);
        Assert.Equal("overview", (string?)r["memberOpen"]);   // every artist's page opens on Overview
        Assert.Equal(0.0, r["askedAgain"]!.GetValue<double>());
        Assert.Contains("Ten Thousand Maniacs", (string?)r["againTitle"]);
        Assert.Empty(page.Errors);
    }
}
