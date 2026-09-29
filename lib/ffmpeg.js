"use strict";
/*
 * ffmpeg.js — where the ffmpeg binary is, and what it was built with.
 *
 * The Docker image installs Debian's ffmpeg; FFMPEG_PATH points anywhere else.
 * Whether it has libsoxr decides the resampler: soxr at high precision is the
 * better converter for a 96k → 48k step, and swr is the fallback that every
 * build has.
 */
const { spawnSync } = require("child_process");

let cached = null;

function info() {
  if (cached) return cached;
  const bin = process.env.FFMPEG_PATH || "ffmpeg";
  let ok = false, soxr = false, version = "";
  try {
    const r = spawnSync(bin, ["-hide_banner", "-buildconf"], { encoding: "utf8", timeout: 10000 });
    ok = r.status === 0;
    soxr = /--enable-libsoxr/.test(r.stdout || "");
    const v = spawnSync(bin, ["-hide_banner", "-version"], { encoding: "utf8", timeout: 10000 });
    version = ((v.stdout || "").split("\n")[0] || "").trim();
  } catch (e) {
    ok = false;
  }
  // Can this ffmpeg write 32-bit FLAC? (6.1 quietly caps the encoder at 24.)
  // A fifth of a second of silence is encoded and its STREAMINFO read back.
  let flac32 = false;
  if (ok) {
    try {
      const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "0.2",
        "-sample_fmt", "s32", "-bits_per_raw_sample", "32", "-c:a", "flac", "-f", "flac", "-"], { timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
      const b = r.stdout;
      if (r.status === 0 && b && b.length > 42 && b.toString("ascii", 0, 4) === "fLaC") {
        const si = b.subarray(8, 8 + 34);
        flac32 = ((((si[12] & 1) << 4) | (si[13] >> 4)) + 1) === 32;
      }
    } catch (e) { flac32 = false; }
  }
  cached = { bin, ok, soxr, version, flac32 };
  return cached;
}

module.exports = { info };
