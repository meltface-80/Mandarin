"use strict";
/*
 * The Album Scanner and the rooms (bug list item 417, Playback/Hub.Heard.cs): it starts no album while music plays,
 * and a room is playing when it says PLAYING, or TRANSITIONING (loading its track) for a while. A Sonos paused or
 * stopped never counts. Before, a room that said TRANSITIONING counted for as long as it said so: its state is read
 * every second or few, and "loading" counted while it had been heard from lately, which a room read every second
 * always had; the owner's Album Scanner said "Paused while music plays" with the Sonos and the phone paused. Here a
 * Sonos of the test's own says each state in turn, and loading counts for 3 s (MANDARIN_HEARD_LOADING_MS); a phone
 * that reports loading again and again likewise. Since item 417b a room counts only while it plays Mandarin's own music
 * (test/scanner-holding.test.js): the Sonos here is given an album of the library to play first.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeHousehold } = require("./fake-sonos");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(200);
  }
}

test("a paused or stopped room is no music playing, nor one that says it is loading for longer than a track takes to load", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold([{ uid: "RINCON_LOUNGE001400", name: "Lounge", ip: ports.host(0) }]);
  await house.start();
  const room = house.room("Lounge");
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false,
    identify: false, heardLoadingMs: 3000 });
  await srv.start();
  try {
    const H = { Authorization: "Bearer " + await signIn(B), "Content-Type": "application/json" };
    const api = async (p, body) => (await fetch(B + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H })).json();
    const reason = async () => (await api("album-scanner")).now.reason;
    const lounge = (await until(async () => ((await api("zones")).zones || [])[0], 30000, "the Sonos room")).zone_id;
    await until(async () => (await api("status")).index_count > 0, 30000, "the library");
    const album = (await api("library/albums?sort=album")).albums[0];
    const played = await api("play", { offset: album.offset, zone_or_output_id: lounge, kind: "play_now" });
    assert.ok(!played.error, JSON.stringify(played));
    await until(() => room.queue.length > 0 && room.state === "PLAYING", 15000, "the album given the room");
    room.state = "STOPPED";
    assert.equal((await api("album-scanner", { on: true, schedule: false })).on, true);

    // Playing: music plays. Paused, or stopped: none, however often it is read.
    room.state = "PLAYING"; room.setPos(10);
    await until(async () => await reason() === "playing", 15000, "the room playing");
    room.state = "PAUSED_PLAYBACK";
    await until(async () => await reason() !== "playing", 15000, "the room paused");
    await sleep(4000);
    assert.notEqual(await reason(), "playing", "paused, read again and again");
    room.state = "STOPPED";
    await sleep(2000);
    assert.notEqual(await reason(), "playing", "stopped");

    // Loading its track: music playing, for 3 s here; one still loading after that is not, though read every second.
    room.state = "TRANSITIONING";
    await until(async () => await reason() === "playing", 15000, "the room loading");
    await until(async () => await reason() !== "playing", 15000, "the room loading for longer than a track takes");
    await sleep(3000);
    assert.notEqual(await reason(), "playing", "still loading, read again and again");
    // It plays at last: music playing again.
    room.state = "PLAYING";
    await until(async () => await reason() === "playing", 15000, "the room playing again");
    room.state = "PAUSED_PLAYBACK";
    await until(async () => await reason() !== "playing", 15000, "the room paused again");

    // A phone that says it is loading, again and again: the same.
    await api("phone/hello", { name: "Pixel 8" });
    const report = state => api("phone/state", { index: 0, position: 0, duration: 60, state, volume: 40 });
    await report("loading");
    assert.equal(await reason(), "playing", "the phone loading");
    const t0 = Date.now();
    let still = true;
    while (Date.now() - t0 < 9000 && still) { await report("loading"); await sleep(500); still = await reason() === "playing"; }
    assert.equal(still, false, "a phone loading for 9 s, reporting every half second, was still taken for music playing");
    await report("paused");
    assert.notEqual(await reason(), "playing", "the phone paused");
  } finally { await srv.stop(); await house.stop(); }
});
