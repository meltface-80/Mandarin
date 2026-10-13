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
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = id => document.getElementById(id);
  const title = () => $("album-count").classList.contains("hidden") ? "" : $("album-count").textContent;
  const names = () => [...document.querySelectorAll(".label-tile:not(.hidden)")].map(t => t.getAttribute("aria-label"));
  const shown = id => !$(id).classList.contains("hidden");
  const cols = () => getComputedStyle($("album-grid")).gridTemplateColumns.split(" ").length;
  // The side menu open and its drawer done sliding in, then a frame; and closed.
  const menuIn = async () => { await until(() => shown("menu-overlay") && document.querySelector(".menu-drawer").getAnimations().every(a => a.playState === "finished")); await new Promise(r => requestAnimationFrame(r)); };
  const menuOut = () => until(() => !shown("menu-overlay"));
  const out = {};
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  out.view_button = !!$("topbar-view");

  $("labels-toggle").click();
  await until(() => document.querySelectorAll(".label-tile").length >= 2);
  out.labels = { title: title(), names: names(), sort: $("labels-sort-btn").textContent };
  const sortSays = () => $("labels-sort-btn").textContent;
  const searchOpen = () => !document.querySelector(".labels-search").classList.contains("hidden");
  $("labels-sort-btn").click(); await until(() => sortSays() !== out.labels.sort);
  out.reversed = { names: names(), sort: sortSays() };
  $("labels-sort-btn").click(); await until(() => sortSays() === out.labels.sort);
  $("labels-search-btn").click(); await until(searchOpen);
  const input = $("labels-search-input");
  input.value = "parlo"; input.dispatchEvent(new Event("input")); await until(() => names().length < out.labels.names.length);
  out.found = names();
  $("labels-search-clear").click(); await until(() => input.value === "" && names().length === out.labels.names.length);
  out.cleared = { value: input.value, open: searchOpen(), names: names().length };
  $("labels-search-clear").click(); await until(() => !searchOpen());
  out.closed = !searchOpen();

  [...document.querySelectorAll(".label-tile")].find(t => t.getAttribute("aria-label") === "Parlophone").click();
  await until(() => title() === "Parlophone" && document.querySelector("#album-grid .album:not(.label-tile)"));
  out.label = { title: title(), bar: !$("labels-bar").classList.contains("hidden"), logo: !$("labels-logo-btn").classList.contains("hidden"),
    search: !$("labels-search-btn").classList.contains("hidden") };
  $("topbar-back").click();
  // The tiles can be back before the bar's title is (a busy machine): both.
  await until(() => title() === "Labels" && document.querySelectorAll(".label-tile").length >= 2);
  out.back = title();
  $("topbar-back").click(); await until(() => shown("home-view"));
  out.home = shown("home-view");

  // ‹ on a label before its albums have come (a slow server): when they come,
  // they stay off the Labels list. Held until the list is back, then let go.
  const plainFetch = window.fetch;
  let letGo, came = false;
  const held = new Promise(r => { letGo = r; });
  window.fetch = (u, o) => String(u).includes("/api/label-albums")
    ? plainFetch(u, o).then(async res => { await held; came = true; return res; }) : plainFetch(u, o);
  $("labels-toggle").click();
  await until(() => document.querySelectorAll(".label-tile").length >= 2);
  [...document.querySelectorAll(".label-tile")].find(t => t.getAttribute("aria-label") === "Parlophone").click();
  await until(() => title() === "Parlophone");
  $("topbar-back").click();
  await until(() => title() === "Labels" && document.querySelectorAll(".label-tile").length >= 2);
  letGo(); await until(() => came);
  // A window: the late albums must not cover the Labels list in it.
  await sleep(500);
  window.fetch = plainFetch;
  out.back_early = { title: title(), labels: document.querySelectorAll(".label-tile").length };
  $("topbar-back").click(); await until(() => shown("home-view"));

  // The Library wall: Focus, Sort and the glass in the top bar, in brass. On a phone or a tablet
  // (the touch layout, v0.9.6) the glass gives way to Search in the row along the foot.
  out.touch = getComputedStyle($("touch-nav")).display !== "none";
  const libTitle = $("home-library-title");
  out.has_library = !!libTitle;
  if (libTitle) {
    libTitle.click();
    await until(() => document.querySelector(".topbar #library-controls:not(.hidden) .lib-ctl-sort"));
    const bar = $("library-controls");
    const tb = document.querySelector(".topbar");
    const vis = sel => { const e = tb.querySelector(sel); return !!e && getComputedStyle(e).display !== "none"; };
    out.lib = { in_topbar: !!bar.closest(".topbar"), focus: vis(".lib-ctl-focus"), sort: vis(".lib-ctl-sort"), glass: vis(".lib-filter-btn"),
      brass: getComputedStyle(bar.querySelector(".lib-ctl-sort")).backgroundColor === getComputedStyle(document.querySelector("#menu-toggle")).backgroundColor,
      glass_last: !!document.querySelector(".topbar-row .lib-filter-btn") };
    tb.querySelector(".lib-filter-btn").click(); await until(() => tb.querySelector(".lib-filter-input"));
    const inp = tb.querySelector(".lib-filter-input");
    inp.value = "Al"; inp.dispatchEvent(new Event("input"));
    // The title gives the field its place in the bar; on a phone it is the page's heading, out of the field's way.
    await until(() => out.touch ? $("album-grid").querySelectorAll(".album").length : getComputedStyle($("album-count")).display === "none");
    out.lib_open = { focus: vis(".lib-ctl-focus"), sort: vis(".lib-ctl-sort"), title: getComputedStyle($("album-count")).display === "none", value: tb.querySelector(".lib-filter-input").value };
    tb.querySelector(".lib-filter-clear").click(); await until(() => (tb.querySelector(".lib-filter-input") || {}).value === "");
    out.lib_cleared = { open: !!tb.querySelector(".lib-filter-input"), value: (tb.querySelector(".lib-filter-input") || {}).value };
    tb.querySelector(".lib-filter-clear").click(); await until(() => !tb.querySelector(".lib-filter-input"));
    out.lib_closed = { open: !!tb.querySelector(".lib-filter-input"), focus: vis(".lib-ctl-focus"), sort: vis(".lib-ctl-sort") };
    window.__showArtistAlbums("Artist A");
    await until(() => / · /.test(title()));
    out.lib_in_artist = shown("library-controls");
    $("topbar-back").click(); await until(() => !/ · /.test(title()) && shown("library-controls"));
    out.lib_back = shown("library-controls");
    $("topbar-back").click(); await until(() => shown("home-view") && !shown("library-controls"));
    out.lib_home = shown("library-controls");
  }

  window.__showArtistAlbums("Artist A");
  await until(() => / · /.test(title()));
  out.artist = { title: title(), above: $("content-count").classList.contains("hidden") ? "" : $("content-count").textContent.trim() };

  window.__uiPrefs.set("layout", "2"); await until(() => cols() === 2);
  out.two = cols();
  window.__uiPrefs.set("layout", "list"); await until(() => $("album-grid").classList.contains("as-list"));
  out.list = $("album-grid").classList.contains("as-list");
  window.__uiPrefs.set("layout", "auto"); window.__uiPrefs.set("tile", "1.5"); await until(() => !$("album-grid").classList.contains("as-list") && cols() === 2);
  out.bigger_tiles_cols = cols();
  window.__uiPrefs.set("tile", "1"); const before = parseFloat(getComputedStyle(document.querySelector("#album-grid .album-title")).fontSize);
  const textSize = () => parseFloat(getComputedStyle(document.querySelector("#album-grid .album-title")).fontSize);
  window.__uiPrefs.set("text", "1.5"); await until(() => textSize() !== before);
  out.text_ratio = textSize() / before;
  window.__uiPrefs.set("text", "1");
  document.querySelector('.settings-nav-item[data-pane="ui"]').click(); await until(() => document.querySelectorAll('.settings-pane[data-pane="ui"] select').length >= 5);
  out.pane = [...document.querySelectorAll('.settings-pane[data-pane="ui"] select')].map(x => x.id + "=" + x.value);
  const lay = $("ui-layout-select"); lay.value = "2"; lay.dispatchEvent(new Event("change"));
  out.pane_sets = window.__uiPrefs.get("layout") + " " + getComputedStyle($("album-grid")).gridTemplateColumns.split(" ").length;
  lay.value = "auto"; lay.dispatchEvent(new Event("change"));
  const drawerW = () => document.querySelector(".menu-drawer").getBoundingClientRect().width;
  $("menu-toggle").click(); await menuIn(); const w0 = drawerW(); document.querySelector(".menu-backdrop").click(); await menuOut();
  const mn = $("ui-menu-select"); mn.value = "1.5"; mn.dispatchEvent(new Event("change"));
  $("menu-toggle").click(); await menuIn();
  out.menu_zoom = getComputedStyle(document.querySelector(".menu-drawer > *")).zoom;
  out.menu_drawer_same = Math.abs(drawerW() - w0) < 1;
  document.querySelector(".menu-backdrop").click(); await menuOut();
  mn.value = "1"; mn.dispatchEvent(new Event("change"));
  $("topbar-back").click(); await until(() => shown("home-view") && title() === "");
  out.title_after = title();
  return out;
})()`;

test("labels search and order, the artist title, and UI Settings, in a browser", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
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
    assert.deepEqual(r.back_early, { title: "Labels", labels: 2 }, "a label's albums that come after ‹ don't cover the Labels list");
    assert.equal(r.has_library, true, "Home has its Library row");
    assert.equal(r.touch, true, "a phone has the touch layout");
    assert.deepEqual(r.lib, { in_topbar: true, focus: true, sort: true, glass: false, brass: true, glass_last: true }, "the glass gives way to Search in the row");
    assert.deepEqual(r.lib_open, { focus: true, sort: true, title: false, value: "Al" }, "the field opens in the bar's row; on a phone the title, the page's heading, stays; Focus and Sort stay in theirs");
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
    assert.deepEqual(r.pane, ["ui-text-select=1", "ui-title-select=1", "ui-menu-select=1", "ui-layout-select=auto", "ui-tile-select=1"]);
    assert.equal(r.menu_zoom, "1.5", "Menu & Home Screen text scales the side menu");
    assert.equal(r.menu_drawer_same, true, "and the drawer keeps its width");
    assert.equal(r.pane_sets, "2 2", "a choice in the pane lays the wall out");
    assert.equal(r.title_after, "", "Home has no title");
  } finally {
    await srv.stop();
  }
});

// The Library wall's top bar at a phone's two common widths, a tablet either
// way up and a desktop: everything fits inside the screen without overlapping,
// the bar keeps one height with the field open or shut, the glass is round,
// and the title shows from 480px up (as Rouen v1.8.78 has it). On a phone or a
// tablet (the touch layout, v0.9.6): no glass (Search in the row along the
// foot opens the field), Focus and Sort up in ‹'s line on the right.
const SIZES_DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  document.getElementById("home-library-title").click();
  await until(() => document.querySelector(".topbar #library-controls:not(.hidden) .lib-ctl-sort"));
  // Its layout settled (the bar's buttons in) before it is measured.
  await sleep(200);
  const box = sel => { const b = document.querySelector(sel).getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width, h: b.height, t: b.top, b: b.bottom }; };
  const title = document.getElementById("album-count");
  const touch = getComputedStyle(document.getElementById("touch-nav")).display !== "none";
  const out = { vw: innerWidth, touch, back: box("#topbar-back"), focus: box(".lib-ctl-focus"), sort: box(".lib-ctl-sort"), glass: box(".lib-filter-btn"),
    title_shown: getComputedStyle(title).display !== "none", title: box("#album-count"), bar: box(".topbar").h };
  (touch ? document.getElementById("tnav-search") : document.querySelector(".lib-filter-btn")).click();
  await until(() => document.querySelector(".lib-filter-box"));
  out.open = { field: box(".lib-filter-box"), bar: box(".topbar").h, focus: box(".lib-ctl-focus"), sort: box(".lib-ctl-sort") };
  return out;
})()`;

