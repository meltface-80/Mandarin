"use strict";
/*
 * Settings → Library Scanner → Find covers (item 409): the cover finder's
 * switch and its one line on the page, drawn from /api/covers/auto, the switch
 * kept by the server when tapped off and on again. The finder itself runs only
 * where the tests ask for it (AutoCoversTests), so here the line is what the
 * library has: Hi Res and Best Of have no cover, Album One has its folder's.
 * Skipped where no Chromium or Chrome is found.
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
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  const body = document.getElementById("identify-pane-body");
  const navItem = () => document.querySelector('#settings-overlay .settings-nav-item[data-pane="identify"]');
  document.getElementById("settings-toggle").click(); for (let i = 0; i < 200 && !(navItem() && navItem().offsetParent); i++) await sleep(25);
  navItem().click();
  const block = () => body.querySelector('[data-blk="covers"]');
  const box = () => block() && block().querySelector("input[data-covers-on]");
  const out = {};
  out.drawn = await until(() => box() && !box().disabled && /Covers found automatically/.test(block().textContent));
  out.line = block().querySelector(".id-progress").textContent;
  out.name = block().querySelector(".settings-label").textContent.replace("ⓘ", "").trim();
  out.on = box().checked;
  out.label = box().getAttribute("aria-label");
  out.key = block().querySelector("[data-parity='settings-scanner.covers']") !== null;
  // Off: kept by the server.
  box().click();
  await until(() => box() && !box().disabled && !box().checked);
  out.off = (await (await fetch("/api/covers/auto", { cache: "no-store" })).json()).on;
  // On again.
  box().click();
  await until(() => box() && !box().disabled && box().checked);
  out.onAgain = (await (await fetch("/api/covers/auto", { cache: "no-store" })).json()).on;
  return out;
})()`;

test("Library Scanner: Find covers, its switch and its line", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 3 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const b = await Browser.launch({ width: 1180, height: 820 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      const r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
      assert.equal(r.drawn, true, "the block drawn from the server's answer");
      assert.equal(r.name, "Find covers");
      assert.equal(r.label, "Find covers");
      assert.equal(r.key, true, "its screens-contract key");
      assert.equal(r.on, true, "on by default");
      assert.equal(r.line, "Covers found automatically: 0 · 2 left to try · 0 without a sure match");
      assert.equal(r.off, false, "tapped off: kept off");
      assert.equal(r.onAgain, true, "tapped on again: kept on");
    } finally { await b.close(); }
  } finally {
    await srv.stop();
  }
});
