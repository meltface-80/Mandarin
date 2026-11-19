"use strict";
/*
 * An iBroadcast album played first time, iBroadcast slow to answer (item 490). On 19 November the library caught up
 * with iBroadcast's (item 489): some 550 albums new at once, none of their tracks' rates read yet. Chosen to play, each
 * album's rates were read first (item 463), four at a time, five seconds at most; an album of sixteen tracks was four
 * readings one after another, so the play was answered after up to 5 s, the app showing nothing. The tap was taken
 * for one that did nothing and made again, each tap starting the album afresh: sound 8.8 s after the first. Back on the
 * album it played at once, its rates kept. And the reading after a library reading went one track at a time, hours
 * for thousands.
 *
 * The stand-in iBroadcast here answers each stream after a second, as a real one under a busy upload might. Before,
 * every test of this ran against one that answered in milliseconds, and nothing measured how long a play waited.
 *   - chosen to play, an album's rates are read all at once: the play answered in about one reading's time;
 *   - the reading after a library reading reads four at a time.
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
const { until } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SINK = "http-get:*:audio/flac:*,http-get:*:audio/wav:*";
const DAC = { device: "SMSL SU-1", rates: [44100, 48000, 88200, 96000, 176400, 192000], bits: [16, 24, 32], dsd: [], volume_control: false, fixed: true };
const N = 16, SLOW = 1000;

test("item 490: an iBroadcast album new to the library, iBroadcast slow, is answered in about one reading's time", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const hi = path.join(lib.root, "hi-96.flac");
  gen(hi, { seconds: 2, rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], tags: { title: "Hi" } });
  // Sixteen tracks whose files aren't there yet when the reading after the library's comes to them: their rates not
  // known when the album is chosen, as the 550 albums just come in were.
  const tracks = Array.from({ length: N }, (_, i) => ({ id: 9001 + i, title: "T" + (i + 1), track: i + 1, length: 2, type: "audio/flac" }));
  const more = Array.from({ length: 8 }, (_, i) => ({ id: 9501 + i, title: "M" + (i + 1), track: i + 1, length: 2, type: "audio/flac" }));
  const ib = await new FakeIBroadcast({ albums: [
    { id: 901, name: "Sixteen", artist: { id: 9, name: "Band" }, year: 2026, tracks },
  ] }).start();
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
  const rates = ids => db.prepare(`SELECT sample_rate FROM tracks WHERE path IN (${ids.map(i => `'ibroadcast://track/${i}'`).join(",")})`).all().map(r => r.sample_rate);
  await api("settings/ibroadcast/signin", {});
  ib.approve();
  await until(() => rates(tracks.map(x => x.id)).length === N, 30000, "the album's tracks");
  // The reading after the library's tried each and found nothing to read.
  await until(() => tracks.every(x => ib.streamAsks.some(a => a.path.endsWith("/" + x.id))), 30000, "the reading after the library's tried them all");
  await sleep(500);
  assert.ok(rates(tracks.map(x => x.id)).every(r => r == null), "no rate known when the album is chosen");
  for (const x of tracks) x.src = hi;
  ib.streamDelayMs = SLOW;
  ib.mostProbing = 0;

  const USB = idFor(usb.udn);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === USB), 20000, "the Bridge");
  assert.equal((await api("audio-devices/" + USB, { enabled: true }, "PATCH")).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === USB), 20000, "the room");
  const album = db.prepare("SELECT id FROM albums WHERE key = 'ibroadcast:901'").get().id;

  await t.test("chosen to play: its sixteen rates read at once, the play answered in about one reading's time, at 24/96", async () => {
    const t0 = Date.now();
    const r = await api("play", { offset: album, zone_or_output_id: USB, kind: "play_now" });
    const took = Date.now() - t0;
    assert.equal(r.status, 200, JSON.stringify(r));
    // One reading takes a second here; four rounds of four took four, and the five seconds' cap cut them short.
    assert.ok(took < 2500, `the play was answered after ${took} ms`);
    assert.ok(ib.mostProbing >= N / 2, `read at once: ${ib.mostProbing} at most`);
    assert.ok(rates(tracks.map(x => x.id)).every(r => r === 96000), JSON.stringify(rates(tracks.map(x => x.id))));
    const uri = await until(() => usb.setUri, 20000, "the Bridge told what to play");
    assert.match(uri, /\.96000-24\.flac/, "planned at its own 24/96: " + uri.replace(/\?.*$/, ""));
    assert.ok(!ctx.logs.some(l => /cannot read/.test(l)), ctx.logs.filter(l => /\[stream\]/.test(l)).join("\n"));
    // Stopped, so what the Bridge fetches as it plays isn't counted below.
    await api("control", { zone_or_output_id: USB, command: "stop" });
    await until(() => ib.streaming === 0, 30000, "the Bridge done fetching");
  });

  await t.test("the reading after a library reading: four at a time, not one", async () => {
    ib.albums.push({ id: 902, name: "Eight", artist: { id: 9, name: "Band" }, year: 2026, tracks: more.map(x => Object.assign(x, { src: hi })) });
    ib.changed();
    ib.streamDelayMs = 600;
    ib.mostProbing = 0;
    const t0 = Date.now();
    assert.equal((await api("settings/ibroadcast/library", {})).status, 200);
    await until(() => rates(more.map(x => x.id)).length === 8 && rates(more.map(x => x.id)).every(r => r === 96000), 30000, "the eight rates read");
    const took = Date.now() - t0;
    assert.equal(ib.mostProbing, 4, "four at a time, never more");
    // Eight at 0.6 s each: 4.8 s one at a time, 1.2 s four at a time.
    assert.ok(took < 4000, `read in ${took} ms`);
  });
});
