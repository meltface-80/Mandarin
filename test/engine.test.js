"use strict";
/*
 * Mandarin's audio engine (v0.8.0): engine/Mandarin.Audio, a native program
 * written in C#, playing a sound device on the server.
 *   - it is found and answers its protocol; a program that isn't one is not used;
 *   - two tracks go into one open device with nothing between them, every
 *     sample untouched at 100%; the position follows the device; pause holds
 *     it where it is and play carries on; 50% is 25 dB down;
 *   - through the ALSA library itself (its file plugin as the device): the
 *     same bit for bit;
 *   - a seek is heard at once; a device that isn't there is said in words;
 *   - the engine going away mid-track is said, and the next play starts it again.
 * The C# server's driver (Local/EngineOutput.cs, AudioEngine.cs; lib/local/engine.js
 * until v0.8.50), run step by step from a script (`mandarin-server score`
 * { fn: "engine" }, Local/EngineCommand.cs). The engine is built by
 * engine/build.sh (CI does it); without one the tests skip.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { haveFfmpeg } = require("./fixtures");
const { built } = require("./server");
const { score, scoreAsync } = require("./score");

const ROOT = path.join(__dirname, "..");
const APP = { MANDARIN_APP_DIR: ROOT };
const linux = process.platform === "linux";
/* The steps, run in order on one output at a time; one answer a step. */
const run = async (steps, env) => (await scoreAsync({ fn: "engine", steps }, Object.assign({}, APP, env))).results;
const found = !built() && linux ? score({ fn: "engine", steps: [{ find: true }] }, APP).results[0] : null;
const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!linux && "Linux only")
  || (!found && !process.env.CI && "no audio engine built (engine/build.sh)");
if (process.env.CI && linux && !built()) assert.ok(found, "CI builds the audio engine before the tests");

function tones() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-"));
  const t1 = path.join(dir, "t1.flac"), t2 = path.join(dir, "t2.flac");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=44100", "-ac", "2", "-sample_fmt", "s16", t1]);
  // A 24-bit second track: the samples are carried, not converted.
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=1:sample_rate=44100", "-ac", "2", "-sample_fmt", "s32", t2]);
  const pcm = (f) => execFileSync("ffmpeg", ["-loglevel", "error", "-i", f, "-c:a", "pcm_s32le", "-f", "s32le", "-"], { maxBuffer: 1 << 24 });
  return { dir, t1, t2, src: Buffer.concat([pcm(t1), pcm(t2)]), one: pcm(t1) };
}

test("the engine is found and answers its protocol; something else is not used", { skip }, async () => {
  assert.equal(found.version, require("../package.json").version, "built at the server's version");
  const [probed, no1, no2, alsa, other] = await run([{ probe: found.bin }, { probe: "/bin/true" }, { probe: "/no/such/file" },
    { plays: "alsa:plughw:CARD=Mojo,DEV=0" }, { plays: "coreaudio:MacBook Pro Speakers" }]);
  assert.equal(probed, found.version);
  assert.equal(no1, null, "a program that doesn't answer the protocol");
  assert.equal(no2, null);
  assert.equal(alsa, true);
  assert.equal(other, false, "a location that isn't ALSA's (a Mac's, before v1.0.3) isn't the engine's");
  assert.deepEqual(await run([{ find: true }], { AUDIO_ENGINE: "0" }), [null], "AUDIO_ENGINE=0 turns it off");
});

