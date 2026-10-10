"use strict";
/*
 * The page in a real browser (v0.6.2), at a desktop with a mouse, a phone
 * held upright and a tablet in landscape, against the real server and the
 * test library:
 *   - Home: Random Album and Album of the day under the greeting; "Not
 *     played in 6 months" hidden while it has nothing (v0.6.1);
 *   - the album view: × from 720px up, ‹ below, the cover below the corner
 *     buttons with previous/next on its centre line;
 *   - Now playing over an album: its corner button (×  on a desktop, ‹
 *     elsewhere), Escape and a click outside the reduced card all return to
 *     that album with its previous/next; with nothing under it, it closes;
 *   - Now playing reduced on a large screen, and the choice remembered;
 *   - the share card's × a brass disc; every ⓘ named for screen readers.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

// On CI (GitHub's runners carry Chrome) a missing browser is a failure, not
// a skip, so these checks can't quietly stop running.
const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

// Runs in the page: walks the screens and reports what it saw.
const DRIVER = `(async () => {
  const out = {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const box = (sel) => {
    const e = typeof sel === "string" ? document.querySelector(sel) : sel;
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { top: b.top, bottom: b.bottom, w: b.width, h: b.height, mid: b.top + b.height / 2, shown: getComputedStyle(e).display !== "none" && b.width > 0 };
  };
  const colour = v => { const p = document.createElement("span"); p.style.color = v; document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  await until(() => document.querySelector("#home-random .album") && document.querySelector("#home-today .home-aotd"));
  out.desktop_pointer = matchMedia("(hover: hover) and (pointer: fine)").matches;

  // Home.
  out.first_in_sections = document.getElementById("home-sections").firstElementChild.id;
  out.today = [...document.querySelectorAll("#home-today > *")].map(e => e.id || e.className);
  out.today_rows = getComputedStyle(document.getElementById("home-today")).gridTemplateRows.split(" ").length;
  out.unplayed_hidden = document.getElementById("home-unplayed").closest(".home-section").classList.contains("hidden");

  // The album view, opened from the middle of a row.
  const modal = document.getElementById("album-modal");
  const tiles = [...document.querySelectorAll("#home-random .album")];
  out.tiles = tiles.length;
  tiles[1].click();
  await until(() => !modal.classList.contains("hidden"));
  await sleep(300);
  const close = document.getElementById("modal-close-btn");
  out.close_label = close.getAttribute("aria-label");
  out.x = box(close.querySelector(".ico-close")).shown;
  out.chevron = box(close.querySelector(".ico-back")).shown;
  out.close = box(close); out.art = box(".modal-art"); out.prev = box("#modal-prev"); out.next = box("#modal-next");
  out.title = document.getElementById("modal-title").textContent;

  // Now playing over it.
  const np = () => window.__openAlbum({ title: "Now", subtitle: "Someone" }, { source: "now-playing" });
  const home = document.getElementById("modal-home-btn");
  const size = document.getElementById("modal-np-size-btn");
  const state = () => ({ hidden: modal.classList.contains("hidden"), np: modal.classList.contains("np-mode"),
    title: document.getElementById("modal-title").textContent, prev: box("#modal-prev").shown, next: box("#modal-next").shown });
  np(); await sleep(400);
  out.np_label = home.getAttribute("aria-label");
  out.np_x = box(home.querySelector(".ico-close")).shown;
  out.np_chevron = box(home.querySelector(".ico-back")).shown;
  out.size_shown = box(size).shown;
  out.full = box(".modal-panel");
  if (out.size_shown) {
    size.click(); await sleep(200);
    out.reduced = modal.classList.contains("np-reduced");
    out.size_label = size.getAttribute("aria-label");
    out.reduced_box = box(".modal-panel");
    out.stored = localStorage.getItem("rra-np-reduced");
    modal.querySelector(".modal-backdrop").click();
    await sleep(600);
    out.after_backdrop = state();
    localStorage.setItem("rra-np-reduced", "0");
    np(); await sleep(400);
    if (modal.classList.contains("np-reduced")) size.click();
  }
  home.click(); await sleep(600);
  out.after_back = state();
  np(); await sleep(400);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await sleep(600);
  out.after_escape = state();
  close.click(); await sleep(300);
  np(); await sleep(400);
  home.click(); await sleep(300);
  out.plain_closes = modal.classList.contains("hidden");

  const sc = document.querySelector(".share-close");
  out.share_close = sc ? { bg: getComputedStyle(sc).backgroundColor, radius: getComputedStyle(sc).borderTopLeftRadius } : null;
  out.accent = colour("var(--plum)");
  out.unnamed_info = [...document.querySelectorAll(".settings-info-btn")].filter(b => !/^About |^More information$/.test(b.getAttribute("aria-label") || "")).length;
  return out;
})()`;

test("the page in a browser: Home, the album view and Now playing at three sizes", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token };
  for (let i = 0; i < 100; i++) {
    const s = await (await fetch(B + "/api/status", { headers: H })).json();
    if (s.index_count >= 3 && !s.library_importing) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const run = async (size) => {
    const b = await Browser.launch(size);
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      const r = await page.eval(DRIVER);
      r.errors = page.errors;
      return r;
    } finally { await b.close(); }
  };
  try {
    const desk = await run({ width: 1440, height: 900, mouse: true });
    const phone = await run({ width: 390, height: 844 });
    const tablet = await run({ width: 1180, height: 820 });

    await t.test("no page errors", () => {
      for (const r of [desk, phone, tablet]) assert.deepEqual(r.errors, []);
    });

    await t.test("Home: Random Album and Album of the day under the greeting; Not played hidden while empty", () => {
      for (const r of [desk, phone, tablet]) {
        assert.equal(r.first_in_sections, "home-today", "the strip is the first thing in #home-sections");
        assert.deepEqual(r.today, ["home-unheard-tile", "album home-aotd"]);
        assert.equal(r.today_rows, 1, "one row, whatever the screen");
        assert.equal(r.unplayed_hidden, true, "no listening history yet: the row stays hidden");
      }
    });

    await t.test("the album view closes with × as a card, ‹ full screen on a phone", () => {
      assert.equal(desk.close_label, "Close"); assert.equal(desk.x, true); assert.equal(desk.chevron, false);
      assert.equal(tablet.close_label, "Close"); assert.equal(tablet.x, true);
      assert.equal(phone.close_label, "Back"); assert.equal(phone.x, false); assert.equal(phone.chevron, true);
    });

    await t.test("on a card the cover starts below the corner button, previous/next on its centre line", () => {
      for (const r of [desk, tablet]) {
        assert.ok(r.art.top >= r.close.bottom + 8, `cover at ${r.art.top}, the × ends at ${r.close.bottom}`);
        for (const k of ["prev", "next"]) {
          assert.equal(r[k].shown, true, k);
          assert.ok(Math.abs(r[k].mid - r.art.mid) <= 3, `${k} at ${r[k].mid}, the cover's middle at ${r.art.mid}`);
        }
      }
    });

    await t.test("Now playing's corner button: × on a desktop, ‹ on a phone or a tablet", () => {
      assert.equal(desk.desktop_pointer, true, "the desktop run saw no mouse, so it measures nothing");
      assert.equal(desk.np_label, "Close"); assert.equal(desk.np_x, true); assert.equal(desk.np_chevron, false);
      for (const r of [phone, tablet]) {
        assert.equal(r.desktop_pointer, false);
        assert.equal(r.np_label, "Back"); assert.equal(r.np_x, false); assert.equal(r.np_chevron, true);
      }
    });

    await t.test("Back, Escape and a click outside the reduced card return to the album, previous/next intact", () => {
      for (const r of [desk, phone, tablet]) {
        for (const k of ["after_back", "after_escape"]) {
          assert.deepEqual(r[k], { hidden: false, np: false, title: r.title, prev: true, next: true }, k);
        }
        assert.equal(r.plain_closes, true, "with nothing under it, Back just closes");
      }
      assert.deepEqual(desk.after_backdrop, { hidden: false, np: false, title: desk.title, prev: true, next: true });
    });

    await t.test("Now playing reduces to the album card's size on a large screen, and remembers", () => {
      assert.equal(desk.size_shown, true);
      assert.equal(desk.reduced, true);
      assert.equal(desk.size_label, "Full size");
      assert.ok(desk.reduced_box.w <= 960.5 && desk.reduced_box.w < desk.full.w, String(desk.reduced_box.w));
      assert.ok(desk.reduced_box.h > 300, "the card collapsed to " + desk.reduced_box.h);
      assert.equal(desk.stored, "1");
      assert.equal(phone.size_shown, false);
      assert.equal(tablet.size_shown, false, "1180×820 is under the large-screen size");
    });

    await t.test("the share card's × is a brass disc; every ⓘ has a name", () => {
      for (const r of [desk, phone]) {
        assert.ok(r.share_close);
        assert.equal(r.share_close.bg, r.accent);
        assert.equal(r.share_close.radius, "50%");
        assert.equal(r.unnamed_info, 0);
      }
    });
  } finally {
    await srv.stop();
  }
});
