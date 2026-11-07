"use strict";
/*
 * SQ-tool, Mandarin's own (item 290, SqToolRecord.cs): a song chosen in SQ-tool, a zone chosen, and Mandarin plays the
 * song there from its start and records what the zone's DAC is fed (a Mandarin Bridge renderer's /capture, in parts
 * joined into one: test/fake-capture.js), and hands the recording to SQ-tool, which compares it with the file:
 *   - the zones: the Bridge can be recorded, a Sonos room can't, and says why;
 *   - the Bridge feeding its DAC what was sent: bit-perfect, the test's zone the Bridge's name;
 *   - the Bridge's samples changed (its volume a decibel down): recorded again, not bit-perfect;
 *   - refused: a zone that can't be recorded, a test that isn't there, a song not in Mandarin's library, a second
 *     recording while one is under way.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const python = spawnSync("python3", ["-c", "import numpy"]).status === 0;
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !python && !process.env.CI && "python3 with numpy is not installed";
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(200);
  }
}

const SINK = "http-get:*:audio/flac:*,http-get:*:audio/wav:*";
const DAC = { device: "SMSL SU-1", rates: [44100, 48000, 96000, 192000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true, capture: true, captureParts: true };

test("SQ-tool has Mandarin record a zone's DAC, and compares it with the file", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const usb = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: DAC });
  usb.capturePart = 1;   // parts of a second: the track in several, joined into one
  await usb.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [usb.location], upnpMulticast: false });
  await srv.start();
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const call = async (p, body, method) => {
    const r = await fetch(B + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const USB = idFor(usb.udn);
  // SQ-tool's test of the song at [rel] in the music folder, its song read.
  const newTest = async (rel) => {
    const r = await call("/sq-tool/api/tests", { path: rel });
    assert.equal(r.status, 200, JSON.stringify(r));
    await until(async () => (await call("/sq-tool/api/tests/" + r.id)).source.state === "ready", 60000);
    return r.id;
  };
  // Mandarin's recording of [tid] on [zone], to its end: SQ-tool's test once compared.
  const recorded = async (tid, zone) => {
    const r = await call("/api/sq-tool/record", { test: tid, zone_or_output_id: zone });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.test, tid);
    const job = await until(async () => { const j = await call("/api/sq-tool/record"); return j.state === "done" || j.state === "failed" ? j : null; }, 90000);
    assert.equal(job.state, "done", JSON.stringify(job));
    return until(async () => { const t = await call("/sq-tool/api/tests/" + tid); return t.results.a && t.results.a.state === "ready" && t; }, 90000);
  };
  try {
    await until(async () => (await call("/api/status")).index_count === 3);
    await until(async () => (await call("/api/audio-devices")).devices.some(d => d.id === USB));
    assert.equal((await call("/api/audio-devices/" + USB, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await call("/api/zones")).zones.some(z => z.zone_id === USB));
    await until(async () => (await call("/api/zones")).zones.some(z => z.zone_id !== USB && !z.is_phone), 30000);   // the Sonos rooms found too

    // The zones: the Bridge can be recorded; a Sonos room can't, and says why.
    const zones = (await call("/api/sq-tool/zones")).zones;
    const bridge = zones.find(z => z.zone_id === USB);
    assert.deepEqual([bridge.name, bridge.can, bridge.why], ["FiiO R7 USB", true, null]);
    const sonos = zones.find(z => z.zone_id !== USB);
    assert.ok(sonos && !sonos.can && /Mandarin Bridge/.test(sonos.why), JSON.stringify(zones));

    // The Bridge feeds its DAC what it was sent: recorded whole, from its start, in parts joined; bit-perfect.
    const tid = await newTest("Artist A/Album One/01 Song 1.flac");
    let t = await recorded(tid, USB);
    assert.deepEqual(usb.captureAsks.map(a => [a.part, a.after_flush]), [[60, true]], "asked once, in parts, from the start");
    assert.ok(usb.captureDropped.length >= 3, "recorded in parts: " + JSON.stringify(usb.captureDropped));
    assert.equal(t.players.a, "FiiO R7 USB");
    assert.deepEqual([t.captures.a.method, t.captures.a.player], ["mandarin", "FiiO R7 USB"]);
    assert.deepEqual([t.results.a.verdict, t.results.a.short], ["IDENTICAL", "BIT-PERFECT"], JSON.stringify(t.results.a));
    const side = JSON.parse(fs.readFileSync(path.join(lib.data, "sq-tool", "tests", tid, "a.wav.json"), "utf8")).capture;
    assert.equal(side.device, "Mandarin Bridge");
    assert.ok(!fs.existsSync(path.join(lib.data, "sq-tool-recording")), "the recording went to SQ-tool, none left behind");

    // While it records, its clock runs: the seconds the device has taken, before any part is done (item 292).
    usb.captureHold = 2.5;
    assert.equal((await call("/api/sq-tool/record", { test: tid, zone_or_output_id: USB })).status, 200);
    const live = await until(async () => { const j = await call("/api/sq-tool/record"); return j.state === "recording" && j.recorded > 0 ? j : null; }, 30000);
    assert.equal(live.recorded, 2.5, JSON.stringify(live));
    usb.captureHold = 0;
    t = await until(async () => { const j = await call("/api/sq-tool/record"); return j.state === "done" || j.state === "failed" ? j : null; }, 90000);
    assert.equal(t.state, "done", JSON.stringify(t));

    // A device that takes the ask as one piece, not the whole track in parts: said at once, not when its piece ends.
    usb.captureWhole = true;
    assert.equal((await call("/api/sq-tool/record", { test: tid, zone_or_output_id: USB })).status, 200);
    const whole = await until(async () => { const j = await call("/api/sq-tool/record"); return j.state === "done" || j.state === "failed" ? j : null; }, 30000);
    assert.deepEqual([whole.state, whole.says], ["failed", "The recording couldn't be made: the device didn't take the recording as asked: it would record in one piece, not the whole track in parts"]);
    usb.captureWhole = false;

    // Its samples changed on the way to the DAC: recorded again, not bit-perfect, the level said.
    usb.captureFilter = "volume=-1dB";
    t = await recorded(tid, USB);
    assert.equal(t.results.a.verdict, "DIFFERENT", JSON.stringify(t.results.a));
    assert.ok(t.results.a.gain_db.every(g => Math.abs(g + 1) < 0.05), JSON.stringify(t.results.a.gain_db));
    usb.captureFilter = null;

    // Refused, and why.
    let r = await call("/api/sq-tool/record", { test: tid, zone_or_output_id: sonos.zone_id });
    assert.deepEqual([r.status, r.error], [400, "Only Mandarin Bridge can record what its DAC is fed"]);
    r = await call("/api/sq-tool/record", { test: "20990101-000000-none", zone_or_output_id: USB });
    assert.deepEqual([r.status, r.error], [404, "SQ-tool has no such test"]);
    // A song in the music folder that isn't in Mandarin's library: Mandarin can't play it.
    fs.copyFileSync(path.join(lib.music, "Artist A", "Album One", "01 Song 1.flac"), path.join(lib.music, "Not scanned.flac"));
    const loose = await newTest("Not scanned.flac");
    r = await call("/api/sq-tool/record", { test: loose, zone_or_output_id: USB });
    assert.equal(r.status, 404);
    assert.match(r.error, /isn't in Mandarin's library/);
    // One recording at a time.
    assert.equal((await call("/api/sq-tool/record", { test: tid, zone_or_output_id: USB })).status, 200);
    r = await call("/api/sq-tool/record", { test: tid, zone_or_output_id: USB });
    assert.deepEqual([r.status, r.error], [409, "A recording is already under way"]);
    assert.equal((await call("/api/sq-tool/record", { stop: true })).status, 200);
    const stopped = await until(async () => { const j = await call("/api/sq-tool/record"); return j.state === "done" || j.state === "failed" ? j : null; }, 30000);
    assert.ok(stopped.state === "failed" && stopped.says === "Stopped" || stopped.state === "done", JSON.stringify(stopped));
    // Not signed in: nothing.
    assert.equal((await fetch(B + "/api/sq-tool/zones")).status, 401);
  } finally {
    await srv.stop();
    await usb.stop();
    await house.stop();
  }
});
