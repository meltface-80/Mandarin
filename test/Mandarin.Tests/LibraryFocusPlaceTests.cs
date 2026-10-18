namespace Mandarin.Tests;

/// <summary>
/// The Library's place kept over Focus (v1.0.7). Show albums with nothing chosen, or Clear all with
/// nothing to clear, loaded the wall afresh from its first album, so closing Focus sprang the wall to
/// the top. Now Focus closes over the wall as it was, where it was scrolled to; a filter that changes
/// what's shown still loads it afresh.
/// </summary>
public sealed class LibraryFocusPlaceTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const tiles = () => [...document.querySelectorAll("#album-grid .album")];
          const main = document.querySelector("main");
          await until(() => document.querySelector("#home-random .album, #home-today .album"));
          document.getElementById("tnav-library").click();
          await until(() => document.documentElement.classList.contains("tn-lib") && tiles().length >= 3);
          await sleep(300);
          const out = {};
          const closed = async (button) => {
            const first = tiles()[0];
            first.__mark = true;
            main.scrollTop = main.scrollHeight;
            const at = main.scrollTop;
            document.querySelector(".lib-ctl-focus").click();
            await until(() => document.querySelector(".lib-sheet-foot"));
            const b = [...document.querySelectorAll(".lib-sheet-foot button")].find(x => x.textContent.trim() === button);
            b.click();
            await until(() => !document.querySelector(".lib-sheet"));
            await sleep(600);
            return { kept: tiles()[0] === first && !!tiles()[0].__mark, at, now: main.scrollTop };
          };
          out.show = await closed("Show albums");
          out.clear = await closed("Clear all");
          // A filter chosen: the wall is loaded afresh for it.
          const first = tiles()[0];
          first.__mark = true;
          document.querySelector(".lib-ctl-focus").click();
          const genre = () => [...document.querySelectorAll(".lib-sheet-section")].find(x => /^Genre/.test(x.querySelector(".lib-sheet-section-head").textContent.trim()));
          await until(() => genre());
          genre().querySelector(".lib-sheet-section-head").click();
          await until(() => genre().querySelector(".lib-chip"));
          genre().querySelector(".lib-chip").click();
          [...document.querySelectorAll(".lib-sheet-foot button")].find(x => x.textContent.trim() === "Show albums").click();
          await until(() => !tiles().length || !tiles()[0].__mark);
          out.filtered = true;
          return out;
        })()
        """;

    [Test]
    public async Task Focus_closed_with_nothing_changed_leaves_the_wall_where_it_was()
    {
        await using var s = await Session.Started();
        // Short, so the wall of the fixture library scrolls.
        await using var b = await Browser.Launch(412, 420);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }]);
        var r = (await page.Eval(Look))!;
        foreach (var k in new[] { "show", "clear" })
        {
            Assert.True(r[k]!["kept"]!.GetValue<bool>(), k + ": the wall as it was, not loaded afresh");
            Assert.True(r[k]!["at"]!.GetValue<double>() > 0, k + ": the wall was scrolled");
            Assert.Equal(r[k]!["at"]!.GetValue<double>(), r[k]!["now"]!.GetValue<double>());
        }
        Assert.True(r["filtered"]!.GetValue<bool>(), "a filter chosen loads the wall afresh");
        Assert.Empty(page.Errors);
    }
}
