"use strict";
/*
 * What a track is sent as: Sonos's 24/48 ceiling, a renderer's plan within
 * its own, native DSD, the 64-bit float pipeline and its cache key, and a
 * repack that is sample for sample.
 *
 * The C# server's (Playback/StreamPlans.cs; lib/stream.js until v0.8.50): asked
 * through `mandarin-server score` { fn: "plans" }.
 */
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");
const { haveFfmpeg } = require("./fixtures");

const skip = built();
const plans = job => score(Object.assign({ fn: "plans" }, job));
/* plan(track, target): each [track, target?] → its plan; no target is Sonos. */
const plan = (...calls) => plans({ plan: calls }).plan;
const pick = p => [p.rate, p.bits, p.upsampled];

test("a renderer's plan: Original within its ceiling, upsampling in the file's family", { skip }, () => {
  const wiim = { name: "WiiM", rates: [44100, 48000, 88200, 96000, 176400, 192000], maxBits: 24, containers: ["flac", "wav"] };
  const poly = { name: "Poly", rates: [44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000, 705600, 768000], maxBits: 32, containers: ["flac"] };
  const cd = { path: "/m/a.flac", codec: "FLAC", sampleRate: 44100, bitsPerSample: 16, channels: 2 };
  const hi = Object.assign({}, cd, { sampleRate: 96000, bitsPerSample: 24 });
  const dsf = { path: "/m/a.dsf", codec: "DSD", sampleRate: 2822400, bitsPerSample: 1 };
  const dff = Object.assign({}, dsf, { path: "/m/a.dff" });
  // Native DSD (Stage 9.3): a device that takes DSD64 gets the DSF as it is; DSD128 beyond it is PCM as before.
  const dsdDac = Object.assign({ dsd: [64] }, wiim);
  // A renderer that names its own DSD type is told the file in those words (v0.6.0-RC3).
  const named = Object.assign({ dsdMimes: { dsf: "audio/dsf", dff: null } }, dsdDac);
  const mode = (m, target, more) => Object.assign({ mode: m }, more, target);
  const p = plan([cd, wiim], [hi, wiim], [Object.assign({}, cd, { sampleRate: 352800 }), wiim], [hi, { rates: [44100, 48000], containers: ["flac"] }],
    [cd, mode("x2", wiim)], [cd, mode("x4", wiim)], [cd, mode("max", wiim)], [hi, mode("x4", wiim)], [Object.assign({}, hi, { sampleRate: 192000 }), mode("max", wiim)],
    [cd, mode("max", poly, { bits: "auto" })], [cd, mode("max", poly, { bits: 24 })], [Object.assign({}, cd, { sampleRate: 48000 }), mode("max", poly)],
    // A lossy file follows the same rules; DSD is PCM at the top of the 44.1 ladder ≤ 176.4.
    [{ path: "/m/a.mp3", codec: "MPEG 1 Layer 3", sampleRate: 44100 }, mode("x2", wiim)], [dsf, mode("max", wiim)],
    [dsf, dsdDac], [dff, dsdDac], [dsf, named], [dff, named], [Object.assign({}, dsf, { sampleRate: 5644800 }), dsdDac],
    [hi], [hi, { rates: [44100, 48000], containers: ["flac"] }]);
  assert.equal(p[0].transcode, false);
  assert.equal(p[1].transcode, false);
  assert.deepEqual(pick(p[2]), [176400, 24, undefined]);
  assert.deepEqual(pick(p[3]), [48000, 24, undefined]);
  assert.deepEqual(pick(p[4]), [88200, 24, 2]);
  assert.deepEqual(pick(p[5]), [176400, 24, 4]);
  assert.deepEqual(pick(p[6]), [176400, 24, 4]);
  assert.deepEqual(pick(p[7]), [192000, 24, 2], "capped at the top of the 48 k family");
  assert.equal(p[8].transcode, false, "already at the top: as it is");
  assert.deepEqual(pick(p[9]), [705600, 32, 16]);
  assert.deepEqual(pick(p[10]), [705600, 24, 16]);
  assert.deepEqual(pick(p[11]), [768000, 32, 16]);
  assert.deepEqual(pick(p[12]), [88200, 24, 2]);
  assert.deepEqual(pick(p[13]), [176400, 24, undefined]);
  assert.deepEqual([p[14].transcode, p[14].mime, p[14].ext, p[14].dsd], [false, "audio/x-dsf", "dsf", 64]);
  assert.equal(p[15].mime, "audio/x-dff");
  assert.equal(p[16].mime, "audio/dsf");
  assert.equal(p[17].mime, "audio/x-dff");
  assert.deepEqual(pick(p[18]), [176400, 24, undefined]);
  // The 64-bit float pipeline, and its own cache key. SoX's resampler where
  // ffmpeg has it, swr where it hasn't (Homebrew's, on a Mac): both.
  const x4 = p[5], sonos = p[19];
  const [x4Soxr, x4Swr, sonosSoxr, sonosSwr] = plans({ args: [["/m/a.flac", x4, "/out.flac", true], ["/m/a.flac", x4, "/out.flac", false],
    ["/m/a.flac", sonos, "/out.flac", true], ["/m/a.flac", sonos, "/out.flac", false]] }).args.map(a => a.join(" "));
  assert.match(x4Soxr, / -af aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=176400:dither_method=triangular /);
  assert.match(x4Swr, / -af aresample=internal_sample_fmt=dblp:osr=176400:dither_method=triangular /);
  assert.match(sonosSoxr, / -af aresample=resampler=soxr:precision=28:osr=48000:/, "the Sonos conversion is as it was");
  assert.match(sonosSwr, / -af aresample=osr=48000:/, "the Sonos conversion is as it was");
  const [k1, k2] = plans({ keys: [[{ id: 1, mtime: 5 }, sonos], [{ id: 1, mtime: 5 }, p[20]]] }).keys;
  assert.notEqual(k1, k2);
});

