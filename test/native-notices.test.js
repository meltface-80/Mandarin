"use strict";
/*
 * The page's notices told to the Android app (public/app/native-notices.js, bug
 * list item 69), whose native Home is in front of them: the server's notice and
 * the update offer, each time either changes, and their buttons tapped by name
 * (native-handoff.js "notice-button", "update"). The app is stood in for by its
 * bridge; the notices are put up as the page's own code puts them up. Skipped
 * where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { started } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

const BRIDGE = `window.MusicdApp = { told: [], notices(j) { this.told.push(JSON.parse(j)); }, nativeNowPlaying() { return false; } };`;

const TOLD = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  await until(() => document.querySelectorAll("#home-library .album").length > 0, 20000);
  await sleep(500);
  const app = window.MusicdApp, last = () => app.told[app.told.length - 1];
  const out = { first: last() };
  // A music folder gone, as server-notice.js says it: a paragraph and its Forget.
  const n = document.getElementById("server-notice");
  n.innerHTML = "<div>The music folder “Music” isn't there.</div>";
  const b = document.createElement("button"); b.className = "settings-update-btn server-notice-btn"; b.textContent = "Forget “Music”";
  let forgot = 0; b.addEventListener("click", () => forgot++);
  n.appendChild(b); n.classList.add("error"); n.classList.remove("hidden");
  await until(() => last().notice);
  out.notice = last().notice;
  out.tapped = window.__musicdNative("notice-button", "0") && forgot === 1;
  out.noButton = window.__musicdNative("notice-button", "3");
  // An update offered, as updater.js shows it, with its notes.
  document.getElementById("update-text").textContent = "Mandarin v9.9.9 is ready";
  const notes = document.getElementById("update-notes"); notes.textContent = "- faster"; notes.classList.remove("hidden");
  document.getElementById("update-toast").classList.add("open");
  await until(() => last().update);
  out.update = last().update;
  out.later = window.__musicdNative("update", "later");
  out.closed = await until(() => last().update === null, 3000);
  out.badUpdate = window.__musicdNative("update", "sideways");
  n.classList.add("hidden");
  await until(() => last().notice === null);
  out.gone = last();
  return out;
})()`;

test("the page's notices told to the app, and their buttons tapped for it", { skip, timeout: 120000 }, async (t) => {
  const { base, token } = await started(t);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true, init: BRIDGE });
  const r = await page.eval(TOLD);
  assert.deepEqual(page.errors, [], "nothing thrown");
  assert.equal(r.first.update, null, "no update offered at the start");
  assert.deepEqual(r.notice, { lines: ["The music folder “Music” isn't there."], error: true, buttons: ["Forget “Music”"] });
  assert.deepEqual([r.tapped, r.noButton], [true, false]);
  assert.deepEqual(r.update, { text: "Mandarin v9.9.9 is ready", notes: "- faster", now: "Update", later: true, error: false });
  assert.deepEqual([r.later, r.closed, r.badUpdate], [true, true, false], "Later, the page's own, closes it");
  assert.deepEqual(r.gone, { notice: null, update: null });
});
