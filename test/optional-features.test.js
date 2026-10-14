"use strict";
/*
 * The wall display and Shelf switch off whole (v1.0.2, Features.cs,
 * public/features.js). The wall display on unless set off; Shelf off on a new
 * install, on for one from before v1.0.2 (no setting). Shelf's switch is
 * /api/settings/shelf, as the wall display's is /api/settings/display. Off:
 *   - /display and /shelf are a page saying so, with no script;
 *   - what only they ask for is refused: the display's content, the shelf's
 *     list (never made, and a kept one let go, a 403 every time);
 *   - a page left open on either goes to that page and asks nothing more;
 *   - the side menu has no Shelf, and the wall display no Shelf button.
 * On again, each is as it was. The browser half is skipped where no Chromium
 * or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { started, until } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const skip = built();
const noBrowser = skip || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("off is off: the pages say so with no script, and what only they ask for is refused", { skip, timeout: 120000 }, async (t) => {
  const { base, H, api, ctx } = await started(t);
  const page = async (p) => { const r = await fetch(base + p, { headers: H }); return { status: r.status, text: await r.text(), frame: r.headers.get("x-frame-options") }; };

  // A new install (this server's database just made): Shelf off, the wall display on.
  assert.deepEqual((await api("settings/shelf")).json, { enabled: false });
  assert.equal((await api("settings/display")).json.enabled, true);
  assert.match((await page("/shelf")).text, /Shelf is turned off/);
  // An install from before v1.0.2 has no setting for it: on, as it was.
  ctx.db.raw.prepare("DELETE FROM settings WHERE key = 'shelfEnabled'").run();
  assert.deepEqual((await api("settings/shelf")).json, { enabled: true });
  let r = await page("/shelf");
  assert.match(r.text, /<script src="\/shelf\.js">/, "Shelf's own page");
  r = await page("/display");
  assert.match(r.text, /<script src="\/display\.js">/, "the wall display's own page");
  const list = await fetch(base + "/api/shelf/albums", { headers: H });
  assert.equal(list.status, 200);
  const kept = await fetch(base + "/api/shelf/albums", { headers: H });
  assert.equal(kept.headers.get("x-mandarin-kept"), "1", "the shelf's list kept once made");

  // Shelf off.
  assert.deepEqual((await api("settings/shelf", { enabled: false })).json, { ok: true, enabled: false });
  assert.deepEqual((await api("settings/shelf")).json, { enabled: false });
  r = await page("/shelf");
  assert.equal(r.status, 200);
  assert.match(r.text, /Shelf is turned off/);
  assert.doesNotMatch(r.text, /<script/i, "no script: nothing on it asks again");
  assert.equal(r.frame, "SAMEORIGIN", "framed only here, as Shelf");
  for (let i = 0; i < 2; i++) {
    const off = await fetch(base + "/api/shelf/albums", { headers: H });
    assert.equal(off.status, 403, "refused, never kept");
    assert.equal(off.headers.get("x-mandarin-kept"), null);
    assert.deepEqual(await off.json(), { error: "Shelf is turned off in Settings" });
  }
  // Not JSON, or not a switch: refused, or nothing changed.
  const bad = await fetch(base + "/api/settings/shelf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: "x" });
  assert.equal(bad.status, 400);
  assert.deepEqual((await api("settings/shelf", { enabled: "yes" })).json, { ok: true, enabled: false });

  // The wall display off.
  assert.equal((await api("settings/display", { enabled: false })).json.enabled, false);
  r = await page("/display");
  assert.match(r.text, /The wall display is turned off/);
  assert.doesNotMatch(r.text, /<script/i);
  assert.equal(r.frame, null, "framed anywhere, as the wall display");
  assert.equal((await api("display/content?zone=x")).status, 403);

  // Both on again: each as it was.
  await api("settings/shelf", { enabled: true });
  await api("settings/display", { enabled: true });
  assert.match((await page("/shelf")).text, /<script src="\/shelf\.js">/);
  assert.match((await page("/display")).text, /<script src="\/display\.js">/);
  assert.equal((await fetch(base + "/api/shelf/albums", { headers: H })).status, 200);

  // Kept again, then switched off other than by its switch (a restored backup's
  // settings): still refused, the kept list never sent.
  assert.equal((await fetch(base + "/api/shelf/albums", { headers: H })).headers.get("x-mandarin-kept"), "1");
  ctx.db.setSetting("shelfEnabled", false);
  assert.equal((await fetch(base + "/api/shelf/albums", { headers: H })).status, 403, "a kept list isn't sent while off");
  ctx.db.setSetting("shelfEnabled", true);
});

test("the page: Shelf's switch in Setup, the side menu's Shelf, and a Shelf or wall display left open when switched off", { skip: noBrowser, timeout: 180000 }, async (t) => {
  const { base, token, api } = await started(t);
  await api("settings/shelf", { enabled: true });   // a new install: off until switched on
  const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
  t.after(() => b.close());
  const open = (p) => b.page(base + p, { cookies: [{ name: "musicd_session", value: token, url: base }] });
  const SETUP = `
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
    await until(() => document.querySelector("#home-random .album, #home-today .album"));
    const shelfItem = () => document.querySelector('.menu-item[data-action="shelf"]');
    const offered = () => getComputedStyle(shelfItem()).display !== "none";
    document.getElementById("settings-toggle").click(); await sleep(400);
    document.querySelector('#settings-overlay .settings-nav-item[data-pane="setup"]').click(); await sleep(300);
    document.querySelector('#settings-overlay .settings-nav-item[data-pane="shelfset"]').click(); await sleep(300);
    const sw = document.getElementById("shelf-toggle");`;

  // Switched off from its page in Setup: the side menu has no Shelf, and the server says off.
  let page = await open("/");
  let r = await page.eval(`(async () => { ${SETUP}
    await until(() => sw.checked);
    const before = offered();
    sw.click();
    await until(() => !offered());
    return { before, after: offered(), checked: sw.checked };
  })()`);
  assert.deepEqual(r, { before: true, after: false, checked: false });
  await until(async () => (await api("settings/shelf")).json.enabled === false);
  assert.deepEqual(page.errors, []);

  // Opened again: off, and still not offered; switched on, offered again.
  page = await open("/");
  r = await page.eval(`(async () => { ${SETUP}
    await until(() => !offered());
    const was = sw.checked;
    sw.click();
    await until(() => offered());
    return { was, checked: sw.checked };
  })()`);
  assert.deepEqual(r, { was: false, checked: true });
  await until(async () => (await api("settings/shelf")).json.enabled === true);

  // A Shelf left open as it is switched off (its own file, so not /shelf's answer): on to the page saying so.
  await api("settings/shelf", { enabled: false });
  page = await open("/shelf.html");
  await until(async () => (await page.eval(`location.pathname + "|" + document.body.textContent.includes("Shelf is turned off")`)) === "/shelf|true", 15000, "Shelf's off page");
  assert.equal(await page.eval(`document.scripts.length`), 0, "nothing on it asks again");

  // The wall display with Shelf off: no Shelf button. Then switched off itself: on to the page saying so.
  page = await open("/display");
  await until(async () => (await page.eval(`(() => { const s = document.getElementById("to-shelf"); return !!s && s.classList.contains("hidden"); })()`)) === true, 15000, "no Shelf button");
  await api("settings/display", { enabled: false });
  page = await open("/display.html");
  await until(async () => (await page.eval(`location.pathname + "|" + document.body.textContent.includes("The wall display is turned off")`)) === "/display|true", 15000, "the wall display's off page");
  assert.equal(await page.eval(`document.scripts.length`), 0);
  await api("settings/display", { enabled: true });
  await api("settings/shelf", { enabled: true });
});
