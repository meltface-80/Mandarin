"use strict";
/*
 * engine.js — a sound device on the server, played by Mandarin's audio engine
 * (v0.8.0): engine/Mandarin.Audio, a native program written in C#.
 *
 * The engine owns the whole path from the decoder to the device: ffmpeg
 * decodes each track straight into the engine's own buffer (a minute or more
 * ahead), and a thread of its own — on the core kept for playback, at a raised
 * priority where the system allows — writes it to the device through ALSA.
 * Nothing of the server's own work is in that path: not a library scan, not
 * an import, not a garbage collection in the server. Where the device is in a
 * track comes from ALSA itself (what the device has still to play), not a
 * clock.
 *
 * This class answers exactly as lib/local/output.js does — the renderer's
 * shape (setUri, setNextUri, play, pause, seek, the transport and position
 * reads, volume) — so the renderer family keeps its queue, gapless next
 * track, DSP and Volume Levelling for it as before. The engine is told what
 * to do over its stdin and says what happened on its stdout, one JSON object
 * a line (engine/Mandarin.Audio/Program.cs).
 *
 * WHERE THE ENGINE COMES FROM, IN ORDER:
 *   AUDIO_ENGINE_BIN       set by hand (tests, a build of your own)
 *   engine/bin/            in the Docker image, and a build in the checkout
 *   <data>/bin/            downloaded from the "audio-engine" pre-release on
 *                          GitHub (an install updated in place, whose image
 *                          predates the engine), checked against its SHA256SUMS
 * With none of them — a Mac for now, or AUDIO_ENGINE=0 — the device is played
 * as before v0.8.0 (lib/local/output.js): nothing stops playing.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");
const FF = require("../ffmpeg");
const DIDL = require("../sonos/didl");
const CORES = require("./cores");
const { amplitude } = require("./output");

const PROTOCOL = 1;
const RELEASE_URL = "https://github.com/meltface-80/Mandarin/releases/download/audio-engine";
const ARCH = { x64: "x64", arm64: "arm64" }[process.arch] || null;
const IMAGE_BIN = path.join(__dirname, "..", "..", "engine", "bin", "mandarin-audio");

let found = null;          // { bin, version } once one has answered, or false
let downloading = null;

const executable = (f) => { try { fs.accessSync(f, fs.constants.X_OK); return fs.statSync(f).isFile(); } catch (e) { return false; } };

/* "0.8.0 protocol 1" from the program, or null if it isn't one we can drive. */
function probe(bin) {
  if (!executable(bin)) return null;
  try {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    const m = String(r.stdout || "").match(/^(\S+) protocol (\d+)/);
    return m && Number(m[2]) === PROTOCOL ? { bin, version: m[1] } : null;
  } catch (e) { return null; }
}

/*
 * The engine to use, or null. Decided once (and again after a download).
 * Linux only for now: the engine plays through ALSA.
 */
function engine({ env = process.env, dataDir = null, platform = process.platform } = {}) {
  if (String(env.AUDIO_ENGINE || "").trim() === "0") return null;
  if (platform !== "linux") return null;
  if (found !== null) return found || null;
  const tries = [env.AUDIO_ENGINE_BIN, IMAGE_BIN, dataDir && downloadedBin(dataDir)].filter(Boolean);
  for (const b of tries) { const p = probe(b); if (p) { found = p; return p; } }
  found = false;
  return null;
}

function downloadedBin(dataDir) { return path.join(dataDir, "bin", "mandarin-audio"); }

/*
 * No engine in the image or the checkout: fetch the one for this version,
 * once, in the background. Until it is here (or if it can't be had), devices
 * play the way they did before.
 */
