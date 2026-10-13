"use strict";
/*
 * v0.8.38's ports (server/Mandarin.Server/Playback/) decide what the Node
 * server's decide: what each device is handed for a track (lib/stream.js, and
 * lib/server/playback.js's planFor), ReplayGain's levelling (lib/loudness.js),
 * the DSP's filters and fingerprint (public/biquad.js, lib/dsp.js), the
 * signatures on the addresses speakers are given (lib/server/auth.js), and the
 * radio's six-month memory (lib/radio-memory.js). Each is asked of both — the
 * C# server through `mandarin-server score` — over the cases the repo's own
 * tests use, the edges (every rate from 8 kHz to 768 kHz and DSD, 16/24/32
 * bits, odd containers, every renderer profile; gains of every kind; every
 * filter type at its extremes) and thousands of generated cases, with
 * deepStrictEqual, NaN and −0 included (they travel as { $js }). What the C#
 * server already did (Streams.cs's Sonos rule, Transcoder.cs's names and
 * arguments, the download list's signing and combining, the loudness summary,
 * AutoEq's bands) is held to the same answers. Nothing here changes what runs.
 * Skipped where the C# server isn't built.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's answers are kept (test/golden/streams-csharp.json, made
 * while lib/ was here) and the C# program alone held to them; what a case is made of that the
 * Node server worked out (a plan, a gain, a renderer's chips, a signed address) is asked of the C# program first,
 * held the same way. public/biquad.js, the page's own, is still asked live.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const Biquad = require("../public/biquad");
const { answers } = require("./golden");

const kept = answers("streams-csharp");
const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!kept.exists() && "no recording of the Node server's answers");
// Every kept answer asked for, where every test ran (on Node without fdlibm's Math some are left out: below).
test.after(() => { if (!skip && !onlyFdlibm()) kept.done(); });
const DAY = 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 183 * DAY;   // lib/radio-memory.js's window

// ------------------------------------------------------------------ the wire

const SPECIAL = { NaN: NaN, Infinity: Infinity, "-Infinity": -Infinity, "-0": -0 };
const enc = (k, v) => typeof v === "number" && (!Number.isFinite(v) || Object.is(v, -0)) ? { $js: Object.is(v, -0) ? "-0" : String(v) } : v;
const dec = (k, v) => v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$js === "string" && v.$js in SPECIAL ? SPECIAL[v.$js] : v;
/* What both sides are given: the job as it crosses JSON. */
const wire = v => JSON.parse(JSON.stringify(v, enc), dec);
/* What is compared: plain JSON, with NaN, the infinities and −0 kept. */
const mark = v => v === undefined ? null : JSON.parse(JSON.stringify(v, enc));

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(job, enc) + "\n", maxBuffer: 1024 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}

const THROWS = { $throws: true };
const run = (list, f) => (list || []).map(x => { try { return mark(f(x)); } catch (e) { return THROWS; } });

/*
 * V8's Math.sin, cos, log, log10 and pow, as JsMath.cs has them, against this
 * machine's Node. On x64 Node's are V8's fdlibm, and the two agree to the bit.
 * Node built for arm64 (Apple silicon) rounds a few of them differently in the
 * last bit (its compiler fuses a multiply and an add there). JsMath.cs doesn't
 * (.NET never fuses on its own, and the ports use nothing else but exact
 * operations), so the C# server gives the same bits everywhere. There Node
 * isn't the reference, and an ill-conditioned case (a filter far below its
 * rate) can carry a last bit into another headroom and another fingerprint.
 * So the answers built on these (the stream plans with their DSP and gains,
 * the DSP, ReplayGain) are held to Node's where its Math is fdlibm's (CI's
 * Linux jobs), and left out where it isn't; the rest are held everywhere.
 */
function mathProbe() {
  const r = rng(77), job = { fn: "math", sin: [], cos: [], log: [], log10: [], pow: [] };
  const RATE = [8000, 44100, 48000, 88200, 96000, 192000, 384000, 768000];
  const ODD = [0, -0, NaN, Infinity, -Infinity, 1, -1, Math.PI, 1e-310, 1e300, -1e300, 0.5, 10];
  for (let i = 0; i < 3000; i++) {
    const w = i % 3 === 0 ? 2 * Math.PI * 20 * Math.pow(1000, r()) / pick(r, RATE) : i % 3 === 1 ? (r() - 0.5) * 20 : (r() - 0.5) * 1e7;
    job.sin.push(w); job.cos.push(w);
    const v = i % 2 ? Math.pow(10, (r() - 0.5) * 80) : r() * 2;
    job.log.push(v); job.log10.push(v);
    job.pow.push(pick(r, [[10, (r() - 0.75) * 160 / 20], [10, (r() - 0.5) * 60 / 10], [10, (r() - 0.5) * 48 / 40], [2400, r()], [1000, r()], [r() * 100, (r() - 0.5) * 20]]));
  }
  for (const x of ODD) { job.sin.push(x); job.cos.push(x); job.log.push(x); job.log10.push(x); for (const y of ODD) job.pow.push([x, y]); }
  const got = csharp(wire(job));
  const out = { differ: 0, worst: 0, cases: 0 };
  for (const k of ["sin", "cos", "log", "log10", "pow"]) {
    job[k].forEach((a, i) => {
      const want = mark(k === "pow" ? Math.pow(a[0], a[1]) : Math[k](a));
      out.cases++;
      if (Object.is(JSON.stringify(got[k][i]), JSON.stringify(want))) return;
      out.differ++;
      const g = typeof got[k][i] === "number" ? got[k][i] : NaN, w = typeof want === "number" ? want : NaN;
      // Relative, or absolute below 1 (a sine near a zero).
      out.worst = Math.max(out.worst, Number.isFinite(g) && Number.isFinite(w) ? Math.abs(g - w) / Math.max(Math.abs(g), Math.abs(w), 1) : Infinity);
      if (!out.first) out.first = `${k}(${JSON.stringify(a)}): C# ${JSON.stringify(got[k][i])}, Node ${JSON.stringify(want)}`;
    });
  }
  return out;
}
/* This machine's Node has V8's fdlibm (asked once, when the C# server is built). */
let mathHere = null;
const fdlibm = () => (mathHere = mathHere || mathProbe()).differ === 0;
const onlyFdlibm = () => skip || (!fdlibm() && `this Node's Math isn't V8's fdlibm (${process.arch}: ${mathHere.differ} of ${mathHere.cases} differ in the last bits); held to the bit on x64`);

