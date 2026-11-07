"use strict";
/*
 * A Mandarin Bridge played Mandarin's continuous PCM (item 322, Renderers/Slim/SlimRuns.cs), over SlimProto: its hello
 * says ContinuousPcm=1, and Mandarin gives it an album at 16/44.1 as one run, one stream of samples alone (strm s 'p',
 * 16 bits, 44.1 kHz, two channels, little-endian), the tracks one on into the next; it follows the track heard from
 * where the Bridge is in the run, and tells the Bridge each track it comes to (mtrk). A seek makes the track again
 * from there, a run of its own, and the track after it still follows; at the end of the queue it stops on the last
 * track, never begun again. A stand-in Bridge here (test/fake-slim-pcm.js); the real one, end to end, in
 * test/bridge-linux.test.js.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeSlimPcm } = require("./fake-slim-pcm");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), SLIM = ports.port(), B = "http://127.0.0.1:" + PORT;
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

test("a Mandarin Bridge played continuous PCM: an album as one run, each track said, a seek, stopped at the end", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, slimprotoPort: SLIM });
  const { logs } = await srv.start();
  const bridge = new FakeSlimPcm({ port: SLIM, name: "Pcm Bridge", mac: "02:00:00:00:00:52" });
  t.after(async () => { bridge.close(); await srv.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => (await api("status")).index_count >= 3, 30000, "the library");
  await bridge.connect();
  const ID = "SLIM_020000000052";
  await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID), 15000, "the Bridge, a device");
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000, "its room");
  const zone = async () => (await api("zone-state?zone=" + ID)).zone || {};
  const line1 = async () => ((await zone()).now_playing || {}).line1;
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);

  // One run for the album: one strm s of PCM, 16/44.1, to wait for Play; the tracks follow in it, each said.
  await until(async () => (await line1()) === "Song 2", 20000, "Song 2 heard, in the run");
  const given = bridge.log.filter(l => l.startsWith("strm s "));
  assert.equal(given.length, 1, "one stream for both tracks: " + given.join(" | "));
  assert.match(given[0], new RegExp(`^strm s p 0 /stream/slim/${ID}/1\\.pcm\\?s=`), "PCM, its address signed");
  assert.match(bridge.requests[0], /X-Mandarin-Title: Song%201/, "its first track said in the request");
  assert.ok(bridge.log.includes("strm u"), "Play said");
  await until(() => bridge.log.includes("mtrk Song 2"), 3000, "the Bridge told it came to Song 2 (at its next STAT)");

  // A seek in Song 2: made again from 1.5 s, a run of its own; the room's position from there; Song 3 still after it.
  await api("seek", { zone_or_output_id: ID, how: "absolute", seconds: 1.5 });
  await until(async () => { const z = await zone(); return z.now_playing && z.now_playing.line1 === "Song 2" && z.now_playing.seek_position >= 1.5; }, 10000, "Song 2 from 1.5 s");
  const at = bridge.log.findIndex(l => l.startsWith(`strm s p 1 /stream/slim/${ID}/2.pcm`));
  assert.ok(at > 0, "run 2, playing on: " + bridge.log.join(" | "));
  assert.equal(bridge.log[at - 1], "strm q", "what it played stopped first");
  await until(async () => (await line1()) === "Song 3", 10000, "Song 3 after the seek's run");
  await until(() => bridge.log.slice(at).includes("mtrk Song 3"), 3000, "the Bridge told of Song 3 in run 2");

  // The end of the queue: stopped on Song 3, never begun again.
  await until(async () => (await zone()).state === "stopped", 10000, "stopped at the end");
  await sleep(1500);
  assert.equal(await line1(), "Song 3");
  assert.equal(bridge.log.filter(l => l.startsWith("strm s ")).length, 2, "nothing given after the end");
  // Run 2: the rest of Song 2 from 1.5 s and all of Song 3, 4 bytes a frame at 44.1 kHz.
  const run2 = bridge.fetched.find(f => /\/2\.pcm/.test(f.path)).bytes / 4 / 44100;
  assert.ok(Math.abs(run2 - 4.5) < 0.1, `1.5 s of Song 2 and 3 s of Song 3 (${run2} s)`);
  assert.match(logs.join("\n"), /run 2: the track again from 1\.5 s, PCM 16\/44\.1 kHz/);
});
