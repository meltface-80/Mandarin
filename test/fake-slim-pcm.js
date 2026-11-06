"use strict";
/*
 * A stand-in Mandarin Bridge taking Mandarin's continuous PCM (item 322, Renderers/Slim/SlimRuns.cs): test/fake-slim.js
 * whose hello says ContinuousPcm=1. A strm s of PCM ('p') is a run: it is played as it comes, as a Bridge plays it,
 * from its first bytes, for as long as the bytes it has had last at the strm's rate, depth and channels; read to its
 * end it says STMd, and played to its end it goes on into the run given after it, or says STMu. Another stream (a DSD
 * file) is fake-slim's. Each track Mandarin tells it it has come to in a run (mtrk) is logged: "mtrk Song 2".
 */
const { FakeSlim } = require("./fake-slim");

const RATES = [11025, 22050, 32000, 44100, 48000, 8000, 12000, 16000, 24000, 96000, 88200, 176400, 192000, 352800, 384000, 0, 705600, 768000];

class FakeSlimPcm extends FakeSlim {
  constructor(o) { super(Object.assign({ caps: "Model=mandarinbridge,ModelName=Mandarin Bridge,Firmware=0.3.0,MaxSampleRate=192000,ContinuousPcm=1,flc,pcm,wav,dsf,dff" }, o)); }

  frame(op, b) {
    if (op === "mtrk") {
      const title = (b.toString("ascii").match(/^X-Mandarin-Title: (.*)$/m) || [])[1];
      this.log.push("mtrk " + decodeURIComponent((title || "").trim()));
      return;
    }
    if (op !== "strm" || String.fromCharCode(b[0]) !== "s" || String.fromCharCode(b[2]) !== "p") return super.frame(op, b);
    const autostart = String.fromCharCode(b[1]);
    const bytesPerSecond = (b[3] - 48 + 1) * RATES[b[4] - 48] * (b[5] - 48);
    const port = b.readUInt16BE(18), request = b.toString("ascii", 24), path = request.split(" ")[1];
    this.log.push(`strm s p ${autostart} ${path}`);
    this.requests.push(request);
    this.stat("STMc");
    const s = { path, base: 0, started: 0, bytes: 0, done: false, bytesPerSecond, abort: new AbortController() };
    (this.streams = this.streams || []).push(s);
    if (this.playing) this.queued.push(s);
    else if (autostart === "0") { this.waiting = s; this.stat("STMl"); }
    else this.begin(s);
    this.read(port, s);
  }

  async read(port, s) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + s.path, { signal: s.abort.signal });
      for await (const chunk of r.body) s.bytes += chunk.length;
    } catch (e) { /* stopped */ }
    s.done = true;
    this.fetched.push({ path: s.path, bytes: s.bytes });
    if (!s.abort.signal.aborted) this.stat("STMd");
  }

  /* A run heard for as long as what it has had lasts; to its end once read to its end. */
  schedule() {
    const p = this.playing;
    if (!p || p.bytesPerSecond === undefined) return super.schedule();
    this.later(50, () => {
      if (this.playing !== p) return;
      if (this.paused || !p.done || this.elapsedMs() < p.bytes / p.bytesPerSecond * 1000) return this.schedule();
      if (this.queued.length) this.begin(this.queued.shift());
      else { this.playing = null; this.stat("STMu"); }
    });
  }

  stopAll() { for (const s of this.streams || []) s.abort.abort(); this.streams = []; super.stopAll(); }
}

module.exports = { FakeSlimPcm };
