namespace Mandarin.Tests;

/// <summary>
/// Home's Recently played row opens to a grid screen of its own (v1.0.7), as Favourites, Listen later and
/// Not played do: its title is a link, and the screen is the albums played in the last 30 days, the
/// latest first, with Back to Home.
/// </summary>
public sealed class HistoryWallTests
{
    private const string Open = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          // Tiles drawn (not the skeletons that stand in while a wall loads).
          const titles = sel => [...document.querySelectorAll(sel + " .album .album-title")].map(t => t.textContent.trim()).filter(Boolean);
          await until(() => titles("#home-history").length >= 2);
          const head = document.getElementById("home-history-title");
          const out = { row: titles("#home-history"), link: head.classList.contains("home-section-link") && head.getAttribute("role") === "button" };
          head.click();
          await until(() => document.getElementById("home-view").classList.contains("hidden") && titles("#album-grid").length >= 2);
          out.wall = titles("#album-grid");
          out.title = document.getElementById("album-count").textContent.trim();
          document.getElementById("topbar-back").click();
          await until(() => !document.getElementById("home-view").classList.contains("hidden"));
          out.home = true;
          return out;
        })()
        """;

    [Test]
    public async Task Recently_played_opens_to_its_own_grid_screen()
    {
        await using var s = await Session.Started();
        var albums = (await s.Api("library/albums?sort=album")).Json!["albums"]!.AsArray();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        // Two albums played, the second one last.
        var played = new List<string>();
        foreach (var (a, ago) in albums.Take(2).Zip(new[] { 7200000L, 3600000L }))
        {
            var al = (await s.Api($"download/album?offset={a!["offset"]!.ToJsonString()}")).J;
            var r = (await s.Api("phone/plays", new { plays = new object[] { new { track_id = al["tracks"]![0].Num("id"), ts = now - ago } } })).J;
            Assert.Equal(1, r.Num("recorded"));
            played.Insert(0, (string)a["title"]!);
        }
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var o = (await page.Eval(Open))!;
        Assert.True(o["link"]!.GetValue<bool>(), "its title is a link, as the other rows' are");
        Assert.Equal(played, o["row"]!.AsArray().Select(x => (string)x!).Take(2));
        Assert.Equal(played, o["wall"]!.AsArray().Select(x => (string)x!));
        Assert.Equal("Recently played", (string?)o["title"]);
        Assert.True(o["home"]!.GetValue<bool>(), "Back to Home");
        Assert.Empty(page.Errors);
    }
}
