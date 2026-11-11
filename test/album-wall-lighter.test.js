"use strict";
/*
 * The album walls, lighter (audit W-M7, stages 1 and 2). Every tile's cover
 * was read back through a canvas once it loaded (getImageData) to set a
 * `--glow` nothing read, and every tile carried about ten listeners of its own
 * (its tap and nine for its long press). Now no cover is read back, and the
 * tiles' taps and long presses are one set of listeners on the document
 * (public/app/album-tile-press.js), which do what the tiles' own did: a tap
 * opens the album, a long press starts selecting with that tile picked (the
 * release's click eaten), a tap in selection picks and unpicks, a move cancels
 * the long press, and a tile has no context menu; on the Library wall and on
 * Home's rows alike.
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

// Counted from the page's first line: each canvas read-back, and each listener put on an album tile (on the tile itself).
const INIT = `(() => {
  window.__imageReads = 0;
  const read = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function () { window.__imageReads++; return read.apply(this, arguments); };
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function () {
    if (this instanceof Element && this.classList.contains("album")) this.__listeners = (this.__listeners || 0) + 1;
    return add.apply(this, arguments);
  };
})();`;

const UNTIL = `const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, what, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("not there in time: " + what); await sleep(50); } };
  const tileOf = (sel, title) => [...document.querySelectorAll(sel)].find(t => (t.querySelector(".album-title") || {}).textContent === title);`;

test("the album walls: no cover read back, no listeners on each tile, and a tile's tap and long press as they were", { skip, timeout: 120000 }, async (t) => {
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
  const b = await Browser.launch({ width: 1280, height: 800 });
  t.after(() => b.close());
  const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT });

  await t.test("the Library wall: Album One's cover loads and nothing reads it back", async () => {
    const r = await page.eval(`(async () => {
      ${UNTIL}
      await until(() => document.querySelector("#home-library .album"), "Home's Library row");
      window.__showLibraryWall();
      const tile = await until(() => tileOf("#album-grid .album", "Album One"), "Album One on the wall");
      const img = await until(() => tile.querySelector(".album-art-wrap img"), "its cover");
      await until(() => img.complete && img.naturalWidth > 0, "its cover loaded");
      await sleep(500);
      return { reads: window.__imageReads, width: img.naturalWidth, glow: tile.querySelector(".album-art-wrap").style.getPropertyValue("--glow") };
    })()`);
    assert.ok(r.width > 0, "the cover loaded");
    assert.equal(r.reads, 0, "no canvas read-back of a tile's cover");
    assert.equal(r.glow, "", "no --glow on the tile");
  });

  await t.test("the Library wall's tiles carry no listeners of their own", async () => {
    const r = await page.eval(`(async () => {
      ${UNTIL}
      const tiles = await until(() => { const a = [...document.querySelectorAll("#album-grid .album")]; return a.length >= 3 && a; }, "the wall's tiles");
      return { tiles: tiles.length, listeners: tiles.map(t => t.__listeners || 0) };
    })()`);
    assert.equal(r.tiles, 3);
    const total = r.listeners.reduce((a, n) => a + n, 0);
    assert.equal(total, 0, "listeners on the wall's " + r.tiles + " tiles: " + JSON.stringify(r.listeners));
  });

  await t.test("a tile's long press, tap in selection, context menu, and tap: as before", async () => {
    const r = await page.eval(`(async () => {
      ${UNTIL}
      const out = {};
      const one = tileOf("#album-grid .album", "Album One"), hi = tileOf("#album-grid .album", "Hi Res");
      const ev = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      // Held, then moved: no long press.
      ev(one, "mousedown"); await sleep(100); ev(one, "mousemove"); await sleep(700); ev(one, "mouseup");
      out.moved = { selecting: !!document.querySelector(".album.is-selected") };
      // Held: selecting, with the tile picked; the release's click eaten (it stays picked).
      ev(one, "mousedown"); await sleep(700); ev(one, "mouseup"); one.click(); await sleep(50);
      out.held = { one: one.classList.contains("is-selected"), modal: !document.getElementById("album-modal").classList.contains("hidden") };
      // A tap in selection picks another, a second unpicks it.
      hi.click(); await sleep(50); out.picked = hi.classList.contains("is-selected");
      hi.click(); await sleep(50); out.unpicked = !hi.classList.contains("is-selected");
      // No context menu on a tile.
      out.menu = !one.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      window.__exitAlbumSelectMode();
      // A tap opens the album, with its neighbours to step to.
      hi.click();
      await until(() => !document.getElementById("album-modal").classList.contains("hidden"), "the album's page");
      out.title = document.getElementById("modal-title").textContent;
      await until(() => !document.getElementById("modal-nav").classList.contains("hidden"), "the album page's previous and next");
      out.nav = true;
      return out;
    })()`);
    assert.deepEqual(r, { moved: { selecting: false }, held: { one: true, modal: false }, picked: true, unpicked: true, menu: true, title: "Hi Res", nav: true });
  });

  await t.test("on Home's rows the same: a long press picks, a tap opens", async () => {
    const r = await page.eval(`(async () => {
      ${UNTIL}
      if (window.__showHome) window.__showHome();
      const tile = await until(() => document.querySelector("#home-library .album"), "Home's Library row");
      const ev = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      ev(tile, "mousedown"); await sleep(700); ev(tile, "mouseup"); tile.click(); await sleep(50);
      const picked = tile.classList.contains("is-selected");
      window.__exitAlbumSelectMode();
      tile.click();
      await until(() => !document.getElementById("album-modal").classList.contains("hidden"), "the album's page");
      return { picked, listeners: tile.__listeners || 0 };
    })()`);
    assert.deepEqual(r, { picked: true, listeners: 0 });
    assert.deepEqual(page.errors, []);
  });
});
