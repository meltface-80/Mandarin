"use strict";
/*
 * A fake Mandarin Bridge renderer's /capture (github.com/meltface-80/Android-USB-Driver, its Capture.kt): a recording of
 * what it "feeds its DAC", for the server's bit-perfect check (item 275). POST /capture {seconds} arms one, from the
 * next track the device fetches; that fetch, decoded as the device's DAC would be fed it (32-bit slots), is the
 * recording, written as SQ-tool writes one, beside its sidecar. renderer.captureFilter (an ffmpeg -af, such as
 * "volume=-1dB") makes it something other than was sent; renderer.captureSkip, another track than the one played again.
 * Asked with {part, after_flush} (item 286: dac.captureParts, as Capture.kt in parts), the recording is kept in parts
 * of renderer.capturePart seconds (else [part]) one after another, sample for sample, at /capture/N.wav, each let go
 * by DELETE /capture/N; the asks are kept in renderer.captureAsks. renderer.captureCorrupt: parts no WAV reader can read.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

/** @param {any} r the FakeRenderer @param {import("http").IncomingMessage} req @param {import("http").ServerResponse} res @param {URL} u */
function handle(r, req, res, u) {
  const c = r.cap || (r.cap = { state: "idle", dir: fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-capture-")) });
  const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (req.method === "POST" && u.pathname === "/capture") {
    let body = "";
    req.on("data", d => { body += d; });
    req.on("end", () => {
      if (c.state === "armed" || c.state === "recording") return json(409, { state: c.state });
      const ask = JSON.parse(body || "{}");
      (r.captureAsks || (r.captureAsks = [])).push(ask);
      Object.assign(c, { state: "armed", seconds: ask.seconds || 30, from: r.fetches.length, frames: 0, rate: 0, part: ask.part ? (r.capturePart || ask.part) : 0, parts: [] });
      r.log.push("capture");
      json(202, { state: c.state });
    });
    return;
  }
  if (req.method === "GET" && u.pathname === "/capture") {
    if (c.state === "armed" || c.state === "recording") {
      // renderer.captureSkip: the nth track fetched after it was armed recorded instead (0: the first, the one played again).
      const f = r.fetches.slice(c.from).filter(x => x.done && x.body)[r.captureSkip || 0];
      if (f) record(r, c, f.body); else if (r.fetches.length > c.from) c.state = "recording";
    }
    return json(200, { state: c.state, reason: c.state === "done" ? "done" : "", frames: c.frames, rate: c.rate, channels: 2, container_bits: 32, kind: "pcm",
      parts: c.parts.map(n => ({ n, wav: `/capture/${n}.wav`, sidecar: `/capture/${n}.wav.json`, frames: c.partFrames[n] })) });
  }
  const part = /^\/capture\/(\d+)(\.wav(\.json)?)?$/.exec(u.pathname);
  if (part) {
    const n = Number(part[1]);
    if (!c.parts || !c.parts.includes(n)) { res.writeHead(404); return res.end(); }
    if (req.method === "DELETE" && !part[2]) { c.parts = c.parts.filter(x => x !== n); (r.captureDropped || (r.captureDropped = [])).push(n); return json(200, { state: c.state }); }
    if (req.method === "GET" && part[2]) {
      res.writeHead(200, { "Content-Type": part[3] ? "application/json" : "audio/wav" });
      return res.end(fs.readFileSync(path.join(c.dir, `capture-${n}${part[2]}`)));
    }
  }
  if (req.method === "GET" && (u.pathname === "/capture.wav" || u.pathname === "/capture.wav.json")) {
    if (c.state !== "done") { res.writeHead(404); return res.end(); }
    const file = path.join(c.dir, u.pathname.slice(1));
    res.writeHead(200, { "Content-Type": u.pathname.endsWith(".json") ? "application/json" : "audio/wav" });
    return res.end(fs.readFileSync(file));
  }
  if (req.method === "DELETE" && u.pathname === "/capture") { c.state = c.state === "done" ? "done" : "idle"; return json(200, { state: c.state }); }
  res.writeHead(404); res.end();
}

// The fetched track decoded into a capture: 32-bit words, at its own rate, at most [seconds] of it.
function record(r, c, body) {
  const src = path.join(c.dir, "fetched");
  fs.writeFileSync(src, body);
  const out = path.join(c.dir, "capture.wav");
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", src, "-t", String(c.seconds)];
  if (r.captureFilter) args.push("-af", r.captureFilter);
  args.push("-c:a", "pcm_s32le", out);
  const ff = spawnSync(process.env.FFMPEG || "ffmpeg", args, { encoding: "utf8" });
  if (ff.status !== 0) { c.state = "failed"; c.reason = ff.stderr; return; }
  const wav = fs.readFileSync(out);
  const rate = wav.readUInt32LE(24);
  // ffmpeg's header is longer than 44 bytes (WAVE_FORMAT_EXTENSIBLE, a LIST): the samples start after "data".
  const data0 = wav.indexOf("data", 12) + 8;
  c.rate = rate;
  c.frames = Math.floor((wav.length - data0) / 8);
  const sidecar = (frames, first) => JSON.stringify({ tool: "fake Mandarin Bridge", capture: { method: "usb-driver", rate, channels: 2, container_bits: 32, valid_bits: 32,
    dsd: false, kind: "pcm", dsd_setting: "pcm", frames, seconds: frames / rate, first_frame: first || 0, interruptions: [], usb: { underruns: 0, errors: 0 } } });
  fs.writeFileSync(out + ".json", sidecar(c.frames));
  c.partFrames = {};
  if (c.part) {
    // In parts: the same samples cut every [part] seconds, each part's WAV beginning on the frame after the last's.
    const per = c.part * rate;
    for (let n = 1, at = 0; at < c.frames; n++, at += per) {
      const frames = Math.min(per, c.frames - at);
      const data = wav.subarray(data0 + at * 8, data0 + (at + frames) * 8);
      const head = Buffer.from(wav.subarray(0, data0));
      head.writeUInt32LE(head.length - 8 + data.length, 4); head.writeUInt32LE(data.length, data0 - 4);
      // renderer.captureCorrupt: a part whose "fmt " chunk says it runs far past the file.
      if (r.captureCorrupt) head.writeUInt32LE(0x7ffffff0, 16);
      fs.writeFileSync(path.join(c.dir, `capture-${n}.wav`), Buffer.concat([head, data]));
      fs.writeFileSync(path.join(c.dir, `capture-${n}.wav.json`), sidecar(frames, at));
      c.parts.push(n); c.partFrames[n] = frames;
    }
  }
  c.state = "done";
}

module.exports = { handle };
