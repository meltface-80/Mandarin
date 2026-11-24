"use strict";
/*
 * An iBroadcast album's cover (item 504), against a stand-in on loopback (test/fake-ibroadcast.js). iBroadcast gives a
 * file with no picture in it a stand-in of its own (a loudspeaker with the title on it), and Mandarin took that for the
 * album's cover, so a real one was never looked for. Three folders uploaded, then read back as iBroadcast albums:
 *   - one with a cover.jpg beside its file (no picture in the file): the folder's picture is the album's cover;
 *   - one whose file holds a picture: iBroadcast's is that one, and is used;
 *   - one with neither: iBroadcast's is its stand-in, and none is kept, so the cover finder looks;
 * and an album Mandarin didn't upload keeps iBroadcast's picture, as before. The stand-in already kept as a cover (as on
 * a box from before) is put right at the next reading. And (item 509) an album uploaded before item 480, which sent the
 * file's whole path and recorded nothing of it, is traced by that path: its folder's picture, where iBroadcast's picture
 * had been kept for it by the first reckoning.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
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
const picture = (file, colour) => spawnSync(FFMPEG, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=400x400`, "-frames:v", "1", file]);

test("item 504: an uploaded iBroadcast album's cover is its folder's, iBroadcast's only where the file had one, none for the stand-in", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const m = lib.music;
  const up = (...p) => path.join(m, "Up", ...p);
  gen(up("With Cover", "01 One.flac"), { tags: { title: "One", artist: "Folder Band", album: "With Cover", track: 1 } });
  picture(up("With Cover", "cover.jpg"), "blue");
  // A file with its own picture: made, then the picture put in it.
  gen(up("Embedded", "plain.flac"), { tags: { title: "Two", artist: "Folder Band", album: "Embedded", track: 1 } });
  picture(up("Embedded", "art.png"), "green");
  spawnSync(FFMPEG, ["-loglevel", "error", "-y", "-i", up("Embedded", "plain.flac"), "-i", up("Embedded", "art.png"), "-map", "0:a", "-map", "1",
    "-c:a", "copy", "-c:v", "png", "-disposition:v", "attached_pic", up("Embedded", "01 Two.flac")]);
  fs.rmSync(up("Embedded", "plain.flac"));
  fs.rmSync(up("Embedded", "art.png"));
  gen(up("Bare", "01 Three.flac"), { tags: { title: "Three", artist: "Folder Band", album: "Bare", track: 1 } });
  // Uploaded before item 480 (by hand here: nothing of it in the upload's records), its whole path at iBroadcast.
  const old = path.join(lib.root, "Old Drive", "Old Upload");
  gen(path.join(old, "01 Four.flac"), { tags: { title: "Four", artist: "Folder Band", album: "Old Upload", track: 1 } });
  picture(path.join(old, "folder.jpg"), "yellow");

  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: m, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastUploadLimit: 2000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const state = () => call("GET", "settings/ibroadcast");
  const post = (p, body = {}) => call("POST", "settings/ibroadcast" + p, body);
  const db = ctx.db.raw;
  await until(async () => db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path LIKE '%/Up/%'").get().n >= 3 && !(await call("GET", "status")).scanning, 60000, "the library");
  await post("/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  assert.equal((await post("/upload/settings", { from: "all" })).status, 200);
  assert.equal((await post("/upload")).status, 200);
  await until(async () => { const s = await state(); return s.upload && !s.upload.running && s.upload.finished > 0; }, 120000, "the upload done");

  // iBroadcast's library as it lists what was sent: each track the path it was sent as, each with a picture of iBroadcast's.
  const sent = name => ib.uploads.find(u => u.name === name).file_path;
  const album = (id, name, file, artwork) => ({ id, name, artist: { id: 9, name: "At iBroadcast" }, year: 2020,
    tracks: [{ id: id * 10, title: name, track: 1, type: "audio/flac", artwork_id: artwork, path: file ? sent(file) : "elsewhere/" + name + ".flac" }] });
  ib.albums = [album(601, "With Cover", "01 One.flac", 701), album(602, "Embedded", "01 Two.flac", 702), album(603, "Bare", "01 Three.flac", 703),
    album(604, "Not Mine", null, 704),
    Object.assign(album(605, "Old Upload", null, 705), { tracks: [{ id: 6050, title: "Four", track: 1, type: "audio/flac", artwork_id: 705, path: path.join(old, "01 Four.flac") }] })];
  // As a box from before has it: the stand-in kept as a cover already, nothing decided.
  ib.changed();
  assert.equal((await post("/library")).status, 200);
  const row = id => db.prepare("SELECT art_path, art_hash FROM albums WHERE key = ?").get("ibroadcast:" + id);
  const cover = async (id, want) => until(() => { const r = row(id); return r && want(r) && r; }, 20000, "the cover of " + id);

  const withCover = await cover(601, r => r.art_hash && r.art_hash.startsWith("ibf"));
  assert.deepEqual(fs.readFileSync(withCover.art_path), fs.readFileSync(up("With Cover", "cover.jpg")), "the folder's picture");
  assert.ok(withCover.art_path.startsWith(lib.data), "kept beside the database, there when the drive is away");
  assert.equal((await cover(602, r => r.art_hash === "ib702")).art_hash, "ib702", "iBroadcast's: the file's own picture");
  assert.equal((await cover(604, r => r.art_hash === "ib704")).art_hash, "ib704", "not uploaded from here: iBroadcast's, as before");
  const oldOne = await cover(605, r => r.art_hash && r.art_hash.startsWith("ibf"));
  assert.deepEqual(fs.readFileSync(oldOne.art_path), fs.readFileSync(path.join(old, "folder.jpg")), "uploaded before item 480: traced by its whole path");
  const bare = await cover(603, r => r.art_path === null);
  assert.equal(bare.art_hash, null, "the stand-in: no cover kept");
  assert.ok(!ib.artworkAsks.includes("/artwork/artwork/701-1000") && !ib.artworkAsks.includes("/artwork/artwork/703-1000"), JSON.stringify(ib.artworkAsks));
  // With no cover of its own yet, its tile the drawn stand-in (its title's colour), not an empty square (item 526).
  const listed = await until(async () => (await (await fetch(base + "/api/library/albums?count=200", { headers: H })).json()).albums.find(a => a.title === "Bare"), 20000, "Bare listed");
  const tile = await fetch(base + "/api/image/" + encodeURIComponent(listed.image_key) + "?size=300", { headers: H });
  assert.equal(tile.status, 200, "Bare's tile drawn");
  assert.match(tile.headers.get("content-type") || "", /^image\//);

  // The stand-in kept on a box from before (its picture as the cover, nothing decided): put right at the next reading.
  db.prepare("UPDATE albums SET art_path = ?, art_hash = 'ib703' WHERE key = 'ibroadcast:603'").run(withCover.art_path);
  db.prepare("DELETE FROM cache WHERE ns = 'ibroadcast-art2'").run();
  // As the first reckoning left an album uploaded before item 480 (item 509): iBroadcast's picture, decided for good.
  db.prepare("UPDATE albums SET art_path = ?, art_hash = 'ib705' WHERE key = 'ibroadcast:605'").run(withCover.art_path);
  db.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('ibroadcast-art', 'ibroadcast:605', 'ibroadcast', 1)").run();
  ib.changed();
  assert.equal((await post("/library")).status, 200);
  await cover(603, r => r.art_path === null);
  assert.ok((await cover(601, r => r.art_hash && r.art_hash.startsWith("ibf"))).art_path);
  assert.deepEqual(fs.readFileSync((await cover(605, r => r.art_hash && r.art_hash.startsWith("ibf"))).art_path), fs.readFileSync(path.join(old, "folder.jpg")));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cache WHERE ns = 'ibroadcast-art'").get().n, 0, "the first reckoning's let go");
});
