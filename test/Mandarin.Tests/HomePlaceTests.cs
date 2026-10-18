namespace Mandarin.Tests;

/// <summary>
/// Home's place kept over a screen opened from it (v1.0.7). A genre tapped on Home opened its wall at
/// the top, rightly, but Back then put Home at its top too, wherever it had been scrolled to. Now Back
/// comes to Home where it was; Home tapped while on Home still goes to its top.
/// </summary>
public sealed class HomePlaceTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const home = () => !document.getElementById("home-view").classList.contains("hidden");
          await until(() => document.querySelector("#home-random .album, #home-today .album") && document.querySelector(".home-genre-card"));
          await sleep(500);
          const main = document.querySelector("main");
          main.scrollTop = 180;
          await sleep(200);
          const out = { before: main.scrollTop };
          document.querySelector(".home-genre-card").click();
          await until(() => !home());
          await sleep(300);
          out.wall = main.scrollTop;
          document.getElementById("topbar-back").click();
          await until(() => home());
          await sleep(300);
          out.back = main.scrollTop;
          document.getElementById("tnav-home").click();
          await sleep(300);
          out.homeOnHome = main.scrollTop;
          return out;
        })()
        """;

    [Test]
    public async Task Back_from_a_genre_comes_to_Home_where_it_was()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 600);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!;
        Assert.Equal(180, r["before"]!.GetValue<double>());
        Assert.True(r["wall"]!.GetValue<double>() == 0, "the genre's wall from its top");
        Assert.True(r["back"]!.GetValue<double>() == 180, "Back: Home where it was, not " + r["back"]);
        Assert.True(r["homeOnHome"]!.GetValue<double>() == 0, "Home tapped on Home: its top");
        Assert.Empty(page.Errors);
    }
}
