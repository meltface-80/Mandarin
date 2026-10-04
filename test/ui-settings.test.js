"use strict";
/*
 * v0.6.5 in a real browser, phone-sized, against the real server:
 *   - Labels: find a label from the top bar (× clears, then closes), # to Z
 *     turned round to Z to #, and a label's ‹ going back to all labels — no
 *     "‹ All labels" bar of its own;
 *   - the artist page's name and album count in the top bar, not above the grid;
 *   - Settings → UI Settings: the walls in 2 columns or as a list, bigger
 *     text and tiles, and no grid ⇄ list button left in the top bar.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3623;
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = id => document.getElementById(id);
  const title = () => $("album-count").classList.contains("hidden") ? "" : $("album-count").textContent;
  const names = () => [...document.querySelectorAll(".label-tile:not(.hidden)")].map(t => t.getAttribute("aria-label"));
  const out = {};
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  out.view_button = !!$("topbar-view");

  $("labels-toggle").click();
  await until(() => document.querySelectorAll(".label-tile").length >= 2);
  out.labels = { title: title(), names: names(), sort: $("labels-sort-btn").textContent };
  $("labels-sort-btn").click(); await sleep(200);
  out.reversed = { names: names(), sort: $("labels-sort-btn").textContent };
  $("labels-sort-btn").click(); await sleep(200);
  $("labels-search-btn").click(); await sleep(100);
  const input = $("labels-search-input");
  input.value = "parlo"; input.dispatchEvent(new Event("input")); await sleep(100);
  out.found = names();
  $("labels-search-clear").click(); await sleep(100);
  out.cleared = { value: input.value, open: !document.querySelector(".labels-search").classList.contains("hidden"), names: names().length };
  $("labels-search-clear").click(); await sleep(100);
  out.closed = document.querySelector(".labels-search").classList.contains("hidden");

  [...document.querySelectorAll(".label-tile")].find(t => t.getAttribute("aria-label") === "Parlophone").click();
  await until(() => title() === "Parlophone" && document.querySelector("#album-grid .album:not(.label-tile)"));
  out.label = { title: title(), bar: !$("labels-bar").classList.contains("hidden"), logo: !$("labels-logo-btn").classList.contains("hidden"),
    search: !$("labels-search-btn").classList.contains("hidden") };
  $("topbar-back").click();
  await until(() => document.querySelectorAll(".label-tile").length >= 2);
  out.back = title();
  $("topbar-back").click(); await sleep(500);
  out.home = !$("home-view").classList.contains("hidden");

  window.__showArtistAlbums("Artist A");
  await until(() => / · /.test(title()));
  out.artist = { title: title(), above: $("content-count").classList.contains("hidden") ? "" : $("content-count").textContent.trim() };

  window.__uiPrefs.set({ layout: "2" }); await sleep(100);
  out.two = getComputedStyle($("album-grid")).gridTemplateColumns.split(" ").length;
  window.__uiPrefs.set({ layout: "list" }); await sleep(100);
  out.list = $("album-grid").classList.contains("as-list");
  window.__uiPrefs.set({ layout: "standard", tiles: 50 }); await sleep(100);
  out.bigger_tiles_cols = getComputedStyle($("album-grid")).gridTemplateColumns.split(" ").length;
  window.__uiPrefs.set({ tiles: 0, gridText: 50 }); await sleep(100);
  out.grid_zoom = getComputedStyle(document.querySelector("#album-grid .album-meta")).zoom;
  window.__uiPrefs.set({ gridText: 0 });
  $("topbar-back").click(); await sleep(400);
  out.title_after = title();
  return out;
})()`;

test("labels search and order, the artist title, and UI Settings, in a browser", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    for (let i = 0; i < 100; i++) {
      const s = await (await fetch(B + "/api/status", { headers: H })).json();
      if (s.index_count >= 3 && !s.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal((await fetch(B + "/api/settings/labels", { method: "POST", headers: H, body: JSON.stringify({ enabled: true }) })).status, 200);
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }

    assert.equal(r.view_button, false, "the grid ⇄ list button is gone from the top bar");
    assert.equal(r.labels.title, "Labels");
    assert.deepEqual(r.labels.names, ["Blue Note", "Parlophone"]);
    assert.equal(r.labels.sort, "#–Z");
    assert.deepEqual(r.reversed, { names: ["Parlophone", "Blue Note"], sort: "Z–#" });
    assert.deepEqual(r.found, ["Parlophone"]);
    assert.deepEqual(r.cleared, { value: "", open: true, names: 2 }, "the first × clears the words");
    assert.equal(r.closed, true, "the second × closes the field");
    assert.deepEqual(r.label, { title: "Parlophone", bar: false, logo: true, search: false });
    assert.equal(r.back, "Labels", "‹ on a label goes back to all labels");
    assert.equal(r.home, true, "and ‹ there goes Home");
    assert.deepEqual(r.artist, { title: "Artist A · 1 album", above: "" });
    assert.equal(r.two, 2);
    assert.equal(r.list, true);
    assert.equal(r.bigger_tiles_cols, 2, "a phone's 3 across, half as big again: 2");
    assert.equal(r.grid_zoom, "1.5");
    assert.equal(r.title_after, "", "Home has no title");
  } finally {
    await srv.stop();
  }
});
