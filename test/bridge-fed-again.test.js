"use strict";
/*
 * A Mandarin Bridge's word on what it feeds its DAC, asked again until it is had (item 314). Mandarin asks a Bridge
 * (/dac.json "now") once a track has played a couple of seconds, for the signal path's last step and its ✓. A Bridge
 * that didn't answer that once, or answered that it played nothing (its app busy, or between tracks), was never
 * asked again for that track: the ✓ never came. Asked again at the next read now, the first answer that says what
 * it feeds is the one shown.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? ": " + what : ""));
    await sleep(150);
  }
}

const SINK = "http-get:*:audio/flac:*,http-get:*:audio/wav:*";
const DAC = { device: "SMSL SU-1", rates: [44100, 48000, 96000, 192000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true };

test("a Bridge that missed the first asks: asked again, its word on what the DAC is fed shown", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  // Long enough to be asked again before it ends.
  gen(path.join(lib.music, "Artist L", "Long One", "01 Long.flac"), { seconds: 12, freq: 440, tags: { title: "Long", artist: "Artist L", album: "Long One", track: 1 } });
  // The first ask unanswered, the second said to play nothing: the third says what it feeds.
  const usb = new FakeRenderer({ name: "FiiO R7 USB", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: DAC, dacMisses: 1, nowMisses: 1 });
  await usb.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpHosts: [usb.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { await srv.stop(); await usb.stop(); });
  const auth = { Authorization: "Bearer " + await signIn(B) };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const USB = idFor(usb.udn);
  await until(async () => (await api("status")).index_count === 4, 30000, "the library");
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === USB), 20000, "the Bridge");
  assert.equal((await api("audio-devices/" + USB, { enabled: true }, "PATCH")).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === USB), 20000, "the room");
  const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Long One");
  usb.nowExtra = { bits: 32, volume: "fixed", level: 100, untouched: true };
  assert.equal((await api("play-track", { offset: one.offset, track: 0, zone_or_output_id: USB, kind: "play_now", only: true })).status, 200);
  const fed = await until(async () => {
    const np = (await api("zone-state?zone=" + USB)).zone.now_playing;
    return np && np.line1 === "Long" && np.signal && np.signal.steps.find(x => x.kind === "fed");
  }, 30000, "its word on what the DAC is fed");
  assert.equal(fed.title, "The DAC is fed");
  assert.equal(usb.dacMisses + usb.nowMisses, 0, "both misses were asked through");
});
