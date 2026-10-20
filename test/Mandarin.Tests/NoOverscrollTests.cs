using System.Text.RegularExpressions;

namespace Mandarin.Tests;

/// <summary>
/// Home pulled past its top or its foot doesn't stretch or bounce (v1.0.7), in a browser or the app.
/// In a browser the page's own scrolling stops dead there (style.css, overscroll-behavior on the page
/// and on main, Home's scroller); in the Android app, its own screens since its WebView went (bug list
/// item 111), Android's stretch is off for every screen (Theme.kt: from Android 12 on it is drawn unless
/// switched off).
/// </summary>
public sealed class NoOverscrollTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => document.querySelector("#home-random .album, #home-today .album"));
          const main = document.querySelector("main");
          const ob = e => getComputedStyle(e).overscrollBehaviorY;
          return { home: document.documentElement.classList.contains("tn-home"), scrolls: main.scrollHeight > main.clientHeight,
            html: ob(document.documentElement), body: ob(document.body), main: ob(main) };
        })()
        """;

    [Test]
    public async Task Home_pulled_past_its_ends_does_not_stretch_in_a_browser()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 600);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!;
        Assert.True(r["home"]!.GetValue<bool>(), "on Home, in the touch layout");
        Assert.True(r["scrolls"]!.GetValue<bool>(), "Home scrolls, in main");
        foreach (var k in new[] { "html", "body", "main" }) Assert.Equal("none", (string?)r[k]);
        Assert.Empty(page.Errors);
    }

    [Test]
    public void The_apps_screens_draw_no_stretch_of_their_own()
    {
        var dir = Path.Combine(ServerProcess.Root, "android", "app", "src", "main", "java", "com", "musicd", "server", "android");
        Assert.Matches(@"CompositionLocalProvider\(LocalOverscrollFactory provides null\) \{ MaterialTheme\(", File.ReadAllText(Path.Combine(dir, "Theme.kt")));
        Assert.True(Regex.IsMatch(File.ReadAllText(Path.Combine(dir, "NativeShell.kt")), @"setContent \{ MandarinTheme \{ Shell\("),
            "every screen is drawn in the theme");
    }
}
