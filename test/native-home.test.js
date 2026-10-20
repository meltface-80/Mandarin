"use strict";
/*
 * The Android app's native Home (stage N5 of docs/specs/plan-android-native.md,
 * bug list item 57; a preview), as the page tells the app when it should be
 * in front (public/app/native-home.js): the page keeps Home as ever, and says
 * `homeShown(true)` as it comes to Home with nothing of its own over it, and
 * `homeShown(false)` as something of the page's comes over it that the app
 * doesn't draw (the side menu, the search, a wall in Home's place), with the
 * UI Settings and the room; nothing while the app's Home is off, and nothing
 * in a browser. And what the native Home hands back (public/app/native-handoff.js):
 * the Playlists screen, a playlist's page. The app is stood in for by its
 * bridge. Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { started } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

const KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  const $ = (s) => document.querySelector(s);
  await until(() => document.querySelectorAll("#home-library .album").length > 1, 20000);
  await sleep(500);`;

// Before the page's scripts: the app's bridge, whether it draws Home itself ([on]), and what it is told written down.
const bridge = (on) => `window.MusicdApp = { on: ${on ? "true" : "false"}, told: [],
  views: [], nativeHome() { return this.on; }, setNativeHome() {},
  homeShown(front, prefs, zone) { this.told.push([front, JSON.parse(prefs).layout, zone]); this.views.push(JSON.parse(prefs).view); },
  nativeNowPlaying() { return false; }, setNativeNowPlaying() {}, openNowPlaying() {}, nativeAlbum() { return false; }, setNativeAlbum() {},
  nativeLibrary() { return false; }, setNativeLibrary() {} };`;

/* Home drawn, then the page's own screens over it one by one: what the app was told at each. */
const TOLD = `(async () => { ${KIT}
  const app = window.MusicdApp;
  const last = () => app.told[app.told.length - 1];
  const out = { start: app.told.slice() };
  $("#tnav-menu").click(); await until(() => shown($("#menu-overlay")));
  out.menu = last();
  $("#menu-overlay [data-menu-close]").click(); await until(() => !shown($("#menu-overlay")));
  out.menuClosed = last();
  $("#tnav-search").click(); await until(() => $("#topbar-search").classList.contains("is-open"));
  out.search = last();
  $("#tnav-home").click(); await until(() => !$("#topbar-search").classList.contains("is-open"));
  out.searchClosed = last();
  $("#home-random-title").click(); await until(() => $("#home-view").classList.contains("hidden"));
  out.wall = last();
  $("#topbar-back").click(); await until(() => !$("#home-view").classList.contains("hidden"));
  out.back = last();
  out.count = app.told.length;
  return out;
})()`;

/* The room chosen on the page with Home in front (no class changes): said again, with the Library's view as ever. */
const ROOM = `(async () => { ${KIT}
  const app = window.MusicdApp, before = app.told.length;
  const sel = $("#zone-select"), o = document.createElement("option");
  o.value = "Z1"; o.textContent = "Z1"; sel.appendChild(o);
  sel.value = "Z1"; sel.dispatchEvent(new Event("change"));
  await until(() => app.told.length > before, 5000);
  await sleep(1500);
  return { added: app.told.slice(before), view: app.views[app.views.length - 1] };
})()`;

/* What the native Home hands back: the Playlists screen, a playlist by its id. */
const HANDOFF = `(async () => { ${KIT}
  const out = { none: window.__musicdNative("playlist"), gone: window.__musicdNative("playlist", "999") };
  out.playlists = window.__musicdNative("playlists");
  out.screen = (await until(() => /Playlists/.test($("#album-count").textContent) && $("#home-view").classList.contains("hidden"))) && $("#album-count").textContent;
  return out;
})()`;

test("the app's native Home: told when it is in front, and what it hands back", { skip, timeout: 240000 }, async (t) => {
  const { base, token } = await started(t);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const cookies = [{ name: "musicd_session", value: token, url: base }];
  const run = async (js, init) => {
    const page = await b.page(base + "/", { cookies, touch: true, init: init || "" });
    const r = await page.eval(js);
    assert.deepEqual(page.errors, [], "nothing thrown");
    return r;
  };

  await t.test("the page on Home, then the menu, the search, a wall: in front, then not, then again", async () => {
    const r = await run(TOLD, bridge(true));
    assert.deepEqual(r.start, [[true, "auto", ""]], "Home drawn: the app's Home in front, with the UI Settings and the room");
    assert.deepEqual([r.menu, r.menuClosed], [[false, "auto", ""], [true, "auto", ""]], "the side menu");
    assert.deepEqual([r.search, r.searchClosed], [[false, "auto", ""], [true, "auto", ""]], "the search");
    assert.deepEqual([r.wall, r.back], [[false, "auto", ""], [true, "auto", ""]], "a wall in Home's place, and Back");
    assert.equal(r.count, 7, "said only as it changes");
  });

  await t.test("the room chosen on Home: said again at once, once, with the Library's view", async () => {
    const r = await run(ROOM, bridge(true));
    assert.deepEqual(r.added, [[true, "auto", "Z1"]]);
    assert.match(r.view, /^sort=\w+&dir=(asc|desc)/, "the view the Library wall asks with");
  });

  await t.test("offline (the app's own copy of the page): the page's Home in front, never the app's", async () => {
    const r = await run(`(async () => { ${KIT} return window.MusicdApp.told; })()`, "window.__musicdOffline = true;" + bridge(true));
    assert.deepEqual(r, [[false, "auto", ""]]);
  });

  await t.test("the app's Home off, or a browser: nothing said", async () => {
    const r = await run(`(async () => { ${KIT} return window.MusicdApp.told; })()`, bridge(false));
    assert.deepEqual(r, []);
    await run(`(async () => { ${KIT} return true; })()`);
  });

  await t.test("handed back: the Playlists screen, a playlist by its id", async () => {
    const r = await run(HANDOFF, bridge(true));
    assert.deepEqual(r, { none: false, gone: true, playlists: true, screen: "Playlists" });
  });
});
