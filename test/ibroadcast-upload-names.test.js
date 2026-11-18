"use strict";
/*
 * The name a file is sent to iBroadcast as (item 480). A real upload's 46 files were taken by iBroadcast and never
 * kept, upload after upload: each had a long name (181 to 240 bytes), sent with the whole path here, over the 255 a name
 * field so often holds. The fake iBroadcast here keeps no file whose path is over 255 bytes, as that one seemed not to.
 *   - a file's name goes as it is, in UTF-8, as iBroadcast's own uploader sends it: .NET wrote a name that isn't ASCII
 *     as =?utf-8?B?…?=, a third longer and its extension hidden (all 46 had an È, ö or é);
 *   - a file is sent as its path from its drive, a long name cut to 100 bytes (its start, "…" and its extension kept)
 *     and outer folders left out past 160: kept;
 *   - one left by item 477 (taken twice, not kept, under its old name) is tried again under its new one;
 *   - the files here are untouched.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}
const bytes = s => Buffer.byteLength(s, "utf8");

test("item 480: a file is sent as its path from its drive, a long name shortened, and iBroadcast keeps it", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  // As the real one's: an opera's scene, its first words and who sings them, in a box set's disc folder.
  const name = "06 - Giuseppe Verdi - Falstaff I. Atto primo 2. Parte seconda 'Fulgida Alice!'-'Quell'otre! quel tino!' (Meg, Alice, Quickly, Nannetta) - 'È un ribaldo, un furbo, un ladro!' (Dr. Cajus, Bardolfo, Pistola, Fenton, Ford).flac";
  assert.ok(bytes(name) > 200, bytes(name));
  const long = path.join(lib.music, "Box", "Vol.05 1970-1972 (CD 80 - 102)", "CD 91", name);
  gen(long, { freq: 523, tags: { title: "Fulgida Alice", artist: "Giuseppe Verdi", album: "Vol.05 1970-1972 (CD 80 - 102)", track: 6 } });
  const before = crypto.createHash("md5").update(fs.readFileSync(long)).digest("hex");
  assert.ok(bytes(long) > 255, "over 255 as the whole path here: " + bytes(long));

  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  ib.notKept = p => bytes(p || "") > 255;   // taken, not kept: a path too long for it
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 50000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  await until(async () => (await call("GET", "status")).index_count >= 4, 60000, "the library");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  // Left by item 477 under its old name (the whole path): taken twice, never kept.
  ctx.db.raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('ibroadcast-upload', ?, ?, 0)").run(long,
    JSON.stringify({ size: fs.statSync(long).size, mtime: Math.floor(fs.statSync(long).mtimeMs), md5: before, flac: false, taken: 2, said: "File uploaded" }));
  assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: "all", at_once: 1 })).status, 200);
  assert.equal((await call("POST", "settings/ibroadcast/upload")).status, 200);
  const u = await until(async () => { const x = (await state()).upload; return x && !x.running && x.finished && x; }, 60000, "the upload done");
  assert.equal(u.error, null, JSON.stringify(u));

  const sent = ib.uploads.find(x => /Falstaff/.test(x.file_path));
  assert.ok(sent, "the long one tried again under its new name: " + JSON.stringify(ib.uploads.map(x => x.file_path)));
  assert.ok(bytes(sent.file_path) <= 160, sent.file_path);
  assert.ok(bytes(sent.name) <= 100, sent.name);
  assert.ok(!sent.name.startsWith("=?"), "its name as it is, not encoded: " + sent.name);
  assert.match(sent.name, /^06 - Giuseppe Verdi - Falstaff I\. Atto primo .*…\.flac$/);
  assert.equal(sent.file_path, "Vol.05 1970-1972 (CD 80 - 102)/CD 91/" + sent.name, "from its drive (Box), its folders kept");
  assert.ok(ib.md5s.includes(before), "and iBroadcast keeps it");
  assert.equal(u.skipped, 0, JSON.stringify(u.problems));
  // The others, from their drives too.
  assert.ok(ib.uploads.some(x => x.file_path === "Hi Res/01 Hi 1.flac"), JSON.stringify(ib.uploads.map(x => x.file_path)));
  assert.ok(ib.uploads.every(x => !x.file_path.startsWith("/")), "no path here sent");
  // Untouched here.
  assert.equal(crypto.createHash("md5").update(fs.readFileSync(long)).digest("hex"), before);
  assert.ok(fs.existsSync(long));
});