function ensure({ dataDir, version, log = () => {}, fetch: f = globalThis.fetch, env = process.env } = {}) {
  if (engine({ env, dataDir })) return Promise.resolve(true);
  if (String(env.AUDIO_ENGINE || "").trim() === "0" || process.platform !== "linux" || !ARCH || !dataDir) return Promise.resolve(false);
  const bin = downloadedBin(dataDir);
  const marker = bin + ".version";
  let have = null;
  try { have = fs.readFileSync(marker, "utf8").trim(); } catch (e) { /* none yet */ }
  if (executable(bin) && have === version) return Promise.resolve(!!engine({ env, dataDir }));
  if (downloading) return downloading;
  downloading = (async () => {
    const base = String(env.AUDIO_ENGINE_URL || RELEASE_URL).replace(/\/+$/, "");
    const name = `mandarin-audio-linux-${ARCH}.gz`;
    const get = async (u) => {
      const r = await f(u, { redirect: "follow" });
      if (!r.ok) throw new Error(`${u.split("/").pop()}: HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    };
    log(`[local] downloading Mandarin's audio engine (${name})…`);
    const sums = (await get(`${base}/SHA256SUMS`)).toString("utf8");
    const want = (sums.split("\n").map(l => l.trim().split(/\s+/)).find(p => p[1] === name) || [])[0];
    if (!want) throw new Error(`no checksum for ${name}`);
    const gz = await get(`${base}/${name}`);
    if (crypto.createHash("sha256").update(gz).digest("hex") !== want) throw new Error("the download was damaged (checksum mismatch)");
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    fs.writeFileSync(bin + ".tmp", zlib.gunzipSync(gz), { mode: 0o755 });
    fs.renameSync(bin + ".tmp", bin);
    fs.writeFileSync(marker, String(version));
    found = null;   // look again
    const e = engine({ env, dataDir });
    log(e ? `[local] audio engine ${e.version} ready` : "[local] the downloaded audio engine doesn't run here; devices play as before");
    return !!e;
  })().catch(e => { log(`[local] couldn't download the audio engine (${e.message}); devices play as before`); return false; })
    .finally(() => { downloading = null; });
  return downloading;
}

/* For a test: forget what was found. */
function reset() { found = null; }

/* A location the engine can play: an ALSA device, or the tests' file. */
function plays(location) { return /^(alsa|file):/.test(String(location || "")); }

class EngineOutput {
  constructor({ id, name, location, bin, ffmpeg, log = () => {}, volume = 100, fixed = () => false, source = (u) => u, spawnFn = spawn }) {
    this.id = id;
    this.name = name || id;
    this.location = location;
    this.bin = bin;
    this.ffmpeg = ffmpeg || FF.info().bin;
    this.log = log;
    this.fixed = fixed;
    this.source = source;
    this.spawnFn = spawnFn;
    this.state = "STOPPED";
    this.uri = "";
    this.nextUri = "";
    this.offset = 0;
    this.volume = volume;
    this.muted = false;
    this.error = null;
    this.proc = null;
    this.sink = null;          // { rate, channels } while the device is open
    this.sent = null;
    this.seconds = 0;          // where the device is in the track it is on
    this.ahead = 0;            // seconds of audio held ahead of the device
    this.fetched = new Map();  // what the engine was given → the URI the player knows
  }

  // ------------------------------------------------------------ the engine process

  ensureProc() {
    if (this.proc && !this.proc.dead) return this.proc;
    const core = CORES.reserve(this.log);
    const args = ["--device", this.location, "--ffmpeg", this.ffmpeg];
    if (core != null) args.push("--core", String(core));
    // The whole engine on the reserved core, the decoder it starts with it.
    const [bin, wargs] = CORES.wrap(this.bin, args);
    const proc = this.spawnFn(bin, wargs, { stdio: ["pipe", "pipe", "pipe"] });
    proc.dead = false;
    CORES.favour(proc.pid);
    this.proc = proc;
    readline.createInterface({ input: proc.stdout }).on("line", (l) => this.onLine(l));
    readline.createInterface({ input: proc.stderr }).on("line", (l) => { if (l.trim()) this.log(`[engine] ${this.name}: ${l}`); });
    proc.stdin.on("error", () => { proc.dead = true; });
    proc.on("error", (e) => { proc.dead = true; this.lost(proc, e.message); });
    proc.on("close", (code, sig) => { proc.dead = true; this.lost(proc, sig ? "stopped (" + sig + ")" : "exited (" + code + ")"); });
    return proc;
  }

  // The engine went away while it had work: said once, and stopped.
  lost(proc, why) {
    if (this.proc !== proc) return;
    this.proc = null;
    this.sink = null;
    if (this.state !== "STOPPED") {
      this.error = new Error("the audio engine " + why);
      this.log(`[local] ${this.name}: the audio engine ${why}`);
      this.state = "STOPPED";
    }
  }

  send(cmd) {
    const p = this.ensureProc();
    try { p.stdin.write(JSON.stringify(cmd) + "\n"); } catch (e) { p.dead = true; }
  }

  onLine(line) {
    let ev;
    try { ev = JSON.parse(line); } catch (e) { return; }
    switch (ev.ev) {
      case "hello":
        this.log(`[local] ${this.name}: played by Mandarin's audio engine ${ev.version}`);
        break;
      case "pos": {
        const uri = this.fetched.get(ev.uri) || ev.uri || "";
        // The engine went on to the next track by itself (gapless).
        if (uri && this.nextUri && uri === this.nextUri) { this.uri = this.nextUri; this.nextUri = ""; this.offset = 0; }
        else if (uri && uri !== this.uri && ev.state !== "STOPPED") this.uri = uri;
        this.seconds = Number(ev.seconds) || 0;
        this.ahead = Number(ev.ahead) || 0;
        if (ev.rate > 0) { this.sink = { rate: ev.rate, channels: ev.channels }; this.sent = { rate: ev.rate, bits: 32 }; }
        // Ours only where the engine has caught up with what it was told.
        if (this.pending && ev.state === this.pending) this.pending = null;
        if (!this.pending) this.state = ev.state;
        break;
      }
      case "format":
        this.sink = { rate: ev.rate, channels: ev.channels };
        this.sent = { rate: ev.rate, bits: 32 };
        break;
      case "ended":
        this.pending = null;
        this.state = "STOPPED"; this.offset = 0; this.seconds = 0; this.sink = null;
        break;
      case "xrun":
        this.log(`[local] ${this.name}: the device ran dry (ALSA xrun #${ev.count}); ${this.ahead.toFixed(1)} s were held ahead`);
        break;
      case "error":
        this.pending = null;
        this.error = new Error(ev.message);
        this.log(`[local] ${this.name}: ${ev.message}`);
        this.state = "STOPPED";
        this.sink = null;
        break;
    }
  }

  fetchUri(uri) {
    const src = this.source(uri);
    this.fetched.set(src, uri);
    if (this.fetched.size > 64) this.fetched.delete(this.fetched.keys().next().value);
    return src;
  }

  sendGain() { this.send({ cmd: "gain", value: this.gain() }); }
  gain() { return this.fixed() ? 1 : amplitude(this.volume, this.muted); }

  // ------------------------------------------------------------ the renderer's shape

  async setUri(uri) {
    if (this.proc) this.send({ cmd: "stop" });
    this.uri = String(uri || ""); this.nextUri = ""; this.offset = 0; this.seconds = 0;
    this.state = "STOPPED"; this.pending = "STOPPED";
  }

  async setNextUri(uri) {
    this.nextUri = String(uri || "");
    if (this.proc && this.state !== "STOPPED") this.send({ cmd: "next", uri: this.nextUri ? this.fetchUri(this.nextUri) : "" });
  }

  async play() {
    if (this.state === "PAUSED_PLAYBACK" && this.proc) { this.send({ cmd: "resume" }); this.state = "PLAYING"; this.pending = "PLAYING"; return; }
    if (this.state === "PLAYING" || this.state === "TRANSITIONING") return;
    if (!this.uri) throw new Error(`${this.name}: nothing to play`);
    this.begin(this.offset, false);
  }

  begin(offset, paused) {
    this.error = null;
    this.sendGain();
    this.send({ cmd: "play", uri: this.fetchUri(this.uri), offset: offset || 0, paused: !!paused });
    if (this.nextUri) this.send({ cmd: "next", uri: this.fetchUri(this.nextUri) });
    this.seconds = offset || 0;
    this.state = paused ? "PAUSED_PLAYBACK" : "TRANSITIONING";
    this.pending = paused ? "PAUSED_PLAYBACK" : "PLAYING";
  }

  async pause() {
    if (this.state !== "PLAYING" && this.state !== "TRANSITIONING") return;
    this.send({ cmd: "pause" });
    this.state = "PAUSED_PLAYBACK"; this.pending = "PAUSED_PLAYBACK";
  }

  async stop() {
    if (this.proc) this.send({ cmd: "stop" });
    this.offset = 0; this.seconds = 0; this.state = "STOPPED"; this.pending = "STOPPED";
  }

  async seekTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    if (!this.uri) return;
    const was = this.state;
    if (was === "PLAYING" || was === "TRANSITIONING" || was === "PAUSED_PLAYBACK") this.begin(s, was === "PAUSED_PLAYBACK");
    else { this.offset = s; this.seconds = s; }
  }

  async getTransportInfo() { return { CurrentTransportState: this.state }; }
  async getPositionInfo() { return { TrackURI: this.uri, RelTime: DIDL.hms(this.position()), TrackDuration: "0:00:00" }; }
  async getMediaInfo() { return { CurrentURI: this.uri, NextURI: this.nextUri }; }

  async getVolume() { return this.volume; }
  async setVolume(v) { this.volume = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); if (this.proc) this.sendGain(); }
  async getMute() { return this.muted; }
  async setMute(m) { this.muted = !!m; if (this.proc) this.sendGain(); }

  position() { return this.state === "STOPPED" ? this.offset : this.seconds; }
  takeError() { const e = this.error; this.error = null; return e; }

  /* Everything stopped and let go, the engine with it. */
  halt() {
    const p = this.proc;
    this.proc = null;
    this.sink = null;
    this.state = "STOPPED";
    if (p && !p.dead) { try { p.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n"); p.stdin.end(); } catch (e) { /* gone */ } setTimeout(() => { try { p.kill("SIGKILL"); } catch (e) { /* gone */ } }, 2000).unref(); }
  }
}

module.exports = { EngineOutput, engine, ensure, reset, plays, probe, PROTOCOL, IMAGE_BIN, downloadedBin, ARCH };
