"use strict";
/*
 * The bit-perfect check, end to end (item 275): a Mandarin USB renderer whose app records what it feeds its DAC
 * (/dac.json says "capture"), the track playing on it checked on request. The track is played again from its start
 * while the device records, the recording fetched, and compared sample by sample with what the server sent it
 * (BitPerfect/Check.cs): bit-perfect when the device fed the DAC what it was sent; not, and by how much, when its
 * recording is 1 dB down; not the track when it recorded the next one; and a renderer that can't record is told so.
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

test("a Mandarin USB renderer's DAC checked bit-perfect, end to end", { skip, timeout: 150000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const usb = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin USB", sink: SINK, dac: Object.assign({ capture: true }, DAC) });
  const old = new FakeRenderer({ name: "Older app", manufacturer: "Mandarin", model: "Mandarin USB", sink: SINK, dac: DAC });
  await usb.start(); await old.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [usb.location, old.location], upnpMulticast: false });
  await srv.start();
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const USB = idFor(usb.udn), OLD = idFor(old.udn);
  try {
    await until(async () => (await api("status")).index_count === 3);
    await until(async () => { const l = (await api("audio-devices")).devices; return l.some(d => d.id === USB) && l.some(d => d.id === OLD); });
    for (const id of [USB, OLD]) assert.equal((await api("audio-devices/" + id, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.filter(z => z.zone_id === USB || z.zone_id === OLD).length === 2);
    const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
    const checked = async (zone) => {
      const r = await api("bitperfect", { zone_or_output_id: zone });
      assert.equal(r.status, 200, JSON.stringify(r));
      return until(async () => { const c = await api("bitperfect?zone=" + zone); return c.state === "done" || c.state === "failed" ? c : null; }, 60000);
    };
    const playing = async (zone) => {
      assert.equal((await api("play", { offset: one.offset, zone_or_output_id: zone, kind: "play_now" })).ok, true);
      await until(async () => { const z = (await api("zone-state?zone=" + zone)).zone; return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Song 1"; });
    };

    // Now playing's signal path offers it (item 275): a step with its button, on this device only.
    const step = async (zone) => { const z = (await api("zone-state?zone=" + zone)).zone; return ((z && z.now_playing && z.now_playing.signal && z.now_playing.signal.steps) || []).find(x => x.kind === "check"); };
    await playing(USB);
    const offered = await until(() => step(USB));
    assert.deepEqual([offered.title, offered.action, offered.button, offered.quality], ["Bit-perfect check", "bitperfect", "Check", "pending"]);

    // Fed what it was sent: bit-perfect, every sample, the track played again from its start for it.
    const sets = usb.log.filter(a => a === "SetAVTransportURI").length;
    let c = await checked(USB);
    assert.equal(c.state, "done", JSON.stringify(c));
    assert.equal(c.report.verdict, "bit-perfect", JSON.stringify(c.report));
    assert.ok(c.report.coverage > 0.95, JSON.stringify(c.report));
    assert.match(c.report.says, /^Bit-perfect/);
    assert.ok(usb.log.includes("capture"), "the device was asked to record");
    assert.ok(usb.log.filter(a => a === "SetAVTransportURI").length > sets, "the track sent again from its start");
    // The step says so, and offers it again.
    const said = await until(async () => { const s2 = await step(USB); return s2 && s2.title === "Bit-perfect to the DAC" && s2; });
    assert.deepEqual([said.quality, said.button], ["lossless", "Check again"]);
    assert.match(said.detail, /^Bit-perfect: every sample/);

    // Fed it 1 dB down: not bit-perfect, by how much.
    usb.captureFilter = "volume=-1dB:precision=double";
    await playing(USB);
    c = await checked(USB);
    assert.equal(c.report.verdict, "not-bit-perfect", JSON.stringify(c.report));
    assert.ok(Math.abs(c.report.level_db + 1) < 0.1, JSON.stringify(c.report));

    // Fed the next track, not the one played again: not the track that was sent, not "a level" of it.
    usb.captureFilter = null; usb.captureSkip = 1;
    await playing(USB);
    c = await checked(USB);
    assert.equal(c.report.verdict, "not-found", JSON.stringify(c.report));
    assert.match(c.report.says, /isn't the track that was sent/);

    // An app that can't record: no step offered, and asked anyway, told so.
    await playing(OLD);
    assert.equal(await step(OLD), undefined);
    const r = await api("bitperfect", { zone_or_output_id: OLD });
    assert.equal(r.status, 409);
    assert.match(r.error || "", /can't record what it feeds the DAC yet/);
  } finally {
    await srv.stop();
    await usb.stop(); await old.stop();
    await house.stop();
  }
});