test("the engine: two tracks into one open device, untouched; paused where it is; scaled below 100%", { skip, timeout: 60000 }, async () => {
  const { dir, t1, t2, src, one } = tones();
  const file = path.join(dir, "out.raw");
  const r = await run([
    { open: { location: "file:" + file, bin: found.bin } }, { set: t1 }, { next: t2 }, { play: true },
    { until: { state: "PLAYING" } }, { sink: true }, { until: { track: t1 }, ms: 0 },
    { until: { track: t2 }, ms: 8000 }, { next_uri: true }, { until: { state: "STOPPED" }, ms: 8000 }, { take_error: true }]);
  assert.equal(r[4], true, "playing");
  assert.equal(r[5].rate, 44100, "the device's format, as the hardware check reads it");
  assert.equal(r[6], true, "on the first track");
  assert.equal(r[7], true, "then the second");
  assert.equal(r[8], "", "the next track taken up, gapless");
  assert.equal(r[9], true, "and stopped at the end");
  assert.equal(r[10], null);
  const got = fs.readFileSync(file);
  assert.equal(got.length, src.length, "every frame of both, nothing added between them");
  assert.ok(got.equals(src), "at 100% the samples are untouched");

  const file2 = path.join(dir, "out2.raw");
  const p = await run([
    { open: { location: "file:" + file2, bin: found.bin, volume: 50 } }, { set: t1 }, { play: true },
    { until: { above: 0.3 } }, { pause: true }, { wait: 400 }, { position: true }, { wait: 700 },
    { state: true }, { position: true }, { play: true }, { until: { state: "STOPPED" }, ms: 8000 }]);
  const at = p[6];
  assert.equal(p[8], "PAUSED_PLAYBACK");
  assert.ok(Math.abs(p[9] - at) < 0.01, `held where it is (${at} → ${p[9]})`);
  assert.equal(p[11], true, "played on to the end");
  const b = fs.readFileSync(file2);
  assert.equal(b.length, one.length, "all of it, after the pause");
  let peak = 0, srcPeak = 0;
  for (let i = 0; i < b.length; i += 4) { peak = Math.max(peak, Math.abs(b.readInt32LE(i))); srcPeak = Math.max(srcPeak, Math.abs(one.readInt32LE(i))); }
  assert.ok(Math.abs(20 * Math.log10(peak / srcPeak) - -25) < 0.01, "50% is 25 dB down");
});

test("the engine through ALSA itself: bit for bit; a seek is heard at once; a missing device is said", { skip, timeout: 60000 }, async () => {
  const { dir, t1, t2, src, one } = tones();
  const raw = path.join(dir, "alsa.raw");
  const conf = path.join(dir, "asound.conf");
  fs.writeFileSync(conf, `pcm.mandtest { type file slave { pcm { type null } } file "${raw}" format "raw" }\n`);
  // The engine inherits ALSA_CONFIG_PATH from the program that starts it.
  const r = await run([
    { open: { location: "alsa:mandtest", bin: found.bin } }, { set: t1 }, { next: t2 }, { play: true },
    { until: { size: [raw, src.length] }, ms: 15000 }, { until: { state: "STOPPED" }, ms: 15000 }, { take_error: true },
    // A device that isn't there.
    { open: { location: "alsa:plughw:CARD=NoSuchCard,DEV=0", bin: found.bin } }, { set: t1 }, { play: true },
    { until: { error: true } }, { state: true }], { ALSA_CONFIG_PATH: conf });
  assert.equal(r[5], true, "played to the end");
  assert.equal(r[6], null);
  assert.ok(fs.readFileSync(raw).equals(src), "through libasound, every sample as it was");
  assert.match(String(r[10]), /isn't there|stopped/);
  assert.equal(r[11], "STOPPED");

  // A seek, on the paced device: the position jumps there at once (played from the start, it
  // would take a second to get there) and plays on from it.
  const file = path.join(dir, "seek.raw");
  const s = await run([
    { open: { location: "file:" + file, bin: found.bin } }, { set: t1 }, { play: true },
    { until: { above: 0.2 } }, { seek: 1.0 }, { until: { between: [1.0, 1.3] }, ms: 600 }, { until: { state: "STOPPED" }, ms: 8000 }]);
  assert.equal(s[5], true, "the position jumped there");
  assert.equal(s[6], true);
  // What played after the seek is the track from 1.0 s on, and what lay between was never played.
  const tail = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", "1", "-i", t1, "-c:a", "pcm_s32le", "-f", "s32le", "-"], { maxBuffer: 1 << 24 });
  const b = fs.readFileSync(file);
  assert.ok(b.subarray(b.length - tail.length).equals(tail), "after the seek, the track from where it was sent");
  assert.ok(b.length < one.length, `skipped over: ${b.length} bytes played of the track's ${one.length}`);
});

test("the engine going away mid-track is said; the next play starts it again", { skip, timeout: 60000 }, async () => {
  const { dir, t1 } = tones();
  const r = await run([
    { open: { location: "file:" + path.join(dir, "k.raw"), bin: found.bin } }, { set: t1 }, { play: true },
    { until: { state: "PLAYING" } }, { kill: true }, { until: { error: true } }, { state: true },
    { set: t1 }, { play: true }, { until: { state: "PLAYING" } }]);
  assert.equal(r[3], true);
  assert.equal(r[4], true, "the engine was there to kill");
  assert.match(String(r[5]), /audio engine/);
  assert.equal(r[6], "STOPPED");
  assert.equal(r[9], true, "started again");
});
