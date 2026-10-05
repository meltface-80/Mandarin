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
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3632;
const B = "http://127.0.0.1:" + PORT;
const PORT2 = 3637, B2 = "http://127.0.0.1:" + PORT2; // the Playlists test's own, so the two never share a port

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const out = {};
  // The app's Offline switch, as the Android app provides it.
  const settings = { offlineMode: false };
  window.MusicdDownloads = { settings: () => JSON.stringify(settings), set: (k, v) => { settings[k] = v; } };
  const overlay = $("menu-overlay"), drawer = overlay.querySelector(".menu-drawer");
  const open = () => !overlay.classList.contains("hidden");
  const tapAt = (x, y) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: x, clientY: y })); return el; };
  $("menu-toggle").click(); await sleep(400);
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
  await sleep(100);
  out.offline_set = settings.offlineMode;
  out.open_after_offline = open();
  out.reopen_flagged = !!localStorage.getItem("rra-menu-reopen");
  // An item: chosen, and the menu closes.
  home.click(); await sleep(100);
  out.open_after_item = open();
  // Beside the menu: closes.
  $("menu-toggle").click(); await sleep(400);
  tapAt(window.innerWidth - 10, window.innerHeight / 2); await sleep(100);
  out.open_after_outside = open();
  return out;
})()`;

test("the side menu: items hug their words, Offline keeps it open, an item or the page beside it closes it", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
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
      r.open_after_reload = await next.eval(`(async () => { await new Promise(r => setTimeout(r, 300)); return !document.getElementById("menu-overlay").classList.contains("hidden"); })()`);
      r.flag_cleared = await next.eval(`!localStorage.getItem("rra-menu-reopen")`);
      const later = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r.open_on_next_visit = await later.eval(`(async () => { await new Promise(r => setTimeout(r, 300)); return !document.getElementById("menu-overlay").classList.contains("hidden"); })()`);
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

// Playlists (v0.6.24): Import is a pill in the top-right corner of the
// screen, above the grid. And the Random albums wall is titled (v0.6.24).
test("Playlists: Import sits in the top-right corner; the Random albums wall has its title", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT2, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B2);
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B2 + "/", { cookies: [{ name: "musicd_session", value: token, url: B2 }] });
      r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        document.getElementById("menu-toggle").click(); await sleep(400);
        document.querySelector('#menu-overlay .menu-item[data-action="playlists"]').click(); await sleep(600);
        const btn = document.querySelector("#content-count .playlists-import");
        if (!btn) return { shown: false };
        const r = btn.getBoundingClientRect(), bar = document.getElementById("content-count").getBoundingClientRect();
        const top = document.querySelector(".topbar").getBoundingClientRect();
        const out = { shown: true, text: btn.textContent, height: r.height, right_gap: Math.round(bar.right - r.right), left_gap: Math.round(r.left - bar.left), below_bar: r.top >= top.bottom - 1 };
        // Home, then the Random albums wall from its row's heading: titled; Home again: no title.
        document.getElementById("topbar-back").click(); await sleep(300);
        document.getElementById("home-random-title").click(); await sleep(600);
        const count = document.getElementById("album-count");
        out.random_title = count.classList.contains("hidden") ? "" : count.textContent;
        document.getElementById("topbar-back").click(); await sleep(300);
        out.home_title_hidden = count.classList.contains("hidden");
        return out;
      })()`);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.equal(r.shown, true, "the Import pill is on the Playlists screen");
    assert.equal(r.text, "Import");
    assert.equal(r.height, 32);
    assert.ok(r.right_gap <= 16, "it hugs the right edge: " + r.right_gap + " px");
    assert.ok(r.left_gap > 100, "not the left: " + r.left_gap + " px");
    assert.equal(r.below_bar, true, "just under the top bar");
    assert.equal(r.random_title, "Random albums", "the Random albums wall is titled");
    assert.equal(r.home_title_hidden, true, "and Home is not");
  } finally { await srv.stop(); }
});
