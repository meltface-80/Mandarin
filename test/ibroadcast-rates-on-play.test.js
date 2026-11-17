"use strict";
/*
 * An iBroadcast album played before its rates are read (item 463). The library reads each lossless track's rate and
 * depth from its original after a library reading, one after another (item 445); an album new to the library (one
 * just uploaded, thousands before it) was played before that reading came to it, and a track planned without its rate
 * was planned at 44.1 kHz: "a flac Mandarin Bridge cannot read → FLAC 24/44.1 kHz", a 24/96 original turned down.
 * Chosen to play, its tracks' rates are read first, and it is sent to a Bridge at its own 24/96.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}

const SINK = "http-get:*:audio/flac:*,http-get:*:audio/wav:*";
const DAC = { device: "SMSL SU-1", rates: [44100, 48000, 88200, 96000, 176400, 192000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true };

test("item 463: an iBroadcast album played before its rates were read is sent to a Bridge at its own 24/96", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const hi = path.join(lib.root, "hi-96.flac");
  gen(hi, { seconds: 3, rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], tags: { title: "Hi" } });
  // Its file not there yet when the library's reading after the library's comes to it: as an album the reading hasn't
  // reached is, its rate not known when it is chosen.
  const track = { id: 8001, title: "Hi", track: 1, length: 3, type: "audio/flac" };
  const ib = await new FakeIBroadcast({ albums: [{ id: 801, name: "Just Uploaded", artist: { id: 8, name: "Band" }, year: 2026, tracks: [track] }] }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const usb = await new FakeRenderer({ name: "Mandarin", manufacturer: "Mandarin", model: "Mandarin Bridge", sink: SINK, dac: DAC }).start();
  t.after(() => usb.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpHosts: [usb.location], upnpMulticast: false,
    identify: false, ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 100000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const auth = { Authorization: "Bearer " + await signIn(base) };
  const api = async (p, body, method) => {
    const r = await fetch(base + "/api/" + p, body || method ? { method: method || "POST", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify(body || {}) } : { headers: auth });
    return { status: r.status, ...await r.json().catch(() => ({})) };
  };
  const db = ctx.db.raw;
  await api("settings/ibroadcast/signin", {});
  ib.approve();
  const row = () => db.prepare("SELECT t.id, t.sample_rate, t.bits, a.id AS album FROM tracks t JOIN albums a ON a.id = t.album_id WHERE t.path = 'ibroadcast://track/8001'").get();
  await until(() => row(), 30000, "the iBroadcast album");
  await until(() => ib.streamAsks.some(a => a.path.endsWith("/8001") && a.range === "bytes=0-65535"), 30000, "the library's reading of its rate tried");
  await sleep(500);
  assert.equal(row().sample_rate, null, "its rate not known when it is chosen");
  track.src = hi;

  const USB = idFor(usb.udn);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === USB), 20000, "the Bridge");
  assert.equal((await api("audio-devices/" + USB, { enabled: true }, "PATCH")).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === USB), 20000, "the room");
  assert.equal((await api("play", { offset: row().album, zone_or_output_id: USB, kind: "play_now" })).status, 200);
  const uri = await until(() => usb.setUri, 20000, "the Bridge told what to play");
  assert.match(uri, new RegExp("/stream/t" + row().id + "\\.96000-24\\.flac"), "planned at its own 24/96, never 44.1: " + uri.replace(/\?.*$/, ""));
  assert.deepEqual([row().sample_rate, row().bits], [96000, 24], "and kept");
  assert.ok(!ctx.logs.some(l => /cannot read/.test(l)), ctx.logs.filter(l => /\[stream\]/.test(l)).join("\n"));
});
