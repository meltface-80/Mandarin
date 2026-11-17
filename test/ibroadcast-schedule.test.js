"use strict";
/*
 * The upload to iBroadcast on a schedule (item 447), against a stand-in on loopback (test/fake-ibroadcast.js), the
 * clock looked at every 300 ms (ibroadcast_schedule_tick_ms):
 *   - an upload window can't overlap the Library Scanner's hours (over midnight too), nor be set while the scanner has
 *     none; one that only touches them can. Refused in words that say the scanner's hours;
 *   - from the scanner's side likewise: its hours over the window, or its Schedule off, refused, saying the window;
 *     each side's answer says the other's hours;
 *   - the window opening begins the upload, once a window; its closing stops one it began;
 *   - the page says the window and the scanner's hours.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { Browser, findBrowser } = require("./browser-harness");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}
/* The time [minutes] from now, on this machine's clock (the server's), as "HH:MM". */
const from = minutes => {
  const d = new Date(Date.now() + minutes * 60000);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

test("item 447: the upload on a schedule, never over the Library Scanner's hours, begun and stopped by its window", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastScheduleTickMs: 300 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const schedule = body => call("POST", "settings/ibroadcast/schedule", body);
  const scanner = body => call("POST", "album-scanner", body);
  const logged = re => ctx.logs.filter(l => re.test(l)).length;
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");

  await t.test("a window over the scanner's hours, or while it has none, is refused, saying them", async () => {
    assert.deepEqual((await state()).scanner_hours, { on: true, start: "01:00", end: "06:00" }, "the Library Scanner's hours as they are at first");
    assert.deepEqual((await state()).schedule, { on: false, start: "22:00", end: "01:00" }, "off, until set");
    const inside = await schedule({ on: true, start: "02:00", end: "03:00" });
    assert.equal(inside.status, 409);
    assert.equal(inside.error, "The upload window 02:00–03:00 overlaps the Library Scanner's hours, 01:00–06:00: choose hours outside them");
    assert.equal((await schedule({ on: true, start: "23:00", end: "01:30" })).status, 409, "over midnight, into its hours");
    assert.equal((await schedule({ on: true, start: "05:59", end: "07:00" })).status, 409, "a minute of its hours");
    assert.match((await schedule({ on: true, start: "08:00", end: "08:00" })).error, /the same time/);
    assert.match((await schedule({ on: true, start: "8 pm" })).error, /start must be a time like 01:00/);
    assert.equal((await state()).schedule.on, false, "none of them kept");
    const touching = await schedule({ on: true, start: "22:00", end: "01:00" });
    assert.equal(touching.status, 200, JSON.stringify(touching));
    assert.deepEqual(touching.schedule, { on: true, start: "22:00", end: "01:00" }, "ending as the scanner begins: no minute shared");
  });

  await t.test("from the scanner's side: its hours over the window, or none, refused, saying the window", async () => {
    const over = await scanner({ start: "00:30" });
    assert.equal(over.status, 409);
    assert.equal(over.error, "These hours overlap iBroadcast's upload window, 22:00–01:00: choose hours outside it");
    const none = await scanner({ schedule: false });
    assert.equal(none.status, 409);
    assert.match(none.error, /^iBroadcast uploads are set for 22:00–01:00/);
    const s = await call("GET", "album-scanner");
    assert.deepEqual([s.schedule.on, s.schedule.start, s.schedule.end], [true, "01:00", "06:00"], "the scanner's hours as they were");
    assert.deepEqual(s.upload_window, { start: "22:00", end: "01:00" }, "the window said beside them");
    const moved = await scanner({ start: "02:00" });
    assert.equal(moved.status, 200);
    assert.deepEqual((await state()).scanner_hours, { on: true, start: "02:00", end: "06:00" });
    // The upload schedule off: the scanner's Schedule may go off; then no window can be set.
    assert.equal((await schedule({ on: false })).status, 200);
    assert.equal((await call("GET", "album-scanner")).upload_window, null);
    assert.equal((await scanner({ schedule: false })).status, 200);
    const noHours = await schedule({ on: true });
    assert.equal(noHours.status, 409);
    assert.match(noHours.error, /^The Library Scanner has no hours \(its Schedule is off\)/);
    assert.equal((await scanner({ schedule: true })).status, 200);
  });

  if (findBrowser()) await t.test("the page says the window and the scanner's hours", async () => {
    assert.equal((await schedule({ on: true, start: "22:00", end: "01:00" })).status, 200);
    const b = await Browser.launch({ width: 412, height: 915 });
    try {
      const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }] });
      await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && !document.querySelector("#settings-toggle"); i++) await sleep(100);
        document.querySelector("#settings-toggle").click(); await sleep(300);
        document.querySelector('.settings-nav-item[data-pane="streaming"]').click(); await sleep(200);
        document.querySelector('[data-parity="settings-services.ibroadcast"]').click();
      })()`);
      const $ = id => `document.getElementById("${id}")`;
      const seen = await until(() => page.eval(`(() => { const n = ${$("ib-scanner-hours")}; return n && n.offsetParent && n.textContent && [${$("ib-schedule")}.checked,
        ${$("ib-schedule-note")}.textContent, !${$("ib-schedule-times")}.hidden, ${$("ib-start")}.value, ${$("ib-end")}.value, n.textContent]; })()`), 15000, "the schedule on the page");
      assert.deepEqual(seen, [true, "Uploads each day between these times, stopping at the end", true, "22:00", "01:00",
        "The Library Scanner runs 02:00–06:00: the upload window can't overlap it."]);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });

  await t.test("the window opening begins the upload, once; its closing stops one it began", async () => {
    // The scanner's hours well away from now, the window around now: whatever the time the test runs at.
    assert.equal((await schedule({ on: false })).status, 200);
    assert.equal((await scanner({ start: from(30), end: from(90) })).status, 200);
    // Nothing chosen to upload from (item 451): the window opens, and nothing begins.
    const before = ib.md5Asks;
    assert.equal((await schedule({ on: true, start: from(-1), end: from(5) })).status, 200);
    await until(() => logged(/upload schedule: the window opened, but nothing is chosen to upload from/) === 1, 10000, "said once");
    await sleep(1000);
    assert.equal(ib.md5Asks, before, "nothing begun");
    assert.equal((await schedule({ on: false })).status, 200);
    await sleep(700);
    assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: "all" })).status, 200);
    const asks = ib.md5Asks;
    assert.equal((await schedule({ on: true, start: from(-1), end: from(5) })).status, 200);
    const done = await until(async () => { const u = (await state()).upload; return u && !u.running && u.finished && u; }, 20000, "the upload the window began");
    assert.equal(done.uploaded, 7, JSON.stringify(done));
    assert.equal(logged(/\[ibroadcast\] upload schedule: the window opened, the upload begun/), 1);
    await sleep(2000);
    assert.equal(ib.md5Asks, asks + 1, "begun once a window, not again when it ends early");

    // A file more, sent slowly; the window opened again, then closed under it: stopped after the file it is on.
    gen(path.join(lib.music, "New", "One", "01 New.flac"), { freq: 321, tags: { title: "New", artist: "New", album: "One", track: 1 } });
    gen(path.join(lib.music, "New", "One", "02 Newer.flac"), { freq: 654, tags: { title: "Newer", artist: "New", album: "One", track: 2 } });
    await call("POST", "library/rescan");
    await until(async () => (await call("GET", "status")).index_count >= 4 && !(await call("GET", "status")).scanning, 60000, "the new album");
    ib.uploadDelayMs = 3000;
    assert.equal((await schedule({ on: false })).status, 200);
    await sleep(700);
    assert.equal((await schedule({ on: true })).status, 200);
    await until(async () => (await state()).upload.running, 10000, "begun again as the window opened again");
    assert.equal((await schedule({ start: from(100), end: from(110) })).status, 200);
    const stopped = await until(async () => { const u = (await state()).upload; return !u.running && u.stopped && u; }, 20000, "stopped as the window closed");
    assert.ok(stopped.uploaded < 2, JSON.stringify(stopped));
    assert.equal(logged(/\[ibroadcast\] upload schedule: the window closed, the upload stopped/), 1);
  });
});
