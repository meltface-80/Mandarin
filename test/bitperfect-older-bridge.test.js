"use strict";
/*
 * What a Mandarin Bridge that can't record what it feeds the DAC is told (item 412): one for Linux before 0.3.11 (its
 * /dac.json says "platform": "linux", and no "capture") is told it records from 0.3.11 and is updated in Settings →
 * Updates, where it used to be told to update an app no update could help; an Android one keeps its words. Asked for
 * the check (POST /api/bitperfect) and in SQ-tool's list of rooms (/api/sq-tool/zones), the same.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(150);
  }
}

const SINK = "http-get:*:audio/flac:*,http-get:*:audio/wav:*";
const DAC = { device: "SMSL SU-1", rates: [44100, 48000, 96000, 192000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true };
const LINUX = "Mandarin Bridge for Linux can't record what it feeds the DAC before 0.3.11: update it in Settings → Updates";
const ANDROID = "This device's app can't record what it feeds the DAC yet: update Mandarin Bridge";

test("a Mandarin Bridge for Linux older than 0.3.11 is told it records from 0.3.11; an Android one keeps its words", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const linux = new FakeRenderer({ name: "Mandarin Bridge (mandarin)", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: Object.assign({ platform: "linux", bridgeVersion: "0.3.10" }, DAC) });
  const android = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: Object.assign({ platform: "android", bridgeVersion: "0.2.0" }, DAC) });
  await linux.start(); await android.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [linux.location, android.location], upnpMulticast: false });
  await srv.start();
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const LIN = idFor(linux.udn), AND = idFor(android.udn);
  try {
    await until(async () => (await api("status")).index_count === 3);
    await until(async () => { const l = (await api("audio-devices")).devices; return l.some(d => d.id === LIN) && l.some(d => d.id === AND); });
    for (const id of [LIN, AND]) assert.equal((await api("audio-devices/" + id, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.filter(z => z.zone_id === LIN || z.zone_id === AND).length === 2);
    const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
    for (const [zone, words] of [[LIN, LINUX], [AND, ANDROID]]) {
      assert.equal((await api("play", { offset: one.offset, zone_or_output_id: zone, kind: "play_now" })).ok, true);
      await until(async () => { const z = (await api("zone-state?zone=" + zone)).zone; return z && z.state === "playing"; });
      const r = await api("bitperfect", { zone_or_output_id: zone });
      assert.equal(r.status, 409, JSON.stringify(r));
      assert.equal(r.error, words);
    }
    // SQ-tool's rooms: each said as it can't be recorded, and why.
    const zones = (await api("sq-tool/zones")).zones;
    assert.deepEqual([LIN, AND].map(id => { const z = zones.find(x => x.zone_id === id); return z && [z.can, z.why]; }), [[false, LINUX], [false, ANDROID]], JSON.stringify(zones));
  } finally {
    await srv.stop();
    await linux.stop(); await android.stop();
    await house.stop();
  }
});
