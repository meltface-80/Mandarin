"use strict";
/*
 * Mandarin as a SlimProto server (item 312, Renderers/Slim/): a Squeezelite player (a stand-in, test/fake-slim.js)
 * finds it by a UDP 'e' to its port, connects, says hello, and is a device: named as it says, on the network while
 * it is connected, with the formats its hello names. Switched on and played to, the track set is a stream started to
 * wait for Play (autostart '0') and started by it ('u'); the next, given once the one playing has been read (STMd) to
 * go on into from the player's buffer — never a stop between them; the room follows what it says it plays. Pause and
 * Play are 'p' and 'u', the volume its gain, Next its stream stopped and the next started; gone, it is off the network.
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
async function until(fn, ms = 15000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(100);
  }
}

test("a SlimProto player: found, a device, played track into track from its buffer, paused, its volume, gone", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  for (const i of [1, 2, 3])
    gen(path.join(lib.music, "Artist S", "Slim Album", `0${i} Slim ${i}.flac`), { seconds: 3, freq: 300 * i, tags: { title: `Slim ${i}`, artist: "Artist S", album: "Slim Album", track: i } });
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, slimprotoPort: SLIM });
  await srv.start();
  const player = new FakeSlim({ port: SLIM, name: "Kitchen Pi", seconds: 3 });
  t.after(async () => { player.close(); await srv.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => (await api("status")).index_count === 4, 30000, "the library");

  // Found: discovery answered with Mandarin's name and where its pages are.
  const found = await FakeSlim.discover(SLIM);
  assert.equal(found.type, "E");
  assert.equal(found.tags.NAME, "Mandarin");
  assert.equal(found.tags.JSON, String(PORT));

  // A device, named as it said, with the formats its hello named.
  await player.connect();
  const ID = "SLIM_020000000031";
  const dev = await until(async () => { const d = (await api("audio-devices")).devices.find(x => x.id === ID); return d && d.name === "Kitchen Pi" && d; }, 15000, "the player as a device");
  assert.equal(dev.kind, "slim");
  assert.equal(dev.online, true);
  const caps = (await api("audio-devices/" + ID)).caps || {};
  const advertised = (caps.advertised || {});
  assert.deepEqual(advertised.rates, [44100, 48000, 88200, 96000, 176400, 192000], "every rate to its MaxSampleRate");
  assert.ok(advertised.containers.includes("flac") && advertised.containers.includes("dsd"), "FLAC and DSD, as it named flc and dsf");
  assert.ok(player.log.includes("setd 0"), "its name asked");

  // Switched on, played to.
  assert.equal((await call("PATCH", "audio-devices/" + ID, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === ID), 20000, "the room");
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Slim Album");
  const ids = (await api("album?offset=" + album.offset)).tracks.map(x => x.track_id);
  const line1 = async () => { const z = (await api("zone-state?zone=" + ID)).zone; return z && z.now_playing && z.now_playing.line1; };
  assert.equal((await api("play", { offset: album.offset, zone_or_output_id: ID, kind: "play_now" })).status, 200);

  // Track 1: a FLAC stream started to wait for Play, then Play.
  await until(() => player.current() && new RegExp(`/stream/t${ids[0]}\\.`).test(player.current()), 15000, "track 1 heard");
  const s1 = player.log.findIndex(l => l.startsWith("strm s ") && l.includes(`/stream/t${ids[0]}.`));
  assert.match(player.log[s1], /^strm s f 0 /, "FLAC, waiting for Play");
  assert.ok(player.log.slice(s1).includes("strm u"), "Play said");
  await until(async () => (await line1()) === "Slim 1", 15000, "track 1 shown");

  // Track 2: given once track 1 was read, to go on into — no stop between them.
  await until(() => player.log.some(l => l.startsWith("strm s ") && l.includes(`/stream/t${ids[1]}.`)), 15000, "track 2 given");
  const s2 = player.log.findIndex(l => l.startsWith("strm s ") && l.includes(`/stream/t${ids[1]}.`));
  assert.match(player.log[s2], /^strm s f 1 /, "autostart: it plays on into it");
  assert.ok(!player.log.slice(s1 + 1, s2 + 1).includes("strm q"), "gapless: track 1's stream never stopped for it");
  await until(async () => (await line1()) === "Slim 2", 15000, "track 2 shown when the player began it");
  assert.equal(player.fetched.filter(f => f.bytes > 1000).length >= 2, true, "both streams fetched whole");

  // Pause and Play: 'p' and 'u'.
  await api("control", { zone_or_output_id: ID, command: "pause" });
  await until(async () => (await api("zone-state?zone=" + ID)).zone.state === "paused", 15000, "paused");
  assert.ok(player.log.includes("strm p"));
  const before = player.log.filter(l => l === "strm u").length;
  await api("control", { zone_or_output_id: ID, command: "play" });
  await until(() => player.log.filter(l => l === "strm u").length > before, 15000, "Play again");

  // Its volume: its gain.
  await api("volume", { output_id: ID, how: "absolute", value: 30 });
  await until(() => player.gain === Math.round(0.3 * 65536), 15000, "the gain at 30%");

  // Next: its stream stopped, track 3 started.
  await api("control", { zone_or_output_id: ID, command: "next" });
  await until(async () => (await line1()) === "Slim 3", 15000, "Next to track 3");
  assert.ok(player.log.lastIndexOf("strm q") > s2, "Next stopped what it played");

  // Gone: off the network.
  player.close();
  await until(async () => (await api("audio-devices")).devices.find(x => x.id === ID).online === false, 15000, "off once gone");
});