test("the Library's controls under the top bar on phones, tablets and desktops", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const PORT2 = ports.port();
  const srv = createServer({ port: PORT2, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  const B2 = "http://127.0.0.1:" + PORT2;
  try {
    const token = await signIn(B2);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 100; i++) {
      const s = await (await fetch(B2 + "/api/status", { headers: H })).json();
      if (s.index_count >= 3 && !s.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    for (const size of [{ width: 360, height: 760 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1180, height: 820 }, { width: 1440, height: 900, mouse: true }]) {
      const b = await Browser.launch(size);
      let r;
      try {
        const page = await b.page(B2 + "/", { cookies: [{ name: "musicd_session", value: token, url: B2 }] });
        r = await page.eval(SIZES_DRIVER);
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
      const at = size.width + "px";
      assert.equal(r.touch, !size.mouse, at + ": the touch layout on a phone and a tablet, not a desktop");
      if (r.touch) {
        const mid = x => (x.t + x.b) / 2;
        assert.ok(Math.abs(mid(r.focus) - mid(r.back)) <= 2 && Math.abs(mid(r.sort) - mid(r.back)) <= 2, at + ": Focus and Sort up in ‹'s line");
        assert.ok(r.back.r <= r.focus.l && r.focus.r <= r.sort.l && r.sort.r <= r.vw && r.sort.r >= r.vw - 24, at + ": ‹ on the left, then Focus and Sort on the right, not overlapping");
        assert.equal(r.glass.w, 0, at + ": no glass: Search in the row opens the field");
        assert.ok(r.focus.w > 50, at + ": Focus keeps its word");
        assert.ok(r.focus.h <= 36 && r.focus.h < r.back.h, at + ": the pills are smaller than the bar's buttons");
        assert.equal(r.title_shown, true, at + ": the title shows, as the page's heading");
        assert.ok(r.open.field.r <= r.vw && r.open.field.w > 150, at + ": the field takes the room");
        assert.ok(r.open.focus.w > 0 && r.open.sort.w > 0 && r.open.focus.t >= r.open.field.b - 1, at + ": Focus and Sort stay, under the field");
        continue;
      }
      assert.ok(r.focus.t >= r.back.b - 1, at + ": Focus and Sort sit in their own row under the bar's");
      assert.ok(r.focus.r <= r.sort.l, at + ": Focus then Sort, not overlapping");
      assert.ok(r.back.r <= r.glass.l && r.glass.b <= r.focus.t + 1, at + ": the glass is in the bar's row, right of Back");
      assert.ok(r.glass.r <= r.vw, at + ": the glass is on the screen");
      assert.ok(Math.abs(r.glass.w - r.glass.h) < 1 && Math.abs(r.glass.h - r.back.h) < 1, at + ": the glass is round, the bar's size");
      assert.ok(r.focus.w > 50, at + ": Focus keeps its word");
      assert.ok(r.focus.h <= 36 && r.focus.h < r.back.h, at + ": the pills are smaller than the bar's buttons");
      assert.equal(r.title_shown, true, at + ": the title shows at every width");
      assert.equal(r.open.bar, r.bar, at + ": opening the field doesn't change the bar's height");
      assert.ok(r.open.field.r <= r.vw && r.open.field.w > 150, at + ": the field takes the room");
    }
  } finally {
    await srv.stop();
  }
});
