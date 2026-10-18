namespace Mandarin.Tests;

/// <summary>
/// Qobuz's and Tidal's grids follow Settings → UI Settings as every grid screen does (v1.0.7): the
/// columns, the album text, List (the Library wall alone took it before), and the Grid screen title's size
/// (fixed at 24px on a touch screen before, the Library's heading and theirs alike). Drawn here with
/// tiles as the browsers draw them (service-browser-rows.js), no sign-in needed.
/// </summary>
public sealed class ServiceGridsTests
{
    private const string Look = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => document.querySelector("#home-random .album, #home-today .album"));
          document.getElementById("tnav-library").click();
          await until(() => document.documentElement.classList.contains("tn-lib") && document.querySelector("#album-grid .album .album-title"));
          for (const id of ["qobuz", "tidal"]) {
            const list = document.getElementById(id + "-nr-list");
            for (let i = 0; i < 4; i++) {
              const t = document.createElement("div"); t.className = "album qobuz-tile";
              t.innerHTML = '<div class="album-art-wrap no-image"><button class="qobuz-nr-fav qobuz-tile-fav">+</button></div><div class="album-meta"><div class="album-title">T' + i + '</div><div class="album-artist">A</div></div>';
              list.appendChild(t);
            }
          }
          const p = window.__uiPrefs;
          p.set("layout", "2"); p.set("text", "1.5"); p.set("title", "1.5");
          await sleep(300);
          const grid = (sel, shown) => {
            const g = document.querySelector(sel);
            if (shown) shown.classList.remove("hidden");
            const tile = g.querySelector(".album"), title = tile.querySelector(".album-title");
            const out = { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length, text: getComputedStyle(title).fontSize,
              list: g.classList.contains("as-list"), row: Math.round(tile.getBoundingClientRect().width) === Math.round(g.getBoundingClientRect().width) };
            if (shown) shown.classList.add("hidden");
            return out;
          };
          const head = (sel, shown) => { if (shown) shown.classList.remove("hidden"); const f = getComputedStyle(document.querySelector(sel)).fontSize; if (shown) shown.classList.add("hidden"); return f; };
          const all = () => ({ wall: grid("#album-grid"), qobuz: grid("#qobuz-nr-list", document.getElementById("qobuz-overlay")),
            tidal: grid("#tidal-nr-list", document.getElementById("tidal-overlay")) });
          const out = { grid: all(), heads: [head("#tnav-heading #album-count"), head("#qobuz-overlay .settings-head h2", document.getElementById("qobuz-overlay")),
            head("#tidal-overlay .settings-head h2", document.getElementById("tidal-overlay"))] };
          p.set("layout", "list"); await sleep(300);
          out.list = all();
          p.set("layout", "auto"); p.set("text", "1"); p.set("title", "1");
          return out;
        })()
        """;

    [Test]
    public async Task Qobuz_and_Tidal_grids_take_the_columns_text_list_and_title_size_every_grid_does()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Look))!;
        foreach (var k in new[] { "wall", "qobuz", "tidal" })
        {
            var g = r["grid"]![k]!; var l = r["list"]![k]!;
            Assert.True(g["cols"]!.GetValue<int>() == 2, k + ": two columns");
            Assert.True((string?)g["text"] == "18px", k + ": the album text at +50%: " + g["text"]);
            Assert.True(l["list"]!.GetValue<bool>() && l["row"]!.GetValue<bool>(), k + ": List, a row each");
        }
        Assert.Equal(["36px", "36px", "36px"], r["heads"]!.AsArray().Select(x => (string?)x));
        Assert.Empty(page.Errors);
    }
}
