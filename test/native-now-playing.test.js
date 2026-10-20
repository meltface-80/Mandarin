"use strict";
/*
 * The Android app's native Now playing (stage N2 of
 * old/plan-android-native.md), as the page hands over to it. The
 * app's bridge (MusicdApp) says whether it draws the screen itself (always,
 * since item 47; an app from before says no): then a tap on the mini player
 * asks the app for its own Now playing of the room playing, instead of the
 * page's; otherwise the page's opens, as it always has. The app is stood in
 * for by its bridge; a room by the stand-in Sonos household. Skipped where no
 * Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { started } = require("./helpers");
const { FakeHousehold } = require("./fake-sonos");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

const KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  const $ = (s) => document.querySelector(s);
  await until(() => document.querySelector("#home-random .album, #home-today .album, #home-library .album"), 20000);`;

// Before the page's scripts: the app's bridge, whether it draws Now playing itself ([on]), and what it is asked written down.
const bridge = (on) => `window.MusicdApp = { on: ${on ? "true" : "false"}, opened: [],
  nativeNowPlaying() { return this.on; }, setNativeNowPlaying() {}, openNowPlaying(z) { this.opened.push(z); } };`;

/* An album played to the room, then the mini player tapped: what opens, and what the app was asked. */
const TAP = `(async () => { ${KIT}
  const out = {};
  ($("#home-library .album") || $(".album")).click();
  await until(() => shown($("#album-modal")), 8000);
  const playBtn = () => [...document.querySelectorAll("#modal-actions .action-btn")].find(b => /^Play Now$/.test(b.textContent.trim()) && shown(b));
  await until(() => playBtn() && /Kitchen/.test(($("#mt-kicker") || {}).textContent || ""), 10000);
  playBtn().click();
  $("#modal-close-btn").click();
  await until(() => !shown($("#album-modal")), 5000);
  out.playing = await until(() => /Song|Hi /.test(($("#mt-title") || {}).textContent || ""), 15000);
  const pageNp = () => shown($("#np-screen")) || shown($("#album-modal"));
  // Tapped until something answers: the bar acts once it has read what is playing (a poll away).
  for (let i = 0; i < 6 && !pageNp() && !(window.MusicdApp && window.MusicdApp.opened.length); i++) { $(".mt-info").click(); await until(() => pageNp() || (window.MusicdApp && window.MusicdApp.opened.length > 0), 2500); }
  out.pageNp = pageNp();
  out.opened = window.MusicdApp ? window.MusicdApp.opened : null;
  return out;
})()`;

/* What the app's native screens hand back to the page (public/app/native-handoff.js), each asked for by name. */
const HANDOFF = (study) => `(async () => { ${KIT}
  const sheet = () => [...document.querySelectorAll(".lib-sheet h3")].filter(h => shown(h.closest(".lib-sheet"))).map(h => h.textContent);
  const out = { unknown: window.__musicdNative("lyrics"), badRoom: window.__musicdNative("zone", "no-such-room") };
  out.group = window.__musicdNative("group"); await until(() => sheet().length, 5000); out.groupSheet = sheet();
  document.querySelector(".lib-sheet .icon-btn[aria-label=Close]").click(); await until(() => !sheet().length, 5000);
  out.power = window.__musicdNative("power"); await until(() => sheet().length, 5000); out.powerSheet = sheet();
  document.querySelector(".lib-sheet .icon-btn[aria-label=Close]").click(); await until(() => !sheet().length, 5000);
  out.zone = window.__musicdNative("zone", ${JSON.stringify(study)});
  await until(() => /Study/.test(($("#mt-kicker") || {}).textContent || ""), 8000);
  out.kicker = ($("#mt-kicker") || {}).textContent;
  out.stored = localStorage.getItem("rra-zone");
  // The native row along the foot of the screen: the page's own button, tapped; a name it hasn't is nothing.
  out.navUnknown = window.__musicdNative("nav", "settings");
  out.nav = window.__musicdNative("nav", "library");
  out.navLibrary = await until(() => document.documentElement.classList.contains("tn-lib"), 8000);
  return out;
})()`;

