using Microsoft.AspNetCore.Http;

namespace Mandarin.Tests;

/// <summary>
/// An album's credits on its page (bug list item 132; public/app/album-credits.js): under the tracks, who played,
/// sang, wrote and made it, in the server's order, each with their parts and the tracks when not all; a tap opens
/// their page. MusicBrainz stood in for (CreditsTests' release), the page in a browser at a phone's size.
/// </summary>
public sealed class AlbumCreditsPageTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const $ = id => document.getElementById(id);
          await until(() => document.querySelector("#home-view .album"));
          await sleep(400);
          const al = (await (await fetch("/api/library/albums?sort=album")).json()).albums.find(a => a.title === "In My Tribe");
          window.__openAlbum(al, { source: "home", filter: null });
          await until(() => !$("album-credits").classList.contains("hidden"));
          const rows = [...document.querySelectorAll("#album-credits .credit")];
          const out = {
            names: rows.map(b => b.getAttribute("aria-label")),
            lines: rows.map(b => (b.querySelector(".credit-roles") || {}).textContent || ""),
            head: document.querySelector("#album-credits .section-label").textContent,
            more: !document.querySelector("#album-credits .more-toggle").classList.contains("hidden"),
            round: getComputedStyle(document.querySelector("#album-credits .credit-pic")).borderTopLeftRadius,
            beforeReview: !!($("album-credits").compareDocumentPosition($("album-bio-section")) & Node.DOCUMENT_POSITION_FOLLOWING),
          };
          rows.find(b => b.getAttribute("aria-label") === "Dennis Drew").click();
          await until(() => /Dennis Drew/.test($("album-count").textContent));
          out.opened = $("album-count").textContent;
          return out;
        })()
        """;

    private static Task Json(HttpContext ctx, string body)
    {
        ctx.Response.ContentType = "application/json";
        return ctx.Response.WriteAsync(body);
    }

    [Test]
    public async Task Who_played_wrote_and_made_an_album_under_its_tracks_each_opening_their_page()
    {
        Needs.Server(); Needs.Ffmpeg();
        await using var mb = await FakeServer.Start(ctx => ctx.Request.Path.Value == "/release/" + CreditsTests.Release
            ? Json(ctx, CreditsTests.ReleaseJson) : Task.FromResult(ctx.Response.StatusCode = 404));
        await using var none = await FakeServer.Start(ctx => Task.FromResult(ctx.Response.StatusCode = 404));
        var lib = Fixtures.MakeLibrary();
        var dir = Path.Combine(lib.Music, "Ten Thousand Maniacs", "In My Tribe");
        Fixtures.Gen(Path.Combine(dir, "01.flac"), seconds: 1, freq: 300, tags: new Dictionary<string, object>
        {
            ["title"] = "What's the Matter Here?", ["artist"] = "Ten Thousand Maniacs", ["album"] = "In My Tribe", ["track"] = 1, ["date"] = "1987",
            ["performer"] = "Dennis Drew (organ)", ["MUSICBRAINZ_ALBUMID"] = CreditsTests.Release,
        });
        Fixtures.Gen(Path.Combine(dir, "02.flac"), seconds: 1, freq: 350, tags: new Dictionary<string, object>
        {
            ["title"] = "Hey Jack Kerouac", ["artist"] = "Ten Thousand Maniacs", ["album"] = "In My Tribe", ["track"] = 2, ["date"] = "1987", ["MUSICBRAINZ_ALBUMID"] = CreditsTests.Release,
        });
        await using var s = await Session.Started(new Dictionary<string, object?>
        {
            ["mbBaseUrl"] = mb.Base, ["deezerBaseUrl"] = none.Base, ["wikidataBaseUrl"] = none.Base, ["lastfmBaseUrl"] = none.Base,
        }, lib);
        await using var b = await Browser.Launch(390, 844);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!;

        Assert.Equal(["Jerome Augustyniak", "Dennis Drew", "Natalie Merchant", "Novi Novog", "Robert Buck", "Peter Asher"], r["names"]!.AsArray().Select(n => (string?)n));
        Assert.Equal("Organ · track 1", (string?)r["lines"]![1]);
        Assert.DoesNotContain("track", (string?)r["lines"]![0]);
        Assert.Equal("Credits", (string?)r["head"]);
        Assert.False(r["more"]!.GetValue<bool>(), "six: no More");
        Assert.Equal("50%", (string?)r["round"]);
        Assert.True(r["beforeReview"]!.GetValue<bool>(), "over the review");
        Assert.Contains("Dennis Drew", (string?)r["opened"]);
        Assert.Empty(page.Errors);
    }
}
