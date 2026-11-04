"use strict";
/*
 * A renderer that names the next track as soon as it is given it (item 233): a FiiO SR11 answers GetPositionInfo
 * with the URI SetNextAVTransportURI handed it, a moment after an album is started, while it goes on playing the
 * first track. The server took that for the device having moved on, and Play now showed track 2 at once while
 * track 1 played; Play now again sometimes put it right, sometimes not. A move to another track is believed when
 * the track playing has come to its end, or the position has gone back to the start; the device's gapless move at
 * the end of the track is still followed, with no second SetAVTransportURI.
 *
 * Item 273: a device that names the next track all along has moved on only when its position goes back to the start;
 * in the last 15 s of a track it hadn't, and the server showed the next track there, its position the first's: past
 * the end of a shorter next track, that was started by hand, and the next track was never played (Angel, track 2 of
 * Old Sock, on the owner's SR11).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

test("a renderer that names the next track early: the track playing stays on screen, the real move is followed", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  // A long track before a short one, and one after: the end of the first is past the second's whole length.
  for (const [i, seconds] of [[1, 40], [2, 5], [3, 5]])
    gen(path.join(lib.music, "Artist E", "Run Out", `0${i} Run ${i}.flac`), { seconds, freq: 200 * i, tags: { title: `Run ${i}`, artist: "Artist E", album: "Run Out", track: i } });
  const sr11 = new FakeRenderer({ name: "SR11", manufacturer: "FiiO", model: "SR11", namesNext: true });
  await sr11.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [sr11.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { sr11.release(); await srv.stop(); await sr11.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const line1 = async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.now_playing && z.now_playing.line1; };
  await until(async () => (await api("status")).index_count === 4);
  const ID = idFor(sr11.udn);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === ID), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000);
  const albums = (await api("library/albums?sort=album")).albums;
  const one = albums.find(a => a.title === "Album One");

  assert.equal((await api("play", { offset: one.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(() => sr11.state === "PLAYING");
  // Track 1 held at its start, so it can't run out while the next is handed over and the device names it.
  sr11.hold();
  await until(() => sr11.nextUri, 20000);
  assert.equal(sr11.handle("GetPositionInfo", {}).TrackURI, sr11.nextUri, "the device names the next track already");
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) { seen.push(await line1()); await sleep(250); }
  assert.deepEqual([...new Set(seen)], ["Song 1"], "track 1 on screen while track 1 plays");

  // Let track 1 run out: the device moves on by itself, and the screen follows.
  sr11.release();
  await until(() => sr11.log.includes("auto-next"), 15000);
  await until(async () => (await line1()) === "Song 2", 15000);
  assert.equal(sr11.log.filter(a => a === "SetAVTransportURI").length, 1, "gapless: no second SetAVTransportURI");

  // Item 273: the last 15 s of a long track, the next named all along: the first stays on screen to its end, and
  // the short one after it is played, not passed over for the one after that.
  const run = albums.find(a => a.title === "Run Out");
  assert.equal((await api("play", { offset: run.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(async () => (await line1()) === "Run 1");
  sr11.hold();
  await until(() => sr11.nextUri, 20000);
  const sent = sr11.log.filter(a => a === "SetAVTransportURI").length;
  const moves = () => sr11.log.filter(a => a === "auto-next").length;
  const moved = moves();
  sr11.position = 31; sr11.release();
  const end = [];
  while (moves() === moved && end.length < 60) { end.push(await line1()); await sleep(250); }
  assert.deepEqual([...new Set(end)], ["Run 1"], "track 1 on screen to its end");
  await until(async () => (await line1()) === "Run 2", 15000);
  await sleep(1500);
  assert.equal(sr11.log.filter(a => a === "SetAVTransportURI").length, sent, "nothing started by hand: track 2 played");
});
