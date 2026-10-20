"use strict";
/*
 * The Android app's native Settings (item 76) and the pages of it the app doesn't draw yet: one asked for by its name
 * opens on the page alone, over the app's screen (as its row opens it, so it loads what it shows), and its Back closes
 * Settings again, so the app's own list is in front. The app is stood in for by its bridge. Skipped where no Chromium
 * or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { started } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

// Before the page's scripts: the app's bridge, counting the sheets it was told had closed.
const BRIDGE = `window.MusicdApp = { closed: 0, overlayShown() {}, overlayClosed() { this.closed++; document.documentElement.classList.remove("native-over"); } };`;

const RUN = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = e => !!e && e.getClientRects().length > 0;
  const view = name => document.querySelector('#settings-overlay .settings-view[data-pane="' + name + '"]');
  await until(() => document.querySelectorAll("#home-library .album").length > 0, 20000);
  const out = { unknown: window.__musicdNative("settings-pane", "nothing") };
  for (const name of ["backup", "display"]) {
    const before = window.MusicdApp.closed;
    const asked = window.__musicdNativeOver("settings-pane", name);
    const up = await until(() => shown(view(name)));
    const home = shown(document.querySelector('#settings-overlay .settings-view[data-view="home"]'));
    view(name).querySelector("[data-settings-back]").click();
    const closed = await until(() => window.MusicdApp.closed > before);
    out[name] = { asked, up, home, closed, hidden: document.getElementById("settings-overlay").classList.contains("hidden") };
  }
  // Opened from the page's own list, a page's Back still goes back to the list.
  document.getElementById("settings-toggle").click();
  await until(() => shown(document.querySelector('#settings-overlay .settings-view[data-view="home"]')));
  [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="backup"]')].find(shown).click();
  await until(() => shown(view("backup")));
  view("backup").querySelector("[data-settings-back]").click();
  await sleep(300);
  out.ownList = shown(document.querySelector('#settings-overlay .settings-view[data-view="home"]'));
  return out;
})()`;

test("a page of Settings the app doesn't draw opens alone, and its Back hands back to the app", { skip, timeout: 120000 }, async (t) => {
  const { base, token } = await started(t);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true, init: BRIDGE });
  const r = await page.eval(RUN);
  assert.deepEqual(page.errors, [], "nothing thrown");
  assert.equal(r.unknown, false, "a page there isn't");
  for (const name of ["backup", "display"]) {
    assert.deepEqual(r[name], { asked: true, up: true, home: false, closed: true, hidden: true }, name);
  }
  assert.equal(r.ownList, true, "the page's own Settings as ever");
});

test("a setting the page keeps on this device, changed in the app, is kept where the page keeps it", { skip, timeout: 120000 }, async (t) => {
  const { base, token } = await started(t);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true, init: BRIDGE });
  const r = await page.eval(`(async () => {
    const set = (name, value) => window.__musicdNative("page-pref", JSON.stringify({ name, value }));
    const asked = [set("layout", "list"), set("text", "1.25"), set("labelOrder", "random"), set("labelMin", "5"), set("nothing", "1"), window.__musicdNative("page-pref", "{")];
    return { asked, layout: window.__uiPrefs.get("layout"), text: getComputedStyle(document.documentElement).getPropertyValue("--ui-text").trim(),
      order: localStorage.getItem("rra-label-order"), min: localStorage.getItem("rra-label-min"), kept: localStorage.getItem("rra-ui-cols") };
  })()`);
  assert.deepEqual(page.errors, [], "nothing thrown");
  assert.deepEqual(r, { asked: [true, true, true, true, false, false], layout: "list", text: "1.25", order: "random", min: "5", kept: "list" });
});
