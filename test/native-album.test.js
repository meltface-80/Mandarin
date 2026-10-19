"use strict";
/*
 * The Android app's native album page, a preview (stage N3 of
 * docs/specs/plan-android-native.md), as the page hands over to it. Its
 * switch in Settings → Setup → UI Settings is shown only where the app's
 * bridge (MusicdApp) has the screen. Switched on, an album tapped asks the app
 * for its own page of that album, in the room chosen; off, the page's opens,
 * as it always has. What the native page hands back (its Share card, Add to
 * playlist, Edit album, a label) the page opens as its own album page does.
 * The app is stood in for by its bridge. Skipped where no Chromium or Chrome
 * is found.
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

// Before the page's scripts: the app's bridge, its album switch [on], and what it is asked written down.
const bridge = (on) => `window.MusicdApp = { np: false, on: ${on ? "true" : "false"}, set: [], opened: [],
  nativeNowPlaying() { return this.np; }, setNativeNowPlaying(v) { this.np = !!v; }, openNowPlaying() {},
  nativeAlbum() { return this.on; }, setNativeAlbum(v) { this.on = !!v; this.set.push(!!v); }, openAlbum(offset, zone) { this.opened.push([offset, zone]); } };`;

/* Settings → Setup → UI Settings: the album page's switch, and what a tap on it tells the app. */
const SETTINGS = `(async () => { ${KIT}
  $("#settings-toggle").click(); await sleep(300);
  window.__settingsShowView("setup"); await sleep(200);
  document.querySelector('.settings-view[data-pane="setup"] .settings-nav-item[data-pane="ui"]').click();
  await until(() => shown(document.querySelector('.settings-view[data-pane="ui"]')), 5000);
  const out = { shown: shown($("#native-album-row")) };
  if (!out.shown) return out;
  out.checked = $("#native-album-on").checked;
  $("#native-album-on").click(); await sleep(100);
  out.set = window.MusicdApp.set;
  return out;
})()`;

/* Album One tapped on Home: whose page opens, and what the app was asked. */
const TAP = `(async () => { ${KIT}
  [...document.querySelectorAll("#home-library .album")].find(t => /Album One/.test(t.textContent)).click();
  await sleep(1500);
  return { page: shown($("#album-modal")), opened: window.MusicdApp ? window.MusicdApp.opened : null };
})()`;

/* What the native album page hands back, each asked for by name with the album's offset (or a label's name). */
const HANDOFF = (offset) => `(async () => { ${KIT}
  const visible = sel => [...document.querySelectorAll(sel)].some(shown);
  const sheet = () => [...document.querySelectorAll(".lib-sheet h3")].filter(h => shown(h.closest(".lib-sheet"))).map(h => h.textContent);
  const out = { bad: [window.__musicdNative("album-share", "x"), window.__musicdNative("album-edit", "-1"), window.__musicdNative("label")] };
  out.share = window.__musicdNative("album-share", "${offset}");
  out.shareShown = await until(() => shown($("#share-overlay")), 8000);
  $(".share-backdrop").click(); await until(() => !shown($("#share-overlay")), 5000);
  out.playlist = window.__musicdNative("album-playlist", "${offset}");
  out.playlistSheet = (await until(() => sheet().length, 8000)) && sheet();
  document.querySelector(".lib-sheet .icon-btn[aria-label=Close]").click(); await until(() => !sheet().length, 5000);
  out.edit = window.__musicdNative("album-edit", "${offset}");
  out.editShown = await until(() => visible("#album-edit-overlay"), 8000);
  return out;
})()`;

test("the app's native album page: its switch in Setup, an album tap handed over, and what it hands back", { skip, timeout: 240000 }, async (t) => {
  const { base, token, album } = await started(t);
  const one = await album("Album One");
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const cookies = [{ name: "musicd_session", value: token, url: base }];
  const run = async (js, init) => {
    const page = await b.page(base + "/", { cookies, touch: true, init: 'localStorage.setItem("rra-zone", "z-kitchen");' + (init || "") });
    const r = await page.eval(js);
    assert.deepEqual(page.errors, [], "nothing thrown");
    return r;
  };

  await t.test("a browser: no such switch, and the page's album page as ever", async () => {
    assert.deepEqual(await run(SETTINGS), { shown: false });
    assert.deepEqual(await run(TAP), { page: true, opened: null });
  });

  await t.test("the app: the switch, off until switched on, and the app told", async () => {
    assert.deepEqual(await run(SETTINGS, bridge(false)), { shown: true, checked: false, set: [true] });
    assert.deepEqual(await run(SETTINGS, bridge(true)), { shown: true, checked: true, set: [false] });
  });

  await t.test("switched off: the page's album page; on: the app's, of that album, in the room chosen", async () => {
    assert.deepEqual(await run(TAP, bridge(false)), { page: true, opened: [] });
    const r = await run(TAP, bridge(true));
    assert.equal(r.page, false, "not the page's");
    assert.equal(r.opened.length, 1);
    assert.equal(r.opened[0][0], one.offset, "Album One");
  });

  await t.test("handed back: Share card, Add to playlist, Edit album, as the page's album page opens them", async () => {
    const r = await run(HANDOFF(one.offset), bridge(true));
    assert.deepEqual(r.bad, [false, false, false], "nothing it can't find");
    assert.deepEqual([r.share, r.shareShown], [true, true], "Share card");
    assert.equal(r.playlist, true);
    assert.ok(Array.isArray(r.playlistSheet) && r.playlistSheet.length === 1, "the playlist sheet: " + JSON.stringify(r.playlistSheet));
    assert.deepEqual([r.edit, r.editShown], [true, true], "the album editor");
  });
});
