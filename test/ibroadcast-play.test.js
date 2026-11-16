"use strict";
/*
 * iBroadcast's tracks played (item 445), against a stand-in on loopback (test/fake-ibroadcast.js): each lossless
 * track's rate and depth read from its original's first bytes once the library is read, so a 24/96 FLAC is planned at
 * 24/96, never at a row's 16/44.1; its stream made from iBroadcast's original ("orig", the access token as its
 * signature, its file and user ids, Mandarin as the platform) as it comes; away from home as Opus 256, an MP3 too;
 * made DSD from PCM by Mandarin's own upsampler, as a file of the library is; no
 * token in the log.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen, probe } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

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

test("item 445: iBroadcast's tracks played from their originals, at their own rate, away as Opus, made DSD", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const hi = path.join(lib.data, "..", "ib-hi.flac"), lossy = path.join(lib.data, "..", "ib-lossy.mp3");
  gen(hi, { seconds: 3, rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], tags: { title: "Hi" } });
  gen(lossy, { seconds: 3, fmt: null, codecArgs: ["-b:a", "192k"], tags: { title: "Lo" } });
  assert.deepEqual([probe(fs.readFileSync(hi)).rate, probe(fs.readFileSync(hi)).bits], [96000, 24], "the fixture is 24/96");
  const ib = await new FakeIBroadcast({ albums: [
    { id: 601, name: "Hi Res Here", artist: { id: 6, name: "Band" }, year: 2020, tracks: [{ id: 6001, title: "Hi", track: 1, length: 3, type: "audio/flac", src: hi }] },
    { id: 701, name: "Lossy Here", artist: { id: 7, name: "Band" }, year: 2001, tracks: [{ id: 7001, title: "Lo", track: 1, length: 3, type: "audio/mpeg3", src: lossy }] },
  ] }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 3000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const db = ctx.db.raw;
  await fetch(base + "/api/settings/ibroadcast/signin", { method: "POST", headers: H, body: "{}" });
  ib.approve();

  // The lossless track's rate and depth read from its original; the MP3 left as it is.
  const hiRow = await until(() => { const r = db.prepare("SELECT id, sample_rate, bits FROM tracks WHERE path = 'ibroadcast://track/6001'").get(); return r && r.sample_rate && r; }, 30000, "the rate read");
  assert.deepEqual([hiRow.sample_rate, hiRow.bits], [96000, 24]);
  assert.ok(ib.streamAsks.some(a => a.range === "bytes=0-65535"), "read from its first bytes: " + JSON.stringify(ib.streamAsks.map(a => a.range)));
  assert.deepEqual(db.prepare("SELECT max_rate, max_bits FROM albums WHERE key = 'ibroadcast:601'").get(), { max_rate: 96000, max_bits: 24 });
  const loRow = db.prepare("SELECT id, sample_rate FROM tracks WHERE path = 'ibroadcast://track/7001'").get();
  assert.equal(loRow.sample_rate, null);

  // A library read before each track's file was kept (an update to item 445 left them so, and nothing played; item 450):
  // the ten-minute look reads it again though iBroadcast says nothing changed; a track played meanwhile has it read first.
  const files = () => db.prepare("SELECT COUNT(*) AS n FROM cache WHERE ns = 'ibroadcast-file'").get().n;
  const reads = ib.libraryReads;
  db.prepare("DELETE FROM cache WHERE ns = 'ibroadcast-file'").run();
  await until(() => files() === 2, 15000, "the files known again by the look");
  assert.ok(ib.libraryReads > reads, "read again");
  db.prepare("DELETE FROM cache WHERE ns = 'ibroadcast-file'").run();
  const state = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'ibroadcastLibrary'").get().value);
  state.at = Date.now() - 120000;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'ibroadcastLibrary'").run(JSON.stringify(state));
  ib.streamAsks.length = 0;
  const healed = await fetch(base + "/stream/t" + hiRow.id + ".96000-24.flac", { headers: H });
  assert.equal(healed.status, 200, "played: the library read again first: " + (healed.status !== 200 ? await healed.clone().text() : ""));
  await healed.arrayBuffer();

  // Its stream from iBroadcast's original, at 24/96 (a room planned from the row's 96000/24 asks for that): as made just
  // above, and kept.
  const s = await fetch(base + "/stream/t" + hiRow.id + ".96000-24.flac", { headers: H });
  assert.equal(s.status, 200);
  const p = probe(Buffer.from(await s.arrayBuffer()));
  assert.deepEqual([p && p.rate, p && p.bits], [96000, 24], "at its own rate and depth: " + JSON.stringify(p));
  const asked = ib.streamAsks.find(a => !a.range) || ib.streamAsks[0];
  assert.equal(asked.path, "/streaming/orig/a/b/6001", "the original, never a transcode");
  assert.deepEqual([asked.query.Signature, asked.query.file_id, asked.query.user_id, asked.query.platform], [ib.access, "6001", "4242", "mandarin"]);
  assert.ok(Number(asked.query.Expires) > Date.now() - 60000);

  // Away from home: Opus 256, the MP3 too.
  for (const id of [hiRow.id, loRow.id]) {
    const o = await fetch(base + "/stream/t" + id + ".flac?q=opus", { headers: H });
    assert.equal(o.status, 200, "opus for " + id);
    assert.match(o.headers.get("content-type") || "", /ogg/);
    const b = Buffer.from(await o.arrayBuffer());
    assert.equal(b.subarray(0, 4).toString("latin1"), "OggS");
    assert.ok(b.includes(Buffer.from("OpusHead")), "Opus in it");
  }

  // Made DSD from PCM by Mandarin's own upsampler, as a file is.
  const dsf = await fetch(base + "/stream/t" + hiRow.id + ".d64.dsf", { headers: H });
  assert.equal(dsf.status, 200, "DSD from an iBroadcast track is made, not refused");
  assert.equal(Buffer.from(await dsf.arrayBuffer()).subarray(0, 4).toString("latin1"), "DSD ");

  // The log never holds the token.
  const log = fs.readFileSync(path.join(lib.data, "Logs", "Mandarin_log.txt"), "utf8");
  assert.ok(!log.includes(ib.access), "no token in the log");
});
