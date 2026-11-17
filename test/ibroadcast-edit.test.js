"use strict";
/*
 * An iBroadcast album edited as the owner's own (item 458): its title, artist and year changed in Mandarin, laid over
 * what iBroadcast says as a local album's edits are over its files, and nothing sent to iBroadcast. Kept by the album's
 * key (iBroadcast's album id), so a reading of the library, iBroadcast's own name for it changed meanwhile, leaves the
 * edit in place; put back, iBroadcast's name again. On the page, Edit album in its ⋯ menu; never a Qobuz album's.
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
    await sleep(100);
  }
}

test("item 458: an iBroadcast album edited in Mandarin, kept through a reading of the library, put back", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast({ albums: [{ id: 801, name: "Writer", artist: { id: 80, name: "Carole Kng" }, year: 1970, tracks: [
    { id: 8001, title: "Spaceship Races", track: 1, type: "audio/flac" }, { id: 8002, title: "No Easy Way Down", track: 2, type: "audio/flac" }] }] }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 100000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ http: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  const db = ctx.db.raw;
  const offset = await until(() => (db.prepare("SELECT id FROM albums WHERE key = 'ibroadcast:801'").get() || {}).id, 30000, "the iBroadcast album");
  const trackIds = () => db.prepare("SELECT id FROM tracks WHERE path LIKE 'ibroadcast://track/%' ORDER BY path").all().map(r => r.id);
  const ids = trackIds();
  const album = async () => (await call("GET", "album?offset=" + offset)).album || {};
  const writes = () => ib.apiBodies.filter(b => !["/api/status"].includes(b.path)).length;

  await t.test("edited: its title, artist and year Mandarin's, nothing sent to iBroadcast", async () => {
    const before = writes();
    const r = await call("POST", "album/edit", { offset, title: "Writer: Carole King", artist: "Carole King", year: 1970 });
    assert.equal(r.http, 200, JSON.stringify(r));
    const a = await until(async () => { const x = await album(); return x.title === "Writer: Carole King" && x; }, 15000, "the edit on the album");
    assert.equal(a.subtitle, "Carole King");
    assert.equal(writes(), before, "nothing asked of iBroadcast");
    const state = await call("GET", "album/edit?offset=" + offset);
    assert.equal(state.http, 200);
  });

  await t.test("a reading of the library, iBroadcast's name changed meanwhile: the edit stays, the tracks keep their ids", async () => {
    ib.albums[0].name = "Writer (Remastered)";
    ib.changed();
    const reads = ib.libraryReads;
    await call("POST", "settings/ibroadcast/library");
    await until(() => ib.libraryReads > reads, 15000, "the library read again");
    await sleep(1000);
    const a = await album();
    assert.deepEqual([a.title, a.subtitle], ["Writer: Carole King", "Carole King"]);
    assert.deepEqual(trackIds(), ids);
  });

  await t.test("put back: iBroadcast's own name again", async () => {
    assert.equal((await call("POST", "album/edit/reset", { offset })).http, 200);
    const a = await until(async () => { const x = await album(); return x.title === "Writer (Remastered)" && x; }, 15000, "iBroadcast's name back");
    assert.equal(a.subtitle, "Carole Kng");
  });

  if (findBrowser()) await t.test("on the page, Edit album in an iBroadcast album's ⋯ menu; never a Qobuz album's", async () => {
    const b = await Browser.launch({ width: 412, height: 915 });
    try {
      const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }] });
      const seen = await until(() => page.eval(`(() => typeof ownAlbum === "function" && [ownAlbum({ source: "ibroadcast" }), ownAlbum({ source: "local" }), ownAlbum({}),
        ownAlbum({ source: "qobuz" }), ownAlbum({ source: "tidal" })])()`), 15000, "the page's scripts");
      assert.deepEqual(seen, [true, true, true, false, false]);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });
});
