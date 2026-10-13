"use strict";
/*
 * Settings → Audio Devices, the writes made by the C# server (v0.8.48, stage 5
 * part 1 of docs/specs/csharp-migration.md; DeviceRoutes.cs): a device's name,
 * hidden, sharing, output, DSP, levelling and the rates you tick, each written
 * to audio_devices as the Node server writes it and each refusal in its words;
 * the Node server told, so its own effects follow (a name in /api/zones, a
 * renderer's queue planned again, a phone told, a device hidden while on
 * switched off and let go), and the device answered as its page shows it.
 * Switching a player on or off and the radio stay the Node server's (passed
 * on), as does what it alone can read (bad JSON).
 *
 * Once the C# server holds playback (v0.8.49, stage 6; Playback/Hub.cs) its
 * own hub does what each write did, never the Node server's players; the
 * switch and the radio are written there too, each held to the Node server's
 * own; and a renderer hidden while playing is stopped and let go.
 *
 * Each write is made twice from the same row — through the C# server, then by
 * the Node server itself — and the two rows and answers compared.
 *
 * Since v0.8.50 (stage 7) the Node server's side is a recording: made with
 * RECORD_DEVICES=1 through the C# server with the Node server behind it
 * (MANDARIN_FRONT=1, while index.js was still there), each write's answer, row
 * and whether the zones were bumped kept in test/golden/devices-node.json;
 * every run since starts the program alone and holds it to the recording.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { idFor } = require("../lib/renderers/discovery");
const { FakeRenderer } = require("./fake-renderer");
const { FakeHousehold } = require("./fake-sonos");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const fs = require("fs");
const path = require("path");
const { built } = require("./server");

const RECORD = process.env.RECORD_DEVICES === "1";
const GOLDEN = path.join(__dirname, "golden", "devices-node.json");
const skip = (RECORD ? process.env.MANDARIN_FRONT !== "1" && "recording goes through the C# server with the Node server behind it (MANDARIN_FRONT=1)"
  : built() || (!fs.existsSync(GOLDEN) && "no recording of the Node server's answers (RECORD_DEVICES=1 makes one)")) || (!haveFfmpeg() && "ffmpeg is not installed");
/* This file's loopback addresses (test/ports.js), which the household's rooms are on: another in a full run than alone. */
const HOSTS = Array.from({ length: ports.HOSTS }, (_, i) => [new RegExp(ports.host(i).replace(/\./g, "\\.") + "(?![0-9])", "g"), "<host " + i + ">"]);
/* What changes from one run to the next, or with the machine's ffmpeg, made the same. */
const steady = (v) => v === undefined ? v : JSON.parse(JSON.stringify(v, (k, val) => {
  if (typeof val === "string") return HOSTS.reduce((s, [re, to]) => s.replace(re, to), val).replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>").replace(/"(first_seen|last_seen)":\d+/g, '"$1":"<time>"');
  if (k === "first_seen" || k === "last_seen") return "<time>";
  if (k === "flac32") return "<ffmpeg>";
  return val;
}));
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 100));
  }
}

