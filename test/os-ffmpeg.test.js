"use strict";
/*
 * Mandarin OS's ffmpeg has everything Mandarin asks of ffmpeg (item 389; os/ffmpeg): its whole suite runs against that
 * build in CI (.github/workflows/os-image.yml, os-ffmpeg.yml), and where a test would only skip for something missing
 * (drawtext, soxr), this says so instead. Run against the suite's ffmpeg when MANDARIN_OS_FFMPEG=1 (CI sets it for
 * that build); otherwise the build's flags are read: every outside library Mandarin uses is asked for.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const ff = (...a) => spawnSync(FFMPEG, ["-hide_banner", ...a], { encoding: "utf8" });

test("the OS's ffmpeg is built with every outside library Mandarin uses", () => {
  const flags = fs.readFileSync(path.join(__dirname, "..", "os", "ffmpeg", "configure.flags"), "utf8");
  for (const f of ["--enable-libsoxr", "--enable-libopus", "--enable-libmp3lame", "--enable-gnutls", "--enable-libfreetype", "--enable-libharfbuzz", "--enable-libfontconfig"]) {
    assert.match(flags, new RegExp("^" + f + "$", "m"), f);
  }
  assert.doesNotMatch(flags, /^--disable-avdevice$/m, "lavfi (Mandarin's silence and drawn covers) is in the device library");
});

test("the OS's ffmpeg does what Mandarin asks of it", { skip: process.env.MANDARIN_OS_FFMPEG !== "1" && "MANDARIN_OS_FFMPEG=1 only" }, () => {
  assert.match(ff("-version").stdout, /--enable-libsoxr/);
  const filters = ff("-filters").stdout;
  for (const f of ["drawtext", "aresample", "ebur128", "loudnorm", "afir", "equalizer", "biquad", "volume", "showwavespic", "astats", "atrim", "apad", "aformat"]) {
    assert.match(filters, new RegExp("\\s" + f + "\\s"), "filter " + f);
  }
  const enc = ff("-encoders").stdout;
  for (const e of ["flac", "libopus", "libmp3lame", "pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f64le", "mjpeg", "png", "aac", "alac"]) assert.match(enc, new RegExp("\\s" + e + "\\s"), "encoder " + e);
  const dec = ff("-decoders").stdout;
  for (const d of ["flac", "alac", "mp3float", "aac", "vorbis", "opus", "wavpack", "ape", "dsd_lsbf", "dsd_msbf", "tta", "wmav2", "mjpeg", "png", "webp"]) assert.match(dec, new RegExp("\\s" + d + "\\s"), "decoder " + d);
  const prot = ff("-protocols").stdout;
  for (const p of ["https", "file", "pipe", "concat"]) assert.match(prot, new RegExp("^\\s+" + p + "$", "m"), "protocol " + p);
  const fmts = ff("-formats").stdout;
  for (const f of ["lavfi", "dsf", "wav", "flac", "concat", "image2", "s32le"]) assert.match(fmts, new RegExp("\\s" + f + "\\s"), "format " + f);
  // What Mandarin runs: soxr's resampling, and a title drawn in fontconfig's sans-serif.
  assert.equal(ff("-v", "error", "-f", "lavfi", "-i", "sine=duration=1", "-af", "aresample=resampler=soxr:precision=33:osr=96000", "-f", "null", "-").status, 0, "soxr");
  assert.equal(ff("-v", "error", "-f", "lavfi", "-i", "color=c=black:s=200x200:d=1", "-vf", "drawtext=text=Mandarin:font=sans-serif:fontcolor=white", "-frames:v", "1", "-f", "mjpeg", "-").status, 0, "drawtext");
});
