"use strict";
/*
 * v0.6.5 in a real browser, phone-sized, against the real server:
 *   - Labels: find a label from the top bar (× clears, then closes), # to Z
 *     turned round to Z to #, and a label's ‹ going back to all labels — no
 *     "‹ All labels" bar of its own;
 *   - the artist page's name and album count in the top bar, not above the grid;
 *   - the Library wall's Focus, Sort and search in the top bar, in brass; the
 *     field opens over Focus and Sort, × clears, then closes (as Rouen v1.8.78);
 *   - Settings → UI Settings (as Rouen v1.8.77): the walls in 2 columns or as
 *     a list, bigger text and tiles, and no grid ⇄ list button in the top bar.
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

  // The Library wall: Focus, Sort and the glass in the top bar, in brass.
  const libTitle = $("home-library-title");
  out.has_library = !!libTitle;
  if (libTitle) {
    libTitle.click();
    await until(() => document.querySelector(".topbar #library-controls:not(.hidden) .lib-ctl-sort"));
    const bar = $("library-controls");
    const vis = sel => { const e = bar.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; };
    out.lib = { in_topbar: !!bar.closest(".topbar"), focus: vis(".lib-ctl-focus"), sort: vis(".lib-ctl-sort"), glass: vis(".lib-filter-btn"),
      brass: getComputedStyle(bar.querySelector(".lib-ctl-sort")).backgroundColor === getComputedStyle(document.querySelector("#menu-toggle")).backgroundColor,
      glass_last: bar.lastElementChild.querySelector(".lib-filter-btn") !== null };
    bar.querySelector(".lib-filter-btn").click(); await sleep(150);
    const inp = bar.querySelector(".lib-filter-input");
    inp.value = "Al"; inp.dispatchEvent(new Event("input")); await sleep(400);
    const bar2 = $("library-controls");
    out.lib_open = { focus: vis(".lib-ctl-focus"), sort: vis(".lib-ctl-sort"), title: getComputedStyle($("album-count")).display === "none", value: bar2.querySelector(".lib-filter-input").value };
    bar2.querySelector(".lib-filter-clear").click(); await sleep(400);
    out.lib_cleared = { open: !!$("library-controls").querySelector(".lib-filter-input"), value: ($("library-controls").querySelector(".lib-filter-input") || {}).value };
    $("library-controls").querySelector(".lib-filter-clear").click(); await sleep(300);
    out.lib_closed = { open: !!$("library-controls").querySelector(".lib-filter-input"), focus: vis(".lib-ctl-focus"), sort: vis(".lib-ctl-sort") };
    window.__showArtistAlbums("Artist A");
    await until(() => / · /.test(title()));
    out.lib_in_artist = !$("library-controls").classList.contains("hidden");
    $("topbar-back").click(); await sleep(500);
    out.lib_back = !$("library-controls").classList.contains("hidden");
    $("topbar-back").click(); await sleep(500);
    out.lib_home = !$("library-controls").classList.contains("hidden");
  }

  window.__showArtistAlbums("Artist A");
  await until(() => / · /.test(title()));
  out.artist = { title: title(), above: $("content-count").classList.contains("hidden") ? "" : $("content-count").textContent.trim() };

  window.__uiPrefs.set("layout", "2"); await sleep(100);
  out.two = getComputedStyle($("album-grid")).gridTemplateColumns.split(" ").length;
  window.__uiPrefs.set("layout", "list"); await sleep(100);
  out.list = $("album-grid").classList.contains("as-list");
  window.__uiPrefs.set("layout", "auto"); window.__uiPrefs.set("tile", "1.5"); await sleep(100);
  out.bigger_tiles_cols = getComputedStyle($("album-grid")).gridTemplateColumns.split(" ").length;
  window.__uiPrefs.set("tile", "1"); const before = parseFloat(getComputedStyle(document.querySelector("#album-grid .album-title")).fontSize);
  window.__uiPrefs.set("text", "1.5"); await sleep(100);
  out.text_ratio = parseFloat(getComputedStyle(document.querySelector("#album-grid .album-title")).fontSize) / before;
  window.__uiPrefs.set("text", "1");
  document.querySelector('.settings-nav-item[data-pane="ui"]').click(); await sleep(100);
  out.pane = [...document.querySelectorAll('.settings-pane[data-pane="ui"] select')].map(x => x.id + "=" + x.value);
  const lay = $("ui-layout-select"); lay.value = "2"; lay.dispatchEvent(new Event("change"));
  out.pane_sets = window.__uiPrefs.get("layout") + " " + getComputedStyle($("album-grid")).gridTemplateColumns.split(" ").length;
  lay.value = "auto"; lay.dispatchEvent(new Event("change"));
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
    assert.equal(r.has_library, true, "Home has its Library row");
    assert.deepEqual(r.lib, { in_topbar: true, focus: true, sort: true, glass: true, brass: true, glass_last: true });
    assert.deepEqual(r.lib_open, { focus: false, sort: false, title: true, value: "Al" }, "the field opens over Focus and Sort");
    assert.deepEqual(r.lib_cleared, { open: true, value: "" }, "the first × clears the words");
    assert.deepEqual(r.lib_closed, { open: false, focus: true, sort: true }, "the second × closes it");
    assert.equal(r.lib_in_artist, false, "an artist page takes them out of the bar");
    assert.equal(r.lib_back, true, "and Back brings them back with the wall");
    assert.equal(r.lib_home, false, "not on Home");
    assert.deepEqual(r.artist, { title: "1 album · Artist A", above: "" });
    assert.equal(r.two, 2);
    assert.equal(r.list, true);
    assert.equal(r.bigger_tiles_cols, 2, "a phone's 3 across, half as big again: 2");
    assert.equal(r.text_ratio, 1.5);
    assert.deepEqual(r.pane, ["ui-text-select=1", "ui-title-select=1", "ui-layout-select=auto", "ui-tile-select=1"]);
    assert.equal(r.pane_sets, "2 2", "a choice in the pane lays the wall out");
    assert.equal(r.title_after, "", "Home has no title");
  } finally {
    await srv.stop();
  }
});
