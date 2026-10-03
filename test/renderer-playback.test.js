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
const path = require("path");
const { haveFfmpeg, makeLibrary, probe, writeDsf } = require("./fixtures");
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
  // A DSD64 album (v0.6.0-RC3), for the Poly, which says it takes DSD files.
  writeDsf(path.join(lib.music, "Artist D", "DSD Album", "01 Dsd.dsf"), 2);
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM" } });
  // A Poly feeds a Mojo: fixed volume, and this one has no SetNextAVTransportURI.
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", setNext: false,
    sink: "http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/dsf:*,http-get:*:audio/dff:*" });
  await wiim.start(); await poly.start();
  const { createServer } = require("../index.js");
  const options = {
    port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"],
    upnpHosts: [wiim.location, poly.location], upnpMulticast: false
  };
  let srv = createServer(options);
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
    await until(async () => (await api("status")).index_count === 4);
    // A renderer found on the network is off until switched on: two rooms only…
    await until(async () => { const z = await api("zones"); return z.zones.length === 2; }, 20000);
    await until(async () => { const l = (await api("audio-devices")).devices; return l.some(d => d.id === WIIM) && l.some(d => d.id === POLY); }, 20000);
    for (const id of [WIIM, POLY]) {
      const r = await api("audio-devices/" + id, { enabled: true }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.enabled, true);
    }
    // …then four.
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

    await t.test("Volume Levelling changed while a Sonos room plays: its queue is planned again and plays on", async () => {
      const room = house.room("Kitchen");
      await until(async () => (await api("audio-devices")).devices.some(d => d.id === kitchen.zone_id));
      await api("audio-devices/" + kitchen.zone_id, { levelling: { mode: "off" } }, "PATCH");
      await api("play", { offset: cd.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      await until(() => room.state === "PLAYING" && room.queue.length === 3);
      assert.ok(room.queue.every(q => !/[?&]g=/.test(q.uri)));
      // Album at -25 LUFS, -10 dB for what isn't known (these files carry no ReplayGain).
      const r = await api("audio-devices/" + kitchen.zone_id, { levelling: { mode: "album", target: -25, unknown: -10 } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      await until(() => room.queue.length === 3 && room.queue.every(q => /[?&]g=-10\b/.test(q.uri)), 10000);
      await until(() => room.state === "PLAYING");
      // And off again: the files as they were.
      await api("audio-devices/" + kitchen.zone_id, { levelling: { mode: "off" } }, "PATCH");
      await until(() => room.queue.length === 3 && room.queue.every(q => !/[?&]g=/.test(q.uri)), 10000);
      await api("control", { zone_or_output_id: kitchen.zone_id, command: "stop" });
    });

    await t.test("Move to another room, as the page asks it (from_zone / to_zone): Sonos to Sonos, then to a renderer", async () => {
      const study = zones.find(z => z.display_name === "Study");
      const room = house.room("Kitchen"), other = house.room("Study");
      await api("play", { offset: cd.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      await until(() => room.state === "PLAYING" && room.queue.length === 3);
      let r = await api("transfer-zone", { from_zone: kitchen.zone_id, to_zone: study.zone_id });
      assert.equal(r.status, 200, JSON.stringify(r));
      await until(() => other.queue.length === 3 && other.state === "PLAYING");
      assert.deepEqual(other.queue.map(q => q.uri.split("?")[0]), room.queue.map(q => q.uri.split("?")[0]), "the same queue");
      await until(() => room.state !== "PLAYING");
      r = await api("transfer-zone", { from_zone: study.zone_id, to_zone: WIIM });
      assert.equal(r.status, 200, JSON.stringify(r));
      await until(() => wiim.state === "PLAYING");
      await until(() => other.state !== "PLAYING");
      assert.equal((await api("transfer-zone", {})).status, 400);
      await api("control", { zone_or_output_id: WIIM, command: "stop" });
    });

    await t.test("Upsample ×2: a CD rip goes out as 24/88.2 in 64-bit float, and the WiiM confirms it", async () => {
      let r = await api("audio-devices/" + WIIM, { output: { mode: "x2" } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.output.mode, "x2");
      assert.equal((await api("audio-devices/" + WIIM, { output: { mode: "x9" } }, "PATCH")).status, 400);
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f = await until(() => { const l = wiim.fetches.filter(x => x.done && x.body && x.body.length > 1000); const last = l[l.length - 1]; return last && /88200-24/.test(last.uri) && last; }, 15000);
      assert.match(f.uri, /\/stream\/t\d+\.88200-24\.flac\?s=/);
      assert.deepEqual(probe(f.body), { rate: 88200, channels: 2, bits: 24 });
      // The badge says what went, and — once the WiiM's own API agrees — its tick.
      const s = await until(async () => { const z = await state(WIIM); return z && z.now_playing && /↑×2/.test(z.now_playing.format.text) && /✓/.test(z.now_playing.format.text) && z; }, 15000);
      assert.equal(s.now_playing.format.text, "FLAC 24/88.2 ↑×2 ✓");
      const d = await api("audio-devices/" + WIIM);
      assert.equal(d.rates.find(x => x.hz === 88200).source, "verified");
      assert.ok(d.caps.verified.rates["88200"]);
      // Max on this device is 176.4 for a 44.1 file.
      await api("audio-devices/" + WIIM, { output: { mode: "max" } }, "PATCH");
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f2 = await until(() => { const l = wiim.fetches.filter(x => x.done && x.body && x.body.length > 1000); const last = l[l.length - 1]; return last && /176400-24/.test(last.uri) && last; }, 15000);
      assert.deepEqual(probe(f2.body), { rate: 176400, channels: 2, bits: 24 });
      await api("audio-devices/" + WIIM, { output: { mode: "original" } }, "PATCH");
    });

    await t.test("DSP: on, a CD rip is decoded, filtered and sent as 24/44.1 FLAC; off, as it is", async () => {
      // A −6 dB band and the switch, saved together. The zone's queue is
      // planned again, so the next address carries the output's id.
      let r = await api("audio-devices/" + WIIM, { dsp: { enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: -6, q: 1.41 }] } } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.dsp.enabled, true);
      assert.equal(r.dsp.peq.bands.length, 1);
      assert.equal(r.dsp_info.active, true);
      assert.equal(r.dsp_info.headroom, -0.5);
      assert.equal((await api("audio-devices/" + WIIM, { dsp: { peq: { bands: [{ type: "wah", freq: 100 }] } } }, "PATCH")).status, 400);
      assert.equal((await api("audio-devices/RINCON_KITCHEN01400", { dsp: { enabled: true } }, "PATCH")).status, 400, "never a Sonos room");
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f = await until(() => { const l = wiim.fetches.filter(x => x.done && x.body && x.body.length > 1000); const last = l[l.length - 1]; return last && /44100-24\.flac\?o=/.test(last.uri) && last; }, 15000);
      assert.match(f.uri, /\/stream\/t\d+\.44100-24\.flac\?o=UPNP_[^&]+&s=/);
      assert.deepEqual(probe(f.body), { rate: 44100, channels: 2, bits: 24 });
      const s = await until(async () => { const z = await state(WIIM); return z && z.now_playing && /DSP/.test(z.now_playing.format.text) && z; }, 15000);
      assert.match(s.now_playing.format.text, /^FLAC 24\/44\.1 · DSP/);
      // Off again: the file as it is from the next track on.
      r = await api("audio-devices/" + WIIM, { dsp: { enabled: false } }, "PATCH");
      assert.equal(r.dsp.enabled, false);
      assert.equal(r.dsp.peq.bands.length, 1, "the bands are kept for next time");
      assert.equal(r.dsp_info.active, false);
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      await until(() => wiim.state === "PLAYING" && /\.orig\.flac/.test(wiim.uri), 15000);
    });

    await t.test("events: the device says when it changed, and the page knows", async () => {
      // Subscribed (the server's callback is on its own port) and told at once.
      await until(() => wiim.subscribers.length >= 1, 10000);
      assert.match(wiim.subscribers[0].callback, /\/upnp\/event\/UPNP_/);
      const d = await until(async () => { const x = await api("audio-devices/" + WIIM); return x.events === "live" && x; }, 10000);
      assert.equal(d.openhome, false);
      // A change on the device reaches the server's state through the event,
      // sooner than a lazy poll would: pause it behind Mandarin's back.
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      await until(() => wiim.state === "PLAYING");
      await until(async () => (await state(WIIM)).state === "playing");
      const notifiedBefore = wiim.notified;
      wiim.handle("Pause", {}); wiim.notify();
      await until(() => wiim.notified > notifiedBefore);
      const t0 = Date.now();
      await until(async () => (await state(WIIM)).state === "paused", 3000);
      assert.ok(Date.now() - t0 < 2500, "the pause showed within a moment of the event");
      await api("control", { zone_or_output_id: WIIM, command: "play" });
      await until(async () => (await state(WIIM)).state === "playing");
    });

    await t.test("fixed volume is a switch on a renderer's page", async () => {
      let r = await api("audio-devices/" + WIIM, { output: { volume: "fixed" } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.volume_fixed, true);
      const z = (await api("zones")).zones.find(x => x.zone_id === WIIM);
      assert.equal(z.outputs[0].volume, null, "no slider while fixed");
      assert.ok((await api("volume", { output_id: WIIM, how: "absolute", value: 20 })).status >= 400);
      r = await api("audio-devices/" + WIIM, { output: { volume: "upnp" } }, "PATCH");
      assert.equal(r.volume_fixed, false);
      assert.equal((await api("zones")).zones.find(x => x.zone_id === WIIM).outputs[0].volume.type, "number");
      assert.equal((await api("audio-devices/" + WIIM, { output: { volume: "off" } }, "PATCH")).status, 400);
      assert.equal((await api("audio-devices/RINCON_KITCHEN01400")).can_fix_volume, false, "never on a Sonos room");
    });

    await t.test("the device page follows playback", async () => {
      const d = (await api("audio-devices/" + WIIM)).state;
      assert.ok(["playing", "loading"].includes(d), d);
      // The Poly's album ran out a moment ago; once it is idle the WiiM,
      // still playing, heads the list.
      const list = await until(async () => { const l = (await api("audio-devices")).devices; return l[0].id === WIIM && l[0].state === "playing" && l; }, 15000);
      assert.equal(list[0].name, "Living Room WiiM");
    });

    await t.test("DSD: a device that takes DSD files gets the .dsf as it is, in its own words; tapped off, PCM", async () => {
      const dsdAlbum = (await api("library/albums?sort=album")).albums.find(a => a.title === "DSD Album");
      assert.ok(dsdAlbum, "the DSF is in the library");
      const dev = await api("audio-devices/" + POLY);
      assert.deepEqual(dev.dsd.filter(d => d.on).map(d => d.n), [64, 128, 256], JSON.stringify(dev.dsd));
      let from = poly.fetches.length;
      await api("play", { offset: dsdAlbum.offset, zone_or_output_id: POLY, kind: "play_now" });
      const f = await until(() => poly.fetches.slice(from).find(x => x.done && /\.orig\.dsf/.test(x.uri) && x), 15000);
      assert.equal(f.status, 200);
      assert.equal(f.body.toString("ascii", 0, 4), "DSD ", "the file itself, not a conversion");
      assert.equal(f.type, "audio/dsf", "served as the device names it");
      assert.match(poly.meta, /audio\/dsf/, "and announced so");
      await until(async () => { const z = await state(POLY); return z && z.now_playing && z.now_playing.format && z.now_playing.format.text === "DSD64" && z; }, 15000);
      // Tapped off on its page: DSD goes as PCM again.
      const off = await api("audio-devices/" + POLY, { caps: { user: { dsd: [] } } }, "PATCH");
      assert.equal(off.status, 200, JSON.stringify(off));
      assert.deepEqual(off.dsd.filter(d => d.on), []);
      from = poly.fetches.length;
      await api("play", { offset: dsdAlbum.offset, zone_or_output_id: POLY, kind: "play_now" });
      const g = await until(() => poly.fetches.slice(from).find(x => x.done && x.body && x.body.length > 1000 && x), 20000);
      assert.match(g.uri, /\.\d+-\d+\.flac/, g.uri);
      assert.ok(probe(g.body), "FLAC");
      await api("audio-devices/" + POLY, { caps: { user: { dsd: null } } }, "PATCH");
    });

    await t.test("the server restarted (an update): the renderer's queue is kept and the playing track recognised", async () => {
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      await until(async () => { const z = await state(WIIM); return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Song 1"; });
      await new Promise(r => setTimeout(r, 600));            // the store writes after a moment
      const sets = wiim.log.filter(a => a === "SetAVTransportURI").length;
      await srv.stop();
      srv = createServer(options);
      await srv.start();
      await until(async () => (await api("status")).status === 200);
      // The device played on through the restart; the server finds it in the queue it kept.
      const s = await until(async () => { const z = await state(WIIM); return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Song 1" && z; }, 20000);
      assert.equal(s.now_playing.line3, "Album One");
      assert.deepEqual((await api("queue?zone=" + WIIM)).items.map(i => i.title), ["Song 1", "Song 2", "Song 3"]);
      assert.equal(wiim.log.filter(a => a === "SetAVTransportURI").length, sets, "not started again: the same track carries on");
      // And it still moves on to the next.
      await until(() => wiim.nextUri, 10000);
    });
  } finally {
    await srv.stop();
    await house.stop();
    await wiim.stop(); await poly.stop();
  }
});
