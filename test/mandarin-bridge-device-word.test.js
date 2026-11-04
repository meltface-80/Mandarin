"use strict";
/*
 * A Mandarin Bridge renderer's word on its DAC is the whole of it (Renderers/Profiles.MandarinBridge.cs), as a Roon Ready
 * device's is: what the DAC takes is on, nothing else is, and there is nothing to tick. Ticks of yours can only turn
 * one off — a list from before the device said, every chip ticked by hand, leaves its word as it is — and its volume
 * is the DAC's: fixed where the DAC has no USB volume control, Mandarin's slider where it has.
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

async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

const RATES = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
const sinkFor = rates => rates.map(r => `http-get:*:audio/L24;rate=${r};channels=2:*`).concat(["http-get:*:audio/flac:*", "http-get:*:audio/x-dsf:*"]).join(",");

test("a Mandarin Bridge renderer: its DAC's word is the whole of it, and its volume the DAC's", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  // An SMSL SU-1 as the app on a FiiO R7 says it: 24- and 32-bit formats only, DSD to 512, no USB volume control.
  const su1 = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", modelNumber: "0.2.0", sink: sinkFor(RATES),
    dac: { device: "SMSL USB AUDIO", rates: RATES, bits: [24, 32], dsd: [64, 128, 256, 512], dsd_native: [64, 128, 256, 512], dsd_dop: [64, 128, 256], volume_control: false, fixed: true } });
  // A headphone DAC with a volume of its own, to 384 kHz, no DSD.
  const phones = new FakeRenderer({ name: "Desk USB", manufacturer: "Mandarin", model: "Mandarin Bridge", modelNumber: "0.2.0", sink: sinkFor(RATES.slice(0, 8)),
    dac: { device: "Headphone DAC", rates: RATES.slice(0, 8), bits: [16, 24, 32], dsd: [], volume_control: true, fixed: false } });
  await su1.start(); await phones.start();
  const { createServer } = require("./server");
  const srv = createServer({
    port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [su1.location, phones.location], upnpMulticast: false
  });
  await srv.start();
  const token = await signIn(B);
  const auth = { Authorization: "Bearer " + token };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? {
      method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {})
    } : { headers: auth });
    const j = await r.json().catch(() => ({}));
    return { status: r.status, ...j };
  };
  const SU1 = idFor(su1.udn), PHONES = idFor(phones.udn);
  const on = chips => chips.filter(c => c.on);

  try {
    await until(async () => { const l = (await api("audio-devices")).devices; return l.some(d => d.id === SU1) && l.some(d => d.id === PHONES); }, 20000);
    const all = (await api("audio-devices/rescan", {})).devices;
    const d = all.find(x => x.id === SU1), h = all.find(x => x.id === PHONES);

    await t.test("what the DAC takes is on and nothing else: no floor, no profile, the device's own note", async () => {
      assert.deepEqual(on(d.rates).map(c => c.hz), RATES);
      assert.deepEqual(on(d.bits).map(c => c.n), [24, 32], "16-bit isn't assumed where the device says the DAC hasn't it");
      assert.deepEqual(on(d.dsd).map(c => c.n), [64, 128, 256]);
      assert.ok([...on(d.rates), ...on(d.bits), ...on(d.dsd)].every(c => c.source === "advertised"), JSON.stringify(d));
      assert.equal(d.profile.id, "mandarin-usb");
      assert.doesNotMatch(d.profile.notes, /assumed|Tick the rates/);
      assert.match(d.profile.notes, /nothing to tick/);
      assert.deepEqual(on(h.rates).map(c => c.hz), RATES.slice(0, 8));
      assert.deepEqual(on(h.dsd), [], "no DSD where the DAC takes none");
    });

    await t.test("its volume is the DAC's: fixed with no USB volume control, the slider with one", async () => {
      assert.equal((await api("audio-devices/" + SU1)).volume_fixed, true);
      assert.equal((await api("audio-devices/" + PHONES)).volume_fixed, false);
    });

    await t.test("every chip ticked by hand leaves the device's word as it is, marked as the device's", async () => {
      const r = await api("audio-devices/" + SU1, { caps: { user: { rates: RATES, bits: [16, 24, 32], dsd: [64, 128, 256] } } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.deepEqual(on(r.rates).map(c => c.hz), RATES);
      assert.deepEqual(on(r.bits).map(c => c.n), [24, 32]);
      assert.deepEqual(on(r.dsd).map(c => c.n), [64, 128, 256]);
      assert.ok([...on(r.rates), ...on(r.bits), ...on(r.dsd)].every(c => c.source === "advertised"), "no ✎: " + JSON.stringify(r.rates));
    });

    await t.test("a tap turns one off; a tick for what the DAC doesn't take changes nothing", async () => {
      let r = await api("audio-devices/" + SU1, { caps: { user: { rates: RATES.filter(x => x !== 768000) } } }, "PATCH");
      assert.deepEqual(on(r.rates).map(c => c.hz), RATES.filter(x => x !== 768000));
      assert.equal(r.rates.find(c => c.hz === 768000).source, "off");
      r = await api("audio-devices/" + PHONES, { caps: { user: { rates: RATES, dsd: [64] } } }, "PATCH");
      assert.deepEqual(on(r.rates).map(c => c.hz), RATES.slice(0, 8));
      assert.deepEqual(on(r.dsd), []);
    });
  } finally {
    await srv.stop();
    await su1.stop(); await phones.stop();
    await house.stop();
  }
});
