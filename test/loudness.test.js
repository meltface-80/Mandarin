"use strict";
/*
 * ReplayGain (lib/loudness.js, v0.6.0-RC5): the files' own gains kept and
 * used; Track, Album and Auto; the peak keeping a gain from clipping; the
 * stream carrying the gain; files without tags measured in the background —
 * in the schedule's hours, never while the library is scanned, album by
 * album, newest first, after identification, with options ffmpeg 5.1 knows
 * (v0.8.24).
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Loudness, parseEbur128, combine, FILTER } = require("../lib/loudness");
const STREAM = require("../lib/stream");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3619;
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 50));
  }
}

test("ebur128's summary read; tracks' loudness combined by length", () => {
  const out = `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.5 LUFS\n\n  True peak:\n    Peak:       -6.0 dBFS\n`;
  const r = parseEbur128(out);
  assert.equal(r.lufs, -14.2);
  assert.ok(Math.abs(r.peak - 0.501) < 0.001, String(r.peak));
  assert.deepEqual(parseEbur128("I: -inf LUFS\nPeak: -inf dBFS"), { lufs: null, peak: null });
  // Two equal halves: the same loudness; a quiet short track barely moves a long loud one.
  assert.ok(Math.abs(combine([{ lufs: -10, seconds: 100 }, { lufs: -10, seconds: 100 }]) + 10) < 1e-9);
  assert.ok(combine([{ lufs: -10, seconds: 300 }, { lufs: -30, seconds: 10 }]) > -10.2);
});

test("which gain, and the peak's cap", () => {
  const l = Object.create(Loudness.prototype);
  const info = { track_gain: -6, track_peak: 0.5, album_gain: -4, album_peak: 0.9 };
  assert.equal(l.gainOf(info, "track"), -6);
  assert.equal(l.gainOf(info, "album"), -4);
  assert.equal(l.gainOf({ track_gain: null, album_gain: -4, album_peak: 0.9 }, "track"), -4);      // the album's when the track has none
  assert.equal(l.gainOf({ track_gain: -6, track_peak: 0.5, album_gain: null }, "album"), -6);
  // +10 dB asked, but the peak at 0.5 leaves room for 6.0 only.
  assert.equal(l.gainOf({ track_gain: 10, track_peak: 0.5 }, "track"), 6);
  // A -14 LUFS target is 4 dB above ReplayGain's -18; -25 is 7 below.
  assert.equal(l.gainOf({ track_gain: -6, track_peak: 0.5 }, "track", 4), -2);
  assert.equal(l.gainOf({ track_gain: -6, track_peak: 0.5 }, "track", -7), -13);
  assert.equal(l.gainOf({ track_gain: null, album_gain: null }, "track"), null);
  // Loudness unknown: the fixed adjustment.
  assert.equal(l.gainOf({ track_gain: null, album_gain: null }, "track", 4, -5), -5);
  assert.equal(l.gainOf({ track_gain: 0.02 }, "track"), null);                                     // nothing to do
});

test("a device's Volume Levelling: checked, with its defaults", () => {
  const { levelling, levellingPatch } = require("../lib/loudness");
  assert.deepEqual(levelling(null), { mode: "off", target: -14, unknown: -5 });
  assert.deepEqual(levelling({ mode: "auto", target: -30, unknown: 3 }), { mode: "auto", target: -14, unknown: -5 });
  assert.deepEqual(levellingPatch(null, { mode: "album", target: -20 }), { mode: "album", target: -20, unknown: -5 });
  assert.throws(() => levellingPatch(null, { target: -13 }), e => e.status === 400);
  assert.throws(() => levellingPatch(null, { target: -26 }), e => e.status === 400);
  assert.throws(() => levellingPatch(null, { unknown: 2 }), e => e.status === 400);
  assert.throws(() => levellingPatch(null, { mode: "loud" }), e => e.status === 400);
});

test("the plan: a gain means a conversion, never on DSD sent as DSD", () => {
  const flac = { path: "/m/a.flac", codec: "FLAC", sampleRate: 44100, bitsPerSample: 16, channels: 2 };
  const p = STREAM.withGain(STREAM.plan(flac), flac, null, -6.04);
  assert.deepEqual([p.transcode, p.ext, p.rate, p.bits, p.gain], [true, "flac", 44100, 24, -6]);
  const hi = { path: "/m/a.flac", codec: "FLAC", sampleRate: 96000, bitsPerSample: 24, channels: 2 };
  const q = STREAM.withGain(STREAM.plan(hi), hi, null, -3);
  assert.deepEqual([q.rate, q.bits, q.gain], [48000, 24, -3]);
  assert.equal(STREAM.withGain(STREAM.plan(flac), flac, null, 0).transcode, false);
  const dsd = { transcode: false, dsd: 64, ext: "dsf" };
  assert.equal(STREAM.withGain(dsd, {}, {}, -6), dsd);
  // The gain is in the conversion and its cache name.
  assert.ok(STREAM.ffmpegArgs("/in", p, "/out").join(" ").includes("volume=volume=-6dB:precision=double,aresample"));
  const tc = new STREAM.Transcoder({ cacheDir: fs.mkdtempSync(path.join(require("os").tmpdir(), "rg-")), log: () => {} });
  assert.notEqual(tc.keyFor({ id: 1, mtime: 1 }, p), tc.keyFor({ id: 1, mtime: 1 }, Object.assign({}, p, { gain: -3 })));
});

test("ebur128's options are ones ffmpeg 5.1 knows, the same on both servers (v0.8.24)", () => {
  // framelog=quiet came with ffmpeg 6.0; Debian 12's 5.1 refused it and every file failed.
  assert.equal(FILTER, "ebur128=peak=true:framelog=verbose");
  const cs = fs.readFileSync(path.join(__dirname, "../server/Mandarin.Server/Identify/Loudness.cs"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "../lib/loudness.js"), "utf8");
  assert.equal(/const string Filter = "([^"]*)"/.exec(cs)[1], FILTER);
  assert.match(cs, /"-af", Filter,/);
  assert.match(js, /"-af", FILTER,/);
  assert.doesNotMatch(cs + js, /"[^"\n]*framelog=quiet[^"\n]*"/, "no ffmpeg argument asks for framelog=quiet");
  // What is waiting to be measured is the same on both.
  assert.equal(/const string Waiting = "([^"]*)"/.exec(cs)[1], /const WAITING = "([^"]*)"/.exec(js)[1]);
});

test("measuring keeps to the hours and the order (v0.8.24): the schedule's window, never while the library is scanned, album by album, newest first, after identification", () => {
  const DB = require("../lib/library/db");
  const db = DB.open(fs.mkdtempSync(path.join(os.tmpdir(), "rg-order-")), { log: () => {} });
  const DAY = 24 * 60 * 60 * 1000, now = Date.now();
  const albums = new Map();
  const album = (id, title, ago, tracks) => {
    db.raw.prepare("INSERT INTO albums(id, key, title, artist, added_at, updated_at) VALUES(?, ?, ?, 'Someone', ?, ?)").run(id, "k" + id, title, now - ago * DAY, now);
    for (const [tid, no, extra] of tracks) {
      db.raw.prepare("INSERT INTO tracks(id, album_id, path, mtime, size, title, track_no, rg_track_gain) VALUES(?, ?, ?, 0, 0, ?, ?, ?)")
        .run(tid, id, (extra && extra.path) || `/m/${id}/${tid}.flac`, "T" + tid, no, extra && extra.gain != null ? extra.gain : null);
    }
    albums.set(id, { id, key: "k" + id, title, artist: "Someone", added: now - ago * DAY, edited: false, tracks: tracks.length });
  };
  album(1, "Old", 3, [[11, 2], [12, 1]]);                   // track 2 first in the table, played second
  album(2, "New", 0, [[21, 1], [22, 2]]);
  album(3, "Middle", 1, [[31, 1, { gain: -5 }], [32, 2]]);  // one track tagged: never measured
  album(4, "Streamed", -1, [[41, 1, { path: "qobuz://track/41" }], [42, 2, { path: "tidal://track/42" }]]);
  album(5, "Single", 5, [[51, 1]]);                         // one track: identification never looks at it
  album(6, "Unseen", 2, [[61, 1], [62, 2]]);
  // Measured before v0.8.24: failed, as every file did on ffmpeg 5.1.
  db.raw.prepare("INSERT INTO track_loudness(track_id, lufs, peak, measured_at, error) VALUES(51, NULL, NULL, 1, 'ffmpeg exited with 234')").run();

  let win = false, reason = "checking";
  const looked = new Set(["k2"]);
  const scanner = { state: { running: false } };
  const identifier = {
    timer: 1, stopped: false, handedOver: false,
    settings: () => ({ enabled: true, schedule: true, start: "01:00", end: "06:00" }),
    inWindow: () => win,
    state: () => ({ reason }),
    rows: () => new Map([...looked].map(k => [k, {}])),
    eligible: () => [...albums.values()].filter(al => al.tracks >= 2 && al.id !== 4)
  };
  const l = new Loudness({ db, library: { album: id => albums.get(Number(id)) || null }, scanner, identifier });
  const order = [];
  l.run = (row) => { order.push(row.id); l.q.put.run(row.id, -20, 0.5, Date.now(), null); };
  const step = () => { const from = order.length; l.tick(); return order.slice(from); };
  try {
    // The counts are the files here: the Qobuz and Tidal tracks apart.
    let r = l.status();
    assert.deepEqual([r.tracks, r.tagged, r.measured, r.failed, r.left, r.streamed], [9, 1, 0, 1, 7, 2]);
    assert.equal(r.reason, "off");
    // What failed before is measured again — once.
    l.retryOnce();
    assert.equal(l.status().failed, 0);
    assert.equal(db.setting("loudnessRetried", null), 1);
    db.raw.prepare("INSERT INTO track_loudness(track_id, lufs, peak, measured_at, error) VALUES(51, NULL, NULL, 2, 'unreadable')").run();
    l.retryOnce();
    assert.equal(l.status().failed, 1, "a file that fails now stays failed");
    db.raw.prepare("DELETE FROM track_loudness").run();

    l.timer = setInterval(() => {}, 1e9);
    l.timer.unref();
    // Outside the hours: nothing.
    assert.deepEqual(step(), []);
    assert.equal(l.status().reason, "waiting");
    // In them, but the library is being scanned: nothing.
    win = true;
    scanner.state.running = true;
    l.queue = [{ id: 999, path: "/m/gone.flac" }];
    assert.deepEqual(step(), []);
    assert.equal(l.status().reason, "scanning");
    assert.deepEqual(l.queue, [], "the album under way is chosen again after the scan");
    // Identification at work: the albums it has looked at (New) or won't
    // (Single, one track), newest first, each album's tracks in order.
    scanner.state.running = false;
    assert.deepEqual(step(), [21, 22, 51]);
    r = l.status();
    assert.equal(r.reason, "identifying");
    assert.equal(r.measuring, false);
    // It looks at Middle; Old you edited by hand, so it never will.
    looked.add("k3");
    albums.get(1).edited = true;
    assert.deepEqual(step(), [32, 12, 11]);
    // MusicBrainz not answering: identification can't go on, so measuring does.
    reason = "unreachable";
    assert.deepEqual(step(), [61, 62]);
    assert.deepEqual(l.current, { offset: 6, title: "Unseen", subtitle: "Someone" });
    r = l.status();
    assert.deepEqual([r.reason, r.left, r.measured, r.current], ["done", 0, 8, null]);
    assert.ok(!order.includes(41) && !order.includes(42) && !order.includes(31), "Qobuz, Tidal and tagged tracks are never measured");
    // Scheduling off: whenever.
    identifier.settings = () => ({ enabled: true, schedule: false, start: "01:00", end: "06:00" });
    win = false;
    assert.equal(l.inHours(), true);
  } finally {
    l.stop();
    db.raw.close();
  }
});

test("ReplayGain end to end: tags kept, Track/Album/Auto, the stream turned down, untagged files measured", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  // An album with ReplayGain tags: tracks at -6 and -8 dB, the album at -7.
  const dir = path.join(lib.music, "Loud", "Loud Record");
  [["-6.00 dB", "0.500000"], ["-8.00 dB", "0.400000"]].forEach(([g, pk], i) => gen(path.join(dir, `0${i + 1}.flac`), {
    freq: 440 + 100 * i, seconds: 4,
    tags: { title: `Loud ${i + 1}`, artist: "Loud", album: "Loud Record", track: i + 1,
      REPLAYGAIN_TRACK_GAIN: g, REPLAYGAIN_TRACK_PEAK: pk, REPLAYGAIN_ALBUM_GAIN: "-7.00 dB", REPLAYGAIN_ALBUM_PEAK: "0.500000" }
  }));
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, loudnessTickMs: 100 });
  const ctx = await srv.start();
  const token = await signIn(B);
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body ? { method: method || "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  // Two Sonos rooms in the register, each with its own Volume Levelling.
  for (const id of ["RINCON_X", "RINCON_Y"]) ctx.devices.registry.seen({ id, kind: "sonos", network_name: id, model: "Five" });
  const level = (id, lv) => api("audio-devices/" + id, { levelling: lv }, "PATCH");
  try {
    await until(async () => (await api("status")).index_count === 4);
    const al = ctx.library.albums.find(a => a.title === "Loud Record");
    const tracks = ctx.library.tracks(al.id);
    assert.deepEqual(tracks.map(t => t.rg_track_gain), [-6, -8]);
    assert.deepEqual(tracks.map(t => t.rg_album_gain), [-7, -7]);

    // Off by default: every file goes as it is.
    let r = await api("audio-devices/RINCON_X");
    assert.deepEqual(r.levelling, { mode: "off", target: -14, unknown: -5 });
    r = await api("loudness");
    assert.equal(r.settings.measure, false);
    assert.ok(!ctx.playback.itemsFor("RINCON_X", tracks)[0].uri.includes("g="));

    // Track: each its own; Album: the record's; Auto: the record's in order, each its own shuffled.
    // At -18 LUFS the gains are the tags' own.
    const gains = (opts) => ctx.loudness.gainsFor(tracks, Object.assign({ levelling: ctx.devices.levellingFor("RINCON_X") }, opts));
    r = await level("RINCON_X", { mode: "track", target: -18 });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual(r.levelling, { mode: "track", target: -18, unknown: -5 });
    assert.deepEqual(gains(), [-6, -8]);
    await level("RINCON_X", { mode: "album" });
    assert.deepEqual(gains(), [-7, -7]);
    await level("RINCON_X", { mode: "auto" });
    assert.deepEqual(gains(), [-7, -7]);
    assert.deepEqual(gains({ shuffled: true }), [-6, -8]);
    assert.deepEqual(ctx.loudness.gainsFor([tracks[0]], { levelling: ctx.devices.levellingFor("RINCON_X") }), [-6]);   // alone: its own
    // The target moves them: -14 LUFS is 4 dB up (the peaks allow it here).
    await level("RINCON_X", { mode: "track", target: -14 });
    assert.deepEqual(gains(), [-2, -4]);
    assert.equal((await level("RINCON_X", { mode: "loud" })).status, 400);
    assert.equal((await level("RINCON_X", { target: -10 })).status, 400);
    // The other room is untouched: each device is its own.
    assert.equal(ctx.devices.levellingFor("RINCON_Y").mode, "off");
    assert.ok(!ctx.playback.itemsFor("RINCON_Y", tracks)[0].uri.includes("g="));

    // Sonos is handed a conversion with the gain in it, and the stream is that much quieter.
    await level("RINCON_X", { mode: "track", target: -18 });
    const it = ctx.playback.itemsFor("RINCON_X", tracks)[0];
    assert.match(it.uri, /\/stream\/t\d+\.flac\?g=-6/);
    assert.equal(it.plan.bits, 24);
    const measure = async (url, name) => {
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      const f = path.join(lib.data, name);
      fs.writeFileSync(f, buf);
      return ctx.loudness.measure(f);
    };
    const orig = await ctx.loudness.measure(tracks[0].path);
    const down = await measure(it.uri, "down.flac");
    assert.ok(Math.abs((orig.lufs - down.lufs) - 6) < 0.3, `${orig.lufs} → ${down.lufs}`);
    // A gain the URL makes up is refused.
    const bad = it.uri.replace("g=-6", "g=99");
    assert.equal((await fetch(bad)).status, 400);

    // The phone is handed the gain to apply itself, and its stream is untouched.
    const ph = ctx.zones.phones.toItem(ctx.playback.item(tracks[1], null, { phoneGain: -8 }));
    assert.equal(ph.gain, -8);
    assert.ok(!ph.uri.includes("g="));
    const dl = await api("download/album?offset=" + al.offset);
    assert.equal(dl.tracks[0].replaygain.track_gain, -6);
    assert.equal(dl.tracks[0].replaygain.album_gain, -7);

    // Files without tags are measured, one at a time, when asked — behind the
    // C# server (MANDARIN_FRONT=1), by it (v0.8.19).
    if (process.env.MANDARIN_FRONT === "1") {
      const h = await fetch(B + "/api/loudness", { headers: { Authorization: "Bearer " + token } });
      assert.equal(h.headers.get("x-mandarin-answered"), "C#", "measuring is the C# server's");
    }
    // Scheduling on, its window not now: switched on, nothing is measured (v0.8.24).
    const hhmm = (h) => { const d = new Date(Date.now() + h * 3600000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
    r = await api("identify/settings", { schedule: true, start: hhmm(2), end: hhmm(3) });
    assert.equal(r.status, 200, JSON.stringify(r));
    r = await api("loudness", { measure: true });
    assert.equal(r.settings.measure, true);
    await new Promise(res => setTimeout(res, 1500));
    r = await api("loudness");
    assert.deepEqual([r.reason, r.measured, r.failed, r.measuring, r.streamed], ["waiting", 0, 0, false, 0], JSON.stringify(r));
    // Scheduling off: measured until done, album by album, the newest first
    // (one scan added them all: the higher id first).
    await api("identify/settings", { schedule: false });
    const seen = [];
    r = await until(async () => {
      const j = await api("loudness");
      const t = j.current && j.current.title;
      if (t && seen[seen.length - 1] !== t) seen.push(t);
      return j.left === 0 && j.reason === "done" && j;
    });
    const rank = new Map(ctx.library.albums.slice().sort((a, b) => (b.added || 0) - (a.added || 0) || b.id - a.id).map((a, i) => [a.title, i]));
    assert.ok(seen.every((t, i) => rank.has(t) && (i === 0 || rank.get(t) > rank.get(seen[i - 1]))), "measured out of order: " + JSON.stringify(seen));
    assert.equal(r.tagged, 2);
    assert.equal(r.measured + r.failed, 7);
    assert.ok(r.measured >= 5, JSON.stringify(r));
    const one = ctx.library.albums.find(a => a.title === "Album One");
    const info = ctx.loudness.infoOf(ctx.library.tracks(one.id)[0]);
    assert.ok(info.track_gain != null && info.track_peak > 0, JSON.stringify(info));
    // Every track of Album One known: its album gain is worked out from them.
    assert.ok(info.album_gain != null, JSON.stringify(info));
    r = await api("loudness", { measure: false });
    assert.equal(r.measuring, false);
  } finally {
    await srv.stop();
  }
});
