"use strict";
/*
 * A renderer that starts no track by itself (item 184). One without
 * SetNextAVTransportURI is started on the next track by hand when it stops at
 * the end of one; a stop counts as that end only after a reading of it
 * playing. Gone from the network while playing and back stopped, or stopped
 * while the server restarted, it stays stopped: before, the room still said
 * "playing" from before, and the next track started by itself. And it is read
 * once at a time: two reads at the end of a track both started "the next",
 * one track skipped.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
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

test("a renderer started on the next track by hand: only at the end of a track it was heard playing, and once", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  // A Poly: no SetNextAVTransportURI, so every next track is started by the server.
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", setNext: false });
  await poly.start();
  const { createServer } = require("./server");
  const options = { port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [poly.location], upnpMulticast: false, identify: false };
  let srv = createServer(options);
  let ctx = await srv.start();
  t.after(async () => { await srv.stop(); await poly.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const POLY = idFor(poly.udn);
  const state = async () => (await api("zone-state?zone=" + POLY)).zone;
  const title = async () => { const z = await state(); return z && z.now_playing && z.now_playing.line1; };
  const sets = () => poly.log.filter(a => a === "SetAVTransportURI").length;
  await until(async () => (await api("status")).index_count === 3);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === POLY), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + POLY, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === POLY), 20000);
  const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  // Album One from Song 1, playing, its clock held: it never ends by itself.
  const playing = async () => {
    poly.release();
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: POLY, kind: "play_now" })).status, 200);
    await until(() => poly.state === "PLAYING");
    poly.hold();
    await until(async () => { const z = await state(); return z.state === "playing" && z.now_playing && z.now_playing.line1 === "Song 1"; });
  };

  await t.test("off the network while playing, back stopped: it stays stopped", async () => {
    await playing();
    poly.offline = true;
    // Read and not answered, twice over (it is read every second while playing).
    await until(() => (poly.refused || 0) >= 4);
    // Stopped while away (switched off and on, its own remote).
    poly.handle("Stop", {});
    const before = sets(), asked = poly.log.length;
    poly.offline = false;
    // Read again, back on the network.
    await until(() => poly.log.slice(asked).includes("GetTransportInfo"));
    await sleep(2500);
    assert.equal(sets(), before, "no track started by itself");
    assert.equal(poly.state, "STOPPED");
    const z = await state();
    assert.equal(z.state, "stopped");
    assert.equal(z.now_playing && z.now_playing.line1, "Song 1");
  });

  await t.test("stopped while the server restarted: it stays stopped", async () => {
    await playing();
    // The store keeps it as playing; then the server goes, and the device is stopped meanwhile.
    await until(() => { const r = ctx.db.raw.prepare("SELECT value FROM settings WHERE key = ?").get("queue:" + POLY); const k = r && JSON.parse(r.value); return k && k.state === "playing" && k.index === 0; });
    await srv.stop();
    poly.handle("Stop", {});
    const before = sets(), asked = poly.log.length;
    srv = createServer(options);
    ctx = await srv.start();
    await until(async () => (await api("status")).status === 200);
    await until(async () => { const z = await state(); return z && z.now_playing; }, 20000);
    // Read since the start.
    await until(() => poly.log.slice(asked).includes("GetTransportInfo"));
    await sleep(2500);
    assert.equal(sets(), before, "no track started by itself");
    assert.equal(poly.state, "STOPPED");
    assert.equal((await state()).state, "stopped");
    // And played again, it plays on, and starts the next by hand at the end of the track as ever.
    poly.release();
    assert.equal((await api("control", { zone_or_output_id: POLY, command: "play" })).status, 200);
    await until(async () => (await title()) === "Song 2", 20000);
  });

  await t.test("reads at the end of a track start the next track once", async () => {
    await playing();
    poly.holdReads();
    try {
      // Read just before the end of Song 1 (a seek's read-back), answered only later: "playing".
      assert.equal((await api("seek", { zone_or_output_id: POLY, how: "absolute", seconds: 0 })).status, 200);
      await until(() => poly.readGate.length >= 2);
      // The end: the device stops, and is read twice more (two more seeks).
      poly.state = "STOPPED"; poly.setPos(0); poly.log.push("ended");
      const before = sets();
      assert.equal((await api("seek", { zone_or_output_id: POLY, how: "absolute", seconds: 0 })).status, 200);
      assert.equal((await api("seek", { zone_or_output_id: POLY, how: "absolute", seconds: 0 })).status, 200);
      await sleep(1000);
      // The read from before the end answers first, then the rest.
      poly.releaseReads(2);
      await sleep(500);
      poly.releaseReads(4);
      await sleep(1000);
      poly.releaseReads();
      await until(async () => (await state()).state === "playing", 15000);
      await sleep(2500);
      assert.equal(sets() - before, 1, "one track started");
      assert.equal(await title(), "Song 2", "the next, not the one after it");
    } finally { poly.releaseReads(); }
  });
});
