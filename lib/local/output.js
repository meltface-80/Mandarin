"use strict";
/*
 * output.js — a sound device on the computer Mandarin runs on, played to
 * (v0.6.18): a USB DAC, the built-in speakers, HDMI.
 *
 * It answers like a UPnP renderer (lib/renderers/renderer.js) — setUri,
 * setNextUri, play, pause, seek, the transport and position reads, volume
 * and mute — so the renderer zone family (lib/renderers/players.js) keeps
 * its queue, gapless next track, DSP and Volume Levelling for it as for any
 * streamer. The URI is the same stream a renderer would fetch.
 *
 * Two kinds of ffmpeg: a decoder per track (the stream to 32-bit PCM, as
 * WAV so its rate is read from the header) and one sink per format, which
 * holds the device open (ALSA on Linux, Core Audio on a Mac). Node carries
 * the PCM between them, so a track that follows at the same rate goes into
 * the same open sink with nothing between, and the volume is applied as it
 * passes: untouched at 100% or on fixed volume, scaled below. A different
 * rate waits for the sink to finish, then opens a new one.
 *
 * Where it is in a track is reckoned by the clock: the device plays at its
 * rate from the first frame written to it (pauses taken out), while what
 * was written runs well ahead through ffmpeg's buffers. Not ffmpeg's own
 * progress, which differs by version (7.0 reports what it has taken in,
 * not what has played; newer builds report while idle; all hold back a
 * last part-packet until the input ends). Each track's start is marked at
 * its first frame, so the track shown changes when the device gets to it.
 *
 * From Music Assistant's Local Audio Out: the slider is an audio taper (a
 * constant dB per step) rather than linear, and a device that fails is
 * reported and let go rather than left silently "playing".
 */
const { spawn } = require("child_process");
const FF = require("../ffmpeg");
const DIDL = require("../sonos/didl");

// The slider's range: 100% is 0 dB, 10% is −45 dB, a straight line to
// silence below that (Music Assistant's taper, with a little more range).
const RANGE_DB = 50;
function amplitude(pct, muted) {
  const v = Math.max(0, Math.min(100, Number(pct) || 0));
  if (muted || v <= 0) return 0;
  if (v >= 100) return 1;
  const db = (p) => (p - 100) / 100 * RANGE_DB;
  if (v >= 10) return Math.pow(10, db(v) / 20);
  return Math.pow(10, db(10) / 20) * v / 10;
}

// The decoder's WAV header: rate, channels and where the samples start.
function parseWav(buf) {
  if (buf.length < 12) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new Error("not WAV");
  let at = 12, fmt = null;
  while (at + 8 <= buf.length) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") return fmt ? Object.assign(fmt, { start: at + 8 }) : null;
    if (at + 8 + size > buf.length) return null;
    if (id === "fmt ") fmt = { channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
    at += 8 + size + (size & 1);
  }
  return null;
}

class LocalOutput {
  /*
   * sinkArgs({ rate, channels }): the ffmpeg arguments after the PCM input,
   * the device's own (async: a Mac's device number is looked up each time).
   */
  constructor({ id, name, sinkArgs, bin, log = () => {}, volume = 100, fixed = () => false, source = (u) => u }) {
    this.id = id;
    this.name = name || id;
    this.sinkArgs = sinkArgs;
    this.bin = bin || FF.info().bin;
    this.log = log;
    this.fixed = fixed;
    this.source = source;   // where the decoder fetches a URI from (the server itself, on loopback)
    this.state = "STOPPED";
    this.uri = "";
    this.nextUri = "";
    this.volume = volume;
    this.muted = false;
    this.offset = 0;        // where the track being decoded was started (seconds)
    this.frames = 0;        // its frames sent since
    this.marks = [];        // [{ at, uri, offset }]: where each track starts in the sink
    this.run = 0;           // the play under way; a stale one stops by itself
    this.sink = null;       // { proc, rate, channels, closed, err }
    this.dec = null;
    this.waiters = [];      // a paused pump waits here
    this.error = null;      // what went wrong, for the player to report once
    this.sent = null;       // { rate, bits } the sink was opened with
  }

