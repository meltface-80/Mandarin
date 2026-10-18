"use strict";
/*
 * The Android app's native Now playing, a preview (stage N2 of
 * docs/specs/plan-android-native.md), as the page hands over to it. The
 * switch in Settings → Setup → UI Settings is the app's alone: shown only
 * where the app's bridge (MusicdApp) says it has the screen, and kept by the
 * app. Switched on, a tap on the mini player asks the app for its own Now
 * playing of the room playing, instead of the page's; off, the page's opens,
 * as it always has. The app is stood in for by its bridge; a room by the
 * stand-in Sonos household. Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { started } = require("./helpers");
const { FakeHousehold } = require("./fake-sonos");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

const KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  const $ = (s) => document.querySelector(s);
  await until(() => document.querySelector("#home-random .album, #home-today .album, #home-library .album"), 20000);`;

// Before the page's scripts: the app's bridge, its switch [on], and what it is asked written down.
const bridge = (on) => `window.MusicdApp = { on: ${on ? "true" : "false"}, set: [], opened: [],
  nativeNowPlaying() { return this.on; }, setNativeNowPlaying(v) { this.on = !!v; this.set.push(!!v); }, openNowPlaying(z) { this.opened.push(z); } };`;

/* Settings → Setup → UI Settings: the switch, and what a tap on it tells the app. */
const SETTINGS = `(async () => { ${KIT}
  $("#settings-toggle").click(); await sleep(300);
  window.__settingsShowView("setup"); await sleep(200);
  document.querySelector('.settings-view[data-pane="setup"] .settings-nav-item[data-pane="ui"]').click();
  await until(() => shown(document.querySelector('.settings-view[data-pane="ui"]')), 5000);
  const out = { shown: shown($("#native-screens")) };
  if (!out.shown) return out;
  out.checked = $("#native-np-on").checked;
  $("#native-np-on").click(); await sleep(100);
  out.set = window.MusicdApp.set;
  return out;
})()`;

/* An album played to the room, then the mini player tapped: what opens, and what the app was asked. */
const TAP = `(async () => { ${KIT}
  const out = {};
  ($("#home-library .album") || $(".album")).click();
  await until(() => shown($("#album-modal")), 8000);
  const playBtn = () => [...document.querySelectorAll("#modal-actions .action-btn")].find(b => /^Play Now$/.test(b.textContent.trim()) && shown(b));
  await until(() => playBtn() && /Kitchen/.test(($("#mt-kicker") || {}).textContent || ""), 10000);
  playBtn().click();
  $("#modal-close-btn").click();
  await until(() => !shown($("#album-modal")), 5000);
  out.playing = await until(() => /Song|Hi /.test(($("#mt-title") || {}).textContent || ""), 15000);
  const pageNp = () => shown($("#np-screen")) || shown($("#album-modal"));
  // Tapped until something answers: the bar acts once it has read what is playing (a poll away).
  for (let i = 0; i < 6 && !pageNp() && !(window.MusicdApp && window.MusicdApp.opened.length); i++) { $(".mt-info").click(); await until(() => pageNp() || (window.MusicdApp && window.MusicdApp.opened.length > 0), 2500); }
  out.pageNp = pageNp();
  out.opened = window.MusicdApp ? window.MusicdApp.opened : null;
  return out;
})()`;

test("the app's native Now playing: its switch in Setup, and the mini player handing over to it", { skip, timeout: 240000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { base, token } = await started(t, { sonosHosts: [ports.host(0)] });
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const cookies = [{ name: "musicd_session", value: token, url: base }];
  const zones = (await (await fetch(base + "/api/zones", { headers: { Authorization: "Bearer " + token } })).json()).zones || [];
  const kitchen = zones.find(z => z.display_name === "Kitchen");
  assert.ok(kitchen, "the Kitchen room");
  const room = `localStorage.setItem("rra-zone", ${JSON.stringify(kitchen.zone_id)});`;
  const run = async (js, init) => {
    const page = await b.page(base + "/", { cookies, touch: true, init });
    const r = await page.eval(js);
    assert.deepEqual(page.errors, [], "nothing thrown");
    return r;
  };

  await t.test("a browser: no such switch", async () => {
    assert.deepEqual(await run(SETTINGS), { shown: false });
  });

  await t.test("the app: the switch, off until switched on, and the app told", async () => {
    assert.deepEqual(await run(SETTINGS, bridge(false)), { shown: true, checked: false, set: [true] });
    assert.deepEqual(await run(SETTINGS, bridge(true)), { shown: true, checked: true, set: [false] });
  });

  await t.test("switched off: the mini player opens the page's Now playing, as ever", async () => {
    const r = await run(TAP, room + bridge(false));
    assert.equal(r.playing, true, "it plays");
    assert.equal(r.pageNp, true, "the page's Now playing");
    assert.deepEqual(r.opened, [], "the app not asked");
  });

  await t.test("switched on: the mini player asks the app for its own, of the room playing", async () => {
    const r = await run(TAP, room + bridge(true));
    assert.equal(r.playing, true, "it plays");
    assert.deepEqual(r.opened, [kitchen.zone_id], "the app's Now playing, of the Kitchen");
    assert.equal(r.pageNp, false, "not the page's");
  });
});