let compared = 0;
/* Both answers, case by case, the other asked here (public/biquad.js, Node itself); the first that differs is shown with its seed. */
function same(what, cases, got, want, seed) {
  assert.ok(Array.isArray(got), what + ": no answers from the C# server");
  assert.equal(got.length, cases.length, what + ": one answer for each case");
  for (let i = 0; i < cases.length; i++) {
    assert.deepStrictEqual(got[i], want[i], `${what} #${i}${seed != null ? ` (seed ${seed})` : ""}: ${JSON.stringify(cases[i], enc)}\n  C#:   ${JSON.stringify(got[i])}\n  Node: ${JSON.stringify(want[i])}`);
  }
  compared += cases.length;
}
/* The C# server's answers held to the Node server's, kept. */
function held(what, cases, got, seed) {
  assert.ok(Array.isArray(got), what + ": no answers from the C# server");
  kept.same(what, cases.map(() => seed != null ? "seed " + seed : "by hand"), cases.map(c => JSON.parse(JSON.stringify(c ?? null, enc))), got);
  compared += cases.length;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const some = (r, list, p = 0.5) => list.filter(() => r() < p);
/* A C# answer as the Node server's value: NaN, the infinities and −0 back from { $js }. */
const unmark = v => JSON.parse(JSON.stringify(v), dec);

// ------------------------------------------------------------------ tracks and devices

const RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 64000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000];
const DSD_RATES = [1411200, 2822400, 5644800, 11289600, 22579200];
const ODD_RATES = [0, null, undefined, "44100", 44100.5, -44100, NaN, Infinity, 1e21, 37800, 47999, 48001, 1, 12000, 24000, 50000, 2e6];
const BITS = [0, 1, 8, 12, 16, 20, 24, 32, 64, null, undefined, "24", 24.5, NaN];
const CHANNELS = [0, 1, 2, 3, 6, 8, null, undefined, "2", 2.5, -1];
const EXTS = [".flac", ".FLAC", ".fla", ".mp3", ".MP3", ".m4a", ".mp4", ".m4b", ".alac", ".aac", ".ogg", ".oga", ".opus", ".wav", ".wave",
  ".WAV", ".aif", ".aiff", ".aifc", ".AIFF", ".dsf", ".DSF", ".dff", ".Dff", ".ape", ".wv", ".wma", ".tta", ".tak", ".shn", ".mka",
  ".dſf", ".wAv", ".ﬂac", ".aİff", ".flac ", "", "."];
const STEMS = ["/m/a", "/music/Björk/Homogenic/01 Hunter", "/m/x/..", "/m/.hidden", "/m/a.b", "C:\\m\\a", "relative/a", "/m/Ünïcode 😀",
  "/m/a..", "/m/tab\tname", "/m/new\nline", "/m/a.flac/b"];
const ODD_PATHS = [null, undefined, "", "/m/a.flac/", "/m/..", "..", "/", "/m/a.dsf\n", "a.DSF", "/m/.flac", "/m/a..flac", "qobuz://track/123", "tidal://track/9"];
const CODECS = ["FLAC", "flac", "MPEG 1 Layer 3", "mp3", "MPEG 1 Layer 2", "MPEG-4/AAC", "AAC", "aac", "mp4a.40.2", "AAC+SBR", "ALAC", "alac",
  "Vorbis", "vorbis", "Opus", "opus", "PCM", "pcm_s16le", "pcm_s24le", "pcm_f32le", "65534", "DSD", "dsd", "DSF", "DFF", "Dſd", "Monkey's Audio",
  "APE", "ape", "WavPack", "wv", "TTA", "tta", "TAK", "tak", "Shorten", "shn", "WMA", "WMA Lossless", "xape", "ape2", "a-ape-b", "tak_", "ﬂac",
  "", null, undefined, 5, "FLAC ", "İ", "K", "éape", "apeé", "ñwv", "ttaß", "shn·", "Ωtak"];

function trackPath(r) {
  const x = r();
  if (x < 0.04) return pick(r, ODD_PATHS);
  if (x < 0.045) return 5;   // not a string: path.extname throws, both sides
  return pick(r, STEMS) + pick(r, EXTS);
}
function track(r) {
  if (r() < 0.12) {
    // DSD, as a DSF or DFF says it is.
    return { path: "/m/x" + pick(r, [".dsf", ".dff", ".DSF", ".flac"]), codec: pick(r, ["DSD", "dsd", "DSF", "DFF", "DST"]),
      sampleRate: pick(r, DSD_RATES.concat([44100, 0])), bitsPerSample: pick(r, [1, 1, 24, 0]), channels: pick(r, [2, 2, 6]) };
  }
  return { path: trackPath(r), codec: pick(r, CODECS), sampleRate: r() < 0.7 ? pick(r, RATES) : pick(r, ODD_RATES),
    bitsPerSample: pick(r, BITS), channels: r() < 0.8 ? pick(r, [1, 2, 2, 2]) : pick(r, CHANNELS) };
}

const TYPES = ["peak", "low_shelf", "high_shelf", "low_pass", "high_pass"];
function band(r) {
  return {
    type: r() < 0.1 ? pick(r, ["notch", "", "PEAK", undefined, 5, null, "constructor", "toString", "__proto__", "hasOwnProperty", ["peak"]]) : pick(r, TYPES),
    freq: r() < 0.15 ? pick(r, [10, 20, 20.5, 19999.9, 23999, 24000, 24001, 5, 0, -100, "1000", "abc", null, undefined, 1e6, NaN, Infinity, 1000.04, 1000.05, 999.9999, [50]])
      : Math.round(10 * Math.pow(2400, r()) * 100) / 100,
    gain: r() < 0.15 ? pick(r, [-20, -0.04, -0.05, 0, 0.04, 0.05, 0.049999999999999996, 20, 25, -25, "3", null, undefined, NaN, -0, true])
      : Math.round((r() * 40 - 20) * 10) / 10,
    q: r() < 0.15 ? pick(r, [0.1, 0.01, 0.001, 0.707, 20, 100, 1000, 0, -1, "0.707", null, undefined, NaN, 0.0995, 20.0004])
      : Math.round((0.1 + r() * 10) * 1000) / 1000
  };
}
function dspSetting(r) {
  const bands = n => Array.from({ length: n }, () => band(r));
  if (r() < 0.05) return pick(r, [null, undefined, {}, { enabled: true }, "on", 5, [], { enabled: true, peq: { bands: [] } }]);
  const d = {
    enabled: r() < 0.85 ? true : pick(r, [false, "yes", 0, 1, undefined, null]),
    headphone: r() < 0.5 ? null : { name: "HP", source: pick(r, ["autoeq", "custom", undefined]), preamp: r() < 0.5 ? null : pick(r, [-8, -3, -6.4, -6.45, 0, 2, -Infinity, NaN, "-3", -0]), bands: bands(Math.floor(r() * 5)) },
    peq: r() < 0.3 ? null : { bands: bands(Math.floor(r() * 6)) },
    headroom: r() < 0.7 ? "auto" : pick(r, [-3.04, 0, 3, -30, -31, -2, -0, Infinity, -Infinity, NaN, "-3"])
  };
  if (r() < 0.05) d.peq = { bands: r() < 0.5 ? "not a list" : [null] };
  return d;
}

/* A device's target as lib/renderers/players.js targetFor makes it, from a register record and its chips. */
function targetFrom(record, caps, flac32, rest) {
  const rates = caps.rates.filter(x => x.on).map(x => x.hz);
  const bits = caps.bits.filter(x => x.on).map(x => x.n);
  const most = bits.length ? Math.max(...bits) : 24;
  const mimes = (record.caps && record.caps.advertised && record.caps.advertised.mimes) || [];
  return {
    name: record.name, rates, maxBits: Math.min(most, flac32 ? 32 : 24), containers: caps.containers,
    dsd: caps.dsd.filter(x => x.on).map(x => x.n),
    dsdMimes: {
      dsf: mimes.find(m => /^audio\/(x-)?dsf$/.test(m)) || mimes.find(m => /^audio\/(x-)?dsd$/.test(m)) || null,
      dff: mimes.find(m => /^audio\/(x-)?dff$/.test(m)) || mimes.find(m => /^audio\/(x-)?dsd$/.test(m)) || null
    },
    mode: rest.mode, bits: rest.bits, dsp: rest.dsp, id: rest.id
  };
}
/* profiles.js's tables and each record's chips, the C# server's (held to the Node server's). */
let TABLES = null;
function tables() {
  if (TABLES) return TABLES;
  const got = csharp({ fn: "profiles", lookups: [], records: [] });
  held("profiles' tables (to make cases)", ["rates", "bits", "dsd"], [got.rates, got.bits, got.dsd]);
  return (TABLES = { RATES: got.rates, BITS: got.bits, DSD: got.dsd });
}
function effectiveOf(records) {
  const got = csharp({ fn: "profiles", lookups: [], records: records.map(record => ({ record })) }).effective;
  held("effective (to make cases)", records, got);
  return got;
}
const CONTAINER_SETS = [[], ["flac"], ["flac", "wav"], ["mp3"], ["flac", "mp3", "aac", "alac", "wav", "aiff", "ogg", "opus", "dsd"],
  ["dsd", "flac"], ["aac", "alac"], ["ogg", "opus"], ["wav", "aiff"], ["flac", "dsd", "mp3"]];