  // ------------------------------------------------------------ the renderer's shape

  async setUri(uri) { this.halt(); this.uri = String(uri || ""); this.nextUri = ""; this.offset = 0; this.frames = 0; this.marks = []; this.state = "STOPPED"; }
  async setNextUri(uri) { this.nextUri = String(uri || ""); }

  async play() {
    if (this.state === "PAUSED_PLAYBACK" && (this.dec || this.sink)) { this.freeze(false); this.state = "PLAYING"; this.wake(); return; }
    if (this.state === "PLAYING" || this.state === "TRANSITIONING") return;
    if (!this.uri) throw new Error(`${this.name}: nothing to play`);
    this.start(this.uri, this.offset);
  }

  /*
   * Paused: the sink is held where it is (SIGSTOP) — what ffmpeg has taken
   * in stays there, and the device runs out of what it holds — and carries
   * on from there on play (SIGCONT).
   */
  async pause() {
    if (this.state !== "PLAYING" && this.state !== "TRANSITIONING") return;
    this.state = "PAUSED_PLAYBACK";
    this.freeze(true);
  }

  freeze(on) {
    const s = this.sink;
    if (!s || s.dead || s.frozen === on) return;
    try { s.proc.kill(on ? "SIGSTOP" : "SIGCONT"); s.frozen = on; } catch (e) { /* gone */ }
    if (on) s.frozenAt = Date.now(); else { s.pausedMs += Date.now() - s.frozenAt; s.frozenAt = 0; }
  }

  /* How much of what the sink was given it has still to play, in seconds. */
  remaining(s) { return !s || s.dead ? 0 : (s.written - this.played(s)) / s.rate; }

  async stop() { this.halt(); this.offset = 0; this.frames = 0; this.marks = []; this.state = "STOPPED"; }

  async seekTime(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const was = this.state;
    if (!this.uri) return;
    if (was === "PLAYING" || was === "TRANSITIONING" || was === "PAUSED_PLAYBACK") {
      // What the device holds of where it was goes too, so the seek is heard now.
      this.stopDecoder();
      this.closeSink(true);
      this.start(this.uri, s, was === "PAUSED_PLAYBACK");
    } else { this.offset = s; this.frames = 0; this.marks = [{ at: 0, uri: this.uri, offset: s, still: true }]; }
  }

  async getTransportInfo() { return { CurrentTransportState: this.state }; }
  async getPositionInfo() {
    const m = this.mark();
    return { TrackURI: m ? m.uri : this.uri, RelTime: DIDL.hms(this.position()), TrackDuration: "0:00:00" };
  }
  async getMediaInfo() { return { CurrentURI: this.uri, NextURI: this.nextUri }; }

  async getVolume() { return this.volume; }
  async setVolume(v) { this.volume = Math.max(0, Math.min(100, Math.round(Number(v) || 0))); }
  async getMute() { return this.muted; }
  async setMute(m) { this.muted = !!m; }

  // ------------------------------------------------------------ the rest

  /* Frames the device has played of what the sink was given, by the clock. */
  played(s) {
    if (!s || !s.firstWriteAt) return 0;
    const paused = s.pausedMs + (s.frozenAt ? Date.now() - s.frozenAt : 0);
    return Math.min(s.written, Math.max(0, Math.round((Date.now() - s.firstWriteAt - paused) / 1000 * s.rate)));
  }

  // The track the device is on: the last one whose first frame it has reached.
  mark() {
    const played = this.sink ? this.played(this.sink) : Infinity;
    let m = null;
    for (const x of this.marks) if (x.still || x.at <= played) m = x;
    return m || this.marks[0] || null;
  }

  position() {
    const m = this.mark();
    if (!m) return this.offset;
    if (m.still || !this.sink) return m.offset;
    return m.offset + Math.max(0, this.played(this.sink) - m.at) / this.sink.rate;
  }

  /* What went wrong since asked last (a device that would not open, a stream that failed). */
  takeError() { const e = this.error; this.error = null; return e; }

  gain() { return this.fixed() ? 1 : amplitude(this.volume, this.muted); }

