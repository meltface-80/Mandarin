"use strict";
/*
 * Settings → Check for updates in the Android app, with the server ahead of the app (bug list item 178). The app
 * updates only from main's dist/latest.json, which a release's app reaches a few minutes after the server's: "App vX is
 * on its way — try again in a few minutes" is true then. A test build's (dev's, 1.1.9-tN) never reaches it: its app is
 * on the test-android page, so on a dev server the promise was said on every check and never came true. Said as it is
 * now; the Android app's own Settings says the same words (android/core UpdateCheck.kt, UpdateCheckTest.kt).
 * check-update.js run here as the page runs it, against the server's and the app's answers, its version comparison the
 * page's own (updater.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP = path.join(__dirname, "..", "public", "app");
// The page's comparison of versions (updater.js), as it is.
const verNewerSrc = (() => {
  const src = fs.readFileSync(path.join(APP, "updater.js"), "utf8");
  const m = /window\.__verNewer = (\(x, y\) => \{[\s\S]*?\n {2}\});/.exec(src);
  assert.ok(m, "updater.js's __verNewer");
  return m[1];
})();

// What the button says after a check, the server's status [s] and the app's own [a] as they answer.
async function check(s, a) {
  const btn = { disabled: false, textContent: "Check for updates", classList: { add() {}, remove() {} }, on: null,
    addEventListener(_, fn) { this.on = fn; } };
  const window = { __musicdAppUpd: { look: async () => a } };
  const sandbox = {
    window, setTimeout: () => 0, Promise, JSON,
    document: { getElementById: id => (id === "check-update-btn" ? btn : null), querySelector: () => null },
    fetch: async (url) => ({ json: async () => (String(url).startsWith("/api/update/status") ? s : {}) })
  };
  vm.createContext(sandbox);
  window.__verNewer = vm.runInContext("(" + verNewerSrc + ")", sandbox);
  vm.runInContext(fs.readFileSync(path.join(APP, "check-update.js"), "utf8"), sandbox);
  await btn.on();
  return btn.textContent;
}

test("a release's server ahead of the app: the app is on its way", async () => {
  assert.equal(await check({ available: false, current: "1.1.9" }, { available: false, latest: null, current: "1.1.8" }),
    "App v1.1.9 is on its way — try again in a few minutes");
});

test("a test build's server ahead of the app: no promise, where its app is found instead", async () => {
  const said = "Server v1.1.9-t5 is a test build — the app's test builds are installed from the test-android page";
  assert.equal(await check({ available: false, current: "1.1.9-t5" }, { available: false, latest: null, current: "1.1.9-t3" }), said);
  assert.equal(await check({ available: false, current: "1.1.9-t5" }, { available: false, latest: null, current: "1.1.8" }), said);
});

test("the app the same test build as the server: up to date", async () => {
  assert.equal(await check({ available: false, current: "1.1.9-t5" }, { available: false, latest: null, current: "1.1.9-t5" }),
    "Up to date (server v1.1.9-t5, app v1.1.9-t5)");
});
