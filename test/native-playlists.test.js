"use strict";
/*
 * The Android app's native Playlists (the Playlists group of
 * old/plan-android-native.md, bug list item 65), as the page hands them
 * over (public/app/native-playlists.js): the side menu's Playlists, Home's
 * Playlists heading and a playlist's tile open the app's screens
 * (MusicdApp.openPlaylists, openPlaylist) with the UI Settings and the room, in
 * place of the page's; offline, or in a browser, the page's own. And what the
 * native screens hand back (public/app/native-handoff.js): Import, the page's
 * sheet; a playlist shared, the page's sheet with its file. The app is stood in
 * for by its bridge. Skipped where no Chromium or Chrome is found.
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

// Before the page's scripts: the app's bridge, and what it was asked to open.
const BRIDGE = `window.MusicdApp = { opened: [],
  openPlaylists(prefs, zone) { this.opened.push(["list", JSON.parse(prefs).layout, zone]); },
  openPlaylist(id, prefs, zone) { this.opened.push(["one", id, zone]); },
  openSmartPlaylists(prefs, zone) { this.opened.push(["smart-list", JSON.parse(prefs).layout, zone]); },
  openSmartPlaylist(id, prefs, zone) { this.opened.push(["smart-one", id, zone]); },
  nativeNowPlaying() { return false; }, setNativeNowPlaying() {}, openNowPlaying() {}, nativeAlbum() { return false; }, setNativeAlbum() {},
  nativeLibrary() { return false; }, setNativeLibrary() {} };`;

/* A playlist made, then the side menu's Playlists, Home's heading and the playlist itself: what the app was asked, and whether the page's screen came. */
const OPENED = `(async () => { ${KIT}
  const r = await (await fetch("/api/user-playlists/add", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Mine", tracks: [{ album_offset: 0, album_title: "X", album_subtitle: "Y", track_index: 0, title: "T", subtitle: "Y", image_key: null }] }) })).json();
  $("#tnav-menu").click(); await until(() => shown($("#menu-overlay")));
  $('#menu-overlay [data-action="playlists"]').click(); await sleep(400);
  const pageList = /Playlists/.test($("#album-count").textContent) && $("#home-view").classList.contains("hidden");
  if (shown($("#menu-overlay"))) { $("#menu-overlay [data-menu-close]").click(); await sleep(200); }
  const heading = $("#home-playlists-title");
  if (heading && shown(heading)) { heading.click(); await sleep(300); }
  openUserPlaylist({ id: r.id, name: "Mine" }); await sleep(300);
  return { opened: (window.MusicdApp || {}).opened || null, pageList, id: r.id, pageOne: !!$(".playlist-detail") };
})()`;

/* The Dynamic Playlists: one saved, then the side menu's Dynamic Playlists and the playlist itself; and the hand-backs, New, Edit and Share. */
const SMART = `(async () => { ${KIT}
  const r = await (await fetch("/api/smart-playlists", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Rocks", view: { sort: "album", dir: "asc" }, mode: "tracks", order: "album" }) })).json();
  const id = r.playlist.id;
  $("#tnav-menu").click(); await until(() => shown($("#menu-overlay")));
  $('#menu-overlay [data-action="smart-playlists"]').click(); await sleep(400);
  const pageList = /Dynamic Playlists/.test($("#album-count").textContent) && $("#home-view").classList.contains("hidden");
  if (shown($("#menu-overlay"))) { $("#menu-overlay [data-menu-close]").click(); await sleep(200); }
  openSmartPlaylist(r.playlist); await sleep(300);
  const out = { opened: (window.MusicdApp || {}).opened || null, pageList, id, pageOne: !!$(".playlist-detail") };
  if (!window.MusicdApp) return out;
  const sheet = (re) => until(() => [...document.querySelectorAll(".lib-sheet-head h3")].some(e => re.test(e.textContent)));
  const closeSheets = async () => { document.querySelectorAll(".lib-sheet-backdrop").forEach(b => b.click()); await sleep(400); };
  out.newSheet = window.__musicdNative("smart-new") && await sheet(/New Dynamic Playlist/); await closeSheets();
  out.editSheet = window.__musicdNative("smart-edit", id) && await sheet(/Focus|Rocks/); await closeSheets();
  out.shareSheet = window.__musicdNative("smart-share", id) && await sheet(/Share Rocks/, 15000);
  out.none = window.__musicdNative("smart-edit");
  return out;
})()`;

/* Import's sheet and a playlist's share sheet are the app's own (item 94): the page is handed neither, and opens neither. */
const HANDOFF = `(async () => { ${KIT}
  const r = await (await fetch("/api/user-playlists/add", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Shared", tracks: [{ album_offset: 0, album_title: "X", album_subtitle: "Y", track_index: 0, title: "T", subtitle: "Y", image_key: null }] }) })).json();
  const out = { imported: window.__musicdNative("playlist-import"), shared: window.__musicdNative("playlist-share", r.id) };
  await sleep(1500);
  out.sheet = document.querySelectorAll(".lib-sheet").length > 0;
  return out;
})()`;

test("the app's native Playlists: opened in place of the page's, and what they hand back", { skip, timeout: 240000 }, async (t) => {
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

  await t.test("in the app: the menu's Playlists, Home's heading and a playlist open the app's screens", async () => {
    const r = await run(OPENED, BRIDGE);
    assert.equal(r.pageList, false, "the page's Playlists screen never comes");
    assert.equal(r.pageOne, false, "nor the page's playlist");
    assert.deepEqual(r.opened.filter(o => o[0] === "list")[0], ["list", "auto", ""]);
    assert.ok(r.opened.length >= 2, JSON.stringify(r.opened));
    assert.deepEqual(r.opened[r.opened.length - 1], ["one", r.id, ""]);
  });

  await t.test("offline, or a browser: the page's own", async () => {
    for (const init of ["window.__musicdOffline = true;" + BRIDGE, ""]) {
      const r = await run(OPENED, init);
      assert.deepEqual(r.opened || [], [], init.slice(0, 30));
      assert.equal(r.pageOne, true, "the page's playlist opens");
    }
  });

  await t.test("the Dynamic Playlists: the menu's and a playlist open the app's; New, Edit and Share are the page's sheets over them", async () => {
    const r = await run(SMART, BRIDGE);
    assert.equal(r.pageList, false, "the page's Dynamic Playlists never come");
    assert.equal(r.pageOne, false);
    assert.deepEqual(r.opened, [["smart-list", "auto", ""], ["smart-one", r.id, ""]]);
    assert.deepEqual([r.newSheet, r.editSheet, r.shareSheet, r.none], [true, true, true, false]);
    const off = await run(SMART, "window.__musicdOffline = true;" + BRIDGE);
    assert.deepEqual(off.opened, [], "offline: the page's own");
    assert.equal(off.pageOne, true);
  });

  await t.test("Import's sheet and a playlist's share sheet are the app's own: the page is handed neither", async () => {
    const r = await run(HANDOFF, BRIDGE);
    assert.deepEqual(r, { imported: false, shared: false, sheet: false });
  });
});