const MIME_SETS = [[], ["audio/dsf", "audio/dff"], ["audio/x-dsf"], ["audio/dsd"], ["audio/x-dsd", "audio/flac"], ["audio/x-dff"]];
const MODELS = [
  { manufacturer: "Linkplay", model: "WiiM Pro Plus" }, { manufacturer: "Linkplay", model: "WiiM Ultra" }, { manufacturer: "Linkplay", model: "WiiM Amp" },
  { manufacturer: "Linkplay", model: "WiiM Pro" }, { manufacturer: "Linkplay", model: "WiiM Mini" }, { manufacturer: "Linkplay", model: "WiiM", family: "wiim" },
  { manufacturer: "Chord Electronics", model: "Poly" }, { manufacturer: "LinkPlay", model: "A31" }, { manufacturer: "Acme", model: "Renderer" },
  { manufacturer: "", model: "", family: "local" }, { kind: "sonos" }, { kind: "phone" }
];
/* Every renderer profile, with what it advertises and what its owner ticked. */
function profileTargets(r) {
  const made = [], T = tables();
  for (const m of MODELS) for (const containers of CONTAINER_SETS) for (const flac32 of [false, true]) {
    const user = r() < 0.3 ? { rates: some(r, T.RATES), bits: some(r, T.BITS), dsd: some(r, T.DSD) } : null;
    const record = Object.assign({ kind: "upnp", name: m.model || m.kind, caps: { advertised: { containers, mimes: pick(r, MIME_SETS), rates: some(r, RATES, 0.1) }, user } }, m);
    made.push({ record, flac32, rest: { mode: pick(r, ["original", "x2", "x4", "max"]), bits: pick(r, ["auto", 24, 32]), dsp: r() < 0.2 ? dspSetting(r) : null, id: "UPNP_" + Math.floor(r() * 1000) } });
  }
  const caps = effectiveOf(made.map(x => x.record));
  return made.map((x, i) => targetFrom(x.record, caps[i], x.flac32, x.rest));
}
/* A target of any shape at all. */
function oddTarget(r) {
  const t = {};
  if (r() < 0.9) t.rates = r() < 0.9 ? some(r, RATES.concat(ODD_RATES, ["96000", 0, -1]), 0.3) : pick(r, [[], null, undefined, "44100"]);
  if (r() < 0.8) t.maxBits = pick(r, [16, 24, 32, 8, "32", undefined, null, 64, 24.5]);
  if (r() < 0.8) t.containers = r() < 0.8 ? some(r, ["flac", "mp3", "aac", "alac", "wav", "aiff", "ogg", "opus", "dsd", "FLAC", 5]) : pick(r, [[], "flac", null]);
  if (r() < 0.7) t.name = pick(r, ["WiiM", "Poly", "", 0, "Ünïcode 😀", undefined]);
  if (r() < 0.5) t.dsd = pick(r, [[64], [64, 128, 256], [], undefined, "64", null, [128], ["64"], 64]);
  if (r() < 0.5) t.dsdMimes = pick(r, [{ dsf: "audio/dsf", dff: null }, null, {}, "x", { dsf: 5, dff: "audio/x-dff" }]);
  if (r() < 0.7) t.mode = pick(r, ["original", "x2", "x4", "max", "X2", 5, undefined]);
  if (r() < 0.7) t.bits = pick(r, ["auto", 24, 32, undefined, null, "32", 16]);
  if (r() < 0.3) t.dsp = dspSetting(r);
  return t;
}

// ------------------------------------------------------------------ the repo's own cases

