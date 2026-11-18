"use strict";
/*
 * Upload bandwidth (item 479): the home's upload speed, as its internet provider gives it, and the share of it the
 * upload to iBroadcast may use (25, 50, 75 or 100 %). A real upload took nearly all of a home's 108 Mbps for hours.
 *   - kept and said back (the limit it makes, and the fastest an upload sent over a second or more); a speed or share
 *     out of range refused;
 *   - with a limit, the upload sends no faster than it, all its files at once together (three here), not each;
 *   - no speed: no limit, as before;
 *   - the page: a row on iBroadcast's saying the limit opens its own page, where the speed is typed and the share
 *     chosen, said in Mbps with what it leaves; No limit takes it off; a reading of the settings answered after a
 *     change made since isn't painted over it (item 483).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
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
    await sleep(50);
  }
}

test("item 479: Upload bandwidth: the home's upload speed and the share of it to use, every file sent at once within it", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 50000000 });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: "all", at_once: 3 })).status, 200);
  /* Upload now, to its end: how long it took (ms) and its summary. */
  const upload = async () => {
    const was = (await state()).upload?.finished || 0;
    const t0 = Date.now();
    assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
    const u = await until(async () => { const x = (await state()).upload; return x && !x.running && x.finished && x.finished !== was && x; }, 120000, "the upload done");
    return { ms: Date.now() - t0, u };
  };

  // None given: no limit, as before.
  let s = (await state()).upload_speed;
  assert.deepEqual(s, { speed_mbps: null, percent: 100, limit_mbps: null, fastest_mbps: null });
  const free = await upload();
  assert.equal(free.u.uploaded, 7);
  const bytes = ib.uploads.reduce((n, u) => n + u.size, 0);

  // Refused: out of range, or a share not offered.
  for (const bad of [{ speed_mbps: 0 }, { speed_mbps: -5 }, { speed_mbps: "fast" }, { speed_mbps: 200000 }, { percent: 30 }, { percent: 75.5 }]) {
    const r = await call("POST", "settings/ibroadcast/upload/speed", bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(r.error, JSON.stringify(r));
  }
  // A speed whose 50 % sends the files in about 4 s.
  const mbps = Math.round(bytes / 4 * 8 / 1e6 * 2 * 10) / 10;
  const r = await call("POST", "settings/ibroadcast/upload/speed", { speed_mbps: mbps, percent: 50 });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual({ ...r.upload_speed, fastest_mbps: 0 }, { speed_mbps: mbps, percent: 50, limit_mbps: Math.round(mbps * 5) / 10, fastest_mbps: 0 });
  // Sent again as iBroadcast forgets them: the same files, three at once, within the limit together.
  ib.md5s.length = 0;
  ib.uploads.length = 0;
  ib.mostReceiving = 0;
  const held = await upload();
  assert.equal(held.u.uploaded, 7, JSON.stringify(held.u));
  const least = bytes / (mbps * 0.5 * 1e6 / 8) * 1000;
  assert.ok(held.ms >= least * 0.85, `within the limit: ${held.ms} ms for ${bytes} bytes at ${mbps / 2} Mbps (${Math.round(least)} ms at least)`);
  assert.ok(free.ms < least * 0.5, `and slower than with none: ${free.ms} ms then`);
  assert.equal(ib.mostReceiving, 3, "three arriving at once");
  // The fastest it has sent (over a second of sending, so it says the line): about the limit.
  s = (await state()).upload_speed;
  assert.ok(s.fastest_mbps > 0 && s.fastest_mbps <= mbps * 0.5 * 1.3, "the fastest it has sent, kept: " + JSON.stringify(s));
  // Taken off (no speed): as fast as it goes again.
  assert.equal((await call("POST", "settings/ibroadcast/upload/speed", { speed_mbps: null })).upload_speed.limit_mbps, null);
  ib.md5s.length = 0;
  ib.uploads.length = 0;
  const again = await upload();
  assert.ok(again.ms < least * 0.5, `no limit: ${again.ms} ms`);

  if (findBrowser()) await t.test("the page: a row on iBroadcast's, and its own page", async () => {
    assert.equal((await call("POST", "settings/ibroadcast/upload/speed", { percent: 100 })).status, 200);
    const b = await Browser.launch({ width: 412, height: 915 });
    try {
      // The answer to the page's reading of the settings kept from it while __holdReads is set (item 483): asked of the
      // server at once, so it says what was so then; its changes' answers let through.
      const HOLD = `(() => { const real = window.fetch.bind(window); window.fetch = async (u, o) => {
        const r = await real(u, o);
        if (String(u).includes("/api/settings/ibroadcast") && !(o && o.method === "POST")) while (window.__holdReads) await new Promise(f => setTimeout(f, 50));
        return r; }; })();`;
      const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], init: HOLD });
      await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 100 && !document.querySelector("#settings-toggle"); i++) await sleep(100);
        document.querySelector("#settings-toggle").click(); await sleep(300);
        document.querySelector('.settings-nav-item[data-pane="streaming"]').click(); await sleep(200);
        document.querySelector('[data-parity="settings-services.ibroadcast"]').click();
      })()`);
      const text = id => page.eval(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return e && e.offsetParent ? e.textContent : null; })()`);
      assert.equal(await until(() => text("ib-bandwidth-said"), 15000, "the row"), "No limit");
      await page.eval(`document.querySelector('[data-parity="settings-ibroadcast.bandwidth"]').click()`);
      assert.match(await until(() => text("ibb-limit"), 10000, "its page"), /^No limit: uploads use as much of your upload as they can/);
      assert.match(await text("ibb-speed-note"), /The fastest an upload has sent from here: [\d.]+ Mbps\.$/);
      const said = want => until(async () => { const t = await text("ibb-limit"); return t === want && t; }, 10000, want);
      // A reading asked as the page opened and answered after a change made since doesn't put the page back (item 483:
      // its answer, from before the change, was painted over the change's, the page left saying "No limit"). Held
      // here: the page opened again, its reading kept waiting, the speed typed and kept, then the reading let go.
      await page.eval(`document.querySelector('[data-parity="settings-ibroadcast-bandwidth.back"]').click()`);
      await page.eval(`window.__holdReads = true; document.querySelector('[data-parity="settings-ibroadcast.bandwidth"]').click(), true`);
      await page.eval(`(() => { const i = document.getElementById("ibb-speed"); i.focus(); i.value = "108"; i.dispatchEvent(new Event("change")); i.blur(); })()`);
      await said("Uploads use up to 108 Mbps: all of your upload.");
      await page.eval(`window.__holdReads = false, true`);
      await sleep(1000);
      assert.equal(await text("ibb-limit"), "Uploads use up to 108 Mbps: all of your upload.", "the reading from before the change, answered after it, isn't painted");
      assert.equal(await page.eval(`document.getElementById("ibb-speed").value`), "108");
      await page.eval(`[...document.querySelectorAll('#ibb-share .seg-btn')].find(x => x.textContent === "75%").click()`);
      await said("Uploads use up to 81 Mbps, leaving 27 Mbps for everything else.");
      assert.deepEqual((await state()).upload_speed, { speed_mbps: 108, percent: 75, limit_mbps: 81, fastest_mbps: s.fastest_mbps });
      assert.equal(await page.eval(`document.getElementById("ibb-speed").value`), "108");
      // Back on iBroadcast's page, the row says it.
      await page.eval(`document.querySelector('[data-parity="settings-ibroadcast-bandwidth.back"]').click()`);
      assert.equal(await until(async () => { const t = await text("ib-bandwidth-said"); return t === "Up to 81 Mbps" && t; }, 10000, "the row"), "Up to 81 Mbps");
      // Not a number: said, and nothing kept.
      await page.eval(`document.querySelector('[data-parity="settings-ibroadcast.bandwidth"]').click()`);
      await page.eval(`(() => { const i = document.getElementById("ibb-speed"); i.value = "fast"; i.dispatchEvent(new Event("change")); })()`);
      await sleep(500);
      assert.equal((await state()).upload_speed.speed_mbps, 108);
      // No limit: off.
      await page.eval(`document.getElementById("ibb-clear").click()`);
      await said("No limit: uploads use as much of your upload as they can. Enter your upload speed to set one.");
      assert.equal((await state()).upload_speed.speed_mbps, null);
      // The same on iBroadcast's own page (item 483): its reading asked again and its answer kept back, a switch put on
      // meanwhile, then the answer let go: the switch stays on.
      await page.eval(`document.querySelector('[data-parity="settings-ibroadcast-bandwidth.back"]').click()`);
      const home = () => page.eval(`document.getElementById("ib-home").checked`);
      assert.equal(await home(), false);
      await page.eval(`window.__holdReads = true; document.querySelector('[data-parity="settings-services.ibroadcast"]').click(); document.getElementById("ib-home").click(), true`);
      await until(async () => (await state()).upload_settings.home === true && (await home()) === true, 10000, "the switch kept");
      await page.eval(`window.__holdReads = false, true`);
      await sleep(1000);
      assert.equal(await home(), true, "the reading from before the switch, answered after it, isn't painted");
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });
});
