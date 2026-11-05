"use strict";
/*
 * An album as one stream (item 300): with a device's "Albums as one stream" on, an album's tracks made by Mandarin go
 * to it as one URI, /stream/a<id>_<id>…, from the track played: one SetAVTransportURI, nothing armed as the next, the
 * device opening one file for the whole album, as a CD plays. The room shows each track from where the device is in
 * the stream; Next starts the stream again at the next track, a seek at the seconds asked for (?ss=); a track's own
 * file again, gapless as before, with it off.
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

test("an album as one stream: one URI for the album, each track shown from where the device is, Next and a seek start it again there", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  for (const i of [1, 2, 3])
    gen(path.join(lib.music, "Artist S", "One Stream", `0${i} Side ${i}.flac`), { seconds: 4, freq: 300 * i, tags: { title: `Side ${i}`, artist: "Artist S", album: "One Stream", track: i } });
  const dev = new FakeRenderer({ name: "Streamer", manufacturer: "Chord Electronics", model: "Poly" });
  await dev.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [dev.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { dev.release(); await srv.stop(); await dev.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const ID = idFor(dev.udn);
  const zone = async () => (await api("zone-state?zone=" + ID)).zone || {};
  const line1 = async () => { const z = await zone(); return z.now_playing && z.now_playing.line1; };
  await until(async () => (await api("status")).index_count === 4);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === ID), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true, output: { mode: "x2", album_stream: true } })).status, 200);
  assert.equal((await api("audio-devices/" + ID)).output.album_stream, true, "the setting kept");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { album_stream: "yes" } })).status, 400, "on or off only");
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000);
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "One Stream");
  const ids = (await api("album?offset=" + album.offset)).tracks.map(x => x.track_id);

  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(() => dev.state === "PLAYING");
  dev.hold();
  // One URI for the album, from its first track, the device's file the whole album's.
  assert.match(dev.uri, new RegExp(`/stream/a${ids.join("_")}\\.88200-(24|32)\\.flac\\?`), "the album as one stream");
  await until(() => dev.fetches.some(f => f.uri === dev.uri && f.status === 200), 20000);
  const sets = () => dev.log.filter(a => a === "SetAVTransportURI").length;
  assert.equal(sets(), 1);
  await sleep(1500);
  assert.equal(dev.nextUri, "", "nothing armed as the next while the album plays");
  // Where the device is in the stream says the track.
  await until(async () => (await line1()) === "Side 1");
  dev.position = 5;
  await until(async () => (await line1()) === "Side 2", 15000);
  const z2 = await zone();
  assert.ok(z2.now_playing.seek_position >= 0.5 && z2.now_playing.seek_position <= 2, `track 2's own position: ${z2.now_playing.seek_position}`);
  dev.position = 9;
  await until(async () => (await line1()) === "Side 3", 15000);
  assert.equal(sets(), 1, "gapless: the device never told of another file");

  // Next from track 2: the stream begun again at track 3; a seek into track 2: begun there, 1.5 s in.
  dev.position = 5;
  await until(async () => (await line1()) === "Side 2", 15000);
  await api("control", { zone_or_output_id: ID, command: "next" });
  await until(() => new RegExp(`/stream/a${ids[2]}\\.`).test(dev.uri) === false && sets() === 2, 15000).catch(() => null);
  assert.equal(sets(), 2, "Next starts the stream again");
  assert.doesNotMatch(dev.uri, /\/stream\/a/, "the last track alone is no run: its own file");
  await until(async () => (await line1()) === "Side 3", 15000);
  await api("control", { zone_or_output_id: ID, command: "previous" });
  await until(() => sets() === 3, 15000);
  assert.match(dev.uri, new RegExp(`/stream/a${ids[1]}_${ids[2]}\\.`), "Previous: the run from track 2");
  await api("seek", { zone_or_output_id: ID, how: "absolute", seconds: 1.5 });
  await until(() => sets() === 4, 15000);
  assert.match(dev.uri, new RegExp(`/stream/a${ids[1]}_${ids[2]}\\..*[?&]ss=1\\.5`), "a seek: the run begun 1.5 s into track 2");
  await until(async () => (await line1()) === "Side 2", 15000);

  // Off: each track its own file again.
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { album_stream: false } })).status, 200);
  assert.equal((await api("audio-devices/" + ID)).output.album_stream, undefined, "off by its absence");
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);
  await until(() => /\/stream\/t\d+\./.test(dev.uri), 15000);
});
