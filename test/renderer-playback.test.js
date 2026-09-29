"use strict";
/*
 * Playing to a UPnP/DLNA renderer, end to end: a real server, real files, a
 * fake WiiM-like renderer and a fake Poly-like one on loopback (test/
 * fake-renderer.js) beside the fake Sonos household. Covers the path a tap
 * takes — album → the renderer's transport → the device fetching /stream —
 * including what it is handed: the file itself within its ceiling, FLAC at
 * the best rate it takes otherwise; gapless via SetNextAVTransportURI, and
 * the hand-started fallback for a device without it.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary, probe } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer } = require("./fake-renderer");
const { signIn } = require("./auth-helper");
const { idFor } = require("../lib/renderers/discovery");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3608;
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

test("a renderer is a zone", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM" } });
  // A Poly feeds a Mojo: fixed volume, and this one has no SetNextAVTransportURI.
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", setNext: false,
    sink: "http-get:*:audio/flac:*,http-get:*:audio/wav:*" });
  await wiim.start(); await poly.start();
  const { createServer } = require("../index.js");
  const srv = createServer({
    port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"],
    upnpHosts: [wiim.location, poly.location], upnpMulticast: false
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
  const WIIM = idFor(wiim.udn), POLY = idFor(poly.udn);

  try {
    await until(async () => (await api("status")).index_count === 3);
    const zones = await until(async () => { const z = await api("zones"); return z.zones.length === 4 && z.zones; }, 20000);
    const kitchen = zones.find(z => z.display_name === "Kitchen");
    const wz = zones.find(z => z.zone_id === WIIM);
    const pz = zones.find(z => z.zone_id === POLY);
    assert.ok(kitchen && wz && pz, "the renderers stand beside the rooms");
    assert.equal(wz.display_name, "Living Room WiiM");
    assert.equal(wz.outputs[0].volume.type, "number");
    assert.equal(pz.outputs[0].volume, null, "a Poly's volume is Mojo's own: no slider");

    const albums = (await api("library/albums?sort=album")).albums;
    const hires = albums.find(a => a.title === "Hi Res");
    const cd = albums.find(a => a.title === "Album One");

    await t.test("a CD album plays bit-perfect, and the next track follows without a new SetAVTransportURI", async () => {
      const r = await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      assert.equal(r.ok, true);
      await until(() => wiim.state === "PLAYING");
      const f = await until(() => wiim.fetches.find(x => x.done));
      assert.equal(f.status, 200);
      assert.equal(f.type, "audio/flac");
      assert.match(f.uri, /\/stream\/t\d+\.orig\.flac\?s=/);
      assert.deepEqual(probe(f.body), { rate: 44100, channels: 2, bits: 16 });
      const s1 = await until(async () => { const z = await state(WIIM); return z && z.state === "playing" && z.now_playing && z; });
      assert.equal(s1.now_playing.line1, "Song 1");
      assert.equal(s1.now_playing.line3, "Album One");
      assert.deepEqual(s1.now_playing.format, { kind: "lossless", text: "FLAC 16/44.1" });
      // The one after it was handed over ahead of time…
      await until(() => wiim.nextUri);
      assert.ok(wiim.log.includes("SetNextAVTransportURI"));
      // …and the device moved on by itself when the first ended.
      await until(() => wiim.log.includes("auto-next"), 12000);
      assert.equal(wiim.log.filter(a => a === "SetAVTransportURI").length, 1, "no second SetAVTransportURI: gapless");
      const s2 = await until(async () => { const z = await state(WIIM); return z && z.now_playing && z.now_playing.line1 === "Song 2" && z; });
      assert.equal(s2.state, "playing");
      const q = await api("queue?zone=" + WIIM);
      assert.equal(q.items[0].title, "Song 2");
      assert.equal(q.history[0].track, "Song 1");
      assert.ok(wiim.fetches.filter(x => x.done).length >= 2);
    });

    await t.test("24/96 is bit-perfect on the WiiM; a device ticked to 48 kHz gets FLAC 24/48", async () => {
      await api("play", { offset: hires.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f = await until(() => { const l = wiim.fetches.filter(x => x.done); const last = l[l.length - 1]; return last && /Hi|orig/.test(last.uri) && probe(last.body) && probe(last.body).rate === 96000 && last; });
      assert.match(f.uri, /\.orig\.flac\?/);
      assert.deepEqual(probe(f.body), { rate: 96000, channels: 2, bits: 24 });
      const s = await until(async () => { const z = await state(WIIM); return z && z.now_playing && /^Hi/.test(z.now_playing.line1) && z; });
      assert.deepEqual(s.now_playing.format, { kind: "lossless", text: "FLAC 24/96" });

      // The Poly ticked down to 44.1/48 on its page.
      const r = await fetch(B + "/api/audio-devices/" + POLY, { method: "PATCH", headers: Object.assign({ "Content-Type": "application/json" }, auth), body: JSON.stringify({ caps: { user: { rates: [44100, 48000] } } }) });
      assert.equal(r.status, 200);
      await api("play", { offset: hires.offset, zone_or_output_id: POLY, kind: "play_now" });
      const pf = await until(() => poly.fetches.find(x => x.done && x.body && x.body.length > 1000), 15000);
      assert.equal(pf.status, 200);
      assert.equal(pf.type, "audio/flac");
      assert.match(pf.uri, /\/stream\/t\d+\.48000-24\.flac\?s=/);
      assert.deepEqual(probe(pf.body), { rate: 48000, channels: 2, bits: 24 });
      const ps = await until(async () => { const z = await state(POLY); return z && z.state === "playing" && z.now_playing && z; });
      assert.deepEqual(ps.now_playing.format, { kind: "lossless", text: "FLAC 24/48" });
    });

    await t.test("a renderer without SetNextAVTransportURI is started on the next track by hand", async () => {
      // The Poly is playing Hi 1 (4 s); it stops at the end, and the server starts Hi 2.
      await until(() => poly.log.includes("ended"), 15000);
      await until(() => poly.log.filter(a => a === "SetAVTransportURI").length >= 2, 10000);
      const s = await until(async () => { const z = await state(POLY); return z && z.now_playing && z.now_playing.line1 === "Hi 2" && z.state === "playing" && z; });
      assert.equal(s.now_playing.line1, "Hi 2");
      assert.ok(!poly.nextUri, "nothing was ever set as next on a device that faults on it");
    });

    await t.test("transport, seek, volume and modes", async () => {
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      await until(() => wiim.state === "PLAYING" && /orig/.test(wiim.uri));
      assert.equal((await api("control", { zone_or_output_id: WIIM, command: "pause" })).ok, true);
      await until(() => wiim.state === "PAUSED_PLAYBACK");
      await until(async () => (await state(WIIM)).state === "paused");
      await api("control", { zone_or_output_id: WIIM, command: "play" });
      await until(() => wiim.state === "PLAYING");
      await api("seek", { zone_or_output_id: WIIM, how: "absolute", seconds: 1 });
      assert.ok(wiim.pos() >= 1 && wiim.pos() < 2.5, "seeked to about a second");
      const out = wz.outputs[0].output_id;
      await api("volume", { output_id: out, how: "absolute", value: 40 });
      assert.equal(wiim.volume, 40);
      await api("volume", { output_id: out, how: "relative", value: -5 });
      assert.equal(wiim.volume, 35);
      await api("volume", { zone_or_output_id: WIIM, mute: true });
      assert.equal(wiim.muted, true);
      const fixed = await api("volume", { output_id: pz.outputs[0].output_id, how: "absolute", value: 10 });
      assert.ok(fixed.status >= 400, "a fixed-volume device refuses");
      await api("zone-settings", { zone_or_output_id: WIIM, shuffle: false, loop: "loop" });
      const s = await until(async () => { const z = await state(WIIM); return z.settings.loop === "loop" && z; });
      assert.equal(s.settings.shuffle, false);
      await api("play-from-here", { zone_or_output_id: WIIM, queue_item_id: 3 });
      await until(async () => { const z = await state(WIIM); return z.now_playing && z.now_playing.line1 === "Song 3"; });
      // With loop on, next from the last track goes round to the first.
      await api("control", { zone_or_output_id: WIIM, command: "next" });
      await until(async () => { const z = await state(WIIM); return z.now_playing && z.now_playing.line1 === "Song 1"; });
      await api("zone-settings", { zone_or_output_id: WIIM, loop: "disabled" });
      await api("control", { zone_or_output_id: WIIM, command: "previous" });   // > 5 s? no: at the start → stays on Song 1 from 0
      const q = await api("queue?zone=" + WIIM);
      assert.equal(q.items.length, 3);
      assert.equal(q.items[0].title, "Song 1");
    });

    await t.test("what is playing moves between a renderer and a Sonos room, rebuilt for each", async () => {
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      await until(() => wiim.state === "PLAYING");
      await until(async () => (await state(WIIM)).state === "playing");
      const r = await api("transfer-zone", { from: WIIM, to: kitchen.zone_id });
      assert.equal(r.ok, true, JSON.stringify(r));
      const room = house.room("Kitchen");
      await until(() => room.queue.length === 3 && room.state === "PLAYING");
      assert.ok(!/\.orig\./.test(room.queue[0].uri), "the room gets Sonos' own URLs");
      await until(() => wiim.state !== "PLAYING");
      const back = await api("transfer-zone", { from: kitchen.zone_id, to: WIIM });
      assert.equal(back.ok, true, JSON.stringify(back));
      await until(() => wiim.state === "PLAYING" && /\.orig\.flac/.test(wiim.uri));
      await until(() => room.state !== "PLAYING");
      const q = await api("queue?zone=" + WIIM);
      assert.equal(q.items.length + q.history.length, 3);
    });

    await t.test("the device page follows playback", async () => {
      const d = (await api("audio-devices/" + WIIM)).state;
      assert.ok(["playing", "loading"].includes(d), d);
      // The Poly's album ran out a moment ago; once it is idle the WiiM,
      // still playing, heads the list.
      const list = await until(async () => { const l = (await api("audio-devices")).devices; return l[0].id === WIIM && l[0].state === "playing" && l; }, 15000);
      assert.equal(list[0].name, "Living Room WiiM");
    });
  } finally {
    await srv.stop();
    await house.stop();
    await wiim.stop(); await poly.stop();
  }
});