test("Sonos: 24/48 is the ceiling; what it can't read becomes FLAC; what it reads goes untouched", { skip }, () => {
  const t = (path, codec, sampleRate, bitsPerSample) => [{ path, codec, sampleRate, bitsPerSample, channels: 2 }];
  const above = [88200, 96000, 176400, 192000, 352800];
  const p = plan(t("/m/a.flac", "FLAC", 44100, 16), t("/m/a.flac", "FLAC", 48000, 24), ...above.map(rate => t("/m/a.flac", "FLAC", rate, 24)),
    t("/m/a.wav", "PCM", 48000, 32), t("/m/a.m4a", "ALAC", 96000, 24), t("/m/a.dsf", "DSD", 2822400, 1),
    t("/m/a.mp3", "MPEG 1 Layer 3", 44100), t("/m/a.m4a", "AAC", 44100), t("/m/a.ogg", "Vorbis", 44100),
    t("/m/a.ape", "Monkey's Audio", 44100, 16), t("/m/a.wav", "PCM", 44100, 24));
  // A CD-quality FLAC goes untouched; 24/48 too, still bit-perfect.
  assert.deepEqual([p[0].transcode, p[0].mime], [false, "audio/flac"]);
  assert.equal(p[1].transcode, false);
  // Anything above 24/48 is brought down to 24/48 FLAC.
  above.forEach((rate, i) => assert.deepEqual([p[2 + i].transcode, p[2 + i].rate, p[2 + i].bits, p[2 + i].mime], [true, 48000, 24, "audio/flac"], String(rate)));
  // 32-bit at 48k to 24-bit, the rate kept; hi-res ALAC resampled too; DSD to 24/48 FLAC.
  assert.deepEqual([p[7].transcode, p[7].rate, p[7].bits], [true, 48000, 24]);
  assert.deepEqual([p[8].transcode, p[8].rate], [true, 48000]);
  assert.deepEqual([p[9].transcode, p[9].rate, p[9].bits], [true, 48000, 24]);
  // Lossy formats Sonos reads pass straight through.
  assert.equal(p[10].transcode, false);
  assert.equal(p[11].mime, "audio/mp4");
  assert.equal(p[12].mime, "audio/ogg");
  // Formats Sonos cannot read become FLAC at their own rate when within the ceiling; a 24-bit WAV is repacked as FLAC.
  assert.deepEqual([p[13].transcode, p[13].rate, p[13].bits], [true, 44100, 16]);
  assert.deepEqual([p[14].transcode, p[14].rate, p[14].bits], [true, 44100, 24]);
});

/*
 * A repack is sample for sample (v0.7.6). A WAV a device won't take goes as
 * FLAC at its own rate and depth, and the samples must come out exactly as
 * they went in: dither at the 32-bit output, cut to 24 bits by the encoder,
 * took one 24-bit LSB off an eighth of the samples. Found by a bit-for-bit
 * capture of the server's own output against Roon's.
 */
