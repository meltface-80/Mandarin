"use strict";
/*
 * Conversions made ahead of play are TRANSCODE_CONCURRENCY at a time, never
 * more (item 188). The count of those running was checked under the queue's
 * lock but added to only after the conversion had started, outside it: two
 * asking at once (two zones' queues filled, a renderer read as another's
 * queue was) both saw room for one more and both started theirs. ffmpeg is
 * stood in for by a script that notes when each conversion starts and ends;
 * one at a time, many tracks are queued at once, each its own request.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}
const TRACKS = 16;

/* The most conversions running at once, from the stand-in's notes ("start <pid> <ns>", "end <pid> <ns>"). */
function most(lines) {
  const events = lines.map(l => l.split(" ")).filter(p => p.length === 3).map(([what, , at]) => [BigInt(at), what === "start" ? 1 : -1]);
  events.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  let n = 0, top = 0;
  for (const [, d] of events) { n += d; top = Math.max(top, n); }
  return top;
}

test("conversions made ahead: one at a time when the limit is one, however many ask at once", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  // Hi-res tracks, each converted for the phone (24/48, the rule without a DAC), each in an album of its own.
  for (let i = 1; i <= TRACKS; i++) {
    gen(path.join(lib.music, "Artist H", `Hi Album ${i}`, "01 Hi.flac"), { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], seconds: 1,
      tags: { title: `Hi ${i}`, artist: "Artist H", album: `Hi Album ${i}`, track: 1 } });
  }
  const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
  const real = require("child_process").execFileSync("sh", ["-c", 'command -v "$0"', FFMPEG]).toString().trim();
  const notes = path.join(lib.root, "conversions.log"), stand = path.join(lib.root, "ffmpeg-stand-in.sh");
  // A conversion (it writes a .part) takes a second longer than it would, its start and end noted.
  fs.writeFileSync(stand, `#!/bin/sh\ncase "$*" in *.part*) echo "start $$ $(date +%s%N)" >> '${notes}'; sleep 1; '${real}' "$@"; rc=$?; echo "end $$ $(date +%s%N)" >> '${notes}'; exit $rc;; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const before = { ff: process.env.FFMPEG_PATH, n: process.env.TRANSCODE_CONCURRENCY };
  process.env.FFMPEG_PATH = stand;
  process.env.TRANSCODE_CONCURRENCY = "1";
  t.after(() => {
    for (const [k, v] of [["FFMPEG_PATH", before.ff], ["TRANSCODE_CONCURRENCY", before.n]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await api("status")).index_count === 3 + TRACKS, 60000);
  const his = (await api("library/albums?sort=album")).albums.filter(a => /^Hi Album/.test(a.title));
  assert.equal(his.length, TRACKS);
  // The phone: the server never fetches for it, so every conversion is one made ahead.
  const PHONE = (await api("phone/hello", { name: "Pixel 8" })).zone_id;
  // Every album queued at once, each its own request.
  const rs = await Promise.all(his.map(a => api("play", { offset: a.offset, zone_or_output_id: PHONE, kind: "queue" })));
  assert.deepEqual(rs.map(r => r.status), his.map(() => 200));
  // All made, one after another.
  const read = () => (fs.existsSync(notes) ? fs.readFileSync(notes, "utf8") : "").split("\n").filter(Boolean);
  await until(() => read().filter(l => l.startsWith("end ")).length >= TRACKS, 90000);
  assert.equal(most(read()), 1, "conversions running at once:\n" + read().join("\n"));
});
