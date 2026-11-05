"use strict";
/*
 * The bit-perfect check of a whole track (item 286): a Mandarin Bridge renderer whose app records in parts (/dac.json
 * says "capture_parts") is asked once for the whole track, from the stream played again from its start
 * ("after_flush"), in parts one after another; each part is fetched and let go, and the track is compared whole:
 * every sample, nothing unrecorded. Its verdict is kept after the server restarts, at /api/bitperfect. Parts that
 * can't be read are said to be, the check never left hanging.
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
const DAC = { device: "SMSL SU-1", rates: [44100, 48000, 96000, 192000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true, capture: true, captureParts: true };

test("a whole track checked bit-perfect in parts, and its verdict kept", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const usb = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: DAC });
  usb.capturePart = 1;   // parts of a second: a three-second track in three
  await usb.start();
  const { createServer } = require("./server");
  const make = () => createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [usb.location], upnpMulticast: false });
  let srv = make();
  await srv.start();
  let auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const USB = idFor(usb.udn);
  const zone = async () => (await api("zone-state?zone=" + USB)).zone;
  const on = (title) => until(async () => { const z = await zone(); return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === title; });
  try {
    await until(async () => (await api("status")).index_count === 3);
    await until(async () => (await api("audio-devices")).devices.some(d => d.id === USB));
    assert.equal((await api("audio-devices/" + USB, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === USB));
    const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: USB, kind: "play_now" })).ok, true);
    await on("Song 1");

    // Asked once, for the whole track, from the restart, in parts: every part fetched and let go, every sample compared.
    assert.equal((await api("bitperfect", { zone_or_output_id: USB })).status, 200);
    const c = await until(async () => { const x = await api("bitperfect?zone=" + USB); return x.state === "done" || x.state === "failed" ? x : null; }, 60000);
    assert.equal(c.state, "done", JSON.stringify(c));
    assert.deepEqual(usb.captureAsks.map(a => [a.part, a.after_flush]), [[60, true]], "asked once, in parts, from the restart");
    assert.ok(usb.captureDropped.length >= 3, "recorded in parts: " + JSON.stringify(usb.captureDropped));
    assert.deepEqual(usb.captureDropped, usb.captureDropped.map((_, i) => i + 1), "each part let go once fetched, in turn");
    // The parts follow on: compared as the one recording of the track they are.
    assert.equal(c.report.parts.length, 1, JSON.stringify(c.report.parts));
    assert.equal(c.report.parts[0].from, 0, JSON.stringify(c.report.parts));
    assert.equal(c.report.verdict, "bit-perfect", JSON.stringify(c.report));
    assert.ok(c.report.coverage >= 0.995, JSON.stringify(c.report));
    assert.deepEqual(c.report.unrecorded, []);
    assert.match(c.report.says, /^Bit-perfect: every sample of the track reached the DAC exactly as it was sent$/);

    // Parts that can't be read: said so, the check never left hanging at "comparing".
    usb.captureCorrupt = true;
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: USB, kind: "play_now" })).ok, true);
    await on("Song 1");
    assert.equal((await api("bitperfect", { zone_or_output_id: USB })).status, 200);
    const bad = await until(async () => { const x = await api("bitperfect?zone=" + USB); return x.state === "done" || x.state === "failed" ? x : null; }, 30000);
    assert.deepEqual([bad.state, bad.report && bad.report.verdict], ["done", "unread"], JSON.stringify(bad));
    assert.match(bad.report.says, /couldn't be read/);
    usb.captureCorrupt = false;
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: USB, kind: "play_now" })).ok, true);
    await on("Song 1");
    assert.equal((await api("bitperfect", { zone_or_output_id: USB })).status, 200);
    assert.equal((await until(async () => { const x = await api("bitperfect?zone=" + USB); return x.state === "done" || x.state === "failed" ? x : null; }, 60000)).report.verdict, "bit-perfect");

    // The server restarted: the verdict kept, at /api/bitperfect.
    await srv.stop();
    srv = make();
    await srv.start();
    auth = { Authorization: "Bearer " + await signIn(B) };
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === USB));
    const kept = await api("bitperfect?zone=" + USB);
    assert.deepEqual([kept.state, kept.track, kept.report && kept.report.verdict], ["done", "Song 1", "bit-perfect"], JSON.stringify(kept));
  } finally {
    await srv.stop();
    await usb.stop();
    await house.stop();
  }
});
