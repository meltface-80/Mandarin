"use strict";
/*
 * A renderer that names the track it was set to all along (item 299): a Chord Poly playing DSFs made of PCM moved on
 * from track 1 to the next it was given by itself, gapless, and went on naming track 1's URI, its position from track
 * 2's start. The room stayed on track 1; past track 1's length it started track 2 by hand, the one already playing,
 * from its start (33 s before its end, on the owner's Poly with a Mojo 2). A position back at the start just after the
 * track's end, the next armed and taken, is the device on the next; and the URI it goes on naming is the track playing
 * from then on, so the move after it is followed too, and nothing is started by hand.
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

test("a renderer that names the track it was set to all along: its gapless moves are followed, nothing started by hand", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  // Track 2 longer than track 1, as Cutting Room Floor (222 s) after Savage Blood (183 s).
  for (const [i, seconds] of [[1, 30], [2, 50], [3, 30]])
    gen(path.join(lib.music, "Artist P", "Poly", `0${i} Poly ${i}.flac`), { seconds, freq: 300 * i, tags: { title: `Poly ${i}`, artist: "Artist P", album: "Poly", track: i } });
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics", model: "Poly", namesFirst: true });
  await poly.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [poly.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { poly.release(); await srv.stop(); await poly.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const ID = idFor(poly.udn);
  const line1 = async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.now_playing && z.now_playing.line1; };
  await until(async () => (await api("status")).index_count === 4);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === ID), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000);
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Poly");

  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(() => poly.state === "PLAYING");
  const first = poly.uri;
  const moves = () => poly.log.filter(a => a === "auto-next").length;
  const sets = () => poly.log.filter(a => a === "SetAVTransportURI").length;
  // Each track held at its start until the next is handed over, then let run out from 3 s before its end.
  const runOut = async (seconds) => {
    poly.hold();
    const was = moves();
    await until(() => poly.nextUri, 20000);
    poly.position = seconds - 3; poly.release();
    await until(() => moves() > was, 15000);
  };
  await runOut(30);
  assert.equal(poly.handle("GetPositionInfo", {}).TrackURI, first, "the device names track 1 still");
  await until(async () => (await line1()) === "Poly 2", 15000);
  // Past track 1's length (30 s) and its 4 s more, track 2 is still the one: not started again by hand.
  poly.hold(); poly.position = 40;
  await sleep(2500);
  assert.equal(await line1(), "Poly 2", "track 2 on screen past track 1's length");
  assert.equal(sets(), 1, "nothing started by hand: track 2 played on");
  // And the move after it, the device naming track 1 still.
  await runOut(50);
  await until(async () => (await line1()) === "Poly 3", 15000);
  await sleep(1500);
  assert.equal(await line1(), "Poly 3", "track 3, not track 1 again");
  assert.equal(sets(), 1, "gapless throughout: one SetAVTransportURI");
});
