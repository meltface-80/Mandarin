"use strict";
/*
 * A stand-in SlimProto player (item 312, Renderers/Slim/): a Squeezelite, as its own source (slimproto.c) says one
 * talks. It finds the server by a UDP 'e' to the port, connects to TCP, says hello (HELO) with its MAC and what it
 * plays, answers setd 0 with its name, and does what strm says: 's' fetches the stream over HTTP and plays it,
 * waiting for 'u' where it was told not to start (autostart '0'); a stream given while one plays follows it at its
 * end, as Squeezelite's buffer goes on into it (STMs as it begins). Each stream plays [seconds] long, in real time.
 * It reports as Squeezelite does: STMf flushed, STMl buffered, STMd the stream read, STMs a track begun, STMp, STMr,
 * STMu all played, STMt to the server's 't', with how far into the track it is. log: every command, in order.
 * [refuse]: the streams it can't play (item 346), which it says so of (STMn) and fetches nothing of. [early]: it begins
 * a stream once its first bytes are in, as a player's buffer does, not once the whole of it is read.
 */
const net = require("net");
const dgram = require("dgram");

class FakeSlim {
  /** @param {{ port: number, name?: string, mac?: string, caps?: string, seconds?: number, refuse?: RegExp, refuseError?: number, early?: boolean }} o */
  constructor({ port, name = "Fake Slim", mac = "02:00:00:00:00:31", caps = "Model=squeezelite,ModelName=SqueezeLite,MaxSampleRate=192000,dsf,dff,flc,pcm,mp3", seconds = 2, refuse = null, refuseError = 0, early = false }) {
    Object.assign(this, { port, name, mac, caps, seconds, refuse, refuseError, early });
    this.log = [];        // "strm s f 0 /stream/t1.flac", "strm u", "audg 19661", …
    this.fetched = [];    // { path, bytes }
    this.requests = [];   // each strm s's HTTP request, whole
    this.gain = null;
    this.playing = null;  // { path, started, base } the stream being heard
    this.queued = [];     // streams read, waiting to be heard
    this.paused = false;
    this.timers = new Set();
  }

