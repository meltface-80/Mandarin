"use strict";
/*
 * Settings → Services a list (item 449): Qobuz and Tidal a row each, nothing else on it; each row opens the
 * service's own page (Qobuz's email and Sign in, Tidal's Sign in on tidal.com), and
 * Back goes back to Services.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("item 449: Services a list of Qobuz and Tidal, each opening its own page", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }] });
  const seen = await page.eval(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
    const shown = e => !!e && e.getClientRects().length > 0;
    const pane = n => document.querySelector('#settings-overlay .settings-view[data-pane="' + n + '"]');
    const out = {};
    await until(() => document.querySelector("#settings-toggle"));
    document.querySelector("#settings-toggle").click(); await sleep(300);
    document.querySelector('.settings-nav-item[data-pane="streaming"]').click();
    await until(() => shown(pane("streaming")));
    out.rows = [...pane("streaming").querySelectorAll(".settings-nav-item")].filter(shown).map(r => r.textContent.trim());
    out.onList = ["qobuz-username", "qobuz-signin", "tidal-signin"].filter(id => pane("streaming").contains(document.getElementById(id)));
    for (const [svc, control] of [["qobuz", "qobuz-username"], ["tidal", "tidal-signin"]]) {
      pane("streaming").querySelector('.settings-nav-item[data-pane="' + svc + '"]').click();
      out[svc] = await until(() => shown(pane(svc)) && shown(document.getElementById(control))) && pane(svc).querySelector("h2").textContent;
      pane(svc).querySelector("[data-settings-back]").click();
      out[svc + "Back"] = await until(() => shown(pane("streaming")));
    }
    return out;
  })()`);
  assert.deepEqual(seen.rows, ["Qobuz", "Tidal"], "a row each");
  assert.deepEqual(seen.onList, [], "no service's own settings on the list");
  assert.deepEqual([seen.qobuz, seen.tidal], ["Qobuz", "Tidal"], JSON.stringify(seen));
  assert.deepEqual([seen.qobuzBack, seen.tidalBack], [true, true], "Back to Services");
});
