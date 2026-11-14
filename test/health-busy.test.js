"use strict";
/*
 * What /api/health's busy.playing counts (bug list item 421, HealthRoutes.cs): Mandarin OS's upkeep (os-update auto,
 * maintain, the system page's Update and restart) waits on busy.any before it updates or restarts the computer, and
 * busy.playing counted every room that said PLAYING, whatever it played: the owner's Sonos Beam, hidden in Mandarin,
 * playing a film from the TV, would have held back an update. Now it counts as the Album Scanner does (item 417b,
 * Playback/Hub.Heard.cs): only rooms in use playing Mandarin's own music, named in busy.playing_in.
 *   - a Sonos playing an album of the library: 1, by name;
 *   - the same Sonos on its TV input (x-sonos-htastream:): 0;
 *   - the Sonos playing the album again, then hidden in Audio Devices: 0, though it plays on.
 */
const test = require("node:test");
const assert = require("node:assert");
const ports = require("./ports");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeHousehold } = require("./fake-sonos");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const LOUNGE = "RINCON_LOUNGE001400";
const TV = "x-sonos-htastream:" + LOUNGE + ":spdif";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(200);
  }
}

test("/api/health's busy.playing counts only Mandarin's music, in a room in use, and names it", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold([{ uid: LOUNGE, name: "Lounge", ip: ports.host(0), model: "Sonos Beam" }]);
  await house.start();
  const room = house.room("Lounge");
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  // As Mandarin OS asks it: from this machine, signed in or not.
  const busy = async () => (await (await fetch(B + "/api/health")).json()).busy;
  await until(async () => (await api("status")).index_count > 0, 30000, "the library");
  await until(async () => ((await api("zones")).zones || []).some(z => z.zone_id === LOUNGE), 30000, "the Sonos room");
  await until(async () => !(await busy()).scanning, 30000, "the scan done");
  assert.deepEqual(await busy(), { any: false, playing: 0, playing_in: [], scanning: false, making: 0 }, "nothing plays yet");
  const album = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  const playIn = async zone => assert.equal((await api("play", { offset: album.offset, zone_or_output_id: zone, kind: "play_now" })).status, 200);

  await t.test("a Sonos playing an album of the library: one room playing, named", async () => {
    await playIn(LOUNGE);
    await until(() => room.queue.length === 3 && room.state === "PLAYING", 15000, "the album given the Sonos");
    const b = await until(async () => { const x = await busy(); return x.playing > 0 && x; }, 15000, "busy.playing");
    assert.deepEqual([b.any, b.playing, b.playing_in], [true, 1, ["Lounge"]]);
  });

  await t.test("the same Sonos, shown, playing its TV input: nothing playing", async () => {
    room.queue = [{ uri: TV, meta: "" }];
    room.track = 1;
    room.currentUri = TV;
    room.state = "PLAYING";
    room.setPos(600);
    await until(async () => { const z = (await api("zone-state?zone=" + LOUNGE)).zone; return z && z.state === "playing"; }, 15000, "the Sonos read playing the TV");
    await sleep(2500);
    const b = await busy();
    assert.deepEqual([b.any, b.playing, b.playing_in], [false, 0, []], "a Sonos playing its TV input held back an update: " + JSON.stringify(b));
  });

  await t.test("the Sonos playing the album again, then hidden in Audio Devices: nothing playing, though it plays on", async () => {
    await playIn(LOUNGE);
    await until(() => room.queue.length === 3 && room.state === "PLAYING", 15000, "the album given the Sonos again");
    await until(async () => (await busy()).playing === 1, 15000, "the Sonos playing the album again");
    await until(async () => (await api("audio-devices")).devices.some(d => d.id === LOUNGE), 20000, "the Sonos in Audio Devices");
    assert.equal((await call("PATCH", "audio-devices/" + LOUNGE, { hidden: true })).status, 200);
    await sleep(2500);
    assert.equal(room.state, "PLAYING", "still playing: hiding a Sonos doesn't stop it");
    const b = await busy();
    assert.deepEqual([b.any, b.playing, b.playing_in], [false, 0, []], "a hidden Sonos playing held back an update: " + JSON.stringify(b));
  });
});
