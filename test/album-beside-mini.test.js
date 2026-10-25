"use strict";
/*
 * The album view beside the mini player on a desktop (bug list item 164):
 * the player stays on screen over an open album and can be dragged; the
 * album opens in the room beside it, on the left with the player on the
 * right (its corner, or dragged top right), on the right with it dragged to
 * the left, and centred as before where the room is too narrow or there is
 * no player. Skipped where no Chromium or Chrome is found (test/browser-harness.js).
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
const OPEN = (hideBar) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const find = () => [...document.querySelectorAll("body *")].find(e => e.children.length === 0 && e.textContent.trim() === "Album One");
  for (let i = 0; i < 200 && !find(); i++) await sleep(50);
  const bar = document.getElementById("mini-transport");
  ${hideBar ? "bar.classList.add('hidden');" : "bar.classList.remove('hidden');"}
  await sleep(100);
  find().click();
  const modal = document.getElementById("album-modal");
  for (let i = 0; i < 100 && modal.classList.contains("hidden"); i++) await sleep(50);
  await sleep(400);
  const box = el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; };
  return { bar: box(bar), panel: box(modal.querySelector(".modal-panel")), beside: modal.classList.contains("beside-mini"), w: innerWidth };
})()`;

test("an album opens beside the mini player on a desktop", { skip, timeout: 180000 }, async () => {
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
    const at = async (width, height, { pos = null, hideBar = false, mouse = true } = {}) => {
      const b = await Browser.launch({ width, height, mouse });
      try {
        const init = pos ? `localStorage.setItem("rra-mini-pos", ${JSON.stringify(JSON.stringify(pos))});` : null;
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init });
        const r = await page.eval(OPEN(hideBar));
        assert.deepEqual(page.errors, []);
        return r;
      } finally { await b.close(); }
    };

    // The player in its corner, bottom right: the album on the left, clear of it.
    const corner = await at(1920, 1080);
    assert.equal(corner.beside, true);
    assert.ok(corner.panel.right <= corner.bar.left - 24 + 0.5, `the album (to ${corner.panel.right}) clear of the player (from ${corner.bar.left})`);
    assert.ok(Math.abs(corner.panel.width - 960) < 1, "at its full width, room enough on a TV");

    // Dragged to the top right: the album still on the left.
    const topRight = await at(1920, 1080, { pos: { left: 1432, top: 8 } });
    assert.ok(topRight.bar.top < 20, "the player where it was put");
    assert.ok(topRight.panel.right <= topRight.bar.left - 24 + 0.5, "the album on the left of it");

    // Dragged to the left: the album on the right of it.
    const left = await at(1920, 1080, { pos: { left: 8, top: 400 } });
    assert.ok(left.panel.left >= left.bar.right + 24 - 0.5, `the album (from ${left.panel.left}) right of the player (to ${left.bar.right})`);

    // No player (nothing to keep clear of): centred as before.
    const none = await at(1920, 1080, { hideBar: true });
    assert.equal(none.beside, false);
    assert.ok(Math.abs((none.panel.left + none.panel.right) / 2 - 960) < 1, "centred");

    // A touch screen: as it was (the player doesn't move there).
    const touch = await at(1920, 1080, { mouse: false });
    assert.equal(touch.beside, false);
  } finally {
    await srv.stop();
  }
});
