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
 * The engine is built by engine/build.sh (CI does it); without one the tests skip.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { haveFfmpeg } = require("./fixtures");
const ENGINE = require("../lib/local/engine");

ENGINE.reset();
const found = ENGINE.engine();
const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (process.platform !== "linux" && "Linux only")
  || (!found && !process.env.CI && "no audio engine built (engine/build.sh)");
if (process.env.CI && process.platform === "linux") assert.ok(found, "CI builds the audio engine before the tests");

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(50);
  }
}

function tones() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-"));
  const t1 = path.join(dir, "t1.flac"), t2 = path.join(dir, "t2.flac");
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=44100", "-ac", "2", "-sample_fmt", "s16", t1]);
  // A 24-bit second track: the samples are carried, not converted.
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=660:duration=1:sample_rate=44100", "-ac", "2", "-sample_fmt", "s32", t2]);
  const pcm = (f) => execFileSync("ffmpeg", ["-loglevel", "error", "-i", f, "-c:a", "pcm_s32le", "-f", "s32le", "-"], { maxBuffer: 1 << 24 });
  return { dir, t1, t2, src: Buffer.concat([pcm(t1), pcm(t2)]), one: pcm(t1) };
}

const out = (location, volume = 100) => new ENGINE.EngineOutput({ id: "x", name: "Test", location, bin: found.bin, volume });
const state = async (o) => (await o.getTransportInfo()).CurrentTransportState;

test("the engine is found and answers its protocol; something else is not used", { skip }, () => {
  assert.equal(ENGINE.probe(found.bin).version, require("../package.json").version, "built at the server's version");
  assert.equal(ENGINE.probe("/bin/true"), null, "a program that doesn't answer the protocol");
  assert.equal(ENGINE.probe("/no/such/file"), null);
  assert.equal(ENGINE.plays("alsa:plughw:CARD=Mojo,DEV=0"), true);
  assert.equal(ENGINE.plays("coreaudio:MacBook Pro Speakers"), false, "a Mac's devices play as before");
  ENGINE.reset();
  assert.equal(ENGINE.engine({ env: { AUDIO_ENGINE: "0" } }), null, "AUDIO_ENGINE=0 turns it off");
  assert.equal(ENGINE.engine({ platform: "darwin" }), null);
  ENGINE.reset();
});

test("the engine: two tracks into one open device, untouched; paused where it is; scaled below 100%", { skip, timeout: 60000 }, async () => {
  const { dir, t1, t2, src, one } = tones();
  const file = path.join(dir, "out.raw");
  const o = out("file:" + file);
  try {
    await o.setUri(t1); await o.setNextUri(t2); await o.play();
    await until(async () => (await state(o)) === "PLAYING");
    assert.equal(o.sink.rate, 44100, "the device's format, as the hardware check reads it");
    assert.equal((await o.getPositionInfo()).TrackURI, t1);
    await until(async () => (await o.getPositionInfo()).TrackURI === t2, 8000);
    assert.equal(o.nextUri, "", "the next track taken up, gapless");
    await until(async () => (await state(o)) === "STOPPED", 8000);
    assert.equal(o.takeError(), null);
    const got = fs.readFileSync(file);
    assert.equal(got.length, src.length, "every frame of both, nothing added between them");
    assert.ok(got.equals(src), "at 100% the samples are untouched");
  } finally { o.halt(); }

  const file2 = path.join(dir, "out2.raw");
  const p = out("file:" + file2, 50);
  try {
    await p.setUri(t1); await p.play();
    await until(() => p.position() > 0.3);
    await p.pause();
    await sleep(400);
    const at = p.position();
    await sleep(700);
    assert.equal(await state(p), "PAUSED_PLAYBACK");
    assert.ok(Math.abs(p.position() - at) < 0.01, `held where it is (${at} → ${p.position()})`);
    await p.play();
    await until(async () => (await state(p)) === "STOPPED", 8000);
    const b = fs.readFileSync(file2);
    assert.equal(b.length, one.length, "all of it, after the pause");
    let peak = 0, srcPeak = 0;
    for (let i = 0; i < b.length; i += 4) { peak = Math.max(peak, Math.abs(b.readInt32LE(i))); srcPeak = Math.max(srcPeak, Math.abs(one.readInt32LE(i))); }
    assert.ok(Math.abs(20 * Math.log10(peak / srcPeak) - -25) < 0.01, "50% is 25 dB down");
  } finally { p.halt(); }
});

test("the engine through ALSA itself: bit for bit; a seek is heard at once; a missing device is said", { skip, timeout: 60000 }, async () => {
  const { dir, t1, t2, src } = tones();
  const raw = path.join(dir, "alsa.raw");
  const conf = path.join(dir, "asound.conf");
  fs.writeFileSync(conf, `pcm.mandtest { type file slave { pcm { type null } } file "${raw}" format "raw" }\n`);
  const was = process.env.ALSA_CONFIG_PATH;
  process.env.ALSA_CONFIG_PATH = conf;   // the engine inherits it
  const o = out("alsa:mandtest");
  try {
    await o.setUri(t1); await o.setNextUri(t2); await o.play();
    await until(async () => (await state(o)) === "STOPPED" && fs.existsSync(raw) && fs.statSync(raw).size >= src.length, 15000);
    assert.equal(o.takeError(), null);
    assert.ok(fs.readFileSync(raw).equals(src), "through libasound, every sample as it was");

    // A device that isn't there.
    const gone = out("alsa:plughw:CARD=NoSuchCard,DEV=0");
    try {
      await gone.setUri(t1); await gone.play();
      const e = await until(() => gone.takeError());
      assert.match(e.message, /isn't there|stopped/);
      assert.equal(await state(gone), "STOPPED");
    } finally { gone.halt(); }
  } finally {
    o.halt();
    if (was == null) delete process.env.ALSA_CONFIG_PATH; else process.env.ALSA_CONFIG_PATH = was;
  }

  // A seek, on the paced device: the position jumps there and plays on from it.
  const file = path.join(dir, "seek.raw");
  const s = out("file:" + file);
  try {
    await s.setUri(t1); await s.play();
    await until(() => s.position() > 0.2);
    await s.seekTime(1.0);
    await until(() => s.position() >= 1.0 && s.position() < 1.3, 3000);
    await until(async () => (await state(s)) === "STOPPED", 8000);
    // What played after the seek is the track from 1.0 s on.
    const tail = execFileSync("ffmpeg", ["-loglevel", "error", "-ss", "1", "-i", t1, "-c:a", "pcm_s32le", "-f", "s32le", "-"], { maxBuffer: 1 << 24 });
    const b = fs.readFileSync(file);
    assert.ok(b.subarray(b.length - tail.length).equals(tail), "after the seek, the track from where it was sent");
  } finally { s.halt(); }
});

test("the engine going away mid-track is said; the next play starts it again", { skip, timeout: 60000 }, async () => {
  const { dir, t1 } = tones();
  const o = out("file:" + path.join(dir, "k.raw"));
  try {
    await o.setUri(t1); await o.play();
    await until(async () => (await state(o)) === "PLAYING");
    o.proc.kill("SIGKILL");
    const e = await until(() => o.takeError());
    assert.match(e.message, /audio engine/);
    assert.equal(await state(o), "STOPPED");
    await o.setUri(t1); await o.play();
    await until(async () => (await state(o)) === "PLAYING");
  } finally { o.halt(); }
});
