"use strict";
/*
 * An album as one stream on a Chord Poly (item 305). Played as DSD256, Dark Side of the Moon went a track at a time:
 * the Poly named the track it had been playing for its first reads after the jump, and gave the stream's URI back with
 * its &s escaped. Mandarin took either for the device having left the stream, armed track 2 as the next, and at track
 * 1's end started track 2 by hand, the stream begun again each time with a long gap. Now a device naming what it played
 * before, or the stream's URI as it gives it back, is still in the stream: nothing armed, nothing started by hand.
 * As PCM ×16 to 705.6 kHz the stream is a WAV, whose header can say no more than 4 GB, and past that the Poly played
 * nothing (nor FLAC at that rate, item 307): an album goes as several streams, each one as long as its header can say.
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
async function until(fn, ms = 15000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(100);
  }
}

test("an album as one stream on a Poly: slow to name it and its URI given back escaped, still one stream; a WAV no longer than its header says", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  for (const i of [1, 2, 3])
    gen(path.join(lib.music, "Artist P", "Moon", `0${i} Moon ${i}.flac`), { seconds: 4, freq: 300 * i, tags: { title: `Moon ${i}`, artist: "Artist P", album: "Moon", track: i } });
  // Four tracks of 5 minutes: as 24/705.6 WAV, three fit in 4 GB (1014 s), the fourth doesn't.
  for (const i of [1, 2, 3, 4])
    gen(path.join(lib.music, "Artist L", "Long", `0${i} Long ${i}.flac`), { seconds: 300, freq: 200 * i, tags: { title: `Long ${i}`, artist: "Artist L", album: "Long", track: i } });
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics", model: "Poly", slowToName: 3, escapesUri: true });
  const rates = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
  const bridge = new FakeRenderer({ name: "Bridge", manufacturer: "Mandarin", model: "Mandarin Bridge", fetches: false,
    sink: "http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/x-dsf:*",
    dac: { device: "DAC", rates, bits: [24, 32], dsd: [64, 128, 256], dsd_mode: "native", volume_control: false, fixed: true } });
  await poly.start(); await bridge.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [poly.location, bridge.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { poly.release(); await srv.stop(); await poly.stop(); await bridge.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const P = idFor(poly.udn), W = idFor(bridge.udn);
  const line1 = async () => { const z = (await api("zone-state?zone=" + P)).zone; return z && z.now_playing && z.now_playing.line1; };
  await until(async () => (await api("status")).index_count === 5, 30000);
  await until(async () => { const d = (await api("audio-devices")).devices; return d.some(x => x.id === P) && d.some(x => x.id === W); }, 20000);
  assert.equal((await call("PATCH", "audio-devices/" + P, { enabled: true, output: { mode: "x2", album_stream: true } })).status, 200);
  assert.equal((await call("PATCH", "audio-devices/" + W, { enabled: true, output: { mode: "max", bits: 24, filter: "gaussian", album_stream: true } })).status, 200);
  await until(async () => { const z = (await api("zones")).zones; return z.some(x => x.zone_id === P) && z.some(x => x.zone_id === W); }, 20000);
  const albums = (await api("library/albums?sort=album")).albums;
  const moon = albums.find(a => a.title === "Moon"), long = albums.find(a => a.title === "Long");
  const ids = async al => (await api("album?offset=" + al.offset)).tracks.map(x => x.track_id);

  // The Poly: playing another album first, so that it has a track of its own to go on naming after the jump.
  const other = albums.find(a => a.title !== "Moon" && a.title !== "Long");
  assert.equal((await api("play", { offset: other.offset, zone_or_output_id: P, kind: "play_now" })).status, 200);
  await until(() => poly.state === "PLAYING");
  poly.hold();
  await sleep(1500);
  assert.equal((await api("play", { offset: moon.offset, zone_or_output_id: P, kind: "play_now" })).status, 200);
  await until(() => poly.uri.includes("/stream/a"));
  const sets = () => poly.log.filter(a => a === "SetAVTransportURI").length;
  const was = sets();
  await until(() => poly.state === "PLAYING");
  await sleep(2500);
  assert.equal(poly.nextUri, "", "nothing armed as the next: the stream kept through the reads naming what it played before");
  await until(async () => (await line1()) === "Moon 1");
  // Past track 1's length (4 s), the stream's URI given back escaped: track 2, from where the device is in the stream.
  poly.position = 6;
  await until(async () => (await line1()) === "Moon 2");
  poly.position = 9;
  await until(async () => (await line1()) === "Moon 3");
  await sleep(2000);
  assert.equal(sets(), was, "one stream throughout: nothing started by hand");
  assert.equal(poly.nextUri, "", "nothing armed");

  // The Bridge at 24/705.6: the run of the three that fit as one WAV, the fourth after it.
  const lids = await ids(long);
  assert.equal((await api("play", { offset: long.offset, zone_or_output_id: W, kind: "play_now" })).status, 200);
  await until(() => bridge.uri.includes("/stream/"));
  assert.match(bridge.uri, new RegExp(`/stream/a${lids.slice(0, 3).join("_")}\\.705600-24\\.wav\\?`), "three tracks of five minutes in one WAV, the fourth not");
});
