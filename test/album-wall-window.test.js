"use strict";
/*
 * The Library wall drawn a window at a time (audit W-M7, stage 3;
 * public/app/library-window.js). The wall added 60 tiles a page and never took
 * one away, so at Z a big library was every album in the page. Now the albums
 * are data and only the rows near the view are tiles. A library of 3,000
 * albums (the page's /api/library/albums answered in the page, paged as the
 * server pages it) scrolled to its end is a few hundred tiles, not 3,000;
 * back at the top the first album is there; a selection survives being
 * scrolled away from; the album page steps to the next album from the data;
 * Back from an artist lands where the wall was; and a change of columns (the
 * window resized, UI Settings' tile size) keeps the first album seen in view.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const N = 3000;

// The library's albums, answered in the page: 3,000, every seventh with a title long enough to take two lines.
const INIT = `(() => {
  const name = i => "Album " + String(i).padStart(4, "0") + (i % 7 === 3 ? " — a title long enough to wrap onto a second line of the tile" : "");
  const albums = Array.from({ length: ${N} }, (_, i) => ({ offset: i, title: name(i), subtitle: "Artist " + (i % 50) }));
  const real = window.fetch;
  window.fetch = function (u, o) {
    const s = typeof u === "string" ? u : (u && u.url) || "";
    if (s.indexOf("/api/library/albums?") >= 0) {
      const q = new URL(s, location.href).searchParams;
      const off = parseInt(q.get("offset") || "0", 10), count = parseInt(q.get("count") || "60", 10);
      const body = JSON.stringify({ albums: albums.slice(off, off + count), total: albums.length });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    }
    return real.apply(this, arguments);
  };
})();`;

const KIT = `const sleep = ms => new Promise(r => setTimeout(r, ms));
  const frames = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30))));
  const until = async (fn, what, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("not there in time: " + what); await sleep(50); } };
  const main = document.querySelector("main");
  const tiles = () => [...document.querySelectorAll("#album-grid .album")];
  const num = t => parseInt((t.querySelector(".album-title") || {}).textContent.slice(6, 10), 10);
  const tileOf = i => tiles().find(t => num(t) === i);
  // The first album seen: the first tile whose bottom is below the top bar.
  const viewTop = () => main.getBoundingClientRect().top + parseFloat(getComputedStyle(main).paddingTop);
  const firstSeen = () => { const top = viewTop(); const t = tiles().find(t => t.getBoundingClientRect().bottom > top); return t ? num(t) : -1; };
  const inView = i => { const t = tileOf(i); if (!t) return false; const r = t.getBoundingClientRect(), m = main.getBoundingClientRect(); return r.bottom > m.top && r.top < m.bottom; };
  // Scrolled down until album [i] is drawn (more pages asked for on the way), then to it.
  const reach = async (i) => {
    await until(async () => { if (tileOf(i)) return true; main.scrollTop += main.clientHeight; await frames(); return false; }, "album " + i, 60000);
    tileOf(i).scrollIntoView({ block: "center" }); await frames(); await frames();
  };
  const cols = () => getComputedStyle(document.getElementById("album-grid")).gridTemplateColumns.split(" ").length;`;

test("the Library wall: only the rows near the view are tiles, and the wall works as before", { skip, timeout: 400000 }, async (t) => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token };
  const t0 = Date.now();
  while ((await (await fetch(B + "/api/status", { headers: H })).json()).index_count !== 3) {
    if (Date.now() - t0 > 60000) throw new Error("the library wasn't indexed");
    await new Promise(r => setTimeout(r, 200));
  }
  // Without a mouse (a touch screen: `content-visibility` on a wall's tiles, style.css), then with one (a desktop).
  for (const mouse of [false, true]) {
    await t.test(mouse ? "with a mouse" : "without a mouse", async (t) => {
      const b = await Browser.launch({ width: 1280, height: 800, mouse });
      t.after(() => b.close());
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT });
      await wall(t, page);
    });
  }
});

/** The wall's checks, in one tab. */
async function wall(t, page) {
  await t.test("scrolled to its end, the wall of 3,000 is at most about 400 tiles", async () => {
    const r = await page.eval(`(async () => {
      ${KIT}
      // The page started (Home's Library row drawn), then the wall opened.
      await until(() => document.querySelector("#home-library .album"), "Home's Library row");
      await sleep(1500);
      window.__showLibraryWall();
      await until(() => tileOf(0), "the wall's first album");
      await until(async () => { main.scrollTop = main.scrollHeight; await frames(); return tileOf(${N - 1}); }, "the wall's last album", 120000);
      await frames();
      return { tiles: tiles().length, last: !!tileOf(${N - 1}), cols: cols() };
    })()`);
    assert.equal(r.last, true, "the last album is drawn");
    assert.equal(r.cols, 9, "a desktop's nine columns");
    assert.ok(r.tiles <= 400, "tiles in the page at the end of 3,000 albums: " + r.tiles);
  });

  await t.test("back at the top, the first album is drawn", async () => {
    const r = await page.eval(`(async () => {
      ${KIT}
      main.scrollTop = 0; await frames(); await frames();
      return { first: num(tiles()[0]), seen: firstSeen(), top: main.scrollTop };
    })()`);
    assert.deepEqual(r, { first: 0, seen: 0, top: 0 });
  });

  await t.test("a selection made at the top survives scrolling away and back", async () => {
    const r = await page.eval(`(async () => {
      ${KIT}
      window.__enterAlbumSelectMode();
      tileOf(1).click(); tileOf(2).click(); await frames();
      const count = () => document.getElementById("select-count").textContent;
      const before = count();
      main.scrollTop = main.scrollHeight / 2; await frames(); await frames();
      const away = { count: count(), seen: firstSeen() > 100 };
      main.scrollTop = 0; await frames(); await frames();
      const out = { before, away, back: { one: tileOf(1).classList.contains("is-selected"), two: tileOf(2).classList.contains("is-selected"),
        zero: tileOf(0).classList.contains("is-selected"), count: count() } };
      window.__exitAlbumSelectMode();
      return out;
    })()`);
    assert.deepEqual(r, { before: "2", away: { count: "2", seen: true }, back: { one: true, two: true, zero: false, count: "2" } });
  });

  await t.test("Next on the album page from album 100 opens album 101", async () => {
    const r = await page.eval(`(async () => {
      ${KIT}
      await reach(100);
      tileOf(100).click();
      const modal = document.getElementById("album-modal"), title = document.getElementById("modal-title");
      await until(() => !modal.classList.contains("hidden") && /^Album 0100/.test(title.textContent), "album 100's page");
      document.getElementById("modal-next").click();
      await until(() => /^Album 0101/.test(title.textContent), "album 101's page", 5000).catch(() => {});
      const next = title.textContent;
      closeModal(); await frames();
      return next;
    })()`);
    assert.match(r, /^Album 0101/);
  });

  await t.test("Back from an artist's page keeps the wall's scroll and its first album seen", async () => {
    const r = await page.eval(`(async () => {
      ${KIT}
      await reach(1500);
      await sleep(300); await frames();
      const before = { top: main.scrollTop, seen: firstSeen() };
      window.__showArtistAlbums("Artist A");
      await until(() => !tileOf(before.seen), "the artist's page");
      await sleep(500);
      document.getElementById("topbar-back").click();
      await until(() => tileOf(before.seen), "the wall again");
      await frames(); await frames();
      return { before, after: { top: main.scrollTop, seen: firstSeen() } };
    })()`);
    assert.ok(r.before.seen > 1000, JSON.stringify(r));
    assert.ok(Math.abs(r.after.top - r.before.top) <= 2, "scrollTop kept: " + JSON.stringify(r));
    assert.equal(r.after.seen, r.before.seen, "the first album seen kept");
  });

  await t.test("a change of columns keeps the first album seen in view", async () => {
    const seen = await page.eval(`(async () => { ${KIT} await frames(); return firstSeen(); })()`);
    // Narrower: a tablet held sideways, seven columns.
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
    const resized = await page.eval(`(async () => { ${KIT} await sleep(300); await frames(); await frames(); return { cols: cols(), inView: inView(${seen}), seen: firstSeen(), tiles: tiles().length }; })()`);
    assert.equal(resized.cols, 7, JSON.stringify(resized));
    assert.ok(resized.inView, "album " + seen + " in view after the resize: " + JSON.stringify(resized));
    assert.ok(resized.tiles <= 400, "tiles: " + resized.tiles);
    // UI Settings' tile size: fewer, bigger columns.
    const seen2 = resized.seen;
    const sized = await page.eval(`(async () => { ${KIT} window.__uiPrefs.set("tile", "1.5"); await sleep(300); await frames(); await frames();
      const out = { cols: cols(), inView: inView(${seen2}) }; window.__uiPrefs.set("tile", "1"); return out; })()`);
    assert.ok(sized.cols < 7, JSON.stringify(sized));
    assert.ok(sized.inView, "album " + seen2 + " in view after the tile size changed: " + JSON.stringify(sized));
    assert.deepEqual(page.errors, []);
  });
}
