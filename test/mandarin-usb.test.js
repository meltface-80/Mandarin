"use strict";
/*
 * A Mandarin USB renderer (github.com/meltface-80/Android-USB-Driver): an Android device with a USB DAC,
 * playing as a UPnP renderer, that says what its DAC takes at /dac.json — every rate, depth and DSD multiple — and
 * what it is feeding the DAC. Found like any renderer (its description, its Sink), it is read there too
 * (Renderers/MandarinUsb.cs): the whole of the DAC on its page as advertised, nothing to tick; and a track played
 * to it gets the ✓ of a WiiM's when the DAC is fed what was sent.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary, probe } = require("./fixtures");
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

// What the app advertises for a DAC that takes PCM to 768 kHz at 32 bits and DSD natively to DSD256: a raw-PCM entry
// per rate (the rates Mandarin reads from a Sink), the containers, the DSD types.
const RATES = [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
const SINK = RATES.flatMap(r => [`http-get:*:audio/L16;rate=${r};channels=2:*`, `http-get:*:audio/L24;rate=${r};channels=2:*`])
  .concat(["http-get:*:audio/flac:*", "http-get:*:audio/wav:*", "http-get:*:audio/x-dsf:*", "http-get:*:audio/x-dff:*", "http-get:*:audio/dsd:*"]).join(",");

test("a Mandarin USB renderer: its DAC read whole, and what it plays confirmed", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const usb = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin USB", modelNumber: "0.2.0", sink: SINK,
    dac: { device: "SMSL SU-1", rates: RATES, bits: [16, 24, 32], dsd: [64, 128, 256], dsd_native: [64, 128, 256], dsd_dop: [64, 128], volume_control: false, fixed: true } });
  // The same DAC said by the Sink alone (an older app, or any renderer): the rates, and DSD64 only.
  const plain = new FakeRenderer({ name: "Plain", manufacturer: "Acme", model: "Streamer", sink: SINK });
  await usb.start(); await plain.start();
  const { createServer } = require("./server");
  const srv = createServer({
    port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [usb.location, plain.location], upnpMulticast: false
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
  const state = async (zone) => (await api("zone-state?zone=" + zone)).zone;
  const USB = idFor(usb.udn), PLAIN = idFor(plain.udn);
  const on = chips => chips.filter(c => c.on);

  try {
    await until(async () => { const l = (await api("audio-devices")).devices; return l.some(d => d.id === USB) && l.some(d => d.id === PLAIN); }, 20000);
    const all = (await api("audio-devices/rescan", {})).devices;   // a POST: a round now
    const d = all.find(x => x.id === USB), p = all.find(x => x.id === PLAIN);

    await t.test("the DAC's capabilities come from the device: every rate, 32-bit, DSD to 256, all advertised", async () => {
      assert.ok(usb.requests.some(r => r.path === "/dac.json"), "/dac.json was asked for");
      assert.equal(d.model, "Mandarin USB");
      assert.deepEqual(on(d.rates).map(c => c.hz), RATES);
      assert.ok(d.rates.filter(c => c.hz > 48000).every(c => c.source === "advertised"), JSON.stringify(d.rates));
      assert.deepEqual(on(d.bits).map(c => c.n), [16, 24, 32]);
      assert.equal(d.bits.find(c => c.n === 32).source, "advertised");
      assert.deepEqual(on(d.dsd).map(c => c.n), [64, 128, 256]);
      assert.ok(d.dsd.every(c => c.source === "advertised"), JSON.stringify(d.dsd));
      assert.ok(d.containers.includes("flac") && d.containers.includes("dsd") && d.containers.includes("pcm"));
      assert.ok(d.playable && d.editable);
    });

    await t.test("the Sink alone gives the rates, the floor's depths and DSD64: what any renderer gets", async () => {
      assert.ok(!plain.requests.some(r => r.path === "/dac.json"), "a renderer that isn't one isn't asked");
      assert.deepEqual(on(p.rates).map(c => c.hz), RATES);
      assert.deepEqual(on(p.bits).map(c => c.n), [16, 24]);
      assert.deepEqual(on(p.dsd).map(c => c.n), [64]);
    });

    await t.test("a hi-res album plays as it is, and the DAC being fed 24/96 confirms it: the ✓, and the rate verified", async () => {
      let r = await api("audio-devices/" + USB, { enabled: true }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      const hires = (await api("library/albums?sort=album")).albums.find(a => a.title === "Hi Res");
      r = await api("play", { offset: hires.offset, zone_or_output_id: USB, kind: "play_now" });
      assert.equal(r.ok, true, JSON.stringify(r));
      await until(() => usb.state === "PLAYING");
      const f = await until(() => usb.fetches.find(x => x.done && x.body && x.body.length > 1000));
      assert.match(f.uri, /\/stream\/t\d+\.orig\.flac\?s=/, "the file itself: the DAC takes 96 kHz");
      assert.deepEqual(probe(f.body), { rate: 96000, channels: 2, bits: 24 });
      const s = await until(async () => { const z = await state(USB); return z && z.now_playing && /✓/.test(z.now_playing.format.text) && z; }, 20000);
      assert.equal(s.now_playing.format.text, "FLAC 24/96 ✓");
      assert.ok(usb.requests.filter(x => x.path === "/dac.json").length >= 2, "asked again, for what it plays");
      const dev = await api("audio-devices/" + USB);
      assert.equal(dev.rates.find(x => x.hz === 96000).source, "verified");
      assert.ok(dev.caps.verified.rates["96000"]);
      await api("control", { zone_or_output_id: USB, command: "stop" });
    });
  } finally {
    await srv.stop();
    await usb.stop(); await plain.stop();
    await house.stop();
  }
});
