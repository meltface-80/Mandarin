"use strict";
/*
 * A renderer left stuck on a track (bug list item 272): the FiiO SR11, sent a seek to a point of a DSF not yet made,
 * waited for it and went silent, and Back (a seek to the start) on that same stream played nothing; only the next
 * track, sent anew, played again. Now Back, or a seek, to a device still starting a track long after it was sent
 * (TRANSITIONING) sends the track again, as the next track is sent: SetAVTransportURI, Play, and the seek after.
 * A device playing is sought in as before.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
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

test("Back and a seek on a renderer stuck on its track send the track again", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  for (let i = 1; i <= 2; i++) {
    gen(path.join(lib.music, "Artist L", "Long Album", `0${i} Long ${i}.flac`), { seconds: 60, freq: 300 * i, tags: { title: `Long ${i}`, artist: "Artist L", album: "Long Album", track: i } });
  }
  const house = new FakeHousehold();
  await house.start();
  const sr11 = new FakeRenderer({ name: "SR11", manufacturer: "FiiO", model: "SR11" });
  await sr11.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpHosts: [sr11.location], upnpMulticast: false });
  await srv.start();
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const state = async () => (await api("zone-state?zone=" + SR11)).zone;
  const SR11 = idFor(sr11.udn);
  const sent = () => sr11.log.filter(a => a === "SetAVTransportURI").length;
  try {
    await until(async () => (await api("status")).index_count === 4);
    await until(async () => (await api("audio-devices")).devices.some(d => d.id === SR11), 20000);
    assert.equal((await api("audio-devices/" + SR11, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === SR11), 20000);
    const long = (await api("library/albums?sort=album")).albums.find(a => a.title === "Long Album");
    assert.equal((await api("play", { offset: long.offset, zone_or_output_id: SR11, kind: "play_now" })).ok, true);
    await until(async () => { const z = await state(); return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Long 1"; });

    // Playing: a seek is a seek, nothing sent again.
    const before = sent();
    assert.equal((await api("seek", { zone_or_output_id: SR11, how: "absolute", seconds: 20 })).status, 200);
    await until(() => sr11.log.includes("Seek"));
    assert.equal(sent(), before, "a device playing is sought in");

    // Stuck: still starting it, long after it was sent (a seek it waits on).
    await sleep(8500);
    sr11.hold(); sr11.state = "TRANSITIONING";
    await until(async () => (await state()).state === "loading");
    const seeks = sr11.log.filter(a => a === "Seek").length;
    assert.equal((await api("control", { zone_or_output_id: SR11, command: "previous" })).status, 200);
    await until(() => sent() === before + 1 && sr11.log[sr11.log.length - 1] === "Play", 10000);
    assert.equal(sr11.log.filter(a => a === "Seek").length, seeks, "Back: the track sent again from its start, not sought in");
    assert.match(sr11.uri, /\/stream\/t\d+\./);
    const z = await until(async () => { const s = await state(); return s.state === "playing" && s; });
    assert.equal(z.now_playing.line1, "Long 1", "the same track, from its start");

    // Stuck again, and sought in: sent again and sought to.
    await sleep(8500);
    sr11.hold(); sr11.state = "TRANSITIONING";
    await until(async () => (await state()).state === "loading");
    assert.equal((await api("seek", { zone_or_output_id: SR11, how: "absolute", seconds: 30 })).status, 200);
    await until(() => sent() === before + 2 && sr11.log[sr11.log.length - 1] === "Seek", 10000);
    await until(async () => { const s = await state(); return s.state === "playing" && s.now_playing.line1 === "Long 1" && s.now_playing.seek_position >= 29; });
  } finally {
    await srv.stop();
    await sr11.stop();
    await house.stop();
  }
});
