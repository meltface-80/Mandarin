namespace Mandarin.Tests;

/// <summary>
/// Home's Downloaded albums row in the Android app (v1.0.7). The app tells the page downloads changed on
/// every return to it and after every track a download finishes; the row was drawn afresh each time,
/// whether anything had changed or not, holding the page up as it was and sending the row back to its
/// first tile. Now a row that hasn't changed stays as it is, and one that has is drawn again.
/// </summary>
public sealed class DownloadsRowTests
{
    // The app's bridge, there before the page's scripts run, as the app's WebView has it: an album the
    // server doesn't know (drawn from what the phone kept), and a second one when the test says.
    private const string App = """
        window.__albums = [{ id: 424242, state: "done", done: 3, total: 3, title: "Kept On The Phone", artist: "Phone",
          quality: "original", bytes: 1, auto: false, error: "", image_key: "" }];
        window.__asked = 0;
        window.MusicdDownloads = {
          settings: () => JSON.stringify({ quality: "original", wifiOnly: true }),
          set: () => {}, all: () => { window.__asked++; return JSON.stringify(window.__albums); },
          ids: () => JSON.stringify(window.__albums.map(a => a.id)), status: () => JSON.stringify({ state: "none" })
        };
        """;

    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const row = () => document.querySelector(".home-section-downloads .home-carousel");
          const tiles = () => [...row().querySelectorAll(".album")];
          await until(() => row() && tiles().length === 1);
          const first = tiles()[0];
          first.__mark = true;
          const asked = window.__asked;
          window.__musicdDownloadsChanged(); await sleep(400);
          window.__musicdDownloadsChanged(); await sleep(400);
          const out = { asked: window.__asked > asked, kept: tiles().length === 1 && tiles()[0] === first && !!tiles()[0].__mark };
          window.__albums.unshift({ id: 434343, state: "downloading", done: 1, total: 9, title: "On Its Way", artist: "Phone",
            quality: "original", bytes: 1, auto: false, error: "", image_key: "" });
          window.__musicdDownloadsChanged();
          await until(() => tiles().length === 2);
          out.drawn = tiles().map(t => t.textContent.includes("On Its Way") || t.textContent.includes("Kept On The Phone"));
          return out;
        })()
        """;

    [Test]
    public async Task A_row_that_has_not_changed_is_not_drawn_again_one_that_has_is()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], App);
        var r = (await page.Eval(Look))!;
        Assert.True(r["asked"]!.GetValue<bool>(), "the page asked the app again");
        Assert.True(r["kept"]!.GetValue<bool>(), "the same tile, not one drawn afresh");
        Assert.Equal([true, true], r["drawn"]!.AsArray().Select(x => x!.GetValue<bool>()));
        Assert.Empty(page.Errors);
    }
}
