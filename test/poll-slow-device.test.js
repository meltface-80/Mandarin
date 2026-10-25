"use strict";
/*
 * One device that doesn't answer holds up no other (item 184). Every Sonos
 * room and every renderer is read in one loop each second; the loop waited
 * for every answer, and a device that gave none held it for its whole time
 * limit (10 s a Sonos room, 8 s a renderer): every other room's state was
 * read every 9–11 s. Each device is read on its own now, the next read of it
 * only once its last has answered.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
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

test("a device that doesn't answer holds up no other room's state", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro" });
  await wiim.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [wiim.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { wiim.releaseReads(); await srv.stop(); await house.stop(); await wiim.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const state = async (zone) => (await api("zone-state?zone=" + zone)).zone;
  await until(async () => (await api("status")).index_count === 3);
  const zones = await until(async () => { const z = (await api("zones")).zones; return z.length === 2 && z; }, 20000);
  const kitchen = zones.find(z => z.display_name === "Kitchen").zone_id, study = zones.find(z => z.display_name === "Study").zone_id;
  const WIIM = idFor(wiim.udn);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === WIIM), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + WIIM, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === WIIM), 20000);
  const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  const room = house.room("Kitchen");
  assert.equal((await api("play", { offset: one.offset, zone_or_output_id: kitchen, kind: "play_now" })).status, 200);
  await until(async () => (await state(kitchen)).state === "playing");

  // The Kitchen paused behind the server's back: how long until its state says so.
  const seen = async (what) => {
    const t0 = Date.now();
    room.handle(what === "paused" ? "Pause" : "Play", {});
    await until(async () => (await state(kitchen)).state === what, 20000);
    return Date.now() - t0;
  };

  await t.test("a Sonos room that doesn't answer", async () => {
    await seen("playing");
    // The Study looked at (read every second), then silent: its read waits out the 10 s limit.
    await state(study);
    house.room("Study").stall();
    try {
      await until(() => house.room("Study").stalled >= 1);
      // Long enough for the next round of reads to have reached it too: the one that waits.
      await sleep(1500);
      const ms = await seen("paused");
      assert.ok(ms < 4000, `the Kitchen's pause showed after ${ms} ms`);
    } finally { house.room("Study").unstall(); }
  });

  await t.test("a renderer that doesn't answer", async () => {
    await seen("playing");
    // The WiiM looked at (read every second), then silent: its read waits out the 8 s limit.
    await state(WIIM);
    wiim.holdReads();
    try {
      await until(() => wiim.readGate.length >= 1);
      await sleep(1500);
      const ms = await seen("paused");
      assert.ok(ms < 4000, `the Kitchen's pause showed after ${ms} ms`);
    } finally { wiim.releaseReads(); }
  });
});
