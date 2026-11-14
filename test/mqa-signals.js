"use strict";
/*
 * Signals that carry MQA's signalling as the open identifiers read it (item 418; the server's Mqa/MqaDetect.cs, the C#
 * suite's Harness/MqaSignals.cs), since real MQA audio can't be shipped: a 997 Hz tone at half scale, dithered, on both
 * channels alike but for the 16-bit word's lowest bit, which carries zeros, then the sync word (0xbe0498c88, 36 bits),
 * then 33 frames: frames 3 to 6 the original rate's 4-bit code, frames 29 to 33 the provenance (above 8, MQA Studio).
 * A plain signal has its right channel dithered on its own; a near miss has the sync word's last bit wrong.
 *
 *   mqaFlac(file, { rate: 44100, bits: 24, original: 352800, studio: true, seconds: 3, tags })
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SYNC = 0xbe0498c88n;

/** The 4-bit code of an original rate, as the identifiers read it back. */
function codeOf(rate) {
  for (let c = 0; c < 16; c++) {
    const family = (c & 1) ? 48000 : 44100;
    const power = ((c >> 3) & 1) | (((c >> 2) & 1) << 1) | (((c >> 1) & 1) << 2);
    let times = 1 << power;
    if (times > 16) times *= 2;
    if (family * times === rate) return c;
  }
  throw new Error("no code for " + rate);
}

/** Interleaved stereo samples in their own depth. kind: "mqa", "near" (the sync's last bit wrong) or "plain". */
function samples({ rate = 44100, bits = 24, original = 352800, studio = false, seconds = 3, kind = "mqa", seed = 1 }) {
  const frames = Math.round(rate * seconds);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const full = 2 ** (bits - 1) - 1;
  const lowest = bits - 16;
  const stream = new Uint8Array(frames);
  if (kind !== "plain") {
    const start = Math.round(rate * 0.3), code = codeOf(original), provenance = studio ? 17 : 3;
    for (let i = 0; i < 36; i++) stream[start + i] = Number((SYNC >> BigInt(35 - i)) & 1n);
    if (kind === "near") stream[start + 35] ^= 1;
    const end = start + 35;
    for (let k = 1; k <= 33; k++)
      stream[end + k] = k >= 3 && k <= 6 ? (code >> (6 - k)) & 1 : k >= 29 ? (provenance >> (33 - k)) & 1 : (rnd() < 0.5 ? 1 : 0);
  }
  const out = new Int32Array(frames * 2);
  for (let n = 0; n < frames; n++) {
    const tone = Math.round(Math.sin(2 * Math.PI * 997 * n / rate) * full / 2);
    const l = tone + Math.floor(rnd() * 7) - 3;
    out[2 * n] = l;
    out[2 * n + 1] = kind === "plain" ? tone + Math.floor(rnd() * 7) - 3 : l ^ (stream[n] << lowest);
  }
  return out;
}

/** The signal as a WAV file (PCM, its depth). */
function mqaWav(file, o = {}) {
  const bits = o.bits || 24, rate = o.rate || 44100, bytes = bits / 8;
  const x = samples(o);
  const b = Buffer.alloc(44 + x.length * bytes);
  b.write("RIFF", 0); b.writeUInt32LE(36 + x.length * bytes, 4); b.write("WAVE", 8);
  b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2 * bytes, 28); b.writeUInt16LE(2 * bytes, 32); b.writeUInt16LE(bits, 34);
  b.write("data", 36); b.writeUInt32LE(x.length * bytes, 40);
  for (let i = 0; i < x.length; i++) {
    if (bytes === 3) b.writeIntLE(x[i], 44 + i * 3, 3); else b.writeInt16LE(x[i], 44 + i * 2);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
}

/** The signal as FLAC (ffmpeg's: the same samples), tagged. */
function mqaFlac(file, o = {}) {
  const wav = file + ".wav";
  mqaWav(wav, o);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-c:a", "flac"];
  for (const [k, v] of Object.entries(o.tags || {})) args.push("-metadata", k + "=" + v);
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [...args, file]);
  fs.unlinkSync(wav);
}

module.exports = { mqaFlac, mqaWav, samples, codeOf };
