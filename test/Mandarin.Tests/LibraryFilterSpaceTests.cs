namespace Mandarin.Tests;

/// <summary>
/// A space typed in the Library's filter stays (v1.0.7). The field is drawn afresh as the wall loads,
/// and was drawn from the words looked for, trimmed: the space just typed between two words went before
/// the next letter came. Typed here key by key, as on a keyboard; the words with a space between them
/// find what starts with them.
/// </summary>
public sealed class LibraryFilterSpaceTests
{
    [Test]
    public async Task A_space_between_words_in_the_Library_filter_stays_and_is_looked_for()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        await page.Eval("""
            (async () => {
              const sleep = ms => new Promise(r => setTimeout(r, ms));
              const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
              await until(() => document.querySelector("#home-random .album, #home-today .album"));
              document.getElementById("tnav-library").click();
              await until(() => document.documentElement.classList.contains("tn-lib") && document.querySelector("#album-grid .album .album-title"));
              document.getElementById("tnav-search").click();
              await until(() => document.activeElement && document.activeElement.classList.contains("lib-filter-input"));
            })()
            """);
        foreach (var ch in "album o")
        {
            var key = ch.ToString();
            var code = ch == ' ' ? "Space" : "Key" + char.ToUpperInvariant(ch);
            int vk = ch == ' ' ? 32 : char.ToUpperInvariant(ch);
            await page.Send("Input.dispatchKeyEvent", new { type = "keyDown", key, code, text = key, unmodifiedText = key, windowsVirtualKeyCode = vk });
            await page.Send("Input.dispatchKeyEvent", new { type = "keyUp", key, code, windowsVirtualKeyCode = vk });
            await Task.Delay(60);
        }
        var r = (await page.Eval("""
            (async () => {
              const sleep = ms => new Promise(r => setTimeout(r, ms));
              const titles = () => [...document.querySelectorAll("#album-grid .album .album-title")].map(t => t.textContent.trim()).filter(Boolean);
              const t0 = Date.now();
              while (Date.now() - t0 < 8000 && !(titles().length && titles().every(t => /^album o/i.test(t)))) await sleep(100);
              const field = document.querySelector(".lib-filter-input");
              return { typed: field.value, focused: document.activeElement === field, titles: titles() };
            })()
            """))!;
        Assert.Equal("album o", (string?)r["typed"]);
        Assert.True(r["focused"]!.GetValue<bool>(), "the field still has the keyboard");
        Assert.Equal(["Album One"], r["titles"]!.AsArray().Select(x => (string)x!));
        Assert.Empty(page.Errors);
    }
}
