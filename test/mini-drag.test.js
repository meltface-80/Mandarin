"use strict";
/*
 * The mini player moved about on a desktop (v0.7.11), with a real mouse in
 * a browser:
 *   - pressed on the bar (not a button) and dragged, it follows the mouse,
 *     a quick flick that leaves the bar on the first move included;
 *   - dragged past an edge, it stays wholly on screen;
 *   - a drag is not a click: the cover and the title don't open Now playing
 *     at its end, though a click on them still does, the next one included;
 *   - the volume sheet opens beside it where it is; near the top of the
 *     screen the room list opens under it;
 *   - put somewhere, it is there again after a reload; a double-click sends
 *     it back to its corner;
 *   - on a tablet it doesn't move.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3646, B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The bar shown as it is with something playing, a counter on its info area's clicks.
const SHOW = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 300 && !document.querySelector("#home-view .album"); i++) await sleep(30);
  const $ = id => document.getElementById(id);
  $("mini-transport").classList.remove("hidden");
  $("mt-title").textContent = "Generate"; $("mt-artist").textContent = "Collective Soul";
  window.__infoClicks = 0;
  document.querySelector("#mini-transport .mt-info").addEventListener("click", () => window.__infoClicks++);
  await sleep(100);
  return true;
})()`;
const BOX = `(() => { const el = document.getElementById("mini-transport"), b = el.getBoundingClientRect();
  return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height),
    down: el.classList.contains("mt-drop-down"), clicks: window.__infoClicks, vw: innerWidth, vh: innerHeight }; })()`;
// A spot on the bar that is the bar itself (no button): near its top right corner.
const GRIP = `(() => { const b = document.getElementById("mini-transport").getBoundingClientRect(); const x = b.right - 6, y = b.top + 6;
  return { x, y, bare: document.elementFromPoint(x, y) === document.getElementById("mini-transport") }; })()`;
const TITLE = `(() => { const b = document.getElementById("mt-title").getBoundingClientRect(); return { x: b.left + 8, y: b.top + b.height / 2 }; })()`;

async function drag(page, from, dx, dy, steps = 8) {
  await page.mouse("mousePressed", from.x, from.y);
  for (let i = 1; i <= steps; i++) { await page.mouse("mouseMoved", from.x + dx * i / steps, from.y + dy * i / steps); await sleep(10); }
  await page.mouse("mouseReleased", from.x + dx, from.y + dy);
  await sleep(80);
}

test("the desktop mini player can be dragged about, stays on screen, and is remembered", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const cookies = [{ name: "musicd_session", value: token, url: B }];
    const b = await Browser.launch({ width: 1600, height: 900, mouse: true });
    try {
      const page = await b.page(B + "/", { cookies });
      await page.eval(SHOW);
      const home = await page.eval(BOX);
      assert.ok(home.r > home.vw - 40 && home.b > home.vh - 40, "it starts in its corner: " + JSON.stringify(home));

      // A flick: the first move already leaves the bar.
      const g = await page.eval(GRIP);
      assert.ok(g.bare, "the grip spot is the bar itself");
      await drag(page, g, -900, -400, 4);
      const moved = await page.eval(BOX);
      assert.equal(moved.l, home.l - 900, "it follows the mouse across");
      assert.equal(moved.t, home.t - 400, "and up");
      assert.equal(moved.clicks, 0, "a drag is not a click");

      // A click on the title still is, straight after a drag.
      const t = await page.eval(TITLE);
      await page.mouse("mousePressed", t.x, t.y); await page.mouse("mouseReleased", t.x, t.y); await sleep(60);
      assert.equal((await page.eval(BOX)).clicks, 1, "a click on the title after a drag still opens Now playing");

      // Dragged by the title, past the top left: wholly on screen.
      await drag(page, await page.eval(TITLE), -3000, -3000);
      const edge = await page.eval(BOX);
      assert.equal(edge.clicks, 1, "dragged by the title: no click at its end");
      assert.ok(edge.l >= 0 && edge.t >= 0 && edge.l <= 16 && edge.t <= 16, "kept on screen at the top left: " + JSON.stringify(edge));
      assert.ok(edge.down, "near the top, the room list opens under it");

      // The volume sheet beside it.
      const vol = await page.eval(`(async () => { const p = document.getElementById("mt-vol-popover"); p.classList.remove("hidden");
        await new Promise(r => setTimeout(r, 50)); const r = p.getBoundingClientRect(); p.classList.add("hidden"); return { l: Math.round(r.left), t: Math.round(r.top), b: Math.round(r.bottom) }; })()`);
      assert.equal(vol.l, edge.l, "the volume sheet lines up with the bar");
      assert.ok(vol.t >= edge.b, `under it, with no room above (${vol.t} vs ${edge.b})`);

      // Remembered.
      await page.eval("location.reload()").catch(() => {});
      await sleep(1500);
      await page.eval(SHOW);
      const back = await page.eval(BOX);
      assert.deepEqual([back.l, back.t], [edge.l, edge.t], "there again after a reload");

      // A double-click: back to its corner, and forgotten.
      const g2 = await page.eval(GRIP);
      await page.mouse("mousePressed", g2.x, g2.y); await page.mouse("mouseReleased", g2.x, g2.y);
      await page.mouse("mousePressed", g2.x, g2.y, { clickCount: 2 }); await page.mouse("mouseReleased", g2.x, g2.y, { clickCount: 2 });
      await sleep(80);
      const reset = await page.eval(BOX);
      assert.deepEqual([reset.l, reset.t], [home.l, home.t], "a double-click puts it back in its corner");
      assert.equal(await page.eval(`localStorage.getItem("rra-mini-pos")`), null, "and forgets where it was");
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }

    // A tablet: it stays put.
    const tb = await Browser.launch({ width: 1180, height: 820 });
    try {
      const page = await tb.page(B + "/", { cookies, touch: true });
      await page.eval(SHOW);
      const before = await page.eval(BOX);
      await drag(page, await page.eval(GRIP), -400, -300);
      const after = await page.eval(BOX);
      assert.deepEqual([after.l, after.t], [before.l, before.t], "on a tablet it doesn't move");
      assert.deepEqual(page.errors, []);
    } finally { await tb.close(); }
  } finally { await srv.stop(); }
});
