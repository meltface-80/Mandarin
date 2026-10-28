"use strict";
/*
 * The album view beside the mini player on a desktop (bug list item 164):
 * the player stays on screen over an open album and can be dragged; the
 * album opens in the room beside it, on the left with the player on the
 * right (its corner, or dragged top right), on the right with it dragged to
 * the left, and centred as before where the room is too narrow or on a touch
 * screen. Since item 214 a desktop window or a TV 1000 by 600 at least, wider
 * than tall, has the album in three columns over the whole screen instead,
 * each column ending above the player; beside it is a shorter window's.
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

// The player shown (as it is while a room plays), an album opened from Home, where each stands.
const OPEN = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const find = () => [...document.querySelectorAll("body *")].find(e => e.children.length === 0 && e.textContent.trim() === "Album One");
  for (let i = 0; i < 200 && !find(); i++) await sleep(50);
  const bar = document.getElementById("mini-transport");
  bar.classList.remove("hidden");
  await sleep(100);
  find().click();
  const modal = document.getElementById("album-modal");
  for (let i = 0; i < 100 && modal.classList.contains("hidden"); i++) await sleep(50);
  await sleep(400);
  const box = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
  return { bar: box(bar), panel: box(modal.querySelector(".modal-panel")), beside: modal.classList.contains("beside-mini"), w: innerWidth,
    wide: modal.classList.contains("album-wide"), cols: [...document.querySelectorAll(".aw-col")].map(box) };
})()`;

test("an album opens beside the mini player on a desktop; in three columns above it on a large screen (item 214)", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) {
      const s = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json();
      if (s.index_count >= 3 && !s.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const at = async (width, height, { pos = null, mouse = true } = {}) => {
      const b = await Browser.launch({ width, height, mouse });
      try {
        const init = pos ? `localStorage.setItem("rra-mini-pos", ${JSON.stringify(JSON.stringify(pos))});` : null;
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init });
        const r = await page.eval(OPEN);
        assert.deepEqual(page.errors, []);
        return r;
      } finally { await b.close(); }
    };

    // A TV (item 214): the album in three columns over the whole screen, not beside the player; each column ends above it.
    const tv = await at(1920, 1080);
    assert.equal(tv.wide, true);
    assert.equal(tv.beside, false);
    assert.ok(tv.panel.left === 0 && Math.abs(tv.panel.width - 1920) < 1, "over the whole screen");
    assert.ok(tv.cols.length === 3 && tv.cols.every(c => c.bottom <= tv.bar.top + 0.5), `the columns above the player (${JSON.stringify(tv.cols.map(c => c.bottom))} over ${tv.bar.top})`);

    // A window under 600px tall keeps the album beside the player. In its corner, bottom right: the album on the left, clear of it.
    const corner = await at(1920, 560);
    assert.equal(corner.wide, false);
    assert.equal(corner.beside, true);
    assert.ok(corner.panel.right <= corner.bar.left - 24 + 0.5, `the album (to ${corner.panel.right}) clear of the player (from ${corner.bar.left})`);
    assert.ok(Math.abs(corner.panel.width - 960) < 1, "at its full width, room enough on a wide screen");

    // Dragged to the top right: the album still on the left.
    const topRight = await at(1920, 560, { pos: { left: 1432, top: 8 } });
    assert.ok(topRight.bar.top < 20, "the player where it was put");
    assert.ok(topRight.panel.right <= topRight.bar.left - 24 + 0.5, "the album on the left of it");

    // Dragged to the left: the album on the right of it.
    const left = await at(1920, 560, { pos: { left: 8, top: 300 } });
    assert.ok(left.panel.left >= left.bar.right + 24 - 0.5, `the album (from ${left.panel.left}) right of the player (to ${left.bar.right})`);

    // A narrow desktop, too little room beside the player for the album: centred as before.
    const narrow = await at(1024, 560);
    assert.ok(narrow.bar.left - 48 < 600, `under 600px beside the player: ${narrow.bar.left - 48}`);
    assert.equal(narrow.beside, false);
    assert.ok(Math.abs((narrow.panel.left + narrow.panel.right) / 2 - 512) < 1, "centred");

    // A touch screen: never beside the player (it doesn't move there); a large one in three columns.
    const touch = await at(1920, 1080, { mouse: false });
    assert.equal(touch.beside, false);
    assert.equal(touch.wide, true);
  } finally {
    await srv.stop();
  }
});
