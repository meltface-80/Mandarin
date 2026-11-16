"use strict";
/*
 * What the upload to iBroadcast sends and how hard it pushes (item 451), against a stand-in on loopback
 * (test/fake-ibroadcast.js), each upload held 1.5 s there so how many go at once can be counted:
 *   - Upload from: the drives offered are the folders at the top of the music folder the library has files in;
 *     nothing chosen at first, and Upload now refused till one is; a drive not offered refused; one chosen, only its
 *     files sent;
 *   - files at once with nothing playing, 1 to 3;
 *   - music playing at home holds it, unless let go on, then with its own number at once; a phone playing away from
 *     home holds it whatever home's switch says, unless its own lets it go on, with its own number;
 *   - the page says the choices.
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
const TAILNET = "100.101.102.103";   // a phone away from home, as the built-in Tailscale forwards it

test("item 451: Upload from a drive, files at once, and music playing at home or away", { skip, timeout: 300000 }, async (t) => {
  const lib = makeLibrary();
  // More of Artist A's, so three at once has enough to send.
  for (let i = 4; i <= 9; i++) gen(path.join(lib.music, "Artist A", "More", `0${i} More ${i}.flac`), { freq: 100 * i, tags: { title: "More " + i, artist: "Artist A", album: "More", track: i } });
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  ib.uploadDelayMs = 1500;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 50000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body, headers = {}) => {
    const r = await fetch(base + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token, "Content-Type": "application/json" }, headers), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const choose = body => call("POST", "settings/ibroadcast/upload/settings", body);
  const upload = () => call("POST", "settings/ibroadcast/upload");
  const finished = since => until(async () => { const u = (await state()).upload; return u && !u.running && u.finished > since && u; }, 120000, "the upload done");
  const lastFinished = async () => ((await state()).upload || {}).finished || 0;
  const db = ctx.db.raw;
  await until(async () => db.prepare("SELECT COUNT(*) AS n FROM tracks").get().n >= 13 && !(await call("GET", "status")).scanning, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");

  await t.test("Upload from: the drives offered; none chosen at first; only the chosen drive's files sent", async () => {
    const s = await state();
    assert.deepEqual(s.upload_settings, { from: null, from_name: null, at_once: 3, home: false, home_at_once: 3, away: false, away_at_once: 1 });
    assert.deepEqual(s.upload_sources.map(x => [x.name, x.files]), [["Artist A", 9], ["Artist B", 2], ["Comp", 2]]);
    const none = await upload();
    assert.deepEqual([none.status, none.error], [409, "Choose what to upload from first: All music or a drive"], "nothing chosen: refused");
    assert.equal((await choose({ from: "/somewhere/else" })).status, 400, "a drive not offered");
    assert.equal((await choose({ at_once: 4 })).status, 400, "four at once");
    const b = s.upload_sources.find(x => x.name === "Artist B");
    const kept = await choose({ from: b.path, at_once: 1 });
    assert.equal(kept.upload_settings.from_name, "Artist B");
    await upload();
    const u = await finished(0);
    assert.equal(u.from, "Artist B");
    assert.deepEqual(ib.uploads.map(x => path.basename(x.file_path)).sort(), ["01 Hi 1.flac", "02 Hi 2.flac"]);
    assert.equal(ib.mostAtOnce, 1, "one at once, as chosen");
  });

  await t.test("three at once with nothing playing", async () => {
    ib.mostAtOnce = 0;
    const s = await state();
    await choose({ from: s.upload_sources.find(x => x.name === "Artist A").path, at_once: 3 });
    const since = await lastFinished();
    await upload();
    const u = await finished(since);
    assert.equal(u.uploaded, 9, JSON.stringify(u));
    assert.equal(ib.mostAtOnce, 3);
  });

  // A phone playing Comp's album: at home, or away (its requests forwarded for a Tailscale address).
  let playing = null;
  const play = async away => {
    const h = away ? { "X-Forwarded-For": TAILNET } : {};
    const hello = await call("POST", "phone/hello", { name: away ? "Pixel away" : "Pixel home" }, h);
    const album = (await call("GET", "library/albums?sort=album")).albums.find(a => a.title === "Best Of");
    assert.equal((await call("POST", "play", { offset: album.offset, zone_or_output_id: hello.zone_id, kind: "play_now" }, h)).status, 200);
    playing = { on: true, h };
    const p = playing;
    p.done = (async () => { while (p.on) { await call("POST", "phone/state", { index: 0, position: 5, duration: 60, state: "playing", volume: 40 }, h); await sleep(400); } })();
  };
  const stopPlaying = async () => {
    if (!playing) return;
    playing.on = false;
    await playing.done;
    await call("POST", "phone/state", { index: 0, position: 6, duration: 60, state: "paused", volume: 40 }, playing.h);
    playing = null;
  };
  t.after(stopPlaying);

  await t.test("music playing at home holds it, unless let go on, then with its own number at once", async () => {
    gen(path.join(lib.music, "Comp", "CD3", "01.flac"), { freq: 777, tags: { title: "C3", artist: "Z", album: "Best Of", track: 1, disc: 3 } });
    gen(path.join(lib.music, "Comp", "CD3", "02.flac"), { freq: 888, tags: { title: "C4", artist: "Z", album: "Best Of", track: 2, disc: 3 } });
    gen(path.join(lib.music, "Comp", "CD3", "03.flac"), { freq: 999, tags: { title: "C5", artist: "Z", album: "Best Of", track: 3, disc: 3 } });
    await call("POST", "library/rescan");
    await until(async () => db.prepare("SELECT COUNT(*) AS n FROM tracks").get().n >= 16 && !(await call("GET", "status")).scanning, 60000, "Comp's new files");
    await choose({ from: (await state()).upload_sources.find(x => x.name === "Comp").path, at_once: 3, home: false, home_at_once: 2 });
    await play(false);
    const since = await lastFinished();
    const n = ib.uploads.length;
    await upload();
    const held = await until(async () => { const u = (await state()).upload; return u.running && u.held && u; }, 15000, "held at home");
    assert.equal(held.held_where, "home");
    await sleep(1200);
    assert.equal(ib.uploads.length, n, "nothing sent while it plays at home");
    ib.mostAtOnce = 0;
    await choose({ home: true });
    const u = await finished(since);
    assert.equal(u.uploaded, 5, JSON.stringify(u));
    assert.equal(ib.mostAtOnce, 2, "two at once while music plays at home, as chosen");
    await stopPlaying();
  });

  await t.test("a phone playing away from home holds it whatever home's switch says, unless its own lets it go on", async () => {
    for (let i = 1; i <= 3; i++) gen(path.join(lib.music, "Comp", "CD4", `0${i}.flac`), { freq: 300 + i * 50, tags: { title: "D" + i, artist: "Z", album: "Best Of", track: i, disc: 4 } });
    await call("POST", "library/rescan");
    await until(async () => db.prepare("SELECT COUNT(*) AS n FROM tracks").get().n >= 19 && !(await call("GET", "status")).scanning, 60000, "Comp's newer files");
    await choose({ home: true, home_at_once: 3, away: false, away_at_once: 1 });
    await play(true);
    const since = await lastFinished();
    const n = ib.uploads.length;
    await upload();
    const held = await until(async () => { const u = (await state()).upload; return u.running && u.held && u; }, 15000, "held away");
    assert.equal(held.held_where, "away");
    await sleep(1200);
    assert.equal(ib.uploads.length, n, "nothing sent while a phone plays away from home");
    ib.mostAtOnce = 0;
    await choose({ away: true });
    const u = await finished(since);
    assert.equal(u.uploaded, 3, JSON.stringify(u));
    assert.equal(ib.mostAtOnce, 1, "one at once while a phone plays away, as chosen");
    await stopPlaying();
  });

  if (findBrowser()) await t.test("the page says the choices", async () => {
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
      const seen = await until(() => page.eval(`(() => {
        const from = [...document.querySelectorAll('#ib-from [data-parity="settings-ibroadcast.from"]')];
        if (!from.length || !from[0].offsetParent) return null;
        const on = q => [...document.querySelectorAll(q + " .seg-btn.is-on")].map(x => x.textContent).join();
        return [from.map(x => x.textContent + (x.classList.contains("is-on") ? "*" : "")).join(), on("#ib-at-once"), document.getElementById("ib-home").checked, on("#ib-home-at-once"),
          document.getElementById("ib-away").checked, on("#ib-away-at-once")];
      })()`), 15000, "the choices on the page");
      assert.deepEqual(seen, ["All music,Artist A,Artist B,Comp*", "3", true, "3", true, "1"]);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });
});
