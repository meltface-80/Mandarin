"use strict";
/*
 * ReplayGain (lib/loudness.js, v0.6.0-RC5): the files' own gains kept and
 * used; Track, Album and Auto; the peak keeping a gain from clipping; the
 * stream carrying the gain; files without tags measured in the background.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Loudness, parseEbur128, combine } = require("../lib/loudness");
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
  assert.equal(l.gainOf({ track_gain: -6, track_peak: 0.5 }, "track", 2), -4);                   // pre-amp
  assert.equal(l.gainOf({ track_gain: null, album_gain: null }, "track"), null);
  assert.equal(l.gainOf({ track_gain: 0.02 }, "track"), null);                                     // nothing to do
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
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  try {
    await until(async () => (await api("status")).index_count === 4);
    const al = ctx.library.albums.find(a => a.title === "Loud Record");
    const tracks = ctx.library.tracks(al.id);
    assert.deepEqual(tracks.map(t => t.rg_track_gain), [-6, -8]);
    assert.deepEqual(tracks.map(t => t.rg_album_gain), [-7, -7]);

    // Off by default: every file goes as it is.
    let r = await api("loudness");
    assert.equal(r.settings.mode, "off");
    assert.equal(r.settings.measure, false);
    assert.ok(!ctx.playback.itemsFor("RINCON_X", tracks)[0].uri.includes("g="));

    // Track: each its own; Album: the record's; Auto: the record's in order, each its own shuffled.
    const gains = (opts) => ctx.loudness.gainsFor(tracks, opts);
    await api("loudness", { mode: "track" });
    assert.deepEqual(gains(), [-6, -8]);
    await api("loudness", { mode: "album" });
    assert.deepEqual(gains(), [-7, -7]);
    await api("loudness", { mode: "auto" });
    assert.deepEqual(gains(), [-7, -7]);
    assert.deepEqual(gains({ shuffled: true }), [-6, -8]);
    assert.deepEqual(ctx.loudness.gainsFor([tracks[0]]), [-6]);           // alone: its own
    assert.equal((await api("loudness", { mode: "loud" })).status, 400);
    assert.equal((await api("loudness", { preamp: 40 })).status, 400);

    // Sonos is handed a conversion with the gain in it, and the stream is that much quieter.
    await api("loudness", { mode: "track" });
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

    // Files without tags are measured, one at a time, when asked.
    r = await api("loudness", { measure: true });
    assert.equal(r.settings.measure, true);
    r = await until(async () => { const j = await api("loudness"); return j.left === 0 && j; });
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
