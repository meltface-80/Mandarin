"use strict";
/*
 * A fake MPD (item 306, Renderers/Mpd.cs): the player a Chord Poly carries beside its UPnP renderer, at port 6600.
 * It speaks MPD's protocol as 0.21 does — a greeting, a command a line, "key: value" lines and OK, ACK for what it
 * doesn't know — over a queue it plays in real time, one entry into the next by itself (gapless), each [seconds] long.
 * It never fetches what it is given; log holds every command, in order.
 */
const net = require("net");

class FakeMpd {
  /** @param {{ seconds?: number }} [o] */
  constructor({ seconds = 4 } = {}) {
    this.seconds = seconds;
    this.queue = [];            // { id, file }
    this.pos = -1;
    this.state = "stop";
    this.base = 0; this.at = Date.now();
    this.nextId = 1;
    this.volume = 50;
    this.log = [];
    this.server = net.createServer(sock => this.serve(sock));
  }

  start() { return new Promise(r => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; r(this); })); }
  stop() { return new Promise(r => this.server.close(() => r())); }

  elapsed() { return this.state === "play" ? this.base + (Date.now() - this.at) / 1000 : this.base; }
  setElapsed(s) { this.base = s; this.at = Date.now(); }

  /* Time passed: on into the next entry at each one's end, gapless; stopped after the last. */
  tick() {
    while (this.state === "play" && this.pos >= 0 && this.elapsed() >= this.seconds) {
      const over = this.elapsed() - this.seconds;
      if (this.pos + 1 < this.queue.length) { this.pos++; this.setElapsed(over); this.log.push("auto-next"); }
      else { this.state = "stop"; this.pos = -1; this.setElapsed(0); }
    }
  }

  current() { return this.pos >= 0 ? this.queue[this.pos] : null; }

  status() {
    this.tick();
    const lines = [`volume: ${this.volume}`, "repeat: 0", "random: 0", "single: 0", "consume: 0", "playlist: 1",
      `playlistlength: ${this.queue.length}`, `state: ${this.state}`];
    if (this.pos >= 0) {
      lines.push(`song: ${this.pos}`, `songid: ${this.queue[this.pos].id}`, `elapsed: ${this.elapsed().toFixed(3)}`, `duration: ${this.seconds.toFixed(3)}`);
    }
    return lines;
  }

  run(cmd, args) {
    this.tick();
    switch (cmd) {
      case "status": return this.status();
      case "currentsong": { const c = this.current(); return c ? [`file: ${c.file}`, `Pos: ${this.pos}`, `Id: ${c.id}`, `duration: ${this.seconds.toFixed(3)}`] : []; }
      case "clear": this.queue = []; this.pos = -1; this.state = "stop"; this.setElapsed(0); return [];
      case "add": this.queue.push({ id: this.nextId++, file: args[0] }); return [];
      case "delete": {
        const [a, b] = String(args[0]).split(":").map(Number);
        this.queue.splice(a, (Number.isFinite(b) ? b : a + 1) - a);
        return [];
      }
      case "play": {
        const n = args.length ? Number(args[0]) : Math.max(0, this.pos);
        if (n >= this.queue.length) throw new Error("Bad song index");
        this.pos = n; this.state = "play"; this.setElapsed(0); return [];
      }
      case "pause": {
        const e = this.elapsed();
        if (args[0] === "1") { this.state = "pause"; this.setElapsed(e); } else if (this.state === "pause") { this.state = "play"; this.setElapsed(e); }
        return [];
      }
      case "stop": this.state = "stop"; this.setElapsed(0); return [];
      case "seekcur": this.setElapsed(Number(args[0])); return [];
      case "setvol": this.volume = Number(args[0]); return [];
      case "random": case "repeat": case "single": case "consume": case "ping": return [];
      default: throw new Error(`unknown command "${cmd}"`);
    }
  }

  serve(sock) {
    sock.write("OK MPD 0.21.11\n");
    let buf = "", list = null;
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        const parts = [...line.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)].map(m => m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2]);
        const [cmd, ...args] = parts;
        if (!cmd) continue;
        if (cmd === "command_list_begin") { list = []; continue; }
        if (cmd === "close") { sock.end(); return; }
        if (cmd === "command_list_end") {
          const out = [];
          try { for (const [c, a] of list) { this.log.push([c, ...a].join(" ")); out.push(...this.run(c, a)); } sock.write(out.map(l => l + "\n").join("") + "OK\n"); }
          catch (e) { sock.write(`ACK [5@0] {} ${e.message}\n`); }
          list = null; continue;
        }
        if (list) { list.push([cmd, args]); continue; }
        try { this.log.push([cmd, ...args].join(" ")); sock.write(this.run(cmd, args).map(l => l + "\n").join("") + "OK\n"); }
        catch (e) { sock.write(`ACK [5@0] {${cmd}} ${e.message}\n`); }
      }
    });
    sock.on("error", () => {});
  }
}

module.exports = { FakeMpd };
