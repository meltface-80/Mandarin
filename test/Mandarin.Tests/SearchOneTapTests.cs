namespace Mandarin.Tests;

/// <summary>
/// Search from Home in the touch layout takes one tap (v1.0.7). Its field's row is hidden on Home until
/// the search is open, and the page showed it only after the tap: the field was focused while hidden,
/// took no focus, and in the Android app the keyboard waited for a second tap. Now the field has the
/// focus within the tap itself, which is what lets the app's keyboard come up with it.
/// </summary>
public sealed class SearchOneTapTests
{
    private const string Tap = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => document.querySelector("#home-random .album, #home-today .album"));
          const input = document.getElementById("search-input");
          const home = document.documentElement.classList.contains("tn-home");
          document.getElementById("tnav-search").click();
          const inTap = document.activeElement === input;
          await sleep(300);
          return { home, inTap, after: document.activeElement === input };
        })()
        """;

    [Test]
    public async Task One_tap_on_Search_from_Home_gives_its_field_the_focus_within_the_tap()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Tap))!;
        Assert.True(r["home"]!.GetValue<bool>(), "on Home, in the touch layout");
        Assert.True(r["inTap"]!.GetValue<bool>(), "the field focused within the tap");
        Assert.True(r["after"]!.GetValue<bool>(), "and still, after it");
        Assert.Empty(page.Errors);
    }
}
