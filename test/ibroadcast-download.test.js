"use strict";
/*
 * An iBroadcast album kept on the phone (item 448), against a stand-in on loopback (test/fake-ibroadcast.js) whose
 * tracks' files are fixtures: at "original", a FLAC and an MP3 come as iBroadcast keeps them, byte for byte; an AIFF,
 * which Android doesn't play, as FLAC made from it; at "opus", Opus made from it. Each kept once in the download
 * cache: asked again, iBroadcast isn't asked again. (Qobuz's and Tidal's are still refused: library-front.test.js.) In
 * the app's page, its album offers Download to this phone; a Qobuz album doesn't.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { makeLibrary, haveFfmpeg, gen, probe } = require("./fixtures");
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
const md5 = b => crypto.createHash("md5").update(b).digest("hex");

test("item 448: an iBroadcast album's tracks downloaded: the original where the phone plays it, else FLAC; Opus made from it", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const files = path.join(lib.root, "ib-files");
  const flac = path.join(files, "a.flac"), mp3 = path.join(files, "b.mp3"), aif = path.join(files, "c.aif");
  gen(flac, { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], tags: { title: "Flac One" } });
  gen(mp3, { fmt: null, codecArgs: ["-b:a", "192k"], tags: { title: "Mp3 Two" } });
  gen(aif, { tags: { title: "Aiff Three" } });
  const ib = await new FakeIBroadcast({ albums: [{ id: 701, name: "Cloud Only", artist: { id: 70, name: "Somebody Else" }, year: 2024, tracks: [
    { id: 7001, title: "Flac One", track: 1, type: "audio/flac", src: flac },
    { id: 7002, title: "Mp3 Two", track: 2, type: "audio/mpeg3", src: mp3 },
    { id: 7003, title: "Aiff Three", track: 3, type: "audio/aiff", src: aif }] }] }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, ibroadcastBaseUrl: ib.base });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  await until(async () => (await (await fetch(base + "/api/status", { headers: H })).json()).index_count >= 3, 60000, "the library");
  await fetch(base + "/api/settings/ibroadcast/signin", { method: "POST", headers: H, body: "{}" });
  ib.approve();
  const db = ctx.db.raw;
  const idOf = n => (db.prepare("SELECT id FROM tracks WHERE path = ?").get("ibroadcast://track/" + n) || {}).id;
  await until(() => idOf(7003), 30000, "the iBroadcast album in the library");
  const get = async (n, quality) => {
    const r = await fetch(`${base}/api/download/t${idOf(n)}?quality=${quality}`, { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ext: r.headers.get("x-download-ext"), body: Buffer.from(await r.arrayBuffer()) };
  };

  await t.test("original: the FLAC and the MP3 as iBroadcast keeps them; the AIFF as FLAC", async () => {
    const a = await get(7001, "original");
    assert.equal(a.status, 200);
    assert.deepEqual([a.ext, md5(a.body)], ["flac", md5(fs.readFileSync(flac))], "the FLAC byte for byte");
    const b = await get(7002, "original");
    assert.deepEqual([b.status, b.ext, md5(b.body)], [200, "mp3", md5(fs.readFileSync(mp3))], "the MP3 byte for byte");
    const c = await get(7003, "original");
    assert.deepEqual([c.status, c.ext], [200, "flac"], c.status === 200 ? "" : c.body.toString());
    // Its depth not known (iBroadcast says an AIFF's no more than its type): 24 bits, as for any file whose depth isn't.
    assert.deepEqual(probe(c.body), { rate: 44100, channels: 2, bits: 24 }, "the AIFF made FLAC");
    assert.ok(ib.streamAsks.every(x => !/Signature=/.test(x.path)), "the address's signature never in its path");
  });

  await t.test("opus: Opus made from the original", async () => {
    const o = await get(7001, "opus");
    assert.deepEqual([o.status, o.ext, o.body.subarray(0, 4).toString("latin1")], [200, "opus", "OggS"]);
  });

  if (findBrowser()) await t.test("in the app's page, Download to this phone for an iBroadcast album, never a Qobuz one", async () => {
    const b = await Browser.launch({ width: 412, height: 915 });
    try {
      const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }],
        init: "window.MusicdDownloads = { status: () => '{}', settings: () => '{}', set: () => {}, download: () => {}, remove: () => {}, open: () => {} };" });
      const offset = db.prepare("SELECT id FROM albums WHERE key = 'ibroadcast:701'").get().id;
      const items = await until(() => page.eval(`(() => typeof downloadMenuItem === "function" && [
        downloadMenuItem({ offset: ${offset}, source: "ibroadcast", title: "Cloud Only", subtitle: "Somebody Else" }).map(i => i.label),
        downloadMenuItem({ offset: 1, source: "qobuz", title: "Theirs", subtitle: "Someone" }).map(i => i.label)])()`), 15000, "the page's scripts");
      assert.deepEqual(items, [["Download to this phone"], []]);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });

  await t.test("kept once: asked again, iBroadcast isn't asked again", async () => {
    const asks = ib.streamAsks.length;
    const a = await get(7001, "original");
    assert.deepEqual([a.status, md5(a.body)], [200, md5(fs.readFileSync(flac))]);
    assert.equal(ib.streamAsks.length, asks);
  });
});
