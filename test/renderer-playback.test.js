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
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen, probe, writeDsf } = require("./fixtures");
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

test("a renderer is a zone", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  // A DSD64 album (v0.6.0-RC3), for the Poly, which says it takes DSD files.
  writeDsf(path.join(lib.music, "Artist D", "DSD Album", "01 Dsd.dsf"), 2);
  // An album of long tracks, for the transport: held on a track, a busy machine's pause can come
  // seconds late, and the fixture's three-second tracks ran out first.
  for (let i = 1; i <= 3; i++) {
    gen(path.join(lib.music, "Artist L", "Long Album", `0${i} Long ${i}.flac`), { seconds: 30, freq: 300 * i, tags: { title: `Long ${i}`, artist: "Artist L", album: "Long Album", track: i } });
  }
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM" } });
  // A Poly feeds a Mojo: fixed volume, and this one has no SetNextAVTransportURI.
  const poly = new FakeRenderer({ name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", setNext: false,
    sink: "http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/dsf:*,http-get:*:audio/dff:*" });
  // A DAC of no profile of its own that takes DSF files and SetNextAVTransportURI: PCM made DSD for it (item 243).
  const dac = new FakeRenderer({ name: "DSD DAC", sink: "http-get:*:audio/flac:*,http-get:*:audio/x-dsf:*" });
  await wiim.start(); await poly.start(); await dac.start();
  const { createServer } = require("./server");
  const options = {
    port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [wiim.location, poly.location, dac.location], upnpMulticast: false, dsdLateS: 5, makeWaitMs: 1500
  };
  let srv = createServer(options);
  let ctx = await srv.start();
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
  const WIIM = idFor(wiim.udn), POLY = idFor(poly.udn), DAC = idFor(dac.udn);

  try {
    await until(async () => (await api("status")).index_count === 5);
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
    const long = albums.find(a => a.title === "Long Album");

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
      await api("play", { offset: long.offset, zone_or_output_id: WIIM, kind: "play_now" });
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
      await until(async () => { const z = await state(WIIM); return z.now_playing && z.now_playing.line1 === "Long 3"; });
      // With loop on, next from the last track goes round to the first.
      await api("control", { zone_or_output_id: WIIM, command: "next" });
      await until(async () => { const z = await state(WIIM); return z.now_playing && z.now_playing.line1 === "Long 1"; });
      // Held there, the queue below read with it.
      await api("control", { zone_or_output_id: WIIM, command: "pause" });
      await until(() => wiim.state === "PAUSED_PLAYBACK");
      await api("zone-settings", { zone_or_output_id: WIIM, loop: "disabled" });
      await api("control", { zone_or_output_id: WIIM, command: "previous" });   // > 5 s? no: at the start → stays on Long 1 from 0
      const q = await api("queue?zone=" + WIIM);
      assert.equal(q.items.length, 3);
      assert.equal(q.items[0].title, "Long 1");
    });

    // Item 150: a poll asked before a jump and answered after it named the track jumped from, and the room's place in
    // the queue went back to it ("transport, seek, volume and modes" read 2 tracks left, not 3, on a busy machine: its
    // Previous went from the stale Long 3 to Long 2). Made certain here: the device's reads are held, and the one asked
    // before the jump is answered after it.
    await t.test("a renderer's answer from before a jump doesn't put the room back on the track before", async () => {
      await api("play-from-here", { zone_or_output_id: WIIM, queue_item_id: 3 });
      await until(async () => { const z = await state(WIIM); return z.state === "playing" && z.now_playing && z.now_playing.line1 === "Long 3"; });
      await sleep(1200);
      wiim.holdReads();
      try {
        await api("control", { zone_or_output_id: WIIM, command: "play" });   // a poll 300 ms on, held: Long 3
        await until(() => wiim.readGate.length >= 2);
        await api("play-from-here", { zone_or_output_id: WIIM, queue_item_id: 1 });
        await until(async () => { const z = await state(WIIM); return z.now_playing && z.now_playing.line1 === "Long 1"; });
        wiim.releaseReads(2);   // the poll from before: "Long 3"
        await sleep(400);
        await api("control", { zone_or_output_id: WIIM, command: "previous" });   // at Long 1's start: stays on Long 1
      } finally { wiim.releaseReads(); }
      await sleep(1500);
      const z = await state(WIIM);
      assert.equal(z.now_playing && z.now_playing.line1, "Long 1", "still on Long 1, not Long 2");
      const q = await api("queue?zone=" + WIIM);
      assert.equal(q.items.length, 3, "the whole album still to come from Long 1");
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
      // Its signal path (item 247): what goes out and how, centred; every step from the file to the device.
      const sp = s.now_playing.signal;
      assert.deepEqual(sp.lines, ["FLAC 24/88.2 kHz ↑×2 ✓", "Standard filter"]);
      assert.deepEqual(sp.steps.map(x => x.kind), ["source", "upsample", "output", "verified"]);
      assert.equal(sp.steps[0].detail, "FLAC 16/44.1 kHz");
      assert.equal(sp.steps[1].detail, "×2 to 88.2 kHz · Standard filter");
      assert.match(sp.steps[2].detail, /^FLAC 24\/88\.2 kHz, to Living Room WiiM$/);
      assert.deepEqual(sp.steps.map(x => x.quality), ["lossless", "enhanced", "enhanced", "lossless"]);
      const d = await api("audio-devices/" + WIIM);
      assert.equal(d.rates.find(x => x.hz === 88200).source, "verified");
      assert.ok(d.caps.verified.rates["88200"]);
      // Max on this device is 176.4 for a 44.1 file.
      await api("audio-devices/" + WIIM, { output: { mode: "max" } }, "PATCH");
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f2 = await until(() => { const l = wiim.fetches.filter(x => x.done && x.body && x.body.length > 1000); const last = l[l.length - 1]; return last && /176400-24/.test(last.uri) && last; }, 15000);
      assert.deepEqual(probe(f2.body), { rate: 176400, channels: 2, bits: 24 });
      // A highest rate of its owner's (item 240): Max held to 96 kHz's family, 88.2 for a CD; a cap there isn't, refused.
      r = await api("audio-devices/" + WIIM, { output: { max_rate: 96000 } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.output.max_rate, 96000);
      assert.equal((await api("audio-devices/" + WIIM, { output: { max_rate: 100000 } }, "PATCH")).status, 400);
      const before = wiim.fetches.length;
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f3 = await until(() => wiim.fetches.slice(before).find(x => x.done && x.body && x.body.length > 1000), 15000);
      assert.match(f3.uri, /\/stream\/t\d+\.88200-24\.flac\?s=/);
      assert.deepEqual(probe(f3.body), { rate: 88200, channels: 2, bits: 24 });
      r = await api("audio-devices/" + WIIM, { output: { max_rate: "auto", mode: "original" } }, "PATCH");
      assert.equal(r.output.max_rate, undefined);
      // Whole track, played from a queue (items 237, 244): the album's tracks made ahead upsampled whole, kept as their
      // own files. Planned for the queue, every one of them failed ("the factor must be a power of two") on 3 November.
      r = await api("audio-devices/" + WIIM, { output: { mode: "x2", filter: "whole" } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      const said = ctx.logs.length;
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const made = path.join(lib.data, "transcode");
      // All three of its tracks, the ones the WiiM hasn't asked for yet too: those only the queue makes ahead.
      await until(() => fs.existsSync(made) && fs.readdirSync(made).filter(f => /-w\.flac$/.test(f)).length >= 3, 60000);
      // Each made once, none failed on the way.
      assert.deepEqual(ctx.logs.slice(said).filter(l => /\[upsample\] .*couldn't/.test(l)), []);
      // Minimum phase (item 248): made the same way into files of its own, the address saying the shape it is made in.
      r = await api("audio-devices/" + WIIM, { output: { filter: "minphase" } }, "PATCH");
      assert.equal(r.output.filter, "minphase");
      const asked = wiim.fetches.length;
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f4 = await until(() => wiim.fetches.slice(asked).find(x => /\.88200-24w\.flac/.test(x.uri)), 15000);
      assert.match(f4.uri, /[?&]f=min(&|$)/);
      // Now playing says which: the minimum-phase filter, or the standard one while it is made.
      const np = await until(async () => { const z = await state(WIIM); return z && z.now_playing && z.now_playing.signal && z.now_playing; }, 15000);
      assert.match(np.signal.lines[1], /^(Minimum-phase filter|Standard filter · minimum phase (being made|next play))$/);
      await until(() => fs.readdirSync(made).filter(f => /-w-min\.flac$/.test(f)).length >= 3, 60000);
      assert.deepEqual(ctx.logs.slice(said).filter(l => /\[upsample\] .*couldn't/.test(l)), []);
      await api("audio-devices/" + WIIM, { output: { mode: "original", filter: "standard" } }, "PATCH");
    });

    await t.test("A device that misreads a length (an open-length WAV, item 245): Now playing keeps the track's own", async () => {
      // 419:57:09, as a FiiO SR11 said of a ×16 WAV on 3 November; the fixture's tracks are three seconds.
      wiim.reportedDuration = 1511829;
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const s = await until(async () => { const z = await state(WIIM); return z && z.now_playing && z.now_playing.seek_position >= 1 && z; }, 15000);
      wiim.reportedDuration = null;
      await api("control", { zone_or_output_id: WIIM, command: "stop" });
      assert.ok(s.now_playing.length > 0 && s.now_playing.length < 10, "the track's own length, not the device's: " + s.now_playing.length);
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
      // A room correction made at 48 kHz (items 252, 258): the CD's runs through it resampled, and its signal path says so.
      const ir = Buffer.alloc(44 + 480 * 4);
      ir.write("RIFF", 0); ir.writeUInt32LE(36 + 480 * 4, 4); ir.write("WAVEfmt ", 8); ir.writeUInt32LE(16, 16); ir.writeUInt16LE(3, 20); ir.writeUInt16LE(1, 22);
      ir.writeUInt32LE(48000, 24); ir.writeUInt32LE(48000 * 4, 28); ir.writeUInt16LE(4, 32); ir.writeUInt16LE(32, 34); ir.write("data", 36); ir.writeUInt32LE(480 * 4, 40); ir.writeFloatLE(1, 44);
      const irUrl = B + "/api/audio-devices/" + WIIM + "/impulse";
      assert.equal((await fetch(irUrl + "?name=room48.wav", { method: "POST", headers: auth, body: ir })).status, 200);
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      const f = await until(() => { const l = wiim.fetches.filter(x => x.done && x.body && x.body.length > 1000); const last = l[l.length - 1]; return last && /44100-24\.flac\?o=/.test(last.uri) && last; }, 15000);
      assert.match(f.uri, /\/stream\/t\d+\.44100-24\.flac\?o=UPNP_[^&]+&s=/);
      assert.deepEqual(probe(f.body), { rate: 44100, channels: 2, bits: 24 });
      const s = await until(async () => { const z = await state(WIIM); return z && z.now_playing && /DSP/.test(z.now_playing.format.text) && z; }, 15000);
      assert.match(s.now_playing.format.text, /^FLAC 24\/44\.1 · DSP/);
      const room = s.now_playing.signal.steps.find(x => x.kind === "convolution");
      assert.deepEqual(room && [room.title, room.detail, room.quality], ["Room correction", "room48.wav, made at 48 kHz, resampled to 44.1 kHz", "enhanced"]);
      assert.equal((await fetch(irUrl, { method: "DELETE", headers: auth })).status, 200);
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

    await t.test("PCM as DSD (item 243): the library's PCM made DSD64 ahead and sent as a DSF; a track not yet made, as PCM", async () => {
      let r = await api("audio-devices/" + DAC, { enabled: true }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.deepEqual(r.dsd.filter(d => d.on).map(d => d.n), [64], "a device of no profile of its own: DSD64");
      r = await api("audio-devices/" + DAC, { output: { dsd_out: 64 } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.output.dsd_out, 64);
      assert.equal((await api("audio-devices/" + DAC, { output: { dsd_out: 32 } }, "PATCH")).status, 400);
      await until(async () => (await api("zones")).zones.some(z => z.zone_id === DAC), 20000);
      const said = ctx.logs.length;
      await api("play", { offset: long.offset, zone_or_output_id: DAC, kind: "play_now" });
      // Long 1, not made yet: as PCM (the file as it is), Now playing saying its DSF is on the way.
      const first = await until(() => dac.fetches.find(x => x.done && x.body && x.body.length > 1000 && x), 15000);
      assert.match(first.uri, /\.orig\.flac/, first.uri);
      const pcm = await until(async () => { const z = await state(DAC); return z && z.now_playing && / · DSD64 (being made|next play)$/.test(z.now_playing.format.text) && z; }, 15000);
      // Its signal path (item 247): the file as it is, its DSF still to come.
      assert.deepEqual(pcm.now_playing.signal.lines.slice(0, 1), ["FLAC 16/44.1 kHz · bit-perfect"]);
      assert.match(pcm.now_playing.signal.lines[pcm.now_playing.signal.lines.length - 1], /^DSD64 (being made|next play)$/);
      assert.deepEqual(pcm.now_playing.signal.steps.map(x => x.kind), ["source", "output", "pending"]);
      // Long 2, made meanwhile: armed next as its DSF.
      await until(() => /\.d64\.dsf/.test(dac.nextUri), 40000);
      // Skipped to: started as the DSF, DSD64 in the device's own word for it.
      const from = dac.fetches.length;
      await api("control", { zone_or_output_id: DAC, command: "next" });
      const f = await until(() => dac.fetches.slice(from).find(x => x.done && /\.d64\.dsf/.test(x.uri) && x), 15000);
      assert.equal(f.status, 200);
      assert.equal(f.type, "audio/x-dsf");
      assert.equal(f.body.toString("ascii", 0, 4), "DSD ");
      assert.equal(f.body.readUInt32LE(56), 2822400, "DSD64");
      const dz = await until(async () => { const z = await state(DAC); return z && z.now_playing && z.now_playing.format && z.now_playing.format.text === "DSD64 from PCM" && z; }, 15000);
      // Its signal path (item 247): ×16 whole to 705.6 kHz, the modulator, the DSF.
      assert.deepEqual(dz.now_playing.signal.lines, ["DSD64 · 2.8224 MHz", "From PCM · whole track ×16 · 7th-order modulator"]);
      assert.deepEqual(dz.now_playing.signal.steps.map(x => x.kind), ["source", "upsample", "modulator", "output"]);
      assert.deepEqual(ctx.logs.slice(said).filter(l => /\[upsample\] .*couldn't/.test(l)), []);
      // Long 1 went as PCM: its DSF, asked for before Long 1 started, was put after the tracks still to come (item 246)
      // and made after them, for its next play (item 254: it was dropped, and Now playing's "next play" never so).
      await until(() => ctx.logs.slice(said).some(l => /Long 1\.flac: DSD64 from PCM/.test(l)), 60000);
      const madeOrder = ctx.logs.slice(said).filter(l => /Long \d\.flac: DSD64 from PCM/.test(l)).map(l => l.match(/Long (\d)/)[1]);
      assert.equal(madeOrder[madeOrder.length - 1], "1", madeOrder.join(","));
      assert.equal(madeOrder.filter(n => n === "1").length, 1, madeOrder.join(","));
      assert.ok(madeOrder.indexOf("2") < madeOrder.indexOf("1"), madeOrder.join(","));
      // Another album played at once: what was to be made for the one before no longer is (item 246); the Lorde album
      // went on being made upsampled whole long after other albums were played on 3 November.
      const before = ctx.logs.length;
      await api("play", { offset: cd.offset, zone_or_output_id: DAC, kind: "play_now" });
      await api("play", { offset: long.offset, zone_or_output_id: DAC, kind: "play_now" });
      await until(() => ctx.logs.slice(before).some(l => /track\(s\) no longer made: another play/.test(l)), 15000);
      await until(async () => { const o = (await api("audio-devices/" + DAC)).output; return o.whole && !o.whole.making && o.whole.waiting === 0; }, 40000);
      assert.deepEqual(ctx.logs.slice(before).filter(l => /Song \d\.flac: DSD64 from PCM/.test(l)), []);
      await api("control", { zone_or_output_id: DAC, command: "stop" });
      await api("audio-devices/" + DAC, { output: { dsd_out: "off" }, enabled: false }, "PATCH");
    });

    await t.test("PCM standing in for a DSF says why it has the standard filter, the device set to minimum phase (item 254)", async () => {
      // A FiiO SR11 at Max, Min phase and DSD256 on 3 November: "Standard filter" under a filter set to minimum phase.
      let r = await api("audio-devices/" + DAC, { enabled: true, caps: { user: { rates: [44100, 48000, 88200, 96000] } }, output: { mode: "x2", filter: "minphase", dsd_out: 64 } }, "PATCH");
      assert.equal(r.status, 200, JSON.stringify(r));
      await until(async () => (await api("zones")).zones.some(z => z.zone_id === DAC), 20000);
      // The short album (three tracks of 3 s): its makings in minimum phase take seconds, where the long one's took a
      // minute of this test's budget on a busy machine. Whichever plays first goes as PCM while its DSF is made.
      await api("play", { offset: cd.offset, zone_or_output_id: DAC, kind: "play_now" });
      const z = await until(async () => { const s = await state(DAC); return s && s.now_playing && s.now_playing.signal && /^Song \d$/.test(s.now_playing.line1) && / · DSD64 /.test(s.now_playing.format.text) && s; }, 20000);
      const sp = z.now_playing.signal;
      assert.equal(sp.lines[1], "Standard filter · until the DSD64 (minimum phase) is made", JSON.stringify(sp.lines));
      assert.equal(sp.steps.find(x => x.kind === "upsample").detail, "×2 to 88.2 kHz · Standard filter (until the DSD64 (minimum phase) is made)");
      // Its own DSF, put after the tracks to come: waiting its turn, or being made (never "next play: next play").
      assert.match(sp.steps.find(x => x.kind === "pending").detail, /^DSD64 (for this track’s next play: (waiting its turn|being made now)|made: this track plays as DSD next time)$/);
      await api("control", { zone_or_output_id: DAC, command: "stop" });
      // Its makings ended before the next test.
      await until(async () => { const o = (await api("audio-devices/" + DAC)).output; return o.whole && !o.whole.making && o.whole.waiting === 0; }, 60000);
      await api("audio-devices/" + DAC, { caps: { user: { rates: null } }, output: { mode: "original", filter: "standard", dsd_out: "off" }, enabled: false }, "PATCH");
    });

    await t.test("a renderer still PLAYING at the end of a track, with nothing to go on to, is started on the next by hand (item 246)", async () => {
      // A FiiO SR11 at the end of a WAV whose length is left open waits there for more: nothing armed, it stood still.
      poly.hangAtEnd = true;
      const said = ctx.logs.length;
      const from = poly.fetches.length;
      await api("play", { offset: cd.offset, zone_or_output_id: POLY, kind: "play_now" });
      const f = await until(() => poly.fetches.slice(from).find(x => /\/stream\/t\d+\./.test(x.uri) && x !== poly.fetches[from] && x), 30000);
      assert.notEqual(f.uri.replace(/\?.*/, ""), poly.fetches[from].uri.replace(/\?.*/, ""), "the next track, not the first again");
      assert.ok(poly.log.includes("hung"), "it hung at the end of the first");
      assert.ok(ctx.logs.slice(said).some(l => /Poly: still playing at the end of track 1 .* track 2 started by hand/.test(l)), ctx.logs.slice(said).join("\n"));
      poly.hangAtEnd = false;
      await api("control", { zone_or_output_id: POLY, command: "stop" });
    });

    await t.test("the server restarted (an update): the renderer's queue is kept and the playing track recognised", async () => {
      await api("play", { offset: cd.offset, zone_or_output_id: WIIM, kind: "play_now" });
      await until(async () => { const z = await state(WIIM); return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Song 1"; });
      // Song 1 plays on through the restart however long it takes: the track
      // is 3 seconds long, and a restart on a busy machine can take longer.
      wiim.hold();
      // The store writes after a moment: what it kept, before the server goes.
      await until(() => { const r = ctx.db.raw.prepare("SELECT value FROM settings WHERE key = ?").get("queue:" + WIIM); const k = r && JSON.parse(r.value); return k && k.state === "playing" && k.index === 0 && k.ids.length === 3; });
      const sets = wiim.log.filter(a => a === "SetAVTransportURI").length;
      await srv.stop();
      srv = createServer(options);
      ctx = await srv.start();
      await until(async () => (await api("status")).status === 200);
      // The device played on through the restart; the server finds it in the queue it kept.
      const s = await until(async () => { const z = await state(WIIM); return z && z.state === "playing" && z.now_playing && z.now_playing.line1 === "Song 1" && z; }, 20000);
      assert.equal(s.now_playing.line3, "Album One");
      assert.deepEqual((await api("queue?zone=" + WIIM)).items.map(i => i.title), ["Song 1", "Song 2", "Song 3"]);
      assert.equal(wiim.log.filter(a => a === "SetAVTransportURI").length, sets, "not started again: the same track carries on");
      // And it still moves on to the next.
      wiim.release();
      await until(() => wiim.nextUri, 10000);
    });
  } finally {
    await srv.stop();
    await house.stop();
    await wiim.stop(); await poly.stop(); await dac.stop();
  }
});