const DAC = { name: "DAC", rates: [44100, 48000, 96000], maxBits: 24, containers: ["flac"] };

test("a container-only conversion is marked exact and gets no dither; a gain or a resample is not", { skip }, () => {
  const wav = { path: "/m/a.wav", codec: "pcm_s24le", sampleRate: 96000, bitsPerSample: 24, channels: 2 };
  const [p, cd, sonos, resampled, ape, mp3] = plan([wav, DAC], [{ path: "/m/b.wav", codec: "pcm_s16le", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, DAC],
    [{ path: "/m/c.wav", codec: "PCM", sampleRate: 44100, bitsPerSample: 24, channels: 2 }], [wav, { name: "DAC", rates: [44100, 48000], maxBits: 24, containers: ["flac"] }],
    [{ path: "/m/a.ape", codec: "Monkey's Audio", sampleRate: 44100, bitsPerSample: 16, channels: 2 }, DAC],
    [{ path: "/m/a.mp3", codec: "mp3", sampleRate: 44100, bitsPerSample: 0, channels: 2 }, { name: "DAC", rates: [44100], maxBits: 24, containers: ["flac"] }]);
  assert.equal(p.transcode, true); assert.equal(p.rate, 96000); assert.equal(p.bits, 24);
  assert.equal(p.exact, true, "a WAV repacked at its own rate and depth");
  const { args, with_gain: [gained] } = plans({ args: [["/m/a.wav", p, "/t/x.flac", true]], with_gain: [[p, wav, DAC, -3]] });
  assert.match(args[0].join(" "), /dither_method=0/);
  // 16-bit too, where the output stays 16.
  assert.equal(cd.bits, 16); assert.equal(cd.exact, true);
  // Sonos: a 24-bit WAV is repacked exactly too (WAV above 16 bits is not sent as it is).
  assert.equal(sonos.transcode, true);
  assert.equal(sonos.exact, true);
  // Not exact: a gain, a resample, a lossy source.
  assert.equal(gained.exact, undefined, "a gain changes the samples");
  assert.equal(resampled.exact, undefined, "resampled to 48 kHz");
  assert.equal(ape.exact, true, "a lossless codec decodes to integers: exact");
  assert.equal(mp3.exact, undefined, "a lossy source decodes to float: dithered");
});

test("the repack really is bit for bit: a 24/96 WAV through the conversion comes back sample for sample", { skip: skip || (!haveFfmpeg() && "ffmpeg is not installed") }, () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const { execFileSync } = require("child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-exact-"));
  const wav = path.join(dir, "ref.wav"), flac = path.join(dir, "out.flac");
  // A tone, pink noise and silence, as a test file would be; 24-bit, 96 kHz.
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=1:sample_rate=96000",
    "-f", "lavfi", "-i", "anoisesrc=d=1:c=pink:r=96000:a=0.3", "-filter_complex", "[0][1]concat=n=2:v=0:a=1,adelay=200|200,apad=pad_dur=0.2,volume=0.5,aformat=channel_layouts=stereo",
    "-ar", "96000", "-c:a", "pcm_s24le", wav]);
  const [p] = plan([{ path: wav, codec: "pcm_s24le", sampleRate: 96000, bitsPerSample: 24, channels: 2 }, DAC]);
  assert.equal(p.exact, true);
  const soxr = /--enable-libsoxr/.test(execFileSync("ffmpeg", ["-hide_banner", "-version"]).toString());
  execFileSync("ffmpeg", plans({ args: [[wav, p, flac, soxr]] }).args[0], { stdio: ["ignore", "ignore", "pipe"] });
  // Decoded the way the local output decodes (32-bit PCM), both of them.
  const pcm = f => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", f, "-map", "0:a:0", "-vn", "-ac", "2", "-c:a", "pcm_s32le", "-f", "s32le", "pipe:1"], { maxBuffer: 64 << 20 });
  const a = pcm(wav), b = pcm(flac);
  assert.equal(b.length, a.length, "the same number of samples");
  assert.ok(a.equals(b), "every sample identical");
  let low = 0; for (let i = 0; i < b.length; i += 4) if (b[i] !== 0) low++;
  assert.equal(low, 0, "24-bit samples in a 32-bit container: the low byte is zero");
  fs.rmSync(dir, { recursive: true, force: true });
});
