"use strict";
/*
 * The side menu (v0.6.19), in a real browser, phone-sized: an item is its
 * icon and its words, no wider; a tap on a blank part of the menu does
 * nothing; the Offline switch (the app's) toggles without closing it —
 * the app reloads the page, and the menu is open again on the page that
 * follows (v0.6.20); choosing an item closes it; so does a tap on the page
 * beside it.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const PORT2 = ports.port(), B2 = "http://127.0.0.1:" + PORT2; // the second test's own, so the two never share a port

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(25); } return true; };
  const $ = id => document.getElementById(id);
  const out = {};
  // The app's Offline switch, as the Android app provides it.
  const settings = { offlineMode: false };
  window.MusicdDownloads = { settings: () => JSON.stringify(settings), set: (k, v) => { settings[k] = v; } };
  const overlay = $("menu-overlay"), drawer = overlay.querySelector(".menu-drawer");
  const open = () => !overlay.classList.contains("hidden");
  // The menu open and its drawer done sliding in (style.css menuSlideIn), then a frame: on a
  // slow runner a fixed wait tapped before it was there (v0.8.48).
  const menuIn = async () => {
    for (let i = 0; i < 300; i++) {
      if (open() && drawer.getAnimations().every(a => a.playState === "finished")) { await new Promise(r => requestAnimationFrame(r)); return; }
      await sleep(16);
    }
  };
  const tapAt = (x, y) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })); return el; };
  $("menu-toggle").click(); await menuIn();
  out.opened = open();
  const d = drawer.getBoundingClientRect();
  const home = overlay.querySelector('.menu-item[data-action="later"]');
  const h = home.getBoundingClientRect();
  out.item_hugs = Math.round(h.width) < Math.round(d.width) * 0.75;
  out.item_text = home.textContent.trim();
  // A tap to the right of the words, in the menu: nothing happens.
  const beside = tapAt(d.right - 10, h.top + h.height / 2);
  out.beside_was = beside === drawer || beside.classList.contains("menu-list") ? "blank" : beside.className;
  out.open_after_blank = open();
  // The Offline switch: toggled, the menu still open.
  const off = $("menu-item-offline");
  out.offline_shown = !off.classList.contains("hidden");
  const o = off.getBoundingClientRect();
  tapAt(o.right - 20, o.top + o.height / 2);
  await until(() => settings.offlineMode === "true");
  // A window: the menu must stay open through it.
  await sleep(100);
  out.offline_set = settings.offlineMode;
  out.open_after_offline = open();
  out.reopen_flagged = !!localStorage.getItem("rra-menu-reopen");
  // An item: chosen, and the menu closes.
  home.click(); await until(() => !open());
  out.open_after_item = open();
  // Beside the menu: closes.
  $("menu-toggle").click(); await menuIn();
  tapAt(window.innerWidth - 10, window.innerHeight / 2); await until(() => !open());
  out.open_after_outside = open();
  return out;
})()`;

test("the side menu: items hug their words, Offline keeps it open, an item or the page beside it closes it", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
      // The reload the app does on the switch: the menu is open on the page that follows, once.
      const next = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      const menuOpen = `!document.getElementById("menu-overlay").classList.contains("hidden")`;
      r.open_after_reload = await next.eval(`(async () => { for (let i = 0; i < 200 && !(${menuOpen}); i++) await new Promise(r => setTimeout(r, 25)); return ${menuOpen}; })()`);
      r.flag_cleared = await next.eval(`!localStorage.getItem("rra-menu-reopen")`);
      const later = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      // A window: on this visit the menu must not open by itself.
      r.open_on_next_visit = await later.eval(`(async () => { await new Promise(r => setTimeout(r, 300)); return ${menuOpen}; })()`);
    } finally { await b.close(); }
    assert.equal(r.opened, true);
    assert.equal(r.item_text, "Listen later");
    assert.equal(r.item_hugs, true, "an item is no wider than its icon and words");
    assert.equal(r.beside_was, "blank", "beside the words is nothing");
    assert.equal(r.open_after_blank, true, "a blank part of the menu doesn't close it");
    assert.equal(r.offline_shown, true);
    assert.equal(r.offline_set, "true", "the Offline switch toggled");
    assert.equal(r.open_after_offline, true, "and the menu stayed open");
    assert.equal(r.reopen_flagged, true, "the page that follows the app's reload is told to open it");
    assert.equal(r.open_after_reload, true, "and does");
    assert.equal(r.flag_cleared, true);
    assert.equal(r.open_on_next_visit, false, "once only");
    assert.equal(r.open_after_item, false, "an item closes it");
    assert.equal(r.open_after_outside, false, "so does the page beside it");
  } finally { await srv.stop(); }
});

// The Random albums wall is titled (v0.6.24), and the menu button is Home's
// alone: every other screen shows ‹ in its place.
test("the Random albums wall has its title; the menu button is Home's alone", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT2, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B2);
    // The first scan done before the page opens: the app reloads itself when it lands.
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B2 + "/api/status", { headers: { Authorization: "Bearer " + token } })).json(); if (st.index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B2 + "/", { cookies: [{ name: "musicd_session", value: token, url: B2 }] });
      r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(25); } return true; };
        const $ = id => document.getElementById(id);
        const shown = id => !$(id).classList.contains("hidden");
        const out = {};
        // The Random albums wall from its row's heading: titled; Home again: no title.
        const menuShown = () => shown("menu-toggle"), backShown = () => shown("topbar-back");
        const onHome = () => shown("home-view") && menuShown() && !backShown();
        await until(onHome);
        document.getElementById("home-random-title").click();
        const count = document.getElementById("album-count");
        await until(() => !count.classList.contains("hidden") && count.textContent);
        out.random_title = count.classList.contains("hidden") ? "" : count.textContent;
        document.getElementById("topbar-back").click(); await until(() => onHome() && count.classList.contains("hidden"));
        out.home_title_hidden = count.classList.contains("hidden");
        // The menu button is Home's alone: every other screen shows ‹ in its place.
        out.home_buttons = [menuShown(), backShown()];
        const screens = {};
        for (const [name, open] of [["random", () => $("home-random-title").click()], ["library", () => $("home-library-title").click()],
                                    ["later", () => window.__showListenLater()], ["picks", () => window.__showSmartPicks()], ["wall", () => window.__showWall()]]) {
          open(); await until(() => backShown() && !shown("home-view"));
          screens[name] = [menuShown(), backShown()];
          $("topbar-back").click(); await until(onHome);
        }
        out.screens = screens;
        out.home_after = [menuShown(), backShown()];
        return out;
      })()`);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.equal(r.random_title, "Random albums", "the Random albums wall is titled");
    assert.equal(r.home_title_hidden, true, "and Home is not");
    assert.deepEqual(r.home_buttons, [true, false], "Home: the menu button, no ‹");
    for (const [name, v] of Object.entries(r.screens)) assert.deepEqual(v, [false, true], name + ": ‹ in the menu button's place");
    assert.deepEqual(r.home_after, [true, false]);
  } finally { await srv.stop(); }
});
