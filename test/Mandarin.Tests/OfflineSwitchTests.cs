namespace Mandarin.Tests;

/// <summary>
/// The side menu's Offline switch in the Android app (v1.0.7). The app puts the page up afresh for it, on
/// the phone's music or back on the server, and the menu went with it: it shut, the page loaded, and it
/// came back open, sliding in. Now the switch moves first; then the page asks the app to hold the screen
/// as it is (PageCurtain.kt) and only then tells it; the new page has the menu open at once, not sliding
/// in, and tells the app it can be seen. A stand-in for the app's two bridges here, which reloads the
/// page as the app does, and keeps what it was asked across the reload.
/// </summary>
public sealed class OfflineSwitchTests
{
    private const string App = """
        (() => {
          const st = () => JSON.parse(localStorage.getItem("__app") || '{"offline":false,"calls":[]}');
          const put = s => localStorage.setItem("__app", JSON.stringify(s));
          const note = c => { const s = st(); s.calls.push(c); put(s); };
          window.MusicdDownloads = {
            settings: () => JSON.stringify({ quality: "original", wifiOnly: true, offlineMode: st().offline }),
            set: (k, v) => {
              if (k !== "offlineMode") return;
              const item = document.getElementById("menu-item-offline");
              note({ set: v, switchOn: item.classList.contains("is-on") });
              const s = st(); s.offline = v === "true"; put(s);
              setTimeout(() => location.reload(), 30);
            },
            all: () => "[]", ids: () => "[]", status: () => JSON.stringify({ state: "none" })
          };
          window.MusicdApp = { version: () => "1.0.7", holdScreen: () => note("hold"), screenShown: () => note("shown") };
        })();
        """;

    private const string Tap = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => document.querySelector("#home-random .album, #home-today .album"));
          document.getElementById("home-menu").click();   // Home's menu, at its top right (item 210)
          const item = document.getElementById("menu-item-offline");
          await until(() => !document.getElementById("menu-overlay").classList.contains("hidden") && !item.classList.contains("hidden"));
          const before = item.classList.contains("is-on");
          item.click();
          // At once: the switch moved, the menu still open, and the app not told yet.
          return { before, moved: item.classList.contains("is-on"), open: !document.getElementById("menu-overlay").classList.contains("hidden"),
            told: JSON.parse(localStorage.getItem("__app") || '{"calls":[]}').calls.length };
        })()
        """;

    private const string After = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const calls = () => JSON.parse(localStorage.getItem("__app")).calls;
          await until(() => calls().includes("shown"));
          const overlay = document.getElementById("menu-overlay");
          return { calls: calls(), open: !overlay.classList.contains("hidden"),
            sliding: getComputedStyle(overlay.querySelector(".menu-drawer")).animationName,
            on: document.getElementById("menu-item-offline").classList.contains("is-on") };
        })()
        """;

    [Test]
    public async Task The_switch_moves_the_screen_is_held_and_the_menu_is_open_again_without_sliding_in()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], App, touch: true);
        var r = (await page.Eval(Tap))!;
        Assert.False(r["before"]!.GetValue<bool>(), "off to begin with");
        Assert.True(r["moved"]!.GetValue<bool>(), "the switch moved at once");
        Assert.True(r["open"]!.GetValue<bool>(), "the menu stays open");
        Assert.Equal(0, r["told"]!.GetValue<int>());
        // The page reloads (as the app reloads it); the new one's answers.
        await Task.Delay(1500);
        var a = (await page.Eval(After))!;
        var calls = a["calls"]!.AsArray().Select(c => c!.ToJsonString()).ToList();
        Assert.Equal(["\"hold\"", "{\"set\":\"true\",\"switchOn\":true}", "\"shown\""], calls);
        Assert.True(a["open"]!.GetValue<bool>(), "the menu open on the new page");
        Assert.Equal("none", (string?)a["sliding"]);
        Assert.True(a["on"]!.GetValue<bool>(), "the switch as it was left");
    }
}