/* With a track playing: Share card, its album and its artist, handed back as the page's Now playing opens them. */
const PLAYING_HANDOFF = `(async () => { ${KIT}
  ($("#home-library .album") || $(".album")).click();
  await until(() => shown($("#album-modal")), 8000);
  const playBtn = () => [...document.querySelectorAll("#modal-actions .action-btn")].find(b => /^Play Now$/.test(b.textContent.trim()) && shown(b));
  await until(() => playBtn() && /Kitchen/.test(($("#mt-kicker") || {}).textContent || ""), 10000);
  playBtn().click();
  $("#modal-close-btn").click();
  await until(() => !shown($("#album-modal")), 5000);
  const out = { playing: await until(() => window.__getCurrentNp && window.__getCurrentNp() && /Song/.test(window.__getCurrentNp().line1 || ""), 15000) };
  out.share = window.__musicdNative("share");
  out.shareShown = await until(() => shown($("#share-overlay")), 5000);
  $(".share-backdrop").click(); await until(() => !shown($("#share-overlay")), 5000);
  out.album = window.__musicdNative("album");
  out.albumTitle = (await until(() => shown($("#album-modal")) && !$("#album-modal").classList.contains("np-mode") && /Album/.test($("#modal-title").textContent), 8000)) && $("#modal-title").textContent;
  $("#modal-close-btn").click(); await until(() => !shown($("#album-modal")), 5000);
  out.noArtist = window.__musicdNative("artist");
  out.artist = window.__musicdNative("artist", "Artist A");
  out.artistShown = await until(() => /album.* · Artist A$/.test(($("#album-count") || {}).textContent || ""), 8000);
  // The native mini player's tap on what is playing: the page's bar's own tap, which asks the app (its Now playing on here).
  out.nowPlaying = window.__musicdNative("now-playing");
  out.nowPlayingAsked = await until(() => window.MusicdApp.opened.length > 0, 5000);
  return out;
})()`;

/*
 * A sheet asked for over a native screen (__musicdNativeOver, bug list item 54): the page's ground goes clear with nothing
 * but the sheet showing, the page's own Back closes it, and the app is told; a sheet the page can't open (the Share card
 * with nothing playing) is given up on at once, the app told the same way.
 */
const OVER = `(async () => { ${KIT}
  const sheet = () => [...document.querySelectorAll(".lib-sheet h3")].filter(h => shown(h.closest(".lib-sheet"))).map(h => h.textContent);
  const cleared = () => document.documentElement.classList.contains("native-over");
  // The app's side of the handshake: told the page is painted clear, it comes in front; told the sheet has closed, it puts
  // the screen in front and then takes the class off (as NativeShell.overlayClosed does).
  window.MusicdApp.shown = 0; window.MusicdApp.closed = 0;
  window.MusicdApp.overlayShown = function () { this.shown++; };
  window.MusicdApp.overlayClosed = function () { this.closed++; document.documentElement.classList.remove("native-over"); };
  const out = { over: window.__musicdNativeOver("group") };
  await until(() => sheet().length, 5000);
  await until(() => window.MusicdApp.shown > 0, 5000);
  out.sheet = sheet(); out.shown = window.MusicdApp.shown; out.cleared = cleared(); out.main = getComputedStyle($("main")).visibility; out.ground = getComputedStyle(document.body).backgroundColor;
  out.back = window.__pageBack();
  await until(() => !sheet().length, 5000);
  await until(() => window.MusicdApp.closed > 0, 5000);
  out.closed = window.MusicdApp.closed; out.clearedAfter = cleared(); out.mainAfter = getComputedStyle($("main")).visibility;
  window.MusicdApp.shown = 0; window.MusicdApp.closed = 0;
  out.none = window.__musicdNativeOver("share");
  await sleep(200);
  out.noneShown = window.MusicdApp.shown; out.noneClosed = window.MusicdApp.closed; out.noneCleared = cleared();
  return out;
})()`;

