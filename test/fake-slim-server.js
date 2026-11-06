"use strict";
/*
 * A stand-in SlimProto server (Mandarin's Renderers/Slim/ is the real one): a player connects to it, says hello, and is
 * told what to play (strm). What the player says (HELO, STAT, SETD) is kept, in order, for a test to read: the tests of
 * a Mandarin Bridge that need no Mandarin (test/bridge-no-dac.test.js).
 */
const net = require("net");

class FakeSlimServer {
  constructor() {
    /** @type {{ op: string, body: Buffer, event?: string }[]} */
    this.heard = [];
    /** @type {net.Socket | null} */
    this.player = null;
    /** @type {net.Server | null} */
    this.server = null;
  }

  /** Listening, on a port of its own: where a player is pointed (--server 127.0.0.1:<port>). */
  async start() {
    this.server = net.createServer(sock => {
      this.player = sock;
      let buf = Buffer.alloc(0);
      sock.on("data", d => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 8) {
          const len = buf.readUInt32BE(4);
          if (buf.length < 8 + len) break;
          const op = buf.toString("ascii", 0, 4), body = buf.subarray(8, 8 + len);
          this.heard.push({ op, body, event: op === "STAT" ? body.toString("ascii", 0, 4) : undefined });
          buf = buf.subarray(8 + len);
        }
      });
      sock.on("error", () => {});
    });
    await new Promise(r => this.server && this.server.listen(0, "127.0.0.1", () => r(null)));
    const a = this.server.address();
    this.port = a && typeof a === "object" ? a.port : 0;
  }

  /** The STAT events heard, in order. */
  events() { return this.heard.filter(h => h.event).map(h => h.event); }

  /**
   * strm [cmd] to the player: for 's', the track at http://127.0.0.1:[port][path], started at once ([autostart] '1') or
   * to wait for 'u' ('0').
   * @param {string} cmd
   * @param {{ port?: number, path?: string, autostart?: string }} [o]
   */
  strm(cmd, o = {}) {
    const request = cmd === "s" ? `GET ${o.path} HTTP/1.0\r\nHost: 127.0.0.1:${o.port}\r\n\r\n` : "";
    const b = Buffer.alloc(24 + request.length);
    b.write(cmd, 0, "ascii");
    b.write(o.autostart || "1", 1, "ascii");
    b.write("f", 2, "ascii");
    b.writeUInt16BE(o.port || 0, 18);
    b.writeUInt32BE(0x7f000001, 20);
    b.write(request, 24, "latin1");
    this.send("strm", b);
  }

  /** A frame to the player: its length (2 bytes), its four letters, the rest. */
  send(op, body) {
    if (!this.player) throw new Error("no player connected");
    const head = Buffer.alloc(6);
    head.writeUInt16BE(4 + body.length, 0);
    head.write(op, 2, "ascii");
    this.player.write(Buffer.concat([head, body]));
  }

  close() {
    if (this.player) this.player.destroy();
    if (this.server) this.server.close();
  }
}

module.exports = { FakeSlimServer };
