"use strict";
const { test: utest } = require("node:test");
utest("a renderer's plan: Original within its ceiling, upsampling in the file's family", () => {
  const assert = require("node:assert");
  const S = require("../lib/stream");
  const wiim = { name: "WiiM", rates: [44100, 48000, 88200, 96000, 176400, 192000], maxBits: 24, containers: ["flac", "wav"] };
  const cd = { path: "/m/a.flac", codec: "FLAC", sampleRate: 44100, bitsPerSample: 16, channels: 2 };
  const hi = Object.assign({}, cd, { sampleRate: 96000, bitsPerSample: 24 });
  assert.equal(S.plan(cd, wiim).transcode, false);
  assert.equal(S.plan(hi, wiim).transcode, false);
  assert.deepEqual(pick(S.plan(Object.assign({}, cd, { sampleRate: 352800 }), wiim)), [176400, 24, undefined]);
  assert.deepEqual(pick(S.plan(hi, { rates: [44100, 48000], containers: ["flac"] })), [48000, 24, undefined]);
  assert.deepEqual(pick(S.plan(cd, Object.assign({ mode: "x2" }, wiim))), [88200, 24, 2]);
  assert.deepEqual(pick(S.plan(cd, Object.assign({ mode: "x4" }, wiim))), [176400, 24, 4]);
  assert.deepEqual(pick(S.plan(cd, Object.assign({ mode: "max" }, wiim))), [176400, 24, 4]);
  assert.deepEqual(pick(S.plan(hi, Object.assign({ mode: "x4" }, wiim))), [192000, 24, 2], "capped at the top of the 48 k family");
  assert.equal(S.plan(Object.assign({}, hi, { sampleRate: 192000 }), Object.assign({ mode: "max" }, wiim)).transcode, false, "already at the top: as it is");
  const poly = { name: "Poly", rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000], maxBits: 32, containers: ["flac"] };
  assert.deepEqual(pick(S.plan(cd, Object.assign({ mode: "max", bits: "auto" }, poly))), [705600, 32, 16]);
  assert.deepEqual(pick(S.plan(cd, Object.assign({ mode: "max", bits: 24 }, poly))), [705600, 24, 16]);
  assert.deepEqual(pick(S.plan(Object.assign({}, cd, { sampleRate: 48000 }), Object.assign({ mode: "max" }, poly))), [768000, 32, 16]);
  // A lossy file follows the same rules; DSD is PCM at the top of the 44.1 ladder ≤ 176.4.
  assert.deepEqual(pick(S.plan({ path: "/m/a.mp3", codec: "MPEG 1 Layer 3", sampleRate: 44100 }, Object.assign({ mode: "x2" }, wiim))), [88200, 24, 2]);
  assert.deepEqual(pick(S.plan({ path: "/m/a.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 }, Object.assign({ mode: "max" }, wiim))), [176400, 24, undefined]);
  // Native DSD (Stage 9.3): a device that takes DSD64 gets the DSF as it is; DSD128 beyond it is PCM as before.
  const dsdDac = Object.assign({ dsd: [64] }, wiim);
  const d64 = S.plan({ path: "/m/a.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 }, dsdDac);
  assert.deepEqual([d64.transcode, d64.mime, d64.ext, d64.dsd], [false, "audio/x-dsf", "dsf", 64]);
  assert.equal(S.plan({ path: "/m/a.dff", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 }, dsdDac).mime, "audio/x-dff");
  // A renderer that names its own DSD type is told the file in those words (v0.6.0-RC3).
  const named = Object.assign({ dsdMimes: { dsf: "audio/dsf", dff: null } }, dsdDac);
  assert.equal(S.plan({ path: "/m/a.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 }, named).mime, "audio/dsf");
  assert.equal(S.plan({ path: "/m/a.dff", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 }, named).mime, "audio/x-dff");
  assert.deepEqual(pick(S.plan({ path: "/m/a.dsf", codec: "DSD", sampleRate: 5644800, bitsPerSample: 1 }, dsdDac)), [176400, 24, undefined]);
  // The 64-bit float pipeline, and its own cache key.
  const args = S.ffmpegArgs("/m/a.flac", S.plan(cd, Object.assign({ mode: "x4" }, wiim)), "/out.flac").join(" ");
  assert.match(args, /precision=33:internal_sample_fmt=dblp:osr=176400:dither_method=triangular/);
  assert.match(S.ffmpegArgs("/m/a.flac", S.plan(hi), "/out.flac").join(" "), /precision=28:osr=48000/, "the Sonos conversion is as it was");
  const tr = new S.Transcoder({ cacheDir: require("os").tmpdir() + "/musicd-keys-" + process.pid, log: () => {} });
  assert.notEqual(tr.keyFor({ id: 1, mtime: 5 }, S.plan(hi)), tr.keyFor({ id: 1, mtime: 5 }, S.plan(hi, { rates: [44100, 48000], containers: ["flac"] })));
  function pick(p) { return [p.rate, p.bits, p.upsampled]; }
});
const test = require("node:test");
const assert = require("node:assert");
const { plan } = require("../lib/stream");

test("a CD-quality FLAC goes to Sonos untouched", () => {
  const p = plan({ path: "/m/a.flac", codec: "FLAC", sampleRate: 44100, bitsPerSample: 16, channels: 2 });
  assert.equal(p.transcode, false);
  assert.equal(p.mime, "audio/flac");
});

test("24/48 is the ceiling, and is still bit-perfect", () => {
  const p = plan({ path: "/m/a.flac", codec: "FLAC", sampleRate: 48000, bitsPerSample: 24, channels: 2 });
  assert.equal(p.transcode, false);
});

test("anything above 24/48 is brought down to 24/48 FLAC", () => {
  for (const rate of [88200, 96000, 176400, 192000, 352800]) {
    const p = plan({ path: "/m/a.flac", codec: "FLAC", sampleRate: rate, bitsPerSample: 24, channels: 2 });
    assert.equal(p.transcode, true, String(rate));
    assert.equal(p.rate, 48000);
    assert.equal(p.bits, 24);
    assert.equal(p.mime, "audio/flac");
  }
});

test("32-bit at 48k is brought to 24-bit, rate kept", () => {
  const p = plan({ path: "/m/a.wav", codec: "PCM", sampleRate: 48000, bitsPerSample: 32, channels: 2 });
  assert.equal(p.transcode, true);
  assert.equal(p.rate, 48000);
  assert.equal(p.bits, 24);
});

test("hi-res ALAC is resampled too", () => {
  const p = plan({ path: "/m/a.m4a", codec: "ALAC", sampleRate: 96000, bitsPerSample: 24, channels: 2 });
  assert.equal(p.transcode, true);
  assert.equal(p.rate, 48000);
});

test("DSD becomes 24/48 FLAC", () => {
  const p = plan({ path: "/m/a.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1, channels: 2 });
  assert.equal(p.transcode, true);
  assert.equal(p.rate, 48000);
  assert.equal(p.bits, 24);
});

test("lossy formats Sonos reads pass straight through", () => {
  assert.equal(plan({ path: "/m/a.mp3", codec: "MPEG 1 Layer 3", sampleRate: 44100, channels: 2 }).transcode, false);
  assert.equal(plan({ path: "/m/a.m4a", codec: "AAC", sampleRate: 44100, channels: 2 }).mime, "audio/mp4");
  assert.equal(plan({ path: "/m/a.ogg", codec: "Vorbis", sampleRate: 44100, channels: 2 }).mime, "audio/ogg");
});

test("formats Sonos cannot read become FLAC at their own rate when within the ceiling", () => {
  const p = plan({ path: "/m/a.ape", codec: "Monkey's Audio", sampleRate: 44100, bitsPerSample: 16, channels: 2 });
  assert.equal(p.transcode, true);
  assert.equal(p.rate, 44100);
  assert.equal(p.bits, 16);
});

test("24-bit WAV is repacked as FLAC, same rate", () => {
  const p = plan({ path: "/m/a.wav", codec: "PCM", sampleRate: 44100, bitsPerSample: 24, channels: 2 });
  assert.equal(p.transcode, true);
  assert.equal(p.rate, 44100);
  assert.equal(p.bits, 24);
});