  /* The server's answer to 'e': its tags, as 'E' and four letters, a length, a value each. */
  static discover(port) {
    return new Promise((resolve, reject) => {
      const s = dgram.createSocket("udp4");
      const t = setTimeout(() => { s.close(); reject(new Error("no answer to discovery")); }, 3000);
      s.on("message", m => {
        clearTimeout(t); s.close();
        const tags = {};
        for (let i = 1; i + 5 <= m.length;) { const tag = m.toString("ascii", i, i + 4), n = m[i + 4]; tags[tag] = m.toString("utf8", i + 5, i + 5 + n); i += 5 + n; }
        resolve({ type: String.fromCharCode(m[0]), tags });
      });
      s.send(Buffer.from("e"), port, "127.0.0.1");
    });
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(this.port, "127.0.0.1", () => { this.hello(); resolve(this); });
      this.sock.on("error", reject);
      let buf = Buffer.alloc(0);
      this.sock.on("data", d => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 2) {
          const n = buf.readUInt16BE(0);
          if (buf.length < 2 + n) break;
          this.frame(buf.toString("ascii", 2, 6), buf.subarray(6, 2 + n));
          buf = buf.subarray(2 + n);
        }
      });
    });
  }

  close() { for (const t of this.timers) clearTimeout(t); if (this.sock) this.sock.destroy(); }

  send(op, body) {
    const h = Buffer.alloc(8); h.write(op, 0, "ascii"); h.writeUInt32BE(body.length, 4);
    if (this.sock && !this.sock.destroyed) this.sock.write(Buffer.concat([h, body]));
  }

  hello() {
    const b = Buffer.alloc(36);
    b[0] = 12;   // squeezeplay
    Buffer.from(this.mac.split(":").map(x => parseInt(x, 16))).copy(b, 2);
    this.send("HELO", Buffer.concat([b, Buffer.from(this.caps)]));
  }

  elapsedMs() { const p = this.playing; return p ? p.base + (this.paused || !p.started ? 0 : Date.now() - p.started) : 0; }

  /* [error]: a STMn's, as Mandarin's Bridges say it (1, the DAC stopped or isn't there; 0, the track). */
  stat(event, error = 0) {
    const b = Buffer.alloc(53);
    b.write(event, 0, "ascii");
    b.writeUInt16BE(error, 51);
    b.writeUInt32BE(this.elapsedMs(), 43);
    b.writeUInt32BE(Math.floor(this.elapsedMs() / 1000), 37);
    this.send("STAT", b);
  }

  later(ms, f) { const t = setTimeout(() => { this.timers.delete(t); f(); }, ms); this.timers.add(t); }

  frame(op, b) {
    if (op === "setd") { this.log.push("setd " + b[0]); if (b[0] === 0 && b.length === 1) this.send("SETD", Buffer.concat([Buffer.from([0]), Buffer.from(this.name + "\0")])); return; }
    if (op === "audg") { this.gain = b.readUInt32BE(10); this.log.push("audg " + this.gain); return; }
    if (op === "aude") { this.log.push("aude"); return; }
    if (op !== "strm") { this.log.push(op); return; }
    const cmd = String.fromCharCode(b[0]);
    if (cmd === "t") { this.stat("STMt"); return; }
    if (cmd === "q") { this.log.push("strm q"); this.stopAll(); this.stat("STMf"); return; }
    if (cmd === "p") { this.log.push("strm p"); if (this.playing) { this.playing.base = this.elapsedMs(); this.paused = true; } this.stat("STMp"); return; }
    if (cmd === "u") {
      this.log.push("strm u");
      if (this.waiting) { const w = this.waiting; this.waiting = null; this.begin(w); }
      else if (this.paused && this.playing) { this.paused = false; this.playing.started = Date.now(); this.schedule(); }
      this.stat("STMr");
      return;
    }
    if (cmd === "s") {
      const autostart = String.fromCharCode(b[1]), format = String.fromCharCode(b[2]);
      const port = b.readUInt16BE(18);
      const request = b.toString("ascii", 24);
      const path = request.split(" ")[1];
      this.log.push(`strm s ${format} ${autostart} ${path}`);
      this.requests.push(request);   // the whole HTTP request it was given, its headers too (item 315)
      if (this.refuse && this.refuse.test(path)) { this.stat("STMn", this.refuseError); return; }   // one it can't play (item 346)
      this.stat("STMc");
      const s = { path, base: 0, started: 0 };
      const buffered = () => {
        if (this.playing) this.queued.push(s);   // follows the one heard, from the buffer
        else if (autostart === "0") { this.waiting = s; this.stat("STMl"); }
        else this.begin(s);
      };
      this.fetch(port, path, this.early ? buffered : null).then(bytes => {
        this.fetched.push({ path, bytes });
        this.stat("STMd");                       // the stream read to its end
        if (!this.early) buffered();
      });
    }
  }

  /* The stream fetched whole: its length; [first] called once its first bytes are in. */
  async fetch(port, path, first = null) {
    try {
      const r = await fetch("http://127.0.0.1:" + port + path);
      if (!first) return (await r.arrayBuffer()).byteLength;
      let n = 0;
      for await (const c of r.body) { if (n === 0) first(); n += c.length; }
      return n;
    } catch (e) { return 0; }
  }

  begin(s) { this.playing = s; this.paused = false; s.started = Date.now(); this.stat("STMs"); this.schedule(); }

  /* The stream heard comes to its end: on into the next read, or all played. */
  schedule() {
    const p = this.playing;
    this.later(Math.max(0, this.seconds * 1000 - p.base), () => {
      if (this.playing !== p || this.paused) return;
      if (this.queued.length) this.begin(this.queued.shift());
      else { this.playing = null; this.stat("STMu"); }
    });
  }

  stopAll() { for (const t of this.timers) clearTimeout(t); this.timers.clear(); this.playing = null; this.queued = []; this.waiting = null; this.paused = false; }

  /* The path of the stream being heard. */
  current() { return this.playing && this.playing.path; }
}

module.exports = { FakeSlim };
