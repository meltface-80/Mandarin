"use strict";
/*
 * The Android app's native Play on sheets (the Rooms group of
 * old/plan-android-native.md, R1; bug list item 68), as the page answers
 * them (public/app/native-handoff.js): a room chosen on a native screen is the
 * page's room too, without the page's own "Move what's playing…?" (the app asks
 * that itself, over its own screen; the page's would open unseen behind it);
 * the page's own choice still asks. A room the app grouped is kept and the list
 * read again. The app is stood in for by its bridge; the rooms by the stand-in
 * Sonos household. Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { started } = require("./helpers");
const { FakeHousehold } = require("./fake-sonos");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

/* The Kitchen playing; the app's room choice (to the Study), then the page's own (back to the Kitchen, then the Study again). */
const CHOSEN = (study, kitchen) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const asked = () => !document.getElementById("confirm-overlay").classList.contains("hidden");
  await until(() => /Kitchen/.test((document.getElementById("mt-kicker") || {}).textContent || ""), 20000);
  const sel = document.getElementById("zone-select") || zoneSel;
  const out = { playing: await until(() => /Song|Hi /.test((document.getElementById("mt-title") || {}).textContent || ""), 15000) };
  out.zone = window.__musicdNative("zone", ${JSON.stringify(study)});
  await sleep(1500);
  out.appAsked = asked();
  out.room = localStorage.getItem("rra-zone");
  sel.value = ${JSON.stringify(kitchen)}; sel.dispatchEvent(new Event("change")); await sleep(300);
  sel.value = ${JSON.stringify(study)}; sel.dispatchEvent(new Event("change"));
  out.pageAsked = await until(asked, 5000) && /Move what's playing in Kitchen to Study\\?/.test(document.getElementById("confirm-msg").textContent);
  out.noSettle = window.__musicdNative("group-settled");
  out.settled = window.__musicdNative("group-settled", ${JSON.stringify(kitchen)}) && localStorage.getItem("rra-zone") === ${JSON.stringify(kitchen)};
  return out;
})()`;

test("the app's native Play on: a room it chose, and one it grouped", { skip, timeout: 120000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { base, token, album } = await started(t, { sonosHosts: [ports.host(0)] });
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  let zones = [];
  for (const t0 = Date.now(); zones.length < 2 && Date.now() - t0 < 20000; await new Promise(r => setTimeout(r, 200))) {
    zones = (await (await fetch(base + "/api/zones", { headers: H })).json()).zones || [];
  }
  const kitchen = zones.find(z => z.display_name === "Kitchen"), study = zones.find(z => z.display_name === "Study");
  assert.ok(kitchen && study, "the two rooms");
  const a = await album("Album One");
  const played = await fetch(base + "/api/play", { method: "POST", headers: H, body: JSON.stringify({ offset: a.offset, title: a.title, subtitle: a.subtitle || "", zone_or_output_id: kitchen.zone_id, kind: "play_now" }) });
  assert.equal(played.status, 200, "the Kitchen plays");
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true,
    init: `localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)});` });
  const r = await page.eval(CHOSEN(study.zone_id, kitchen.zone_id));
  assert.deepEqual(page.errors, [], "nothing thrown");
  assert.deepEqual(r, { playing: true, zone: true, appAsked: false, room: study.zone_id, pageAsked: true, noSettle: false, settled: true });
});
