"use strict";
/*
 * The signal path says only what is known, and whose word it is (item 287). Mandarin Bridge reports what it feeds its
 * DAC (/dac.json's "now"); the last step says exactly that, as the Bridge reports it:
 *   - 16-bit samples padded to the DAC's 32 bits, volume fixed, the samples untouched: lossless, and the badge's tick;
 *   - the volume in software, the samples scaled: lossy, no tick;
 *   - an older app that says nothing of its volume: the format it reports, nothing claimed of the samples (pending),
 *     and no tick (item 289);
 *   - another rate than was sent: said, lossy, no tick.
 * "Bit-perfect" is never said: the file sent as it is is "as it is", not a verdict on what reached the DAC.
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

test("the signal path says what the DAC is fed, as the Bridge reports it, and nothing it doesn't", { skip, timeout: 150000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const usb = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: DAC });
  await usb.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [usb.location], upnpMulticast: false });
  await srv.start();
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const USB = idFor(usb.udn);
  try {
    await until(async () => (await api("status")).index_count === 3);
    await until(async () => (await api("audio-devices")).devices.some(d => d.id === USB));
    assert.equal((await api("audio-devices/" + USB, { enabled: true }, "PATCH")).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === USB));
    const albums = (await api("library/albums?sort=album")).albums;
    const one = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");
    // [track] (from 0) of [album] played alone, the Bridge saying [extra] of what it feeds the DAC: its signal path once the device's word is in.
    const said = async (album, track, title, extra) => {
      usb.nowExtra = extra;
      assert.equal((await api("play-track", { offset: album.offset, track, zone_or_output_id: USB, kind: "play_now", only: true })).status, 200);
      return until(async () => {
        const z = (await api("zone-state?zone=" + USB)).zone;
        const np = z && z.now_playing;
        const fed = np && np.line1 === title && np.signal && np.signal.steps.find(x => x.kind === "fed");
        return fed && { fed, np };
      }, 20000);
    };

    // 16-bit samples padded to 32 bits, volume fixed, untouched: all of it said, in plain words (item 289), lossless, ticked.
    let { fed, np } = await said(one, 0, "Song 1", { bits: 32, volume: "fixed", level: 100, untouched: true });
    assert.deepEqual([fed.title, fed.quality], ["The DAC is fed", "lossless"]);
    assert.equal(fed.detail, "PCM 44.1 kHz, the 16-bit samples padded to 32 bits for the DAC, fixed volume: the samples untouched — as Mandarin Bridge reports it");
    assert.match(np.format.text, /✓$/);
    assert.equal(np.signal.lines[0], "FLAC 16/44.1 kHz · as it is ✓");
    for (const t of [np.format.text, ...np.signal.lines, ...np.signal.steps.map(x => x.title + " " + x.detail)]) assert.doesNotMatch(t, /bit-perfect|words/i, t);

    // The volume in software: the samples scaled, said; lossy; no tick.
    ({ fed, np } = await said(one, 1, "Song 2", { bits: 32, volume: "software", level: 44, untouched: false }));
    assert.equal(fed.quality, "lossy");
    assert.equal(fed.detail, "PCM 44.1 kHz, the 16-bit samples sent as 32-bit, volume 44% in software: the samples scaled — as Mandarin Bridge reports it");
    assert.doesNotMatch(np.format.text, /✓/);

    // Another rate than was sent: said so; lossy; no tick.
    ({ fed, np } = await said(one, 2, "Song 3", { rate: 48000, bits: 32, volume: "fixed", level: 100, untouched: true }));
    assert.equal(fed.quality, "lossy");
    assert.match(fed.detail, /^PCM 48 kHz, .*not the format sent, fixed volume: the samples untouched — as Mandarin Bridge reports it$/);
    assert.doesNotMatch(np.format.text, /✓/);

    // An older app, saying nothing of its volume: its format only, nothing claimed of the samples.
    ({ fed, np } = await said(hi, 0, "Hi 1", {}));
    assert.deepEqual([fed.detail, fed.quality], ["PCM 96 kHz, 24-bit — as Mandarin Bridge reports it", "pending"]);
    // Nothing said of the samples, no tick (item 289): the ✓ is the device's word that they go untouched.
    assert.doesNotMatch(np.format.text, /✓/);
    assert.doesNotMatch(np.signal.lines[0], /✓/);

    // An older app with a 16-bit track to its 32-bit DAC (the R7's case): sent as 32-bit, nothing claimed, no tick.
    ({ fed, np } = await said(one, 0, "Song 1", { bits: 32 }));
    assert.deepEqual([fed.detail, fed.quality], ["PCM 44.1 kHz, the 16-bit samples sent as 32-bit — as Mandarin Bridge reports it", "pending"]);
    assert.doesNotMatch(np.format.text, /✓/);
  } finally {
    await srv.stop();
    await usb.stop();
    await house.stop();
  }
});