const WIIM = { name: "WiiM", rates: [44100, 48000, 88200, 96000, 176400, 192000], maxBits: 24, containers: ["flac", "wav"] };
const POLY = { name: "Poly", rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000], maxBits: 32, containers: ["flac"] };
const CD = { path: "/m/a.flac", codec: "FLAC", sampleRate: 44100, bitsPerSample: 16, channels: 2 };
const HI = Object.assign({}, CD, { sampleRate: 96000, bitsPerSample: 24 });
const DSF64 = { path: "/m/a.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 };
const REPO_DSP = Biquad.normalise({ enabled: true, peq: { bands: [
  { type: "peak", freq: 1000, gain: -6, q: 1.41 }, { type: "low_shelf", freq: 100, gain: 2, q: 0.707 }, { type: "high_pass", freq: 30, q: 0.707 }] } });
const REPO_TARGET = { name: "WiiM", rates: [44100, 48000, 88200, 96000], maxBits: 24, containers: ["flac"], mode: "original", bits: "auto", id: "UPNP_x" };
const REPO_PLANS = [
  [CD, WIIM], [HI, WIIM], [Object.assign({}, CD, { sampleRate: 352800 }), WIIM], [HI, { rates: [44100, 48000], containers: ["flac"] }],
  [CD, Object.assign({ mode: "x2" }, WIIM)], [CD, Object.assign({ mode: "x4" }, WIIM)], [CD, Object.assign({ mode: "max" }, WIIM)],
  [HI, Object.assign({ mode: "x4" }, WIIM)], [Object.assign({}, HI, { sampleRate: 192000 }), Object.assign({ mode: "max" }, WIIM)],
  [CD, Object.assign({ mode: "max", bits: "auto" }, POLY)], [CD, Object.assign({ mode: "max", bits: 24 }, POLY)],
  [Object.assign({}, CD, { sampleRate: 48000 }), Object.assign({ mode: "max" }, POLY)],
  [{ path: "/m/a.mp3", codec: "MPEG 1 Layer 3", sampleRate: 44100 }, Object.assign({ mode: "x2" }, WIIM)],
  [DSF64, Object.assign({ mode: "max" }, WIIM)], [DSF64, Object.assign({ dsd: [64] }, WIIM)],
  [{ path: "/m/a.dff", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 }, Object.assign({ dsd: [64] }, WIIM)],
  [DSF64, Object.assign({ dsdMimes: { dsf: "audio/dsf", dff: null }, dsd: [64] }, WIIM)],
  [{ path: "/m/a.dff", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 }, Object.assign({ dsdMimes: { dsf: "audio/dsf", dff: null }, dsd: [64] }, WIIM)],
  [{ path: "/m/a.dsf", codec: "DSD", sampleRate: 5644800, bitsPerSample: 1 }, Object.assign({ dsd: [64] }, WIIM)],
  [{ path: "/m/a.flac", codec: "FLAC", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, null],
  [{ path: "/m/a.flac", codec: "FLAC", sampleRate: 48000, bitsPerSample: 24, channels: 2 }, null],
  ...[88200, 96000, 176400, 192000, 352800].map(rate => [{ path: "/m/a.flac", codec: "FLAC", sampleRate: rate, bitsPerSample: 24, channels: 2 }, null]),
  [{ path: "/m/a.wav", codec: "PCM", sampleRate: 48000, bitsPerSample: 32, channels: 2 }, null],
  [{ path: "/m/a.m4a", codec: "ALAC", sampleRate: 96000, bitsPerSample: 24, channels: 2 }, null],
  [{ path: "/m/a.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1, channels: 2 }, null],
  [{ path: "/m/a.mp3", codec: "MPEG 1 Layer 3", sampleRate: 44100, channels: 2 }, null], [{ path: "/m/a.m4a", codec: "AAC", sampleRate: 44100, channels: 2 }, null],
  [{ path: "/m/a.ogg", codec: "Vorbis", sampleRate: 44100, channels: 2 }, null],
  [{ path: "/m/a.ape", codec: "Monkey's Audio", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, null],
  [{ path: "/m/a.wav", codec: "PCM", sampleRate: 44100, bitsPerSample: 24, channels: 2 }, null],
  [{ path: "/m/a.wav", codec: "pcm_s24le", sampleRate: 96000, bitsPerSample: 24, channels: 2 }, { name: "DAC", rates: [44100, 48000, 96000], maxBits: 24, containers: ["flac"] }],
  [{ path: "/m/b.wav", codec: "pcm_s16le", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, { name: "DAC", rates: [44100, 48000, 96000], maxBits: 24, containers: ["flac"] }],
  [{ path: "/m/a.wav", codec: "pcm_s24le", sampleRate: 96000, bitsPerSample: 24, channels: 2 }, { name: "DAC", rates: [44100, 48000], maxBits: 24, containers: ["flac"] }],
  [{ path: "/m/a.mp3", codec: "mp3", sampleRate: 44100, bitsPerSample: 0, channels: 2 }, { name: "DAC", rates: [44100], maxBits: 24, containers: ["flac"] }],
  [{ path: "/m/a.flac", codec: "flac", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, REPO_TARGET],
  [{ path: "/m/a.flac", codec: "flac", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, Object.assign({}, REPO_TARGET, { dsp: REPO_DSP })],
  [{ path: "/m/a.flac", codec: "flac", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, Object.assign({}, REPO_TARGET, { dsp: REPO_DSP, mode: "x2" })],
  [{ path: "/m/a.flac", codec: "flac", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, Object.assign({}, REPO_TARGET, { dsp: Object.assign({}, REPO_DSP, { enabled: false }) })],
  [{ path: "/m/a.flac", codec: "flac", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, Object.assign({}, REPO_TARGET, { dsp: { enabled: true, peq: { bands: [] } } })]
];

// ------------------------------------------------------------------ stream plans

const GAINS = [0, 0.04, 0.05, -0.05, 0.049, 0.06, -6.25, 6.35, 12, -24, 100, -1e9, NaN, "3.5", "abc", null, undefined, true, "", Infinity,
  1e-7, -0.15, 0.15, 0.25, 0.35, 1.45, -1.45, 2.675, -0, "-6", [3], -0.049999999999999996];

function plansJob(r, n) {
  const job = { fn: "plans", native: [], ext_mime: [], family: [], renderer_mime: [], plan: [], repack: [], with_gain: [], with_dsp: [], args: [], keys: [],
    plan_for: [], service: [], held_mime: [], held_sonos: [], held_keys: [], held_args: [] };
  const targets = profileTargets(r);
  const anyTarget = () => { const x = r(); return x < 0.3 ? null : x < 0.7 ? pick(r, targets) : oddTarget(r); };
  // Plans and gains made of the cases' tracks: worked out after (planned below), in place.
  const toPlan = [], toGain = [];
  for (let i = 0; i < n; i++) {
    const t = track(r);
    job.native.push(t);
    job.plan.push([t, anyTarget()]);
    job.renderer_mime.push([t, some(r, ["flac", "mp3", "aac", "alac", "wav", "aiff", "ogg", "opus", "dsd"])]);
    // A plan as the Node server made them, then some it never would.
    const p = {};
    toPlan.push({ p, t, target: anyTarget(), extra: r() < 0.2 ? pick(r, [{ exact: true }, { dsd: 64 }, { gain: -3 }, { upsampled: 2 }, { transcode: false }, { bits: 16 }, { rate: "44100" }, { copy: true }, { hq: true }, { bits: 32 }]) : null });
    const junk = pick(r, [null, "plan", {}, { transcode: true }, { transcode: 1, rate: 44100, bits: 24 }, []]);
    job.repack.push([r() < 0.9 ? p : junk, t]);
    job.with_gain.push([r() < 0.95 ? p : junk, t, r() < 0.5 ? null : anyTarget(), r() < 0.7 ? Math.round((r() * 40 - 24) * 1000) / 1000 : pick(r, GAINS)]);
    if (p && typeof p === "object" && !Array.isArray(p)) job.with_dsp.push([p, r() < 0.95 ? Object.assign({}, anyTarget() || {}, { dsp: dspSetting(r) }) : null, pick(r, [44100, 0, undefined, "96000", 48000])]);
    const gp = {};
    toGain.push({ gp, p, t, g: pick(r, [-3.2, 4, 0, -11.75]) });
    job.args.push([pick(r, ["/m/a.flac", "qobuz://track/1", "/m/Ünïcode 😀.wav"]), r() < 0.9 ? gp : junk, "/tmp/out.flac.part", r() < 0.5]);
    job.keys.push([{ id: pick(r, [1, 42, 1234567, "7", null]), mtime: pick(r, [0, 1700000000000, 1700000000123.75, -1.5, null, "1700000000000", NaN, -0.5]) }, gp]);
    const row = { id: i + 1, path: pick(r, [t.path, t.path, "qobuz://track/" + i, "tidal://track/" + i]), codec: t.codec, sample_rate: t.sampleRate, bits: t.bitsPerSample, channels: t.channels };
    job.plan_for.push([row, anyTarget(), r() < 0.5 ? null : pick(r, GAINS)]);
    job.service.push(row.path);
    // What the C# server makes from a library row (integers, or 0 for none).
    const int = v => Number.isFinite(Number(v)) && Math.abs(Number(v)) <= Number.MAX_SAFE_INTEGER ? Math.max(0, Math.trunc(Number(v))) : 0;
    const hp = typeof t.path === "string" ? t.path : "";
    const hc = typeof t.codec === "string" ? t.codec : "";
    job.held_sonos.push([hp, hc, r() < 0.01 ? pick(r, [2e15, 9007199254740991]) : int(t.sampleRate), int(t.bitsPerSample), int(t.channels)]);
    job.held_keys.push([1 + Math.floor(r() * 1e6), Math.floor(r() * 2e12), pick(r, RATES), pick(r, [16, 24]), r() < 0.5, r() < 0.3]);
    job.held_args.push(["/m/" + i + pick(r, EXTS), pick(r, RATES), pick(r, [16, 24, 32]), r() < 0.5, r() < 0.3, "/t/" + i + ".flac.part", r() < 0.5]);
  }
  job.ext_mime = ["flac", "FLAC", "fla", "mp3", "m4a", "mp4", "alac", "m4b", "aac", "ogg", "oga", "opus", "wav", "wave", "aif", "aiff", "aifc", "wma",
    "dsf", "DSF", "dff", "ape", "", null, undefined, 5, "ﬂac", "wav ", "x", "Ogg", "OPUS", 0, "İ"];
  job.held_mime = ["flac", "FLAC", "fla", "mp3", "m4a", "mp4", "alac", "m4b", "aac", "ogg", "oga", "opus", "wav", "wave", "aif", "aiff", "aifc",
    "wma", "dsf", "DSF", "dff", "ape", "x", "Ogg", "OPUS", "0", "m4A"];
  job.family = RATES.concat(DSD_RATES, [0, -0, -44100, NaN, Infinity, -Infinity, 88200.5, 1e300, 132300, 4410, "44100", null]);
  plansMade(toPlan, toGain);
  return job;
}

/* A plans job's own plans and gains, as the C# server works them out (held to the Node server's), laid into the
 * objects its cases hold: a plan that throws is a plain conversion, a gain that throws leaves the plan as it was. */
function plansMade(toPlan, toGain) {
  if (!toPlan.length) return;
  const pairs = toPlan.map(x => [x.t, x.target]);
  const plans = csharp(wire({ fn: "plans", plan: pairs })).plan;
  held("plans.plan (to make cases)", pairs, plans);
  toPlan.forEach((x, i) => Object.assign(x.p, plans[i] && plans[i].$throws ? { transcode: true, rate: 44100, bits: 16 } : unmark(plans[i]), x.extra || {}));
  const gains = toGain.map(x => [x.p, x.t, null, x.g]);
  const gained = csharp(wire({ fn: "plans", with_gain: gains })).with_gain;
  held("plans.with_gain (to make cases)", gains, gained);
  toGain.forEach((x, i) => Object.assign(x.gp, gained[i] && gained[i].$throws ? JSON.parse(JSON.stringify(x.p)) : unmark(gained[i])));
}

const PLAN_KEYS = ["native", "ext_mime", "family", "renderer_mime", "plan", "repack", "with_gain", "with_dsp", "args", "keys", "plan_for", "service", "held_mime", "held_sonos", "held_keys", "held_args"];
function comparePlans(job, seed) {
  const got = csharp(wire(job));
  for (const k of PLAN_KEYS) held("plans." + k, job[k], got[k], seed);
}

test("V8's Math as JsMath.cs has it: Node's to the bit on x64, within the last bits on arm64", { skip }, (t) => {
  fdlibm();
  const m = mathHere;
  t.diagnostic(`${m.cases} cases, ${m.differ} differ from this machine's Node (${process.arch})${m.first ? "; the first: " + m.first : ""}`);
  if (process.arch === "x64") assert.equal(m.differ, 0, "V8's fdlibm, to the bit: " + m.first);
  else assert.ok(m.worst <= 1e-14, `within the last bits (worst ${m.worst}): ${m.first}`);
});

test("stream plans: the repo's own cases, then every rate, depth, container and renderer profile", { skip: onlyFdlibm() }, () => {
  const r = rng(838);
  const job = plansJob(r, 0);
  job.plan = REPO_PLANS.slice();
  // stream.test.js: a gain changes the samples, so a repack is no longer exact.
  const wav = { path: "/m/a.wav", codec: "pcm_s24le", sampleRate: 96000, bitsPerSample: 24, channels: 2 };
  const dac = { name: "DAC", rates: [44100, 48000, 96000], maxBits: 24, containers: ["flac"] };
  const toPlan = [{ p: {}, t: wav, target: dac }];
  plansMade(toPlan, []);
  job.with_gain = [[toPlan[0].p, wav, dac, -3]];
  // Every rate × depth × container (as a file and as its codec says) × each kind of device.
  const kinds = [["/m/a.flac", "FLAC"], ["/m/a.wav", "pcm_s24le"], ["/m/a.wav", "PCM"], ["/m/a.aiff", "PCM"], ["/m/a.aif", ""], ["/m/a.m4a", "ALAC"],
    ["/m/a.m4a", "AAC"], ["/m/a.mp3", "MPEG 1 Layer 3"], ["/m/a.ogg", "Vorbis"], ["/m/a.opus", "Opus"], ["/m/a.ape", "Monkey's Audio"],
    ["/m/a.wv", "WavPack"], ["/m/a.wma", "WMA Lossless"], ["/m/a.mka", "FLAC"], ["/m/a.dsf", "DSD"], ["/m/a.dff", "DSD"]];
  const devices = [null].concat(profileTargets(r).filter((x, i) => i % 3 === 0), [WIIM, POLY, Object.assign({ mode: "x4" }, WIIM), Object.assign({ mode: "max", bits: 24 }, POLY)]);
  for (const rate of RATES.concat(DSD_RATES)) for (const bits of [16, 24, 32]) for (const [p, codec] of kinds) {
    const t = { path: p, codec, sampleRate: rate, bitsPerSample: /\.(dsf|dff)$/.test(p) ? 1 : bits, channels: 2 };
    job.native.push(t);
    for (const d of devices) if (r() < 0.25) job.plan.push([t, d]);
    job.held_sonos.push([p, codec, rate, bits, 2]);
  }
  comparePlans(job, 838);
});

test("stream plans: thousands of generated tracks, devices, gains and DSP", { skip: onlyFdlibm() }, () => {
  for (const seed of [1, 2, 3]) comparePlans(plansJob(rng(seed), 1500), seed);
});

// ------------------------------------------------------------------ the DSP

const FS = [8000, 22050, 44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000, 1, 100, 0, -48000, NaN, "48000", undefined, null, 1e9];

function dspJob(r, n) {
  const job = { fn: "dsp", coeffs: [], section_db: [], response: [], sweep: [], peak: [], bands_of: [], headroom: [], normalise_band: [], normalise: [],
    active: [], fingerprint: [], num: [], band_filter: [], filters: [], plan_part: [], held_autoeq: [] };
  for (let i = 0; i < n; i++) {
    const b = band(r);
    const fs = r() < 0.8 ? pick(r, RATES) : pick(r, FS);
    const d = dspSetting(r);
    job.coeffs.push([b, fs]);
    job.section_db.push([b, r() < 0.8 ? 20 * Math.pow(1000, r()) : pick(r, [0, -1, 24000, 1e6, NaN]), fs]);
    if (i % 4 === 0) {
      const bands = Array.from({ length: Math.floor(r() * 4) }, () => band(r)).filter(x => r() < 0.95);
      job.response.push([bands, fs, Array.from({ length: 20 }, () => 20 * Math.pow(1000, r()))]);
      job.sweep.push([bands, pick(r, [2, 3, 10, 400, 0])]);
      job.peak.push([bands, fs]);
    }
    job.bands_of.push(d);
    job.headroom.push([d, pick(r, FS)]);
    job.normalise_band.push(r() < 0.95 ? b : pick(r, [null, "band", 5, [], { type: "peak" }]));
    job.normalise.push(r() < 0.9 ? d : { peq: { bands: Array.from({ length: 11 }, () => ({ type: "peak", freq: 100, gain: 0 })) } });
    job.active.push(d);
    job.fingerprint.push([d, pick(r, FS)]);
    job.num.push(pick(r, [b.freq, b.gain, b.q, 1.0005, -1.0005, 2.0005, 1e21, 1e-7, "1.2345", null, undefined, NaN, -0.0004, 0.0005]));
    job.band_filter.push(b);
    job.filters.push([d, pick(r, [44100, 48000, 96000, 0, undefined, "44100"]), pick(r, RATES.concat([0, undefined])), r() < 0.5]);
    job.plan_part.push([d, pick(r, FS)]);
    if (Number.isFinite(Number(b.freq)) && Number.isFinite(Number(b.gain)) && Number.isFinite(Number(b.q))) {
      job.held_autoeq.push([typeof b.type === "string" ? b.type : "peak", Number(b.freq), Number(b.gain), Number(b.q)]);
    }
  }
  return job;
}

/* The page's own biquad.js, asked here: what both servers' DSP is held to. */
function dspPage(job) {
  const N = x => Number(x);
  const normalised = f => x => { try { return f(x); } catch (e) { return { error: e.message }; } };
  return {
    coeffs: run(job.coeffs, ([b, fs]) => Biquad.coeffs(b, N(fs))),
    section_db: run(job.section_db, ([b, f, fs]) => Biquad.sectionDb(Biquad.coeffs(b, N(fs)), N(f), N(fs))),
    response: run(job.response, ([bands, fs, freqs]) => Biquad.response(bands, N(fs), freqs.map(N))),
    sweep: run(job.sweep, ([bands, n]) => Biquad.sweep(bands, N(n))),
    peak: run(job.peak, ([bands, fs]) => Biquad.peakDb(bands, N(fs))),
    bands_of: run(job.bands_of, d => Biquad.bandsOf(d)),
    headroom: run(job.headroom, ([d, fs]) => Biquad.headroom(d, fs)),
    normalise_band: run(job.normalise_band, normalised(Biquad.normaliseBand)),
    normalise: run(job.normalise, normalised(Biquad.normalise)),
    active: run(job.active, d => Biquad.active(d)),
    fingerprint: run(job.fingerprint, ([d, fs]) => Biquad.fingerprint(d, fs)),
    num: run(job.num, v => (Math.round(v * 1000) / 1000).toString()),
    // AutoEq's typed twin keeps no −0 (a page never shows one): compared as plain JSON.
    held_autoeq: (job.held_autoeq || []).map(([type, freq, gain, q]) => { try { return JSON.parse(JSON.stringify(Biquad.normaliseBand({ type, freq, gain, q }))); } catch (e) { return { error: e.message }; } })
  };
}

function compareDsp(job, seed) {
  const got = csharp(job);
  const page = dspPage(wire(job));
  for (const k of Object.keys(page)) same("dsp." + k, job[k], got[k], page[k], seed);
  for (const k of ["band_filter", "filters", "plan_part"]) held("dsp." + k, job[k], got[k], seed);
}

test("the DSP: the repo's own settings, every filter type at its extremes, and generated ones", { skip: onlyFdlibm() }, () => {
  const r = rng(4242);
  const job = dspJob(r, 0);
  const peak = [{ type: "peak", freq: 1000, gain: 6, q: 1.41 }];
  const repoBands = [peak, [{ type: "peak", freq: 1000, gain: -6, q: 1.41 }], [{ type: "low_shelf", freq: 1000, gain: 4, q: 0.707 }],
    [{ type: "high_shelf", freq: 2000, gain: -3, q: 0.707 }], [{ type: "high_pass", freq: 80, q: 0.707 }], [{ type: "low_pass", freq: 8000, q: 0.707 }],
    [{ type: "peak", freq: 800, gain: 3, q: 0.5 }, { type: "peak", freq: 1200, gain: 3, q: 0.5 }]];
  for (const bands of repoBands) for (const fs of [48000, 96000, 44100, 88200]) {
    job.response.push([bands, fs, [20, 30, 80, 100, 1000, 2000, 8000, 15000, 18000, 20000]]);
    job.peak.push([bands, fs]);
    for (const b of bands) job.coeffs.push([b, fs]);
  }
  const settings = [
    { enabled: true, peq: { bands: peak }, headroom: "auto" },
    { enabled: true, peq: { bands: [{ type: "peak", freq: 800, gain: 3, q: 0.5 }, { type: "peak", freq: 1200, gain: 3, q: 0.5 }] }, headroom: "auto" },
    { enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: -6, q: 1.41 }] }, headroom: "auto" },
    { enabled: true, headphone: { name: "x", preamp: -8, bands: peak }, headroom: "auto" },
    { enabled: true, headphone: { name: "x", preamp: -3, bands: peak }, headroom: "auto" },
    { enabled: true, peq: { bands: peak }, headroom: -2 },
    { enabled: true, headphone: { bands: [{ type: "peak", freq: 100, gain: 1, q: 1 }] }, peq: { bands: [{ type: "peak", freq: 200, gain: 2, q: 1 }] } },
    { enabled: "yes", peq: { bands: [{ type: "peak", freq: "1000.04", gain: 2.26, q: "1.4142" }, { type: "low_pass", freq: 120, gain: 5 }] }, headroom: -3.04 },
    REPO_DSP, { enabled: true, peq: { bands: [] } }, null, { enabled: true, peq: { bands: [{ type: "peak", freq: 8000, gain: 6, q: 4 }] } }
  ];
  for (const d of settings) for (const fs of [48000, 44100, 88200, 96000]) {
    job.headroom.push([d, fs]); job.fingerprint.push([d, fs]); job.plan_part.push([d, fs]); job.filters.push([d, 44100, fs, true]); job.filters.push([d, 44100, fs, false]);
  }
  job.normalise.push(...settings, { peq: { bands: [{ type: "notch", freq: 100 }] } }, { peq: { bands: [{ type: "peak", freq: 5, gain: 0 }] } },
    { peq: { bands: [{ type: "peak", freq: 100, gain: 30 }] } }, { peq: { bands: [{ type: "peak", freq: 100, gain: 0, q: 50 }] } }, { headroom: 3 },
    { peq: { bands: new Array(11).fill({ type: "peak", freq: 100, gain: 0 }) } });
  // Every type at the edges of its ranges, at every rate.
  for (const type of TYPES) for (const freq of [10, 20, 1000, 20000, 23999.9, 24000]) for (const gain of [-20, -0.05, 0, 0.05, 20]) for (const q of [0.1, 0.707, 20]) {
    const b = { type, freq, gain, q };
    job.normalise_band.push(b);
    job.band_filter.push(b);
    job.held_autoeq.push([type, freq, gain, q]);
    for (const fs of [8000, 44100, 192000, 768000]) if (r() < 0.3) job.coeffs.push([b, fs]);
  }
  compareDsp(job, 4242);
  for (const seed of [11, 12]) compareDsp(dspJob(rng(seed), 1500), seed);
});

// ------------------------------------------------------------------ ReplayGain

const EBUR = [
  "[Parsed_ebur128_0 @ 0x55] Summary:\n\n  Integrated loudness:\n    I:         -9.4 LUFS\n    Threshold: -19.6 LUFS\n\n  True peak:\n    Peak:        0.6 dBFS",
  "I: -inf LUFS\nPeak: -inf dBFS", "", "Summary:\n I: -71.0 LUFS\n Peak: -3.2 dBFS", "I: -23 LUFS Peak: -1 dBFS Summary: I: -18.4 LUFS Peak: -0.5 dBFS",
  "I:\u00a0-14.2\u2003LUFS\nPeak:\t-0.0 dBFS", "I: 1.2.3 LUFS\nPeak: . dBFS", "I: -.5 LUFS\nPeak: 5. dBFS", "no summary at all", null, undefined, 5,
  "Summary:\n I: -12.0 LUFS\n Peak: 12.3 dBFS\nSummary:\n I: -70 LUFS\n Peak: -100 dBFS"
];

function gainJob(r, n) {
  const job = { fn: "gain", levelling: [], patch: [], ebur: EBUR.slice(), combine: [], album: [], info: [], gain_of: [], gains_for: [] };
  const lv = () => r() < 0.1 ? pick(r, [null, undefined, "track", 5, [], {}]) : {
    mode: pick(r, ["off", "track", "album", "auto", "loud", undefined, null, "AUTO"]),
    target: pick(r, [-14, -18, -23, -25, -13, -26, "-18", -18.4, -18.5, -14.5, -25.5, -24.5, NaN, null, undefined, "x"]),
    unknown: pick(r, [-5, 0, -12, 1, -13, "-3", -0, -0.4, -0.5, -11.5, -12.5, NaN, null, undefined])
  };
  const num = () => r() < 0.85 ? Math.round((r() * 40 - 30) * 100) / 100 : pick(r, [null, null, 0, NaN, -0, "3", Infinity]);
  const peak = () => r() < 0.8 ? Math.round(r() * 1.5 * 1e6) / 1e6 : pick(r, [null, 0, 1, -0.5, 2, NaN, "0.9"]);
  const row = () => ({ id: Math.floor(r() * 20), duration: r() < 0.05 ? pick(r, ["180", "5", true, [60]]) : pick(r, [180, 200.5, 0, null, -1, 3600, 1]), rg_track_gain: r() < 0.5 ? null : num(), rg_track_peak: peak(), lufs: r() < 0.2 ? null : num() - 10, peak: peak() });
  for (let i = 0; i < n; i++) {
    job.levelling.push(lv());
    job.patch.push([lv(), r() < 0.1 ? pick(r, [null, [], "x", 5]) : Object.assign({}, r() < 0.5 ? { mode: pick(r, ["off", "track", "album", "auto", "loud", null]) } : {},
      r() < 0.5 ? { target: pick(r, [-14, -20, -25, -13, -26, -18.5, "-20", null, NaN]) } : {}, r() < 0.5 ? { unknown: pick(r, [0, -12, -5, 2, -13, -0, "-3", -2.5]) } : {})]);
    job.combine.push(Array.from({ length: Math.floor(r() * 6) }, () => ({ lufs: r() * -40, seconds: pick(r, [180, 0, -1, 1, 3600.5, NaN, 240]) })));
    const albums = {};
    for (let a = 1; a <= 3; a++) albums[a] = r() < 0.1 ? [] : Array.from({ length: 1 + Math.floor(r() * 5) }, row);
    const measured = {};
    for (let id = 1; id <= 10; id++) if (r() < 0.5) measured[id] = { lufs: num() - 10, peak: peak() };
    job.album.push(pick(r, Object.values(albums)));
    const tracks = Array.from({ length: Math.floor(r() * 8) }, (_, k) => ({ id: 1 + Math.floor(r() * 10), album_id: pick(r, [1, 1, 2, 3, null, 4]),
      rg_track_gain: r() < 0.4 ? null : num(), rg_track_peak: peak(), rg_album_gain: r() < 0.6 ? null : num(), rg_album_peak: peak() }));
    job.info.push({ tracks, measured, albums });
    job.gains_for.push({ tracks, measured, albums, shuffled: pick(r, [true, false, undefined, 0, "yes"]), levelling: lv() });
    const info = { track_gain: r() < 0.3 ? null : num(), track_peak: peak(), album_gain: r() < 0.3 ? null : num(), album_peak: peak() };
    job.gain_of.push([info, pick(r, ["track", "album", "auto", undefined]), pick(r, [0, 4, -7, 3.5, -11, undefined, null]), pick(r, [0, -5, -12, -24.5, 3, undefined, null])]);
  }
  return job;
}

test("ReplayGain: the repo's own cases, then generated settings, tags, measurements and albums", { skip: onlyFdlibm() }, () => {
  const job = gainJob(rng(1800), 0);
  job.levelling.push(null, { mode: "auto", target: -30, unknown: 3 });
  job.patch.push([null, { mode: "album", target: -20 }], [null, { target: -13 }], [null, { target: -26 }], [null, { unknown: 2 }], [null, { mode: "loud" }]);
  job.combine.push([{ lufs: -10, seconds: 100 }, { lufs: -10, seconds: 100 }], [{ lufs: -10, seconds: 300 }, { lufs: -30, seconds: 10 }], []);
  const info = { track_gain: -6, track_peak: 0.5, album_gain: -4, album_peak: 0.9 };
  job.gain_of.push([info, "track"], [info, "album"], [{ track_gain: null, album_gain: -4, album_peak: 0.9 }, "track"],
    [{ track_gain: -6, track_peak: 0.5, album_gain: null }, "album"], [{ track_gain: 10, track_peak: 0.5 }, "track"],
    [{ track_gain: -6, track_peak: 0.5 }, "track", 4], [{ track_gain: -6, track_peak: 0.5 }, "track", -7],
    [{ track_gain: null, album_gain: null }, "track"], [{ track_gain: null, album_gain: null }, "track", 4, -5], [{ track_gain: 0.02 }, "track"]);
  const KEYS = ["levelling", "patch", "ebur", "combine", "held_combine", "album", "info", "gain_of", "gains_for"];
  const got = csharp(job);
  for (const k of KEYS) held("gain." + k, job[k === "held_combine" ? "combine" : k], got[k], 1800);
  for (const seed of [21, 22, 23]) {
    const g = gainJob(rng(seed), 800);
    const gotG = csharp(g);
    for (const k of KEYS) held("gain." + k, g[k === "held_combine" ? "combine" : k], gotG[k], seed);
  }
});

// ------------------------------------------------------------------ signing

test("URL signing: the addresses the Node server signs, and the gate's decision on them", { skip }, () => {
  const secrets = ["5f0c1e2d3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d", "sécret 😀", "x", "\ud800lone"];
  let vouched = 0, declined = 0;
  for (const [si, secret] of secrets.entries()) {
    const r = rng(900 + si);
    const keys = ["al-1-0", "u-0123abcd", "label-columbia", "a b", "Ünïcode 😀", "%2F", "a?b", "50%", "x#y", "", "~!*'()"];
    const paths = [];
    for (let i = 0; i < 300; i++) {
      const x = r();
      paths.push(x < 0.5 ? "/api/image/" + encodeURIComponent(pick(r, keys)) + (r() < 0.5 ? "?size=" + pick(r, [200, 300, 600, 1200]) : "")
        : x < 0.9 ? "/stream/t" + Math.floor(r() * 1e5) + pick(r, ["", ".orig", ".96000-24", ".44100-16"]) + pick(r, [".flac", ".mp3", ".dsf"]) + pick(r, ["", "?g=-3.5", "?o=UPNP_x&g=2", "?m=audio%2Fdsf"])
          : pick(r, ["http://192.168.1.2:4400/stream/t1.flac", "https://h/api/image/x?size=600", "x://", "http://host", "http://h/p?a=1?b=2", "", "?", "/", "http://h/a%20b", "ftp://h/a/b?c"]));
    }
    const urls = paths.concat(["/api/image/al-1-0?size=200", "/api/image/" + "k" + "?size=300", "/stream/t1.orig.flac"]);
    // The addresses signed by the C# server (held to the Node server's), then every way of getting one wrong.
    const signed = csharp({ fn: "sign", secret, urls }).urls;
    held("sign.urls", urls, signed, si);
    const targets = [];
    for (const s of signed) {
      const at = s.indexOf("/", s.indexOf("://") >= 0 ? s.indexOf("://") + 3 : 0);
      const rel = at >= 0 ? s.slice(at) : s;
      if (!/^\/(stream|api\/image)\//.test(rel)) continue;
      const sig = rel.split("s=").pop();
      const base = rel.slice(0, rel.lastIndexOf("s=") - 1);
      const q = base.includes("?") ? "&" : "?";
      targets.push(rel, base + q + "s=" + sig.slice(1) + "A", base + q + "S=" + sig, base + q + "s[]=" + sig, base + q + "s[0]=" + sig, base + q + "[s]=" + sig,
        base + q + "s=" + sig + "&s=" + sig, base + q + "%73=" + sig, base + q + "s=" + sig.replace(/[A-Za-z]/, c => "%" + c.charCodeAt(0).toString(16)),
        base + q + "s=" + sig + "%", base + q + "s=+" + sig, base + q + "s=" + sig + "#x", "/api/image/a b" + q + "s=" + sig, base + q + "s=" + "A".repeat(22),
        base + q + "s=" + encodeURIComponent("é".repeat(22)), base + q + "s=" + sig + "&s", base + q + "s", base + q + "s=" + sig + "&x[s]=1",
        base + q + "s=" + sig.toLowerCase(), base.toUpperCase() + q + "s=" + sig, base + q + "a]=b&s=" + sig, base + q + "s%5B%5D=" + sig);
    }
    const job = { fn: "sign", secret, sigs: urls.map(u => u.split("?")[0]), urls, valid: [], targets, queries: [], decode: [] };
    for (const s of signed) { const sig = s.split("s=").pop(); const p = s.slice(s.indexOf("/", s.indexOf("://") >= 0 ? s.indexOf("://") + 3 : 0)).split("?")[0]; job.valid.push([p, sig], [p + "x", sig], [p, sig.slice(1)], [p, sig + "=" ]); }
    job.queries = targets.map(t => (t.split("?")[1] || "").split("#")[0]);
    job.decode = ["%41", "%e2%9c%93", "%E2%9C", "%", "%zz", "a+b", "%C0%AF", "%ED%A0%80", "%F4%90%80%80", "%F0%9F%98%80", "%2F%3F%23", "plain", "%c3%a9t%c3%a9", "%FF"];
    const got = csharp(job);
    const crypto = require("crypto");
    const sig = p => crypto.createHmac("sha256", secret).update(p).digest("base64url").slice(0, 22);
    same("sign.sigs", job.sigs, got.sigs, job.sigs.map(sig), si);
    same("sign.urls", job.urls, got.urls, signed, si);
    same("sign.valid", job.valid, got.valid, job.valid.map(([p, s]) => /^[A-Za-z0-9_-]{22}$/.test(s) && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(sig(p)))), si);
    // The C# server says yes or no only where it can say it as the Node server did (the recording keeps where).
    for (const v of got.targets) if (v === null) declined++; else vouched++;
    held("sign.targets", targets, got.targets, si);
    held("sign.queries", job.queries, got.queries, si);
    same("sign.decode", job.decode, got.decode, job.decode.map(s => { try { return decodeURIComponent(s); } catch (e) { return null; } }), si);
  }
  assert.ok(vouched > declined, `the C# server decides most addresses itself (${vouched} decided, ${declined} left to the Node server)`);
});

// ------------------------------------------------------------------ the radio's memory

const ALBUM_NAMES = ["Kid A", "Abbey Road", "ABBEY ROAD", "÷", "+", "テスト", "Blue", "Hounds of Love", "  ", "", "Björk", "The The", "Ünïcode 😀", "1999", "Σίσυφος"];
const ARTISTS = ["Radiohead", "The Beatles", "Beatles", "Ed Sheeran", "Someone", "Joni Mitchell", "Kate Bush", "", "  ", "The", "the the", "Prince", "Ünïcode 😀", "÷"];

function radioJob(r, n) {
  const albums = () => Array.from({ length: Math.floor(r() * 6) }, (_, i) => ({ id: i + 1, title: pick(r, ALBUM_NAMES), artist: pick(r, ARTISTS), key: pick(r, ["A0", "A1", "A2", "5", "10", "", undefined]) }));
  const keys = ["A0", "A1", "A2", "A3", "5", "10", "", "kid a|radiohead", "abbey road|beatles"];
  const job = { fn: "radio", keys: [], runs: [] };
  for (let i = 0; i < n; i++) {
    job.keys.push(r() < 0.9 ? { title: pick(r, ALBUM_NAMES.concat([1999, 0, null])), artist: pick(r, ARTISTS.concat([null, 7])) } : pick(r, [null, undefined, {}, "Kid A", 5]));
    const start = 1e12 + Math.floor(r() * 1e10);
    const ops = [];
    for (let k = 0; k < 25; k++) {
      const x = r();
      if (x < 0.25) ops.push({ op: "tick", ms: pick(r, [1, DAY, 30 * DAY, 170 * DAY, SIX_MONTHS_MS, SIX_MONTHS_MS + 1, 0.5]) });
      else if (x < 0.5) ops.push({ op: "note", key: pick(r, keys) });
      else if (x < 0.65) ops.push({ op: "at", key: pick(r, keys) });
      else if (x < 0.7) ops.push({ op: "size" });
      else ops.push({ op: "pick", pool: albums(), by: r() < 0.5 ? "radio" : "key", heard: r() < 0.5 ? null : some(r, [1, 2, 3, 4, 5, 6]), rnd: [r(), r(), r()] });
    }
    job.runs.push({ start, ops, window: pick(r, [undefined, undefined, 0, 7 * DAY, "86400000", 1000, null]),
      saved: r() < 0.4 ? null : pick(r, [{ A0: start - 10 * DAY, A1: start - 200 * DAY, 5: start - DAY, "": start, bad: "x", A2: "1000000000000" },
        [start, start - DAY], "nope", { A3: null, A0: true }, { 10: start, 5: start - 1, A1: start - 2 }]) });
  }
  return job;
}

test("the radio's six-month memory: the repo's own sequences, then generated ones", { skip }, () => {
  const job = radioJob(rng(183), 0);
  const pool3 = [{ id: 1, key: "A0" }, { id: 2, key: "A1" }, { id: 3, key: "A2" }];
  const start = 1e12;
  job.runs.push(
    { start, ops: [{ op: "note", key: "A0" }, { op: "note", key: "A1" }, { op: "pick", pool: pool3, by: "key", heard: null, rnd: [0.3, 0.9] }] },
    { start, ops: [{ op: "note", key: "A0" }, { op: "tick", ms: 170 * DAY }, { op: "at", key: "A0" }, { op: "tick", ms: SIX_MONTHS_MS - 170 * DAY + 1 }, { op: "at", key: "A0" }] },
    { start, ops: [{ op: "pick", pool: pool3, by: "key", heard: [1, 3], rnd: [0.99] }, { op: "pick", pool: pool3, by: "key", heard: [1, 2, 3], rnd: [0.5] }] },
    { start, ops: [{ op: "note", key: "A1" }, { op: "tick", ms: DAY }, { op: "note", key: "A0" }, { op: "tick", ms: DAY }, { op: "note", key: "A2" }, { op: "pick", pool: pool3, by: "key", heard: null, rnd: [0.1] }] },
    { start: start + DAY, saved: { A0: start }, ops: [{ op: "at", key: "A0" }, { op: "pick", pool: pool3.slice(0, 2), by: "key", heard: null, rnd: [0.2] }] },
    { start: start + SIX_MONTHS_MS + DAY, saved: { A0: start }, ops: [{ op: "size" }] },
    { start, ops: [{ op: "pick", pool: [], by: "key", heard: null, rnd: [0.5] }] });
  job.keys.push({ title: "÷", artist: "Ed Sheeran" }, { title: "+", artist: "Ed Sheeran" }, { title: "テスト", artist: "Someone" }, { title: "Kid A", artist: "Radiohead" },
    { title: "Abbey Road", artist: "The Beatles" }, { title: "ABBEY ROAD", artist: "Beatles" });
  const all = [job].concat([31, 32, 33].map(s => radioJob(rng(s), 400)));
  for (const [i, j] of all.entries()) {
    const got = csharp(j);
    held("radio.keys", j.keys, got.keys, i === 0 ? 183 : 30 + i);
    held("radio.runs", j.runs, got.runs, i === 0 ? 183 : 30 + i);
  }
});

test("how many cases were compared", { skip }, () => {
  assert.ok(compared > 10000, `${compared} cases compared`);
  console.log(`# streams-csharp: ${compared} cases compared, Node and C#`);
});