test("Audio Devices' writes through the C# server: each held to the Node server's own, each refusal word for word, the Node server's effects seen", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ udn: "uuid:wiim-pro-plus-0000-test", name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", modelNumber: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM", firmware: "4.8.700000" } });
  const poly = new FakeRenderer({ udn: "uuid:chord-poly-0000-test", name: "Poly", manufacturer: "Chord Electronics Ltd", model: "Poly", sink: "http-get:*:audio/flac:*,http-get:*:audio/wav:*,http-get:*:audio/x-dsf:*" });
  await wiim.start(); await poly.start();
  const { createServer } = RECORD ? require("../index.js") : require("./server");
  /* The Node server's side of each write: made now (recording), or as it was made when recorded, in the same order. */
  const golden = { list: RECORD ? [] : JSON.parse(fs.readFileSync(GOLDEN, "utf8")), at: 0 };
  const peek = (label) => {
    const g = golden.list[golden.at];
    assert.ok(g, "the recording ends before " + label);
    assert.equal(g.label, label, "the recording in step");
    return g.v;
  };
  const kept = (label, v) => { if (RECORD) golden.list.push({ label, v }); else golden.at++; };
  const srv = createServer({
    port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [wiim.location, poly.location], upnpMulticast: false, identify: false
  });
  const ctx = await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); await wiim.stop(); await poly.stop(); });
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const NODE = RECORD ? "http://127.0.0.1:" + ctx.listeningOn : null;
  const raw = ctx.db.raw;
  const call = async (base, method, p, body, headers) => {
    const r = await fetch(base + p, { method, headers: headers || (body !== undefined ? H : { Authorization: H.Authorization }), body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j, text };
  };
  const patch = (id, body) => call(B, "PATCH", "/api/audio-devices/" + id, body);
  // Stage 6: the C# server holds playback, so the switch, the radio and the device list are its too.
  const front = true;
  const theirs = "C#";

  // A phone in the register, as the app's hello puts it (the app itself isn't here): the row the Node server's register writes.
  if (RECORD) {
    ctx.devices.registry.seen({ id: "PHONE_test", kind: "phone", network_name: "Test phone", model: "Phone" });
    kept("the phone's row", raw.prepare("SELECT * FROM audio_devices WHERE id = 'PHONE_test'").get());
  } else {
    const r = peek("the phone's row");
    raw.prepare(`INSERT INTO audio_devices(${Object.keys(r).join(", ")}) VALUES(${Object.keys(r).map(() => "?").join(", ")})`).run(...Object.values(r));
    kept("the phone's row", r);
  }
  await until(async () => (await call(B, "GET", "/api/audio-devices")).j.devices.length >= 5);
  const W = idFor(wiim.udn), P = idFor(poly.udn), K = "RINCON_KITCHEN01400", PH = "PHONE_test";

  // The Node server's own effects, seen: what its players are asked to do.
  const effects = [];
  const bumps = { n: 0 };
  if (RECORD) {
    for (const [obj, name] of [[ctx.zones.upnp, "replan"], [ctx.zones.upnp, "drop"], [ctx.zones.phones, "dspChanged"], [ctx.zones.phones, "levellingChanged"], [ctx.zones, "replanSonos"]]) {
      const real = obj[name].bind(obj);
      obj[name] = (...a) => { effects.push(name + ":" + a[0]); return real(...a); };
    }
    const real = ctx.zones.bump.bind(ctx.zones); ctx.zones.bump = (...a) => { bumps.n++; return real(...a); };
  }
  // What the Node server's own players were asked to do, where it made the write itself (recording only).
  const effected = (what) => { if (RECORD) assert.ok(effects.includes(what), what + ": " + effects.join(" ")); };
  // The C# hub's change counter: its zones bumped is the counter moved.
  const revision = async () => (await call(B, "GET", "/api/zone-state?zone=none")).j.revision;

  const row = (id) => raw.prepare("SELECT name, caps, settings FROM audio_devices WHERE id = ?").get(id) || null;
  const putBack = (id, r) => { raw.prepare("UPDATE audio_devices SET name = ?, caps = ?, settings = ? WHERE id = ?").run(r.name, r.caps, r.settings, id); if (RECORD) ctx.devices.registry.refreshName(id); };
  // What is live on the page and may move between two calls.
  const VOLATILE = ["online", "state", "last_seen", "events", "last_error"];
  const strip = (j) => { if (!j || typeof j !== "object") return j; const o = Object.assign({}, j); for (const k of VOLATILE) delete o[k]; return o; };
  /*
   * The same PATCH of each, from the same row: answered by the C# server, the
   * row it wrote and its answer the Node server's own, word for word. The
   * Node server's write is what stays.
   */
  const same = async (id, body, what) => {
    const before = row(id);
    const n0 = effects.length, r0 = await revision();
    const c = await patch(id, body);
    const rowC = row(id);
    const effC = effects.slice(n0);
    let bumpC = (await revision()) - r0;
    let want;
    if (RECORD) {
      if (before) putBack(id, before);
      const b1 = bumps.n;
      const n = await call(NODE, "PATCH", "/api/audio-devices/" + id, body);
      assert.equal(n.by, null, what + ": the Node server's own");
      want = { status: n.status, j: steady(strip(n.j)), row: steady(row(id)), bumped: bumps.n - b1 > 0 };
    } else want = peek(what);
    // The C# hub's counter moves for its own reasons too (a discovery round that found the renderers): a bump where the Node server made none is measured once more, from the same row.
    if (!want.bumped && bumpC > 0 && before) {
      const now = row(id);
      putBack(id, before);
      const r1 = await revision();
      await patch(id, body);
      bumpC = (await revision()) - r1;
      putBack(id, now);
    }
    assert.equal(c.by, "C#", what + ": answered by the C# server");
    assert.equal(c.status, want.status, what + ": " + c.text + " against " + JSON.stringify(want.j));
    assert.deepEqual(steady(strip(c.j)), want.j, what + ": the answer");
    assert.deepEqual(steady(rowC), want.row, what + ": the row");
    // Stage 6: the C# hub's own players, never the Node server's.
    assert.deepEqual(effC, [], what + ": the Node server's players asked nothing");
    assert.equal(bumpC > 0, want.bumped, what + ": the zones bumped");
    kept(what, want);
    return c;
  };

  await t.test("a name of your own, cleaned; back to the network name; never a phone's; text only", async () => {
    let r = await same(W, { name: " Kitchen \u0007streamer " }, "renamed");
    assert.equal(r.j.name, "Kitchen streamer");
    assert.equal(r.j.renamed, true);
    assert.equal(JSON.parse(JSON.stringify(row(W))).name, "Kitchen streamer");
    r = await same(W, { name: "" }, "the network name again");
    assert.equal(r.j.name, "Living Room WiiM");
    assert.equal(row(W).name, null);
    r = await same(PH, { name: "Mine" }, "a phone");
    assert.deepEqual([r.status, r.j], [400, { error: "A phone is named in the app on the phone" }]);
    r = await same(W, { name: 5 }, "not text");
    assert.deepEqual([r.status, r.j], [400, { error: "name must be text" }]);
    r = await same(W, { name: "x".repeat(80) }, "sixty at most");
    assert.equal(r.j.name, "x".repeat(60));
    await same(W, { name: "" }, "cleared");
    // A renamed Sonos room is renamed everywhere the page looks: the Node server's name overlay read again.
    r = await same(K, { name: "Cook’s corner" }, "a room renamed");
    assert.equal(r.j.name, "Cook’s corner");
    const z = (await call(B, "GET", "/api/zones")).j.zones.find(z => z.zone_id === K);
    assert.equal(z.display_name, "Cook’s corner", "in the zone picker");
    assert.equal(house.room("Kitchen").name, "Kitchen", "the speaker itself is never renamed");
    r = await same("UPNP_nothing", { name: "x" }, "no such device");
    assert.deepEqual([r.status, r.j], [404, { error: "No such device" }]);
  });

  await t.test("hidden: switched off with it when it can be, the server stopping it and letting it go; shown again, still off", async () => {
    // Switched on first (the Node server's until stage 6: passed on whole).
    let r = await patch(W, { enabled: true });
    assert.equal(r.by, theirs, "the switch");
    assert.equal(r.j.enabled, true);
    if (front) {
      // Playing when hidden: the C# hub stops it and lets it go.
      await until(async () => (await call(B, "GET", "/api/zones")).j.zones.some(z => z.zone_id === W));
      const albumOne = async () => ((await call(B, "GET", "/api/library/albums?sort=album")).j.albums || []).find(a => a.title === "Album One");
      await until(albumOne);
      const cd = await albumOne();
      assert.equal((await call(B, "POST", "/api/play", { offset: cd.offset, zone_or_output_id: W, kind: "play_now" })).status, 200);
      await until(async () => wiim.state === "PLAYING");
      wiim.log.length = 0;
    }
    r = await same(W, { hidden: true }, "hidden while on");
    assert.deepEqual([r.j.hidden, r.j.enabled], [true, false]);
    assert.deepEqual(JSON.parse(row(W).settings), { enabled: false, hidden: true });
    assert.ok(wiim.log.includes("Stop"), "stopped: " + wiim.log.join(" "));
    assert.ok(!(await call(B, "GET", "/api/zones")).j.zones.some(z => z.zone_id === W), "let go");
    r = await same(W, { hidden: false }, "shown again");
    assert.deepEqual([r.j.hidden, r.j.enabled], [false, false]);
    // A room can be hidden too; the phone just leaves the list.
    r = await same(K, { hidden: true }, "a room hidden");
    assert.equal(r.j.hidden, true);
    await same(K, { hidden: false }, "and back");
    await patch(K, { enabled: true });
    r = await same(PH, { hidden: true }, "a phone hidden");
    assert.deepEqual([r.j.hidden, r.j.enabled], [true, true]);
    await same(PH, { hidden: false }, "and back");
  });

  await t.test("shared: a phone's switch alone", async () => {
    let r = await same(PH, { shared: false }, "not shared");
    assert.equal(r.j.shared, false);
    assert.deepEqual(JSON.parse(row(PH).settings), { hidden: false, shared: false });
    r = await same(PH, { shared: 1 }, "shared again");
    assert.equal(r.j.shared, true);
    r = await same(W, { shared: true }, "a renderer");
    assert.deepEqual([r.status, r.j], [400, { error: "Only a phone has this switch" }]);
  });

  await t.test("output: mode, bits and volume for a renderer, each checked", async () => {
    let r = await same(W, { output: { mode: "x2", bits: 24, volume: "fixed" } }, "set");
    assert.deepEqual(r.j.output, { mode: "x2", bits: 24, flac32: r.j.output.flac32 });
    assert.deepEqual(JSON.parse(row(W).settings), { enabled: false, hidden: false, mode: "x2", bits: 24, volume: "fixed" });
    r = await same(W, { output: { bits: "auto" } }, "auto: the depth let go");
    assert.deepEqual(JSON.parse(row(W).settings), { enabled: false, hidden: false, mode: "x2", volume: "fixed" });
    assert.equal(r.j.output.bits, "auto");
    r = await same(W, { output: { mode: "x9" } }, "a mode there isn't");
    assert.deepEqual([r.status, r.j], [400, { error: "mode must be original, x2, x4 or max" }]);
    r = await same(W, { output: { bits: 20 } }, "a depth there isn't");
    assert.deepEqual([r.status, r.j], [400, { error: "bits must be auto, 24 or 32" }]);
    r = await same(W, { output: { volume: "loud" } }, "a volume there isn't");
    assert.deepEqual([r.status, r.j], [400, { error: "volume must be fixed or upnp" }]);
    r = await same(K, { output: { mode: "x2" } }, "a room");
    assert.deepEqual([r.status, r.j], [400, { error: "Only a renderer or a sound device on this computer has output settings" }]);
    r = await same(W, { output: "x2" }, "not an object: nothing written");
    assert.equal(r.status, 200);
    r = await same(W, { output: ["x2"] }, "a list: nothing in it to write");
    assert.equal(r.status, 200);
    await same(W, { output: { mode: "original", volume: "upnp" } }, "back");
  });

  await t.test("DSP: checked and rounded as the page's biquad.js keeps it; a renderer's queue planned again, a phone told; never a room", async () => {
    let r = await same(W, { dsp: { enabled: "yes", peq: { bands: [{ type: "peak", freq: "1000.04", gain: 2.26, q: "1.4142" }, { type: "low_pass", freq: 120, gain: 5 }] }, headroom: -3.04 } }, "set");
    assert.deepEqual(r.j.dsp, { enabled: true, headphone: null, peq: { bands: [{ type: "peak", freq: 1000, gain: 2.3, q: 1.414 }, { type: "low_pass", freq: 120, gain: 0, q: 0.707 }] }, headroom: -3 });
    assert.equal(r.j.dsp_info.active, true);
    effected("replan:" + W);
    r = await same(W, { dsp: { headroom: null } }, "auto again, the rest kept");
    assert.equal(r.j.dsp.headroom, "auto");
    assert.equal(r.j.dsp.peq.bands.length, 2);
    r = await same(W, { dsp: { headphone: { name: "Cans", source: "autoeq", id: "x", preamp: -4.26, bands: [{ type: "high_shelf", freq: 8000, gain: -2, q: 0.7 }] } } }, "a headphone profile");
    assert.deepEqual(r.j.dsp.headphone, { source: "autoeq", id: "x", name: "Cans", preamp: -4.3, bands: [{ type: "high_shelf", freq: 8000, gain: -2, q: 0.7 }] });
    r = await same(PH, { dsp: { enabled: true, peq: { bands: [{ type: "peak", freq: 100, gain: 1 }] } } }, "a phone's");
    assert.equal(r.j.dsp.enabled, true);
    effected("dspChanged:" + PH);
    for (const [body, error] of [
      [{ dsp: { peq: { bands: [{ type: "notch", freq: 100 }] } } }, "band type must be one of peak, low_shelf, high_shelf, low_pass, high_pass"],
      [{ dsp: { peq: { bands: [{ type: "peak", freq: 5, gain: 0 }] } } }, "band frequency must be 10–24000 Hz"],
      [{ dsp: { peq: { bands: [{ type: "peak", freq: 100, gain: 30 }] } } }, "band gain must be −20–20 dB"],
      [{ dsp: { peq: { bands: [{ type: "peak", freq: 100, gain: 0, q: 50 }] } } }, "band Q must be 0.1–20"],
      [{ dsp: { peq: { bands: ["x"] } } }, "a band must be an object"],
      [{ dsp: { headroom: 3 } }, "headroom must be 0 to −30 dB"],
      [{ dsp: { peq: { bands: new Array(11).fill({ type: "peak", freq: 100, gain: 0 }) } } }, "the PEQ has at most 10 bands"],
      [{ dsp: { headphone: { bands: new Array(11).fill({ type: "peak", freq: 100, gain: 0 }) } } }, "a headphone profile has at most 10 bands"],
      [{ dsp: 5 }, "dsp must be an object"],
      [{ dsp: [1] }, "dsp must be an object"],
      [{ dsp: null }, "dsp must be an object"]
    ]) {
      r = await same(W, body, error);
      assert.deepEqual([r.status, r.j], [400, { error }], JSON.stringify(body));
    }
    r = await same(K, { dsp: { enabled: true } }, "a room");
    assert.deepEqual([r.status, r.j], [400, { error: "Sonos rooms are tuned with Trueplay in the Sonos app" }]);
  });

  await t.test("Volume Levelling: every kind has it; a room's queue planned again, a phone told; each refusal", async () => {
    let r = await same(K, { levelling: { mode: "album", target: -20, unknown: -6 } }, "a room's");
    assert.deepEqual(r.j.levelling, { mode: "album", target: -20, unknown: -6 });
    effected("replanSonos:" + K);
    r = await same(K, { levelling: { target: "-18" } }, "one part, as text");
    assert.deepEqual(r.j.levelling, { mode: "album", target: -18, unknown: -6 });
    r = await same(W, { levelling: { mode: "track" } }, "a renderer's");
    assert.deepEqual(r.j.levelling, { mode: "track", target: -14, unknown: -5 });
    r = await same(PH, { levelling: { mode: "auto" } }, "a phone's");
    assert.equal(r.j.levelling.mode, "auto");
    effected("levellingChanged:" + PH);
    for (const [body, error] of [
      [{ levelling: { mode: "loud" } }, "mode is off, track, album or auto"],
      [{ levelling: { target: -30 } }, "target is a whole number of LUFS from -14 to -25"],
      [{ levelling: { target: -20.5 } }, "target is a whole number of LUFS from -14 to -25"],
      [{ levelling: { unknown: 1 } }, "unknown is a whole number of dB from 0 to -12"],
      [{ levelling: [] }, "levelling must be an object"],
      [{ levelling: "off" }, "levelling must be an object"]
    ]) {
      r = await same(K, body, error);
      assert.deepEqual([r.status, r.j], [400, { error }], JSON.stringify(body));
    }
    await same(K, { levelling: { mode: "off" } }, "off again");
  });

  await t.test("the rates, depths and DSD you tick: a renderer's to set, in the profile's order; cleared with null", async () => {
    let r = await same(W, { caps: { user: { rates: [96000, "48000", 44100], bits: [24] } } }, "ticked");
    assert.deepEqual(r.j.rates.filter(x => x.on).map(x => x.hz), [44100, 48000, 96000]);
    assert.equal(r.j.rates.find(x => x.hz === 96000).source, "user");
    assert.deepEqual(JSON.parse(row(W).caps).user, { rates: [44100, 48000, 96000], bits: [24] });
    r = await same(P, { caps: { user: { dsd: [128, 64] } } }, "DSD");
    assert.deepEqual(JSON.parse(row(P).caps).user, { dsd: [64, 128] });
    r = await same(W, { caps: { user: { bits: null, dsd: [] } } }, "a layer let go, another empty");
    assert.deepEqual(JSON.parse(row(W).caps).user, { rates: [44100, 48000, 96000], dsd: [] });
    r = await same(W, { caps: { user: null } }, "all yours let go");
    assert.equal(JSON.parse(row(W).caps).user, undefined);
    assert.equal(r.j.rates.find(x => x.hz === 192000).source, "profile");
    for (const [body, error] of [
      [{ caps: { user: { rates: [12345] } } }, "caps.user.rates lists something unknown"],
      [{ caps: { user: { bits: 24 } } }, "caps.user.bits lists something unknown"],
      [{ caps: { user: { dsd: ["x"] } } }, "caps.user.dsd lists something unknown"],
      [{ caps: { user: 5 } }, "caps.user must be an object or null"],
      [{ caps: { user: [44100] } }, "caps.user must be an object or null"]
    ]) {
      r = await same(W, body, error);
      assert.deepEqual([r.status, r.j], [400, { error }], JSON.stringify(body));
    }
    r = await same(K, { caps: { user: { rates: [44100] } } }, "a room");
    assert.deepEqual([r.status, r.j], [400, { error: "What a Sonos room or a phone plays is fixed" }]);
    r = await same(PH, { caps: { user: { rates: [44100] } } }, "a phone");
    assert.deepEqual([r.status, r.j], [400, { error: "What a Sonos room or a phone plays is fixed" }]);
    r = await same(W, { caps: "x" }, "caps that isn't an object: nothing written");
    assert.equal(r.status, 200);
  });

  await t.test("several at once, in the route's order; a write made before a refusal stays, and the Node server knows of it", async () => {
    let r = await same(K, { name: "Hall", shared: true }, "a name, then a refusal");
    assert.deepEqual([r.status, r.j], [400, { error: "Only a phone has this switch" }]);
    assert.equal(row(K).name, "Hall", "the name stays");
    assert.equal((await call(B, "GET", "/api/zones")).j.zones.find(z => z.zone_id === K).display_name, "Hall", "and is the room's everywhere");
    r = await same(W, { name: "Both", output: { mode: "x4" }, levelling: { mode: "track" }, caps: { user: { bits: [16, 24] } } }, "four writes");
    assert.deepEqual([r.j.name, r.j.output.mode, r.j.levelling.mode, r.j.bits.filter(b => b.on).map(b => b.n)], ["Both", "x4", "track", [16, 24]]);
    await same(W, { name: "", output: { mode: "original" }, levelling: { mode: "off" }, caps: { user: null } }, "back");
    await same(K, { name: "" }, "back");
    r = await same(W, {}, "nothing to write: the device as it is");
    assert.equal(r.status, 200);
    assert.equal(r.j.id, W);
  });

  await t.test("the switch and the radio: the Node server's until stage 6, then held to its own; a bad body, the list and a device's page", async () => {
    let r = await (front ? same(K, { radio: true }, "the radio on") : patch(K, { radio: true }));
    assert.equal(r.by, theirs, "the radio");
    assert.equal(r.j.radio, true);
    assert.deepEqual(ctx.db.setting("radioZones", []), [K], "per zone");
    r = await (front ? same(K, { radio: false }, "the radio off") : patch(K, { radio: false }));
    assert.equal(r.j.radio, false);
    r = await (front ? same(W, { name: "x", enabled: false }, "a name and the switch") : patch(W, { name: "x", enabled: false }));
    assert.equal(r.by, theirs, "with enabled, the whole PATCH");
    assert.deepEqual([r.j.name, r.j.enabled], ["x", false]);
    await patch(W, { name: "" });
    if (front) {
      r = await same(W, { enabled: true }, "switched on");
      assert.deepEqual([r.j.enabled, JSON.parse(row(W).settings).enabled], [true, true]);
      await until(async () => (await call(B, "GET", "/api/zones")).j.zones.some(z => z.zone_id === W), 5000);
      r = await same(W, { enabled: 0 }, "switched off");
      assert.equal(r.j.enabled, false);
      r = await same(PH, { enabled: false }, "a phone");
      assert.deepEqual([r.status, r.j], [400, { error: "A phone is always its own player" }]);
      r = await same(K, { enabled: false }, "a room switched off");
      assert.equal(r.j.enabled, false);
      assert.ok(!(await call(B, "GET", "/api/zones")).j.zones.some(z => z.zone_id === K), "leaves the picker");
      await same(K, { enabled: true }, "and back");
    }
    r = await call(B, "PATCH", "/api/audio-devices/" + W, "{not json", H);
    assert.equal(r.status, 400, "what can't be read is turned down: " + r.status + " " + r.by + " " + r.text);
    r = await call(B, "PATCH", "/api/audio-devices/" + W, "name=x", { Authorization: H.Authorization, "Content-Type": "text/plain" });
    assert.equal(r.by, "C#", "a body that isn't JSON is {}: nothing to write");
    assert.equal(r.status, 200);
    for (const p of ["/api/audio-devices", "/api/audio-devices/" + W]) assert.equal((await call(B, "GET", p)).by, theirs, p);
    assert.equal((await call(B, "POST", "/api/audio-devices/rescan", {})).by, theirs, "Look again");
    const none = await call(B, "PATCH", "/api/audio-devices/", { name: "x" });
    assert.equal(none.status, 404, "no id: not there");

    // The recording made, or every step of it compared.
    if (RECORD) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, JSON.stringify(golden.list, null, 1) + "\n");
    } else assert.equal(golden.at, golden.list.length, "every recorded step compared");
  });
});