  wake() { const w = this.waiters; this.waiters = []; for (const f of w) f(); }

  /* Everything stopped and let go: the decoder, the sink, a paused pump. */
  halt() {
    this.run++;
    this.stopDecoder();
    this.closeSink(true);
    this.wake();
  }

  stopDecoder() {
    this.run++;
    if (this.dec) { try { this.dec.kill("SIGKILL"); } catch (e) { /* gone */ } this.dec = null; }
    this.wake();
  }

  // Now: stopped where it is. Otherwise what it holds plays out first (and
  // it stays the sink meanwhile, so the position carries on to the end).
  async closeSink(now) {
    const s = this.sink;
    if (!s) return;
    if (now) { this.sink = null; try { s.proc.kill("SIGKILL"); } catch (e) { /* gone */ } return s.closed; }
    // Paused at the end of the queue: it plays out on play.
    while (this.state === "PAUSED_PLAYBACK" && this.sink === s) await new Promise(r => this.waiters.push(r));
    if (this.sink !== s) return s.closed;
    s.ending = true;
    try { s.proc.stdin.end(); } catch (e) { /* gone */ }
    await s.closed;
    if (this.sink === s) this.sink = null;
  }

  fail(message) {
    this.error = new Error(message);
    this.log(`[local] ${this.name}: ${message}`);
    this.halt();
    this.state = "STOPPED";
  }

  async openSink(rate, channels) {
    if (this.sink && this.sink.rate === rate && this.sink.channels === channels && !this.sink.dead && !this.sink.ending) return this.sink;
    // A different format: what the old sink holds plays out first.
    if (this.sink) await this.closeSink(false);
    const out = await this.sinkArgs({ rate, channels });
    const args = ["-hide_banner", "-loglevel", "error", "-nostats",
      "-f", "s32le", "-ar", String(rate), "-ac", String(channels), "-i", "pipe:0"].concat(out);
    const proc = spawn(this.bin, args, { stdio: ["pipe", "ignore", "pipe"] });
    const s = { proc, rate, channels, err: "", dead: false, written: 0, firstWriteAt: 0, pausedMs: 0, frozenAt: 0 };
    this.marks = [];
    proc.stderr.on("data", d => { if (s.err.length < 4000) s.err += d.toString(); });
    proc.stdin.on("error", () => { s.dead = true; });
    s.closed = new Promise(res => proc.on("close", (code, sig) => { s.dead = true; s.code = code; s.signal = sig; res(); }));
    proc.on("error", e => { s.dead = true; s.err += e.message; });
    this.sink = s;
    this.sent = { rate, bits: 32 };
    return s;
  }

  /*
   * One play: the track at `uri` from `offset`, then each next one given in
   * time, into the sink — until the queue runs out, it is stopped, or
   * something fails.
   */
  start(uri, offset, paused) {
    const run = ++this.run;
    this.uri = uri;
    this.offset = offset || 0;
    this.frames = 0;
    this.state = paused ? "PAUSED_PLAYBACK" : "TRANSITIONING";
    this.pump(run).catch(e => { if (run === this.run) this.fail(e.message); });
  }

  async pump(run) {
    for (;;) {
      const done = await this.track(run, this.uri, this.offset);
      if (run !== this.run) return;
      if (!done) return;
      // Gapless: the next track into the same sink, if one was given.
      if (this.nextUri) {
        this.uri = this.nextUri;
        this.nextUri = "";
        this.offset = 0;
        this.frames = 0;
        continue;
      }
      // Nothing given yet — but the device is still playing out what it
      // holds (decoding runs well ahead of it), and the next track usually
      // arrives meanwhile: wait for one while there is sound left.
      const s = this.sink;
      while (run === this.run && !this.nextUri && this.remaining(s) > 0.25) await new Promise(r => setTimeout(r, 50));
      if (run !== this.run) return;
      if (this.nextUri) continue;
      // The end: the last of it plays out.
      await this.closeSink(false);
      if (run !== this.run) return;
      if (s && s.code && !s.signal) return this.fail(this.sinkError(s));
      this.state = "STOPPED";
      this.offset = 0; this.frames = 0; this.marks = [];
      return;
    }
  }

