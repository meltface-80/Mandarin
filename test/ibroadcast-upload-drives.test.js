"use strict";
/*
 * Upload from any connected drive (item 455): the owner took a USB drive out of the music folders, still connected,
 * and wanted it sent all the same. The server's storage folder (its MUSIC_DIR, /data/Storage on Mandarin OS) has the
 * drives Mandarin OS mounts under USB/ and its own disk at Internal/; the library is another folder. A drive connected
 * after that, never read by the library:
 *   - offered in Upload from, as is the internal disk, beside the library's own;
 *   - sent from the drive: every audio file, as it is; covers, cue sheets, hidden files and lost+found left out;
 *   - a lossless file of it over the limit, its rate never read by the library, made FLAC at half the rate the file
 *     has (not half of 44.1 kHz), at 24 bits (its depth not known).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { makeLibrary, haveFfmpeg, gen, probe } = require("./fixtures");
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
const md5 = b => crypto.createHash("md5").update(b).digest("hex");
const LIMIT = 3000000;

test("item 455: Upload from any connected drive, read from the drive, whether or not the library has it", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "mandarin-storage-"));
  fs.mkdirSync(path.join(storage, "USB"), { recursive: true });
  t.after(() => fs.rmSync(storage, { recursive: true, force: true }));
  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: storage, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: LIMIT });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  // The library: another folder; the storage folder out of the music folders.
  const idle = () => until(async () => !(await call("GET", "status")).scanning, 60000, "no scan under way");
  await idle();
  assert.equal((await call("POST", "library/folders", { add: lib.music })).status, 200);
  // Taken out once no scan is under way (one is refused meanwhile: 409).
  await until(async () => (await call("POST", "library/folders", { remove: storage })).status === 200, 60000, "the storage folder taken out");
  await until(async () => (await call("GET", "status")).index_count >= 3 && !(await call("GET", "status")).scanning, 60000, "the library");

  // A drive connected after, never read by the library; and the box's own disk.
  const spare = path.join(storage, "USB", "Spare SSD");
  const at = (...p) => path.join(spare, ...p);
  // What a file of the drive is sent to iBroadcast as (item 480): its path from the drive.
  const sentAs = f => path.relative(spare, f).split(path.sep).join("/");
  gen(at("Band", "Record", "01 First.flac"), { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], tags: { title: "First" } });
  gen(at("Band", "Record", "02 Second.mp3"), { fmt: null, codecArgs: ["-b:a", "192k"], tags: { title: "Second" } });
  gen(at("Band", "Big", "01 Noise.wav"), { rate: 96000, seconds: 20, expr: "random(0)*2-1|random(1)*2-1" });
  gen(at("Band", "Record", ".hidden.flac"), {});
  gen(at("lost+found", "123.flac"), {});
  fs.writeFileSync(at("Band", "Record", "cover.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  fs.writeFileSync(at("Band", "Record", "Record.cue"), "FILE \"01 First.flac\" WAVE\n");
  gen(path.join(storage, "Internal", "Own", "01 Own.flac"), {});
  assert.ok(fs.statSync(at("Band", "Big", "01 Noise.wav")).size > LIMIT);
  assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path LIKE ?").get(storage + "%").n, 0, "the drive not in the library");

  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");

  await t.test("every connected drive offered, with the library's own", async () => {
    const s = await state();
    assert.deepEqual(s.upload_sources.map(x => [x.name, x.files]), [["Spare SSD", null], ["Internal", null], ["Artist A", 3], ["Artist B", 2], ["Comp", 2]]);
  });

  await t.test("a drive the library never read: its audio sent from it, as it is; the rest left out", async () => {
    assert.equal((await call("POST", "settings/ibroadcast/upload/settings", { from: spare })).status, 200);
    await call("POST", "settings/ibroadcast/upload");
    const u = await until(async () => { const x = (await state()).upload; return x && !x.running && x.finished && x; }, 120000, "the upload done");
    assert.deepEqual([u.from, u.uploaded, u.converted, u.failed, u.skipped], ["Spare SSD", 3, 1, 0, 0], JSON.stringify(u));
    const by = Object.fromEntries(ib.uploads.map(x => [x.file_path, x]));
    assert.deepEqual(Object.keys(by).sort(), [at("Band", "Big", "01 Noise.flac"), at("Band", "Record", "01 First.flac"), at("Band", "Record", "02 Second.mp3")].map(sentAs).sort());
    for (const f of [at("Band", "Record", "01 First.flac"), at("Band", "Record", "02 Second.mp3")]) assert.equal(by[sentAs(f)].md5, md5(fs.readFileSync(f)), "as it is: " + f);
    const big = by[sentAs(at("Band", "Big", "01 Noise.flac"))];
    assert.deepEqual(probe(big.data), { rate: 48000, channels: 2, bits: 24 }, "half its own rate, 24 bits");
    assert.ok(big.size <= LIMIT);
  });
});
