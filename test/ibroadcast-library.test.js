"use strict";
/*
 * The iBroadcast library in Mandarin's (item 444), against a stand-in on loopback (test/fake-ibroadcast.js): read as
 * the sign-in lands; each album a service album on the walls ("ibroadcast:<id>"), its tracks' format from their type
 * (MP3 not lossless), their ReplayGain kept, the trash left out; an album iBroadcast keeps a disc an entry one album
 * with its discs; one you have here as files left out ("also here"), shown once; its cover fetched; the switch off
 * and on; Update library now bringing in what changed; signed out, gone. And the sign-in iBroadcast refuses for an app
 * not let sign in with a code, said with what to do.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
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
    await sleep(100);
  }
}

const albums = () => [
  { id: 101, name: "Discovery", artist: { id: 1, name: "Daft Punk" }, year: 2001, tracks: [
    { id: 1001, title: "One More Time", track: 1, length: 320, type: "audio/mpeg3", genre: "Electronic", artwork_id: 555, replay_gain: "-7.9" },
    { id: 1002, title: "Aerodynamic", track: 2, length: 212, type: "audio/mpeg3", genre: "Electronic", artwork_id: 555 },
    { id: 1003, title: "Deleted One", track: 3, length: 100, type: "audio/mpeg3", trashed: true }] },
  { id: 201, name: "Under A Groove", artist: { id: 2, name: "Funkadelic" }, disc: 1, year: 1978, tracks: [{ id: 2001, title: "Groove 1", track: 1, type: "audio/flac" }] },
  { id: 202, name: "Under A Groove", artist: { id: 2, name: "Funkadelic" }, disc: 2, year: 1978, tracks: [{ id: 2002, title: "Groove 2", track: 1, type: "audio/flac" }] },
  { id: 301, name: "Album One", artist: { id: 3, name: "Artist A" }, year: 1997, tracks: [{ id: 3001, title: "Song 1", track: 1, type: "audio/flac" }] },
  { id: 401, name: "Thrown Away", artist: { id: 4, name: "Someone" }, trashed: true, tracks: [{ id: 4001, title: "Gone", track: 1 }] },
];

test("item 444: the iBroadcast library in Mandarin's, its albums as service albums, refreshed, switched, gone at sign-out", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast({ albums: albums() }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, ibroadcastBaseUrl: ib.base });
  const ctx = await srv.start();
  const started = Date.now();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const state = async () => (await fetch(base + "/api/settings/ibroadcast", { headers: H })).json();
  const post = async (p, body = {}) => { const r = await fetch(base + "/api/settings/ibroadcast" + p, { method: "POST", headers: H, body: JSON.stringify(body) }); return Object.assign({ status: r.status }, await r.json()); };
  const walls = async () => { const j = await (await fetch(base + "/api/library/albums?limit=500", { headers: H })).json(); return (Array.isArray(j) ? j : j.albums || j.items || []).map(a => a.title + " / " + a.subtitle); };
  const db = ctx.db.raw;
  await until(async () => { const s = await (await fetch(base + "/api/status", { headers: H })).json(); return s.index_count >= 3 && !s.scanning; }, 60000, "the library");

  // Signed in: the library read at once (after the ten-minute look's first, twenty seconds in, so that one can't be what reads it).
  await sleep(Math.max(0, 22000 - (Date.now() - started)));
  await post("/signin");
  ib.approve();
  const read = await until(async () => { const s = await state(); return s.library && s.library.albums === 3 && s; }, 8000, "the library read");
  assert.deepEqual([read.library.import, read.library.also_here, read.library.tracks], [true, 1, 4], JSON.stringify(read.library));
  const shown = await until(async () => { const w = await walls(); return w.includes("Discovery / Daft Punk") && w; }, 20000, "the albums on the walls");
  assert.ok(shown.includes("Under A Groove / Funkadelic"), shown.join(", "));
  assert.equal(shown.filter(x => x === "Album One / Artist A").length, 1, "one here as files: shown once");
  assert.ok(!shown.some(x => x.startsWith("Thrown Away")), "the trash left out");

  // The rows: service albums, the format from the file's type, ReplayGain kept, the discs one album.
  const disco = db.prepare("SELECT t.path, t.codec, t.lossless, t.rg_track_gain, t.genres FROM tracks t JOIN albums a ON a.id = t.album_id WHERE a.key = 'ibroadcast:101' ORDER BY t.track_no").all();
  assert.deepEqual(disco.map(r => [r.path, r.codec, r.lossless]), [["ibroadcast://track/1001", "mp3", 0], ["ibroadcast://track/1002", "mp3", 0]]);
  assert.equal(disco[0].rg_track_gain, -7.9);
  assert.deepEqual(JSON.parse(disco[0].genres), ["Electronic"]);
  const groove = db.prepare("SELECT t.title, t.disc_no, t.lossless FROM tracks t JOIN albums a ON a.id = t.album_id WHERE a.key = 'ibroadcast:201' ORDER BY t.disc_no").all();
  assert.deepEqual(groove.map(r => [r.title, r.disc_no, r.lossless]), [["Groove 1", 1, 1], ["Groove 2", 2, 1]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM albums WHERE key = 'ibroadcast:202' OR key = 'ibroadcast:301'").get().n, 0);

  // Its cover, iBroadcast's for its first track.
  const art = await until(() => db.prepare("SELECT art_path FROM albums WHERE key = 'ibroadcast:101'").get().art_path, 20000, "the cover");
  assert.ok(fs.existsSync(art));
  assert.ok(ib.artworkAsks.includes("/artwork/artwork/555-1000"), JSON.stringify(ib.artworkAsks));

  // Switched off: off the walls; on: back.
  assert.equal((await post("", { import: false })).library.import, false);
  await until(async () => !(await walls()).includes("Discovery / Daft Punk"), 15000, "off the walls");
  await post("", { import: true });
  await until(async () => (await walls()).includes("Discovery / Daft Punk"), 15000, "back on the walls");

  // A new album at iBroadcast, one taken away: Update library now.
  ib.albums = albums().filter(a => a.id !== 201 && a.id !== 202).concat([{ id: 501, name: "Homework", artist: { id: 1, name: "Daft Punk" }, year: 1997, tracks: [{ id: 5001, title: "Da Funk", track: 1, type: "audio/flac" }] }]);
  ib.changed();
  const now = await post("/library");
  assert.deepEqual([now.status, now.library.albums], [200, 3]);
  const after = await until(async () => { const w = await walls(); return w.includes("Homework / Daft Punk") && w; }, 15000, "the new album");
  assert.ok(!after.some(x => x.startsWith("Under A Groove")), "gone from iBroadcast, gone here");

  if (findBrowser()) {
    // On the page: Services → iBroadcast, the library's switch on and what it holds.
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
      const seen = await until(() => page.eval(`(() => { const s = document.getElementById("ib-library-status"); return s && s.offsetParent && s.textContent && [s.textContent, document.getElementById("ib-import").checked]; })()`), 15000, "the library on the page");
      assert.match(seen[0], /^3 albums in iBroadcast · 1 of them here as files too, shown once · updated /);
      assert.equal(seen[1], true);
    } finally { await b.close(); }
  }

  // Signed out: its albums out of the library.
  await post("/signout");
  await until(async () => !(await walls()).some(x => x.startsWith("Discovery") || x.startsWith("Homework")), 15000, "gone at sign-out");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM albums WHERE key LIKE 'ibroadcast:%'").get().n, 0);

  // An app iBroadcast doesn't let sign in with a code: said, with what to do.
  ib.refuseGrant = true;
  await post("/signin");
  const refused = await until(async () => { const s = await state(); return s.pending && s.pending.error && s; }, 15000, "the refusal");
  assert.match(refused.pending.error, /allow the device code sign-in/);
});