  sinkError(s) {
    const t = (s.err || "").trim();
    if (/busy/i.test(t)) return "the device is in use by another program";
    if (/No such (file|device)|cannot find card|Unknown PCM|audio_device_index/i.test(t)) return "the device isn't there any more";
    const line = t.split("\n").filter(Boolean).pop();
    return line ? "the device stopped: " + line.replace(/^\[[^\]]+\]\s*/, "") : "the device stopped";
  }

  // One track. True when it played to the end.
  async track(run, uri, offset) {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin"];
    if (offset > 0) args.push("-ss", String(offset));
    args.push("-i", this.source(uri), "-map", "0:a:0", "-vn", "-ac", "2", "-c:a", "pcm_s32le", "-f", "wav", "pipe:1");
    const dec = spawn(this.bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    this.dec = dec;
    let derr = "";
    dec.stderr.on("data", d => { if (derr.length < 4000) derr += d.toString(); });
    const exited = new Promise(res => dec.on("close", (code, sig) => res({ code, sig })));
    dec.on("error", e => { derr += e.message; });

    let head = Buffer.alloc(0), fmt = null, carry = Buffer.alloc(0), wrote = 0;
    try {
      for await (const chunk of dec.stdout) {
        if (run !== this.run) return false;
        let data = chunk;
        if (!fmt) {
          head = Buffer.concat([head, chunk]);
          fmt = parseWav(head);
          if (!fmt) { if (head.length > 1 << 16) throw new Error("the stream isn't audio Mandarin can read"); continue; }
          if (fmt.bits !== 32) throw new Error("unexpected PCM from the decoder");
          data = head.subarray(fmt.start);
          const sk = await this.openSink(fmt.rate, fmt.channels);
          if (run !== this.run) return false;
          // Marks the device has passed go, but for the one it is on.
          const on = this.mark();
          const got = this.played(sk);
          this.marks = this.marks.filter(x => !x.still && (x.at > got || x === on)).concat([{ at: sk.written, uri, offset }]);
        }
        // Whole frames only; the rest waits for the next chunk.
        const frameBytes = 4 * fmt.channels;
        if (carry.length) { data = Buffer.concat([carry, data]); carry = Buffer.alloc(0); }
        const whole = data.length - (data.length % frameBytes);
        if (whole < data.length) carry = Buffer.from(data.subarray(whole));
        if (!whole) continue;
        let out = data.subarray(0, whole);
        // Paused: nothing taken from the decoder until play.
        while (this.state === "PAUSED_PLAYBACK" && run === this.run) await new Promise(r => this.waiters.push(r));
        if (run !== this.run) return false;
        const g = this.gain();
        if (g !== 1) out = scale(out, g);
        const s = this.sink;
        if (!s || s.dead) throw new Error(this.sinkError(s || {}));
        if (!s.proc.stdin.write(out)) {
          await new Promise(r => { s.proc.stdin.once("drain", r); s.closed.then(r); });
        }
        if (run !== this.run) return false;
        if (s.dead) throw new Error(this.sinkError(s));
        this.frames += whole / frameBytes;
        // The device's clock starts with its first frame.
        if (!s.firstWriteAt) { s.firstWriteAt = Date.now(); if (this.state === "TRANSITIONING") this.state = "PLAYING"; }
        s.written += whole / frameBytes;
        wrote += whole;
      }
    } finally {
      if (this.dec === dec) this.dec = null;
    }
    const r = await exited;
    if (run !== this.run) return false;
    if (r.code !== 0 && !wrote) {
      const line = derr.trim().split("\n").filter(Boolean).pop() || `the decoder stopped (${r.code})`;
      throw new Error("couldn't play the track: " + line.replace(/^\[[^\]]+\]\s*/, ""));
    }
    return true;
  }
}

// 32-bit samples times g (below 1), into a new buffer.
function scale(buf, g) {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i < buf.length; i += 4) out.writeInt32LE(Math.round(buf.readInt32LE(i) * g), i);
  return out;
}

module.exports = { LocalOutput, amplitude, parseWav, scale, RANGE_DB };
