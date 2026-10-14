"use strict";
/*
 * The Android app's Downloads page, in Settings → Setup (v1.0.4). The page
 * adds it where the app says it is there (window.MusicdDownloads): before
 * v1.0.4 it went before Wall Display in the Settings list, and when v1.0.2
 * moved Wall Display into Setup it fell to the foot of the list, under
 * Updates. Now it is in Setup, before Away from home; it opens its page,
 * and Back goes to Setup as its other pages' do. A browser, with no app,
 * has no Downloads anywhere. Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { started } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

// The app's bridge, there before the page's scripts run, as the app's WebView has it.
const APP = `window.MusicdDownloads = {
  settings: () => JSON.stringify({ quality: "original", wifiOnly: true }),
  set: () => {}, list: () => "[]", usage: () => "{}"
};`;

const LOOK = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  const titles = (sel) => [...document.querySelectorAll(sel + " > .settings-nav-item")].map(b => b.querySelector(".settings-nav-title").textContent.trim());
  const shown = (pane) => { const v = document.querySelector('.settings-view[data-pane="' + pane + '"]'); return !!v && !v.classList.contains("hidden"); };
  const out = {
    list: titles('.settings-view[data-view="home"] .settings-nav'),
    setup: titles('.settings-view[data-pane="setup"] .settings-nav')
  };
  if (!out.setup.includes("Downloads")) return out;
  document.getElementById("settings-toggle").click(); await sleep(300);
  document.querySelector('.settings-view[data-view="home"] .settings-nav-item[data-pane="setup"]').click(); await sleep(200);
  document.querySelector('.settings-view[data-pane="setup"] .settings-nav-item[data-pane="downloads"]').click();
  await until(() => shown("downloads"));
  out.opened = true;
  document.querySelector('.settings-view[data-pane="downloads"] [data-settings-back]').click();
  await until(() => shown("setup") || document.querySelector('.settings-view[data-view="home"]:not(.hidden)'));
  out.back = shown("setup") ? "Setup" : "Settings";
  return out;
})()`;

test("the app's Downloads page is in Setup, before Away from home; Back goes to Setup; a browser has none", { skip, timeout: 120000 }, async (t) => {
  const { base, token } = await started(t);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const cookies = [{ name: "musicd_session", value: token, url: base }];

  const app = await b.page(base + "/", { cookies, init: APP });
  const r = await app.eval(LOOK);
  assert.ok(!r.list.includes("Downloads"), "not in the Settings list: " + r.list.join(", "));
  assert.equal(r.list[r.list.length - 1] === "Downloads", false);
  const at = r.setup.indexOf("Downloads");
  assert.ok(at >= 0, "in Setup: " + r.setup.join(", "));
  assert.equal(r.setup[at + 1], "Away from home", "just before Away from home: " + r.setup.join(", "));
  assert.equal(r.opened, true, "it opens its page");
  assert.equal(r.back, "Setup", "Back goes to Setup");
  assert.deepEqual(app.errors, []);

  const browser = await b.page(base + "/", { cookies });
  const w = await browser.eval(LOOK);
  assert.ok(!w.list.includes("Downloads") && !w.setup.includes("Downloads"), "a browser has no Downloads");
});
