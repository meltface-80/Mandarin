namespace Mandarin.Tests;

/// <summary>
/// Settings → Setup → Home Screen: the greeting and Random Album, each on or off on this device
/// (v1.0.7). Off, it's gone from Home and what was under it moves up into the room (the strip under the
/// greeting too, when nothing is left in it); the choice is kept, and on again puts it back.
/// </summary>
public sealed class HomeTopSwitchesTests
{
    private const string Flip = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const shown = el => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
          const firstRow = () => [...document.querySelectorAll("#home-sections > .home-section")].find(shown);
          const look = () => ({ greeting: shown(document.getElementById("home-greeting")), random: shown(document.getElementById("home-unheard-tile")),
            strip: shown(document.getElementById("home-today")), sections: Math.round(document.getElementById("home-sections").getBoundingClientRect().top),
            row: Math.round(firstRow().getBoundingClientRect().top),
            aotd: (t => t ? Math.round(t.getBoundingClientRect().left) : null)([...document.querySelectorAll("#home-today .album")].find(t => t.id !== "home-unheard-tile" && shown(t))) });
          await until(() => document.querySelector("#home-unheard-tile") && firstRow());
          await sleep(300);
          const out = { before: look() };
          // Settings → Setup → Home Screen, as a person goes.
          const pane = p => document.querySelector('.settings-view[data-pane="' + p + '"]');
          const open = p => !!pane(p) && !pane(p).classList.contains("hidden");
          document.getElementById("settings-toggle").click(); await sleep(300);
          document.querySelector('.settings-view[data-view="home"] .settings-nav-item[data-pane="setup"]').click();
          await until(() => open("setup"));
          document.querySelector('.settings-view[data-pane="setup"] .settings-nav-item[data-pane="homescreen"]').click();
          await until(() => open("homescreen"));
          const sw = id => document.getElementById(id);
          out.switches = [sw("home-greeting-on").checked, sw("home-random-on").checked];
          sw("home-greeting-on").click(); await sleep(100);
          const close = () => { const x = document.getElementById("settings-close"); if (x) x.click(); else document.getElementById("settings-toggle").click(); };
          close(); await sleep(400);
          out.noGreeting = look();
          document.getElementById("settings-toggle").click(); await sleep(300);
          document.querySelector('.settings-view[data-view="home"] .settings-nav-item[data-pane="setup"]').click();
          await until(() => open("setup"));
          document.querySelector('.settings-view[data-pane="setup"] .settings-nav-item[data-pane="homescreen"]').click();
          await until(() => open("homescreen"));
          sw("home-random-on").click(); await sleep(100);
          close(); await sleep(400);
          out.neither = look();
          // Nothing left in the strip (no Album of the day): it goes too.
          for (const t of [...document.querySelectorAll("#home-today .album")]) if (t.id !== "home-unheard-tile") t.remove();
          await sleep(50);
          out.emptyStrip = shown(document.getElementById("home-today"));
          return out;
        })()
        """;

    private const string Again = """
        (async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          const shown = el => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
          await until(() => document.querySelector("#home-unheard-tile") && document.querySelector("#home-sections > .home-section"));
          await sleep(300);
          const out = { greeting: shown(document.getElementById("home-greeting")), random: shown(document.getElementById("home-unheard-tile")),
            switches: [document.getElementById("home-greeting-on").checked, document.getElementById("home-random-on").checked] };
          window.__uiPrefs.set("greeting", "on"); window.__uiPrefs.set("random", "on");
          await sleep(100);
          out.back = [shown(document.getElementById("home-greeting")), shown(document.getElementById("home-unheard-tile"))];
          return out;
        })()
        """;

    [Test]
    public async Task The_greeting_and_Random_Album_switched_off_go_and_Home_moves_up()
    {
        await using var s = await Session.Started();
        await using var b = await Browser.Launch(412, 915);
        var page = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var r = (await page.Eval(Flip))!;
        Assert.Equal("[true,true]", r["switches"]!.ToJsonString());
        var before = r["before"]!; var noGreeting = r["noGreeting"]!; var neither = r["neither"]!;
        Assert.True(before["greeting"]!.GetValue<bool>() && before["random"]!.GetValue<bool>(), "both there to begin with");
        Assert.False(noGreeting["greeting"]!.GetValue<bool>(), "the greeting gone");
        Assert.True(noGreeting["random"]!.GetValue<bool>(), "Random Album still there");
        Assert.True(noGreeting["sections"]!.GetValue<int>() < before["sections"]!.GetValue<int>(), "what was under the greeting moved up");
        Assert.False(neither["random"]!.GetValue<bool>(), "Random Album gone");
        // The Album of the day, where there is one, moves into its place; with none, the strip goes and the rows move up.
        if (noGreeting["aotd"] is { } aotd)
            Assert.True(neither["aotd"]!.GetValue<int>() < aotd.GetValue<int>(), "the Album of the day moved into its place");
        else
        {
            Assert.False(neither["strip"]!.GetValue<bool>(), "nothing left in the strip: it goes");
            Assert.True(neither["row"]!.GetValue<int>() < noGreeting["row"]!.GetValue<int>(), "the rows moved up into its room");
        }

        Assert.False(r["emptyStrip"]!.GetValue<bool>(), "a strip with nothing left in it goes");

        // Kept on this device, and on again puts each back.
        var again = await b.Page(s.Base + "/", [new { name = "musicd_session", value = s.Token, url = s.Base }], touch: true);
        var a = (await again.Eval(Again))!;
        Assert.False(a["greeting"]!.GetValue<bool>() || a["random"]!.GetValue<bool>(), "still off after a reload");
        Assert.Equal("[false,false]", a["switches"]!.ToJsonString());
        Assert.Equal("[true,true]", a["back"]!.ToJsonString());
        Assert.Empty(page.Errors);
        Assert.Empty(again.Errors);
    }
}