test("the app's native Now playing: the mini player handing over to it, and what it hands back", { skip, timeout: 240000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { base, token } = await started(t, { sonosHosts: [ports.host(0)] });
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const cookies = [{ name: "musicd_session", value: token, url: base }];
  // The household's rooms are found a moment after the server starts: waited for.
  let kitchen = null, zones = [];
  for (const t0 = Date.now(); !kitchen && Date.now() - t0 < 20000; await new Promise(r => setTimeout(r, 200))) {
    zones = (await (await fetch(base + "/api/zones", { headers: { Authorization: "Bearer " + token } })).json()).zones || [];
    kitchen = zones.find(z => z.display_name === "Kitchen");
  }
  assert.ok(kitchen, "the Kitchen room");
  const room = `localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)});`;
  const run = async (js, init) => {
    const page = await b.page(base + "/", { cookies, touch: true, init });
    const r = await page.eval(js);
    assert.deepEqual(page.errors, [], "nothing thrown");
    return r;
  };

  await t.test("handed back to the page: Group zones and Device power its own sheets, a room chosen its room", async () => {
    const study = zones.find(z => z.display_name === "Study");
    assert.ok(study, "the Study room");
    const r = await run(HANDOFF(study.zone_id), room + bridge(true));
    assert.deepEqual([r.unknown, r.badRoom], [false, false], "nothing it doesn't know");
    assert.deepEqual([r.group, r.groupSheet], [true, ["Group zones"]]);
    assert.deepEqual([r.power, r.powerSheet], [true, ["Device power"]]);
    assert.equal(r.zone, true);
    assert.match(r.kicker, /Study/, "the page's room is the Study now");
    assert.equal(r.stored, study.zone_id);
    assert.deepEqual([r.navUnknown, r.nav, r.navLibrary], [false, true, true], "the row's Library, as the page's own tap");
  });

  await t.test("a sheet over a native screen: the page clear but for the sheet, Back closes it, the app told", async () => {
    const r = await run(OVER, room + bridge(true));
    assert.deepEqual([r.over, r.sheet, r.shown, r.cleared, r.main, r.ground], [true, ["Group zones"], 1, true, "hidden", "rgba(0, 0, 0, 0)"], "the sheet over a clear page, the app told it is painted");
    assert.deepEqual([r.back, r.closed, r.clearedAfter, r.mainAfter], [true, 1, false, "visible"], "Back closed it, the app told once");
    assert.deepEqual([r.none, r.noneShown, r.noneClosed, r.noneCleared], [false, 0, 1, false], "a sheet that can't open: given up on at once, never shown");
  });

  await t.test("handed back with a track playing: Share card, its album, its artist, Now playing", async () => {
    const r = await run(PLAYING_HANDOFF, room + bridge(true));
    assert.equal(r.playing, true, "it plays");
    assert.deepEqual([r.nowPlaying, r.nowPlayingAsked], [true, true], "the mini player's tap, as the page's bar makes it");
    assert.deepEqual([r.share, r.shareShown], [true, true], "Share card");
    assert.equal(r.album, true);
    assert.equal(r.albumTitle, "Album One", "the playing album, opened");
    assert.deepEqual([r.noArtist, r.artist, r.artistShown], [false, true, true], "the artist's page");
  });

  await t.test("an app from before item 47 (no native Now playing): the mini player opens the page's, as ever", async () => {
    const r = await run(TAP, room + bridge(false));
    assert.equal(r.playing, true, "it plays");
    assert.equal(r.pageNp, true, "the page's Now playing");
    assert.deepEqual(r.opened, [], "the app not asked");
  });

  await t.test("the app: the mini player asks it for its own Now playing, of the room playing", async () => {
    const r = await run(TAP, room + bridge(true));
    assert.equal(r.playing, true, "it plays");
    assert.deepEqual(r.opened, [kitchen.zone_id], "the app's Now playing, of the Kitchen");
    assert.equal(r.pageNp, false, "not the page's");
  });
});
