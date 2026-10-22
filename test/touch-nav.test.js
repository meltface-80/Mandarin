"use strict";
/*
 * touch-nav.test.js — the touch layout (v0.9.6; public/touchnav.js, the
 * "touch layout" section of style.css), in a browser at a phone's and a
 * tablet's sizes, both ways round, and a desktop's:
 *   - along the foot: Menu, Home, Library, Artists and Search, in that order, the
 *     mini player above them; on Home no top bar, the greeting at the top;
 *   - Search opens the top bar again, the field across it, and the page
 *     moves down under it; the results are not under it;
 *   - Library opens the Library wall; Home, from an album's page, closes it
 *     and shows Home; Menu opens the side menu;
 *   - the grid screens have no strip: their buttons float where they were,
 *     their title is the page's heading; on the Library, Focus and Sort are
 *     up in ‹'s line on the right, its glass gone, and Search opens its
 *     filter with the strip back under the field; the Labels list the same
 *     (#–Z alone on the right, Search finds a label); the Artists wall the
 *     same (Sort alone on the right, Search finds an artist), Artists lit;
 *   - the five buttons evenly across; Offline is a pill at the top of the
 *     screen, in the middle, over everything, for as long as it lasts (bug
 *     list item 134), and the row doesn't move when it comes; the scan's
 *     progress a line along the top edge;
 *   - while a field has the keyboard, in the Android app (android.css) the
 *     row and the mini player give way; a browser's keyboard goes over them;
 *     Now playing has no row;
 *   - a desktop (a mouse) keeps its top bar and never shows the row.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

// The Android app's own rules, as the server adds them to style.css for it.
const ANDROID_CSS = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "android.css"), "utf8");

const DRIVER = `(async () => {
  const ANDROID_CSS = ${JSON.stringify(ANDROID_CSS)};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const until = async (f, what, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("not in time: " + what); await sleep(30); } };
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const box = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
  const shown = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const html = document.documentElement;
  await until(() => document.querySelector("#home-view .album"), "Home's albums");
  await until(() => !$("mini-transport").classList.contains("hidden"), "the mini player");
  await frame();
  const out = { viewport: [innerWidth, innerHeight] };
  const nav = $("touch-nav");
  out.nav = shown(nav);
  out.menuInBar = shown($("menu-toggle"));
  if (!out.nav) return out;   // a desktop: nothing more to see

  // Home: the row in order, the mini player above it, no top bar.
  out.order = [...nav.querySelectorAll(".tnav-btn")].map(b => b.textContent.trim());
  out.navBox = box(nav);
  out.mini = box($("mini-transport"));
  out.topbarRow = shown(document.querySelector(".topbar-row"));
  out.greeting = box(document.querySelector("#home-view .home-greeting, #home-view"));
  out.homeOn = html.classList.contains("tn-home") && getComputedStyle($("tnav-home")).color;
  out.libraryColour = getComputedStyle($("tnav-library")).color;

  // The row evenly across. Offline: the pill at the top, over everything. The scan: a line along the top.
  out.row = [...nav.querySelectorAll(".tnav-btn")].map(b => { const r = b.getBoundingClientRect(); return [r.left, r.width]; });
  out.offlineHidden = !shown($("offline-toast"));
  const rowBefore = [...nav.querySelectorAll(".tnav-btn")].map(box);
  $("offline-btn").classList.remove("hidden"); await frame();
  out.offline = box($("offline-toast"));
  { const t = out.offline, at = document.elementFromPoint(t.l + t.w / 2, t.t + t.h / 2); out.offlineOnTop = !!at && $("offline-toast").contains(at); }
  out.rowStill = JSON.stringify([...nav.querySelectorAll(".tnav-btn")].map(box)) === JSON.stringify(rowBefore);
  $("offline-btn").classList.add("hidden");
  $("scan-progress-bar").classList.remove("hidden"); await frame();
  out.scan = box($("scan-progress-bar"));
  $("scan-progress-bar").classList.add("hidden");

  // Search: the top bar back, the field across it, the page moved down under it.
  $("tnav-search").click();
  await until(() => html.classList.contains("tn-search"), "the search open");
  await frame(); await sleep(100);
  out.searchTopbar = box(document.querySelector(".topbar"));
  out.searchField = box($("search-row"));
  const input = $("search-input");
  input.value = "Album"; input.dispatchEvent(new Event("input", { bubbles: true }));
  const first = await until(() => [...document.querySelectorAll("#album-grid .album, #search-results .album, main .album")].find(a => shown(a) && a.closest("#home-view") === null), "a result");
  await frame();
  out.result = box(first);
  // The keyboard up in the Android app (its WebView shrinks the page above the keys; the
  // server adds android.css for it): the row and the mini player give way. In a browser the
  // keyboard goes over them, so they stay.
  html.classList.add("is-typing"); await frame();
  out.typingBrowser = shown(nav) && shown($("mini-transport"));
  const app = document.createElement("style"); app.textContent = ANDROID_CSS; document.head.appendChild(app); await frame();
  out.typingNav = shown(nav); out.typingMini = shown($("mini-transport"));
  app.remove(); html.classList.remove("is-typing");
  $("search-clear").click(); document.body.click(); await frame();

  // Library: the Library wall, its button lit.
  $("tnav-library").click();
  await until(() => html.classList.contains("tn-lib"), "the Library wall");
  await until(() => document.querySelector("#album-grid .album"), "the Library's albums");
  out.libOn = getComputedStyle($("tnav-library")).color;
  out.homeOff = getComputedStyle($("tnav-home")).color;

  // The grid screens: no strip, the buttons over the albums, the title the page's heading.
  const bg = el => getComputedStyle(el).backgroundColor;
  out.libStrip = bg(document.querySelector(".topbar"));
  out.libHeading = !!document.querySelector("main #album-count") && $("album-count").textContent;
  out.libBack = box($("topbar-back"));
  const focus = document.querySelector(".library-controls .lib-ctl-focus"), sort = document.querySelector(".library-controls .lib-ctl-sort");
  out.libFocus = focus && box(focus); out.libSort = sort && box(sort);
  out.libGlass = shown(document.querySelector("#library-filter .lib-filter-btn"));
  out.libTitle = box($("album-count"));
  // Search on the Library: its filter ("starts with"), the strip back for its field.
  $("tnav-search").click();
  await until(() => html.classList.contains("tn-filter") && document.querySelector("#library-filter .lib-filter-input"), "the Library's filter");
  await frame();
  out.filterStrip = bg(document.querySelector(".topbar"));
  out.filterField = box(document.querySelector("#library-filter .lib-filter-input"));
  out.filterSearchOn = getComputedStyle($("tnav-search")).color;
  // Focus and Sort stay where they float, the field over them (v0.9.7: they dropped into a row under it).
  // (Opening it draws the controls again: found afresh.)
  out.filterFocus = box(document.querySelector(".library-controls .lib-ctl-focus")); out.filterSort = box(document.querySelector(".library-controls .lib-ctl-sort"));
  { const c = out.filterSort, at = document.elementFromPoint(c.l + c.w / 2, c.t + c.h / 2); out.filterCovers = !!at && !!at.closest("#library-filter"); }
  // Random albums: its Shuffle floats, its title the heading.
  window.__showHome(); await until(() => html.classList.contains("tn-home"), "Home");
  $("home-random-title").click();
  await until(() => !html.classList.contains("tn-home") && shown($("topbar-refresh")) && $("album-count").textContent, "Random albums");
  await frame();
  out.randomStrip = bg(document.querySelector(".topbar"));
  out.randomShuffle = box($("topbar-refresh"));
  out.randomTitle = [$("album-count").textContent, box($("album-count"))];

  // The Labels list: as the Library, its glass gone, #–Z on the right in ‹'s line, Search finds a label.
  window.__showHome(); await until(() => html.classList.contains("tn-home"), "Home");
  $("labels-toggle").click();
  await until(() => html.classList.contains("tn-labels"), "the Labels list");
  await frame();
  out.labelsStrip = bg(document.querySelector(".topbar"));
  out.labelsGlass = shown($("labels-search-btn"));
  out.labelsOrder = box($("labels-sort-btn")); out.labelsBack = box($("topbar-back"));
  $("tnav-search").click();
  await until(() => html.classList.contains("tn-filter") && document.activeElement === $("labels-search-input"), "Find a label");
  await frame();
  out.labelsSearchStrip = bg(document.querySelector(".topbar"));
  $("labels-search-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // Artists (bug list item 130): the Artists wall, its button lit; Sort on the right in ‹'s line, Search finds an artist.
  $("tnav-artists").click();
  await until(() => html.classList.contains("tn-artists"), "the Artists wall");
  await until(() => document.querySelector("#album-grid .artist-tile"), "the artists");
  await frame();
  out.artistsOn = getComputedStyle($("tnav-artists")).color;
  out.artistsHomeOff = getComputedStyle($("tnav-home")).color;
  out.artistsStrip = bg(document.querySelector(".topbar"));
  out.artistsGlass = shown($("artists-search-btn"));
  out.artistsSort = box($("artists-sort-btn")); out.artistsBack = box($("topbar-back"));
  out.artistsHeading = $("album-count").textContent;
  out.artistsRound = getComputedStyle(document.querySelector("#album-grid .artist-tile .album-art-wrap")).borderTopLeftRadius;
  $("tnav-search").click();
  await until(() => html.classList.contains("tn-filter") && document.activeElement === $("artists-find-input"), "Find an artist");
  await frame();
  out.artistsSearchStrip = bg(document.querySelector(".topbar"));
  $("artists-find-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

  // Home from an album's page: the page closes, Home shows.
  const al = (await (await fetch("/api/library/albums?sort=album")).json()).albums[0];
  window.__openAlbum(al, { source: "home", filter: null });
  await until(() => !$("album-modal").classList.contains("hidden") && $("modal-tracks").querySelectorAll("li").length, "the album's page");
  await frame();
  out.navOverAlbum = shown(nav) && document.elementFromPoint(out.home.l + out.home.w / 2, out.home.t + out.home.h / 2) && $("tnav-home").contains(document.elementFromPoint(out.home.l + out.home.w / 2, out.home.t + out.home.h / 2));
  $("tnav-home").click();
  await until(() => $("album-modal").classList.contains("hidden") && html.classList.contains("tn-home"), "Home, the album's page closed");

  // Menu: the side menu.
  $("tnav-menu").click();
  out.menu = !!(await until(() => { const m = document.getElementById("menu-overlay"); return m && !m.classList.contains("hidden") && shown(m); }, "the side menu"));
  document.querySelector("#menu-overlay [data-close], #menu-overlay .menu-backdrop")?.click();

  // Now playing: no row.
  const m = $("album-modal"); m.classList.remove("hidden"); m.classList.add("np-mode", "tab-album"); await frame();
  out.npNav = shown(nav);
  m.classList.add("hidden"); m.classList.remove("np-mode", "tab-album");
  return out;
})()`;

test("the touch layout: Menu, Home, Library, Artists and Search along the foot on a phone and a tablet; a desktop as it was", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json(); if (st.index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    for (const [w, h, touch] of [[390, 844, true], [844, 390, true], [820, 1180, true], [1180, 820, true], [1440, 900, false]]) {
      const size = `${w}x${h}${touch ? "" : " (a mouse)"}`;
      const b = await Browser.launch({ width: w, height: h, mouse: !touch });
      let r;
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch });
        r = await page.eval(DRIVER);
        assert.deepEqual(page.errors, [], size);
      } finally { await b.close(); }
      if (!touch) {
        assert.equal(r.nav, false, size + ": a desktop has no row");
        assert.equal(r.menuInBar, true, size + ": its menu is in the top bar, as before");
        continue;
      }
      assert.equal(r.nav, true, size + ": the row is shown");
      assert.equal(r.menuInBar, false, size + ": the menu is in the row, not the top bar");
      assert.deepEqual(r.order, ["Menu", "Home", "Library", "Artists", "Search"], size);
      assert.ok(r.navBox.b === h && r.navBox.l === 0 && r.navBox.r === w, `${size}: along the foot, edge to edge (${JSON.stringify(r.navBox)})`);
      assert.ok(r.mini.b <= r.navBox.t, `${size}: the mini player above the row (${r.mini.b} over ${r.navBox.t})`);
      assert.equal(r.topbarRow, false, size + ": on Home, no top bar");
      assert.ok(r.greeting.t < 40, `${size}: the greeting at the top (${r.greeting.t})`);
      assert.ok(r.homeOn && r.homeOn !== r.libraryColour, size + ": Home lit on Home");
      assert.equal(r.offlineHidden, true, size + ": no Offline sign while online");
      const widths = r.row.map(x => x[1]), steps = r.row.slice(1).map((x, i) => x[0] - r.row[i][0]);
      assert.ok(Math.max(...widths) - Math.min(...widths) < 1 && Math.max(...steps) - Math.min(...steps) < 1, `${size}: the five buttons evenly across (${JSON.stringify(r.row)})`);
      assert.ok(r.offline.t <= 20 && Math.abs((r.offline.l + r.offline.r) / 2 - w / 2) <= 1 && r.offline.h <= 40, `${size}: Offline a pill at the top, in the middle (${JSON.stringify(r.offline)})`);
      assert.equal(r.offlineOnTop, true, size + ": the pill over what is under it");
      assert.equal(r.rowStill, true, size + ": the buttons don't move when Offline comes");
      assert.ok(r.scan.t === 0 && r.scan.h <= 4 && r.scan.w === w, `${size}: the scan's line along the top (${JSON.stringify(r.scan)})`);
      assert.ok(r.searchField.w >= w - 60, `${size}: the search field across the screen (${r.searchField.w} of ${w})`);
      assert.ok(r.searchTopbar.t === 0 && r.searchTopbar.h > 30, `${size}: the top bar back with the search (${JSON.stringify(r.searchTopbar)})`);
      assert.ok(r.result.t >= r.searchTopbar.b, `${size}: the results under the top bar, not behind it (${r.result.t} vs ${r.searchTopbar.b})`);
      assert.equal(r.typingBrowser, true, size + ": in a browser the keyboard goes over the row and the mini player");
      assert.equal(r.typingNav, false, size + ": in the app, the keyboard up, the row gives way");
      assert.equal(r.typingMini, false, size + ": in the app, the keyboard up, the mini player gives way");
      assert.ok(r.libOn !== r.homeOff, size + ": Library lit on the Library wall");
      // The grid screens.
      const clear = c => c === "rgba(0, 0, 0, 0)" || c === "transparent";
      assert.ok(clear(r.libStrip), size + ": the Library has no strip: " + r.libStrip);
      assert.match(String(r.libHeading), /^Library/, size + ": its title the page's heading");
      assert.ok(r.libTitle.t >= r.libBack.b, `${size}: the heading under the buttons (${r.libTitle.t} vs ${r.libBack.b})`);
      assert.ok(r.libBack.l < 30 && r.libBack.t < 30, `${size}: ‹ where it was, top left (${JSON.stringify(r.libBack)})`);
      assert.ok(r.libFocus && r.libSort, size + ": Focus and Sort are there");
      assert.ok(Math.abs((r.libFocus.t + r.libFocus.b) / 2 - (r.libBack.t + r.libBack.b) / 2) <= 2 && Math.abs((r.libSort.t + r.libSort.b) / 2 - (r.libBack.t + r.libBack.b) / 2) <= 2,
        `${size}: Focus and Sort up in ‹'s line (${JSON.stringify([r.libBack, r.libFocus, r.libSort])})`);
      assert.ok(r.libSort.r >= w - 24 && r.libFocus.r <= r.libSort.l, `${size}: on the right, Focus then Sort`);
      assert.equal(r.libGlass, false, size + ": the Library's glass gives way to Search in the row");
      assert.ok(!clear(r.filterStrip), size + ": the filter open, the strip is back under its field");
      assert.ok(r.filterField.w > w / 2, `${size}: the filter's field across the bar (${r.filterField.w})`);
      assert.deepEqual([r.filterFocus.t, r.filterSort.t], [r.libFocus.t, r.libSort.t], size + ": Focus and Sort don't move when the filter opens");
      assert.equal(r.filterCovers, true, size + ": the field covers them");
      assert.ok(r.filterSearchOn !== r.homeOff, size + ": Search lit while the filter is open");
      assert.ok(clear(r.randomStrip), size + ": Random albums has no strip either");
      assert.ok(r.randomShuffle.r >= w - 24 && r.randomShuffle.t < 30, `${size}: its Shuffle floats where it was (${JSON.stringify(r.randomShuffle)})`);
      assert.equal(r.randomTitle[0], "Random albums");
      assert.ok(r.randomTitle[1].t >= r.randomShuffle.b, size + ": its title the heading, under the buttons");
      assert.ok(clear(r.labelsStrip), size + ": the Labels list has no strip");
      assert.equal(r.labelsGlass, false, size + ": the Labels list's glass gives way to Search in the row");
      assert.ok(r.labelsOrder.r >= w - 24 && Math.abs((r.labelsOrder.t + r.labelsOrder.b) / 2 - (r.labelsBack.t + r.labelsBack.b) / 2) <= 2,
        `${size}: #–Z on the right, in ‹'s line (${JSON.stringify([r.labelsBack, r.labelsOrder])})`);
      assert.ok(!clear(r.labelsSearchStrip), size + ": Search finds a label, the strip back under the field");
      assert.ok(r.artistsOn !== r.artistsHomeOff, size + ": Artists lit on the Artists wall");
      assert.ok(clear(r.artistsStrip), size + ": the Artists wall has no strip");
      assert.match(r.artistsHeading, /^Artists · \d+$/, size + ": its title, with how many, the heading");
      assert.equal(r.artistsRound, "50%", size + ": the artists' pictures round");
      assert.equal(r.artistsGlass, false, size + ": the Artists wall's glass gives way to Search in the row");
      assert.ok(r.artistsSort.r >= w - 24 && Math.abs((r.artistsSort.t + r.artistsSort.b) / 2 - (r.artistsBack.t + r.artistsBack.b) / 2) <= 2,
        `${size}: Sort on the right, in ‹'s line (${JSON.stringify([r.artistsBack, r.artistsSort])})`);
      assert.ok(!clear(r.artistsSearchStrip), size + ": Search finds an artist, the strip back under the field");
      assert.ok(r.navOverAlbum, size + ": the row over an album's page, Home tappable there");
      assert.equal(r.menu, true, size + ": Menu opens the side menu");
      assert.equal(r.npNav, false, size + ": Now playing has no row");
    }
  } finally { await srv.stop(); }
});
