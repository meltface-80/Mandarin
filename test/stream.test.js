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
  // The 64-bit float pipeline, and its own cache key. SoX's resampler where
  // ffmpeg has it (lib/ffmpeg.js), swr where it hasn't (Homebrew's, on a Mac):
  // both, whichever this machine's ffmpeg is.
  const FF = require("../lib/ffmpeg");
  const withSoxr = (soxr, fn) => {
    const real = FF.info;
    FF.info = () => Object.assign({}, real(), { soxr });
    try { return fn(); } finally { FF.info = real; }
  };
  const x4 = () => S.ffmpegArgs("/m/a.flac", S.plan(cd, Object.assign({ mode: "x4" }, wiim)), "/out.flac").join(" ");
  const sonos = () => S.ffmpegArgs("/m/a.flac", S.plan(hi), "/out.flac").join(" ");
  assert.match(withSoxr(true, x4), / -af aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=176400:dither_method=triangular /);
  assert.match(withSoxr(false, x4), / -af aresample=internal_sample_fmt=dblp:osr=176400:dither_method=triangular /);
  assert.match(withSoxr(true, sonos), / -af aresample=resampler=soxr:precision=28:osr=48000:/, "the Sonos conversion is as it was");
  assert.match(withSoxr(false, sonos), / -af aresample=osr=48000:/, "the Sonos conversion is as it was");
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

/*
 * A repack is sample for sample (v0.7.6). A WAV a device won't take goes as
 * FLAC at its own rate and depth, and the samples must come out exactly as
 * they went in: dither at the 32-bit output, cut to 24 bits by the encoder,
 * took one 24-bit LSB off an eighth of the samples. Found by a bit-for-bit
 * capture of the server's own output against Roon's.
 */
test("a container-only conversion is marked exact and gets no dither; a gain or a resample is not", () => {
  const S = require("../lib/stream");
  const wav = { path: "/m/a.wav", codec: "pcm_s24le", sampleRate: 96000, bitsPerSample: 24, channels: 2 };
  const dac = { name: "DAC", rates: [44100, 48000, 96000], maxBits: 24, containers: ["flac"] };
  const p = S.plan(wav, dac);
  assert.equal(p.transcode, true); assert.equal(p.rate, 96000); assert.equal(p.bits, 24);
  assert.equal(p.exact, true, "a WAV repacked at its own rate and depth");
  assert.match(S.ffmpegArgs("/m/a.wav", p, "/t/x.flac").join(" "), /dither_method=0/);
  // 16-bit too, where the output stays 16.
  const cd = S.plan({ path: "/m/b.wav", codec: "pcm_s16le", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, dac);
  assert.equal(cd.bits, 16); assert.equal(cd.exact, true);
  // Sonos: a 24-bit WAV is repacked exactly too (WAV above 16 bits is not sent as it is).
  const sonos = S.plan({ path: "/m/c.wav", codec: "PCM", sampleRate: 44100, bitsPerSample: 24, channels: 2 });
  if (sonos.transcode) assert.equal(sonos.exact, true);
  // Not exact: a gain, a resample, DSP, a lossy source, more than two channels.
  assert.equal(S.withGain(p, wav, dac, -3).exact, undefined, "a gain changes the samples");
  assert.equal(S.plan(wav, { name: "DAC", rates: [44100, 48000], maxBits: 24, containers: ["flac"] }).exact, undefined, "resampled to 48 kHz");
  assert.equal(S.plan({ path: "/m/a.ape", codec: "Monkey's Audio", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, dac).exact, true, "a lossless codec decodes to integers: exact");
  assert.equal(S.plan({ path: "/m/a.mp3", codec: "mp3", sampleRate: 44100, bitsPerSample: 0, channels: 2 }, { name: "DAC", rates: [44100], maxBits: 24, containers: ["flac"] }).exact, undefined, "a lossy source decodes to float: dithered");
});

test("the repack really is bit for bit: a 24/96 WAV through the conversion comes back sample for sample", { skip: !require("./fixtures").haveFfmpeg() && "ffmpeg is not installed" }, () => {
  const S = require("../lib/stream");
  const fs = require("fs"), os = require("os"), path = require("path");
  const { execFileSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-exact-"));
  const wav = path.join(dir, "ref.wav"), flac = path.join(dir, "out.flac");
  // A tone, pink noise and silence, as a test file would be; 24-bit, 96 kHz.
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1:sample_rate=96000",
    "-f", "lavfi", "-i", "anoisesrc=d=1:c=pink:r=96000:a=0.3", "-filter_complex", "[0][1]concat=n=2:v=0:a=1,adelay=200|200,apad=pad_dur=0.2,volume=0.5,aformat=channel_layouts=stereo",
    "-ar", "96000", "-c:a", "pcm_s24le", wav]);
  const t = { path: wav, codec: "pcm_s24le", sampleRate: 96000, bitsPerSample: 24, channels: 2 };
  const p = S.plan(t, { name: "DAC", rates: [44100, 48000, 96000], maxBits: 24, containers: ["flac"] });
  assert.equal(p.exact, true);
  execFileSync("ffmpeg", S.ffmpegArgs(wav, p, flac), { stdio: ["ignore", "ignore", "pipe"] });
  // Decoded the way the local output decodes (32-bit PCM), both of them.
  const pcm = f => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", f, "-map", "0:a:0", "-vn", "-ac", "2", "-c:a", "pcm_s32le", "-f", "s32le", "pipe:1"], { maxBuffer: 64 << 20 });
  const a = pcm(wav), b = pcm(flac);
  assert.equal(b.length, a.length, "the same number of samples");
  assert.ok(a.equals(b), "every sample identical");
  let low = 0; for (let i = 0; i < b.length; i += 4) if (b[i] !== 0) low++;
  assert.equal(low, 0, "24-bit samples in a 32-bit container: the low byte is zero");
  fs.rmSync(dir, { recursive: true, force: true });
});
