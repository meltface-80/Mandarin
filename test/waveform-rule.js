// @ts-check
"use strict";
/*
 * waveform-rule.js — what a track's waveform is, as the Node server drew it
 * (lib/waveform.js and lib/waveform-decode.js, kept here when it went in
 * v0.8.50 so the C# server's waveforms are still held to it): the first audio
 * stream decoded by ffmpeg to 16-bit stereo at 44.1 kHz, the level (RMS) of
 * every 10 ms, those levels brought to 4000 buckets (RMS of the levels in
 * each, or the nearest level when there are fewer), and scaled so the loudest
 * is 255. Nothing decoded, or less than 90% of the length the track is said
 * to have, is no waveform (null).
 */
const { spawnSync } = require("child_process");

const RATE = 44100, CHANNELS = 2, BUCKETS = 4000, STRIDE = RATE * CHANNELS * 10 / 1000, MIN_COVERAGE = 0.9;

/**
 * The waveform of a file, base64 of its 4000 bytes, or null.
 * @param {string} file
 * @param {number} [expectSeconds]  how long the track is said to be (0: no idea)
 */
function waveformOf(file, expectSeconds = 0) {
  const r = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", file, "-map", "0:a:0", "-f", "s16le", "-ac", String(CHANNELS), "-ar", String(RATE), "-"],
    { maxBuffer: 1024 * 1024 * 1024 });
  const pcm = r.stdout;
  if (!pcm || !pcm.length) return null;
  if (expectSeconds > 0 && pcm.length / (2 * CHANNELS * RATE) < expectSeconds * MIN_COVERAGE) return null;
  const levels = [];
  let sum = 0, n = 0;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const v = pcm.readInt16LE(i);
    sum += v * v;
    if (++n >= STRIDE) { levels.push(Math.sqrt(sum / n)); sum = 0; n = 0; }
  }
  if (n > 0) levels.push(Math.sqrt(sum / n));
  const out = new Array(BUCKETS).fill(0);
  if (levels.length) {
    for (let i = 0; i < BUCKETS; i++) {
      if (levels.length <= BUCKETS) { out[i] = levels[Math.min(levels.length - 1, Math.floor(i * levels.length / BUCKETS))]; continue; }
      const a = Math.floor(i * levels.length / BUCKETS);
      const b = Math.min(levels.length, Math.max(a + 1, Math.floor((i + 1) * levels.length / BUCKETS)));
      let s = 0;
      for (let j = a; j < b; j++) s += levels[j] * levels[j];
      out[i] = Math.sqrt(s / (b - a));
    }
  }
  const max = Math.max(0, ...out);
  const bytes = new Uint8Array(BUCKETS);
  if (max > 0) for (let i = 0; i < BUCKETS; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(out[i] * 255 / max)));
  return Buffer.from(bytes).toString("base64");
}

module.exports = { waveformOf, BUCKETS };
