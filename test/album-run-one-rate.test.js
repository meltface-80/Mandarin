"use strict";
/*
 * An album as one stream is one stream of one rate (item 360). Reported: the Christmas Album played to a Mandarin Bridge
 * whose Output makes DSD256, with "Albums as one stream" on, played nothing, the Bridge saying "400, Bad Request" each
 * time, while an album of one rate played. Its tracks were joined into one run by their address, which for DSD256 from
 * PCM (.d256) doesn't say the track's own rate, and the stream route refuses a run whose tracks differ in rate: the
 * whole album was refused, then the rest of it from the second track, and so on. Now a run goes on only while the
 * tracks' own rate does: two at 44.1 kHz and two at 48 are two runs, each fetched whole.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeSlim } = require("./fake-slim");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), SLIM = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(100);
  }
}

test("an album of two rates made DSD256 as one stream: a run for each rate, each fetched whole", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const rates = [44100, 44100, 48000, 48000];
  rates.forEach((rate, k) => gen(path.join(lib.music, "Chris Rea", "Mixed Rates", `0${k + 1} Song ${k + 1}.flac`),
    { seconds: 2, rate, tags: { title: "Song " + (k + 1), artist: "Chris Rea", album: "Mixed Rates", track: k + 1 } }));
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, slimprotoPort: SLIM });
  await srv.start();
  const player = new FakeSlim({ port: SLIM, name: "Bridge", seconds: 4.5, caps: "Model=squeezelite,ModelName=SqueezeLite,MaxSampleRate=384000,dsf,dff,flc,pcm" });
  t.after(async () => { player.close(); await srv.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => (await api("status")).index_count >= rates.length, 30000, "the library");
  await player.connect();
  const ID = "SLIM_020000000031";
  await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID), 15000, "the player");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  assert.equal((await call("PATCH", "audio-devices/" + ID, { output: { dsd_out: 256, album_stream: true } })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000, "the room");
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Mixed Rates");
  const ids = (await api("album?offset=" + album.offset)).tracks.map(x => x.track_id);
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);

  // The first two tracks, at 44.1 kHz, one run; fetched whole.
  const first = `/stream/a${ids[0]}_${ids[1]}.d256.dsf`;
  await until(() => player.fetched.some(f => f.path.startsWith(first)), 20000, "the 44.1 kHz tracks' run fetched");
  assert.ok(!player.log.some(l => l.includes(`/stream/a${ids[0]}_${ids[1]}_${ids[2]}`)), "never a run across the change of rate: " + player.log.filter(l => l.startsWith("strm s")).join(" | "));
  assert.ok(player.fetched.find(f => f.path.startsWith(first)).bytes > 1000, "the 44.1 kHz run answered, not refused");
  // Then the two at 48 kHz, their own run, fetched whole too.
  const second = `/stream/a${ids[2]}_${ids[3]}.d256.dsf`;
  await until(() => player.fetched.some(f => f.path.startsWith(second)), 30000, "the 48 kHz tracks' run fetched: " + player.log.join(" | ") + " :: " + JSON.stringify(player.fetched));
  assert.ok(player.fetched.find(f => f.path.startsWith(second)).bytes > 1000, "the 48 kHz run answered, not refused");
  assert.deepEqual(player.fetched.filter(f => f.bytes === 0).map(f => f.path), [], "nothing refused");
});
