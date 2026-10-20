"use strict";
/*
 * The Android app's native side menu (the Rooms group of
 * docs/specs/plan-android-native.md, bug list item 67), as the page answers
 * it (public/app/native-handoff.js, "menu"): an item the app leaves to the
 * page is the page's own item in its menu, tapped (Settings, Pitchfork, Restart
 * with its question); "reopen", the page's menu open again on the page the
 * Offline switch loads; anything else, nothing. And the menu's size goes to
 * the app with the UI Settings (device-power.js nativePrefsJson). Skipped
 * where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { started } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

const ASKED = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = (s) => { const el = document.querySelector(s); return !!el && !el.classList.contains("hidden") && el.getClientRects().length > 0; };
  await until(() => document.querySelectorAll("#home-library .album").length > 1, 20000);
  await sleep(500);
  const out = { none: window.__musicdNative("menu", "nope"), empty: window.__musicdNative("menu"), later: window.__musicdNative("menu", "later") };
  out.settings = window.__musicdNative("menu", "settings") && await until(() => shown("#settings-overlay"));
  document.querySelector("#settings-overlay [data-settings-close]").click();
  await sleep(400);
  out.pitchfork = window.__musicdNative("menu", "pitchfork") && await until(() => shown("#pitchfork-overlay"));
  document.querySelector("[data-pitchfork-close]").click(); await sleep(400);
  out.restart = window.__musicdNative("menu", "power-restart") && await until(() => shown("#confirm-overlay")) &&
    /Restart Mandarin\\?/.test(document.getElementById("confirm-msg").textContent);
  out.menuShut = !shown("#menu-overlay");
  localStorage.removeItem("rra-menu-reopen");
  out.reopen = window.__musicdNative("menu", "reopen") && Date.now() - Number(localStorage.getItem("rra-menu-reopen")) < 5000;
  localStorage.removeItem("rra-menu-reopen");
  out.menuSize = JSON.parse(nativePrefsJson()).menu;
  return out;
})()`;

test("the app's native side menu: what the page does for it", { skip, timeout: 120000 }, async (t) => {
  const { base, token } = await started(t);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true });
  const r = await page.eval(ASKED);
  assert.deepEqual(page.errors, [], "nothing thrown");
  assert.deepEqual(r, { none: false, empty: false, later: false, settings: true, pitchfork: true, restart: true, menuShut: true, reopen: true, menuSize: "1" });
});
