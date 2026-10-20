"use strict";
/*
 * The mini player docked in the Android app (bug list item 102, as the owner chose it): the full width of the screen,
 * straight on top of the row along the foot, solid in that row's own colour with a hairline above it, not rounded; the
 * track's progress along its top, the full width, above the cover and the words. A browser keeps the floating bar.
 */
const test = require("node:test");
const assert = require("node:assert");
const { started } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const APP_UA = "Mozilla/5.0 (Linux; Android 16) MusicDAndroid/1.0.17";

const MEASURE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 400 && !document.querySelector("#home-library .album"); i++) await sleep(50);
  const mt = document.getElementById("mini-transport");
  mt.classList.remove("hidden");
  document.getElementById("mt-art").classList.remove("hidden");
  await sleep(300);
  const r = mt.getBoundingClientRect(), nav = document.getElementById("touch-nav").getBoundingClientRect();
  const bar = mt.querySelector(".mt-progress").getBoundingClientRect(), art = document.getElementById("mt-art").getBoundingClientRect();
  const cs = getComputedStyle(mt);
  return { left: Math.round(r.left), width: Math.round(r.width), screen: innerWidth, gap: Math.round(nav.top - r.bottom),
    radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, navBg: getComputedStyle(document.getElementById("touch-nav")).backgroundColor,
    line: cs.borderTopWidth, barAbove: bar.bottom <= art.top, barWide: Math.round(bar.width) >= Math.round(r.width) - 30 };
})()`;

test("the mini player docked in the app: full width on the row along the foot, its colour, its progress across the top", { skip, timeout: 120000 }, async (t) => {
  const { base, token } = await started(t);
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const app = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true, userAgent: APP_UA });
  const r = await app.eval(MEASURE);
  assert.deepEqual(r, { left: 0, width: 412, screen: 412, gap: 0, radius: "0px", bg: r.navBg, navBg: r.navBg, line: "1px", barAbove: true, barWide: true });
  const web = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true });
  const w = await web.eval(MEASURE);
  assert.notEqual(w.radius, "0px", "a browser keeps the floating bar");
});
