"use strict";
/*
 * DSP (Stage 3): the shared biquad maths, the headroom rule, what a setting
 * becomes as ffmpeg filters and in a renderer's plan — and, with ffmpeg, a
 * tone through the chain measured: a −6 dB band at its frequency takes
 * 6 dB off, and the preamp is what the bands need.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Biquad = require("../public/biquad");
const DSP = require("../lib/dsp");
const STREAM = require("../lib/stream");
const { haveFfmpeg, gen, FFMPEG } = require("./fixtures");

const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const at = (bands, f, fs = 48000) => Biquad.response(bands, fs, [f])[0];

test("the bands: the cookbook's responses", () => {
  const peak = [{ type: "peak", freq: 1000, gain: 6, q: 1.41 }];
  near(at(peak, 1000), 6, 0.01, "a +6 dB peak at its centre");
  near(at(peak, 100), 0, 0.1, "and nothing three octaves down");
  const cut = [{ type: "peak", freq: 1000, gain: -6, q: 1.41 }];
  near(at(cut, 1000), -6, 0.01, "a −6 dB cut at its centre");
  const ls = [{ type: "low_shelf", freq: 1000, gain: 4, q: 0.707 }];
  near(at(ls, 30), 4, 0.05, "a low shelf's full lift well below its corner");
  near(at(ls, 15000), 0, 0.05, "and none well above");
  const hs = [{ type: "high_shelf", freq: 2000, gain: -3, q: 0.707 }];
  near(at(hs, 18000), -3, 0.1, "a high shelf's cut at the top");
  near(at(hs, 100), 0, 0.05, "and none at the bottom");
  const hp = [{ type: "high_pass", freq: 80, q: 0.707 }];
  near(at(hp, 80), -3.01, 0.05, "a Butterworth high-pass is −3 dB at its corner");
  assert.ok(at(hp, 20) < -20, "and well down an octave and more below");
  const lp = [{ type: "low_pass", freq: 8000, q: 0.707 }];
  near(at(lp, 8000), -3.01, 0.05, "a low-pass likewise");
  assert.ok(at(lp, 20000) < -12, "and down above");
  // The same at 96 kHz: the design is per sample rate.
  near(at(peak, 1000, 96000), 6, 0.01, "at 96 kHz too");
});

test("headroom: the combined peak, not the largest band", () => {
  const one = { enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: 6, q: 1.41 }] }, headroom: "auto" };
  assert.equal(Biquad.headroom(one, 48000), -6.5);
  // Two +3 dB bands an octave apart, wide: together they reach past either.
  const two = { enabled: true, peq: { bands: [{ type: "peak", freq: 800, gain: 3, q: 0.5 }, { type: "peak", freq: 1200, gain: 3, q: 0.5 }] }, headroom: "auto" };
  const peak = Biquad.peakDb(Biquad.bandsOf(two), 48000);
  assert.ok(peak > 5 && peak < 6, "overlapping bands add: " + peak);
  assert.ok(Biquad.headroom(two, 48000) <= -(peak + 0.5) + 0.05);
  // Only cuts: nothing to take away.
  const cuts = { enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: -6, q: 1.41 }] }, headroom: "auto" };
  assert.equal(Biquad.headroom(cuts, 48000), -0.5);
  // A profile's own preamp stands when it covers the peak, else the measured one.
  const hp = { enabled: true, headphone: { name: "x", preamp: -8, bands: [{ type: "peak", freq: 1000, gain: 6, q: 1.41 }] }, headroom: "auto" };
  assert.equal(Biquad.headroom(hp, 48000), -8);
  hp.headphone.preamp = -3;
  assert.equal(Biquad.headroom(hp, 48000), -6.5);
  // Set by hand: as it is.
  assert.equal(Biquad.headroom(Object.assign({}, one, { headroom: -2 }), 48000), -2);
  // Headphone bands then PEQ bands, in that order.
  const both = { enabled: true, headphone: { bands: [{ type: "peak", freq: 100, gain: 1, q: 1 }] }, peq: { bands: [{ type: "peak", freq: 200, gain: 2, q: 1 }] } };
  assert.deepEqual(Biquad.bandsOf(both).map(b => b.freq), [100, 200]);
});

test("a setting as stored: checked, rounded, refused when wrong", () => {
  const d = Biquad.normalise({ enabled: "yes", peq: { bands: [{ type: "peak", freq: "1000.04", gain: 2.26, q: "1.4142" }, { type: "low_pass", freq: 120, gain: 5 }] }, headroom: -3.04 });
  assert.equal(d.enabled, true);
  assert.deepEqual(d.peq.bands[0], { type: "peak", freq: 1000, gain: 2.3, q: 1.414 });
  assert.deepEqual(d.peq.bands[1], { type: "low_pass", freq: 120, gain: 0, q: 0.707 }, "a pass filter has no gain");
  assert.equal(d.headroom, -3);
  assert.equal(d.headphone, null);
  assert.deepEqual(Biquad.normalise(null), { enabled: false, headphone: null, peq: null, headroom: "auto" });
  assert.throws(() => Biquad.normalise({ peq: { bands: [{ type: "notch", freq: 100 }] } }), /band type/);
  assert.throws(() => Biquad.normalise({ peq: { bands: [{ type: "peak", freq: 5, gain: 0 }] } }), /frequency/);
  assert.throws(() => Biquad.normalise({ peq: { bands: [{ type: "peak", freq: 100, gain: 30 }] } }), /gain/);
  assert.throws(() => Biquad.normalise({ peq: { bands: [{ type: "peak", freq: 100, gain: 0, q: 50 }] } }), /Q/);
  assert.throws(() => Biquad.normalise({ headroom: 3 }), /headroom/);
  assert.throws(() => Biquad.normalise({ peq: { bands: new Array(11).fill({ type: "peak", freq: 100, gain: 0 }) } }), /at most 10/);
  // On with no bands does nothing; the same bands fingerprint the same.
  assert.equal(Biquad.active({ enabled: true, peq: { bands: [] } }), false);
  assert.equal(Biquad.active(d), true);
  assert.equal(Biquad.fingerprint(d, 48000), Biquad.fingerprint(JSON.parse(JSON.stringify(d)), 48000));
  assert.notEqual(Biquad.fingerprint(d, 48000), Biquad.fingerprint(Object.assign({}, d, { headroom: -4 }), 48000));
});

test("the filters ffmpeg runs, and the plan a renderer gets", () => {
  const dsp = Biquad.normalise({ enabled: true, peq: { bands: [
    { type: "peak", freq: 1000, gain: -6, q: 1.41 }, { type: "low_shelf", freq: 100, gain: 2, q: 0.707 }, { type: "high_pass", freq: 30, q: 0.707 }
  ] } });
  const f = DSP.filters(dsp, { inRate: 44100, rate: 88200, soxr: true });
  assert.equal(f[0], "aformat=sample_fmts=dbl");
  const pre = Biquad.headroom(dsp, 88200);
  assert.ok(pre < -1 && pre > -3, "the shelf's lift, less what the high-pass takes: " + pre);
  assert.equal(f[1], `volume=${pre}dB:precision=double`);
  assert.equal(f[2], "aresample=resampler=soxr:precision=33:internal_sample_fmt=dblp:osr=88200:out_sample_fmt=dbl");
  assert.deepEqual(f.slice(3), ["equalizer=f=1000:width_type=q:w=1.41:g=-6", "lowshelf=f=100:width_type=q:w=0.707:g=2", "highpass=f=30:width_type=q:w=0.707"]);
  // Same rate: no resample stage.
  assert.equal(DSP.filters(dsp, { inRate: 44100, rate: 44100, soxr: true }).length, 5);

  const cd = { path: "/m/a.flac", codec: "flac", sampleRate: 44100, bitsPerSample: 16, channels: 2 };
  const target = { name: "WiiM", rates: [44100, 48000, 88200, 96000], maxBits: 24, containers: ["flac"], mode: "original", bits: "auto", id: "UPNP_x" };
  assert.equal(STREAM.plan(cd, target).transcode, false, "bit-perfect without DSP");
  const on = STREAM.plan(cd, Object.assign({}, target, { dsp }));
  assert.equal(on.transcode, true);
  assert.equal(on.rate, 44100, "the file's own rate");
  assert.equal(on.bits, 24);
  assert.equal(on.reason, "DSP");
  assert.equal(on.dsp.hash, Biquad.fingerprint(dsp, 44100));
  assert.equal(on.inRate, 44100);
  const up = STREAM.plan(cd, Object.assign({}, target, { dsp, mode: "x2" }));
  assert.equal(up.rate, 88200); assert.equal(up.upsampled, 2); assert.ok(up.dsp);
  // Off, or on with nothing to do: as without.
  assert.equal(STREAM.plan(cd, Object.assign({}, target, { dsp: Object.assign({}, dsp, { enabled: false }) })).transcode, false);
  assert.equal(STREAM.plan(cd, Object.assign({}, target, { dsp: { enabled: true, peq: { bands: [] } } })).transcode, false);
  // The graph: float, preamp, the bands, then the one dithered requantise.
  const args = STREAM.ffmpegArgs("in.flac", on, "out.flac");
  const graph = args[args.indexOf("-af") + 1];
  assert.match(graph, /^aformat=sample_fmts=dbl,volume=-[\d.]+dB:precision=double,equalizer=.*,aresample=osr=44100:dither_method=triangular$/);
  assert.equal(args[args.indexOf("-sample_fmt") + 1], "s32");
  assert.equal(args[args.indexOf("-bits_per_raw_sample") + 1], "24");
});

test("through ffmpeg: a tone at the band's frequency comes out 6 dB down, and the preamp is applied", { skip: !haveFfmpeg() && "ffmpeg is not installed" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-dsp-"));
  const src = path.join(dir, "tone.flac");
  gen(src, { seconds: 2, freq: 1000, rate: 44100, fmt: "s16" });
  const level = (file, filter) => {
    const r = spawnSync(FFMPEG, ["-hide_banner", "-i", file, "-af", (filter ? filter + "," : "") + "astats=measure_overall=RMS_level:measure_perchannel=none", "-f", "null", "-"], { encoding: "utf8" });
    const m = /RMS level dB:\s*(-?[\d.]+)/.exec(r.stderr);
    assert.ok(m, "astats: " + r.stderr.slice(-400));
    return Number(m[1]);
  };
  const before = level(src);
  // A −6 dB band on the tone: 6 dB off, and the preamp (no lift, so −0.5) too.
  const cut = { transcode: true, hq: true, rate: 44100, bits: 24, inRate: 44100,
    dsp: DSP.planPart(Biquad.normalise({ enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: -6, q: 1.41 }] } }), 44100) };
  const outCut = path.join(dir, "cut.flac");
  let r = spawnSync(FFMPEG, STREAM.ffmpegArgs(src, cut, outCut), { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  near(level(outCut), before - 6.5, 0.15, "−6 dB band and −0.5 dB headroom");
  const { probe } = require("./fixtures");
  assert.deepEqual(probe(fs.readFileSync(outCut)), { rate: 44100, channels: 2, bits: 24 });
  // A +6 dB band elsewhere: the tone is untouched by the band but the preamp
  // takes the 6.5 dB the band would add at its own frequency.
  const lift = { transcode: true, hq: true, rate: 44100, bits: 24, inRate: 44100,
    dsp: DSP.planPart(Biquad.normalise({ enabled: true, peq: { bands: [{ type: "peak", freq: 8000, gain: 6, q: 4 }] } }), 44100) };
  const outLift = path.join(dir, "lift.flac");
  r = spawnSync(FFMPEG, STREAM.ffmpegArgs(src, lift, outLift), { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  near(level(outLift), before - 6.5, 0.15, "the preamp alone");
  // Upsampled ×2 with DSP: 88.2 kHz out, the band still at work.
  const up = Object.assign({}, cut, { rate: 88200, upsampled: 2, dsp: DSP.planPart(cut.dsp.dsp, 88200) });
  const outUp = path.join(dir, "up.flac");
  r = spawnSync(FFMPEG, STREAM.ffmpegArgs(src, up, outUp), { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(probe(fs.readFileSync(outUp)), { rate: 88200, channels: 2, bits: 24 });
  near(level(outUp), before - 6.5, 0.2, "at 88.2 kHz too");
  fs.rmSync(dir, { recursive: true, force: true });
});
