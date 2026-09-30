"use strict";
/*
 * dsp.js — a zone's DSP setting turned into ffmpeg's filter graph.
 *
 * The maths (bands, response, headroom) is public/biquad.js, shared with
 * the page; this is the server's half: the filters ffmpeg runs, in the
 * owner's order —
 *
 *   decode → 64-bit float → headroom → [upsample] → DSP → dither → 24/32-bit
 *
 * Every stage is double precision: `aformat` pins the samples to 64-bit
 * float, the biquads then choose their double-precision form by themselves
 * (ffmpeg's auto precision follows the sample format), `volume` is told to,
 * and the resample is SoX at 33 bits. Dither is applied once, at the end,
 * by the final requantise.
 */
const Biquad = require("../public/biquad");

const FILTER = { peak: "equalizer", low_shelf: "lowshelf", high_shelf: "highshelf", low_pass: "lowpass", high_pass: "highpass" };

const num = v => (Math.round(v * 1000) / 1000).toString();

/* One band as an ffmpeg filter. Q is given as width_type=q; a pass filter
 * has no gain. */
function bandFilter(b) {
  const f = FILTER[b.type] || "equalizer";
  const parts = [`f=${num(b.freq)}`, "width_type=q", `w=${num(b.q)}`];
  if (b.type !== "low_pass" && b.type !== "high_pass") parts.push(`g=${num(b.gain)}`);
  return `${f}=${parts.join(":")}`;
}

/*
 * The filters after decoding, for a conversion to `rate` Hz (`inRate` is
 * the file's): [aformat, volume, (resample), bands…]. The final requantise
 * with dither is the caller's (lib/stream.js), so the chain is the same
 * whichever depth goes out.
 */
function filters(dsp, { inRate, rate, soxr }) {
  const out = ["aformat=sample_fmts=dbl"];
  const pre = Biquad.headroom(dsp, rate);
  if (pre < 0) out.push(`volume=${num(pre)}dB:precision=double`);
  if (rate && inRate && rate !== inRate) {
    out.push(`aresample=${soxr ? "resampler=soxr:precision=33:" : ""}internal_sample_fmt=dblp:osr=${rate}:out_sample_fmt=dbl`);
  }
  for (const b of Biquad.bandsOf(dsp)) out.push(bandFilter(b));
  return out;
}

/* What the plan carries for a conversion with DSP: enough to make the file
 * and to name it. */
function planPart(dsp, rate) {
  if (!Biquad.active(dsp)) return null;
  return { hash: Biquad.fingerprint(dsp, rate), headroom: Biquad.headroom(dsp, rate), bands: Biquad.bandsOf(dsp).length, dsp };
}

module.exports = { filters, bandFilter, planPart, Biquad };
