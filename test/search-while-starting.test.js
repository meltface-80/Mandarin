"use strict";
/*
 * A search begun while the page is still starting is kept (item 280). Home is painted from its cache at once, before
 * the page has heard from the server; the page then lands on Home once the server and its rooms answer. That landing
 * closed the search and threw its results away, so a search typed in the first moment (or, on a loaded machine, the
 * page tour's) was gone. Here the rooms' answer is held back two and a half seconds on the second opening, the search
 * typed meanwhile, and it must still be there, with its results, once the page has started.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { started } = require("./helpers");
const { FakeHousehold } = require("./fake-sonos");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

// The rooms' first answer held back: the page painted from its cache, not yet started.
const HOLD = `(() => {
  const real = window.fetch;
  window.fetch = function (u) {
    if (!window.__held && /\\/api\\/zones/.test(String(u))) { window.__held = true; const a = arguments, me = this; return new Promise(r => setTimeout(r, 2500)).then(() => real.apply(me, a)); }
    return real.apply(this, arguments);
  };
})();`;

const SEARCH = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  const $ = (s) => document.querySelector(s);
  const found = () => [...document.querySelectorAll("#album-grid .album")].some(a => shown(a) && /Album One/.test(a.textContent));
  const out = { painted: await until(() => document.querySelector("#home-random .album, #home-today .album, #home-library .album"), 10000) };
  out.early = !window.__musicdReady;
  $("#search-open").click(); await sleep(200);
  const input = $("#search-input"); input.value = "Album One"; input.dispatchEvent(new Event("input", { bubbles: true }));
  out.found = await until(found, 8000);
  out.started = await until(() => window.__musicdReady, 10000);
  await sleep(500);
  out.kept = found() && input.value === "Album One" && $("#search-row").classList.contains("open");
  return out;
})()`;

test("a search begun while the page is starting is kept once it has started", { skip, timeout: 120000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { base, token } = await started(t, { sonosHosts: [ports.host(0)] });
  const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
  t.after(() => b.close());
  const cookies = [{ name: "musicd_session", value: token, url: base }];
  // Once, so Home is kept for the next opening to paint at once.
  const first = await b.page(base + "/", { cookies });
  assert.ok(await first.eval(`(async () => { for (let i = 0; i < 200 && !(window.__musicdReady && document.querySelector("#home-library .album")); i++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 1500)); return !!window.__musicdReady; })()`));
  const page = await b.page(base + "/", { cookies, init: HOLD });
  const r = await page.eval(SEARCH);
  assert.deepEqual(r, { painted: true, early: true, found: true, started: true, kept: true });
  assert.deepEqual(page.errors, []);
});
