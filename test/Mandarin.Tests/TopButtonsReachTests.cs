namespace Mandarin.Tests;

/// <summary>
/// The buttons at the top of a grid screen with no strip round them, on a touch screen (v1.0.7):
/// ‹, Focus and Sort on the Library. Focus and Sort are 32px tall, and a tap just off one of them
/// went to the album under it. Each now takes a tap from a little way round it (most of all below,
/// where the albums are; beside Focus, the gap is Focus's or Sort's), and none of them is drawn any
/// bigger or anywhere else for it.
/// </summary>
public sealed class TopButtonsReachTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => document.querySelector("#home-random .album, #home-today .album"));
          document.getElementById("tnav-library").click();
          await until(() => document.documentElement.classList.contains("tn-lib") && document.querySelector("#album-grid .album"));
          await sleep(400);
          const at = (b, x, y) => { const h = document.elementFromPoint(x, y); return !!h && b.contains(h); };
          // Beside it: this button or its neighbour (Focus and Sort share the gap between them), never what's under them.
          const beside = (b, x, y) => { const h = document.elementFromPoint(x, y); return !!h && (b.contains(h) || !!h.closest(".topbar button")); };
          return ["#topbar-back", ".lib-ctl-focus", ".lib-ctl-sort"].map(sel => {
            const b = document.querySelector(".topbar " + sel), r = b.getBoundingClientRect();
            const mx = r.left + r.width / 2, my = r.top + r.height / 2;
            return { sel, box: [r.left, r.top, r.width, r.height].map(Math.round),
              below: at(b, mx, r.bottom + 12), above: at(b, mx, r.top - 5), left: beside(b, r.left - 4, my), right: beside(b, r.right + 4, my),
              far: at(b, mx, r.bottom + 24) };
          });
        })()
        """;

    [Test]
    public async Task A_tap_just_off_a_top_button_is_the_buttons_not_the_albums_under_it()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!.AsArray();
        Assert.Equal(3, r.Count);
        foreach (var x in r)
        {
            var sel = (string)x!["sel"]!;
            foreach (var side in new[] { "below", "above", "left", "right" })
                Assert.True(x[side]!.GetValue<bool>(), $"{sel}: a tap just {side} it is its");
            Assert.False(x["far"]!.GetValue<bool>(), sel + ": but not one well away from it");
        }
        // Drawn as before: ‹ 40px square at the bar's padding, Focus and Sort 32px tall in its line.
        Assert.Equal("[14,12,40,40]", r[0]!["box"]!.ToJsonString());
        Assert.All(r.Skip(1), x => Assert.Equal(32, x!["box"]![3]!.GetValue<int>()));
        Assert.Empty(page.Errors);
    }
}
