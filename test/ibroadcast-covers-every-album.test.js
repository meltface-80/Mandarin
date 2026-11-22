"use strict";
/*
 * Every iBroadcast album Mandarin uploaded gets its folder's cover and booklets (item 513). The covers were decided in
 * one run over the whole library after each reading, and one album's fault the run didn't foresee (the database busy
 * past its five seconds while the next reading or the upload wrote, a drive's folder failing to list) ended it there,
 * unsaid: the albums after it kept iBroadcast's stand-in (a loudspeaker with the title on it) reading after reading, the
 * owner's newest among them (Markus Stockhausen's Alba, its cover.jpg and booklet.pdf beside the files), and the booklets,
 * kept after the covers, were never looked at. Here the database refuses one album's cover (a trigger, as a busy database
 * would): the others still get theirs, and their booklets; the one is said in the log, and gets its cover at the next
 * reading. And a file iBroadcast already had is noted with the name it went as, which links its track back to its folder.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg, gen, pdf } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { until } = require("./helpers");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const picture = (file, colour) => spawnSync(FFMPEG, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=400x400`, "-frames:v", "1", file]);

test("item 513: one album's cover refused, the others get theirs and their booklets, it is said, and it gets its own next time", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const up = (...p) => path.join(lib.music, "Up", ...p);
  gen(up("Alba", "01 What Can I Do For You.flac"), { tags: { title: "What Can I Do For You?", artist: "Markus Stockhausen", album: "Alba", track: 1 } });
  picture(up("Alba", "cover.jpg"), "blue");
  fs.writeFileSync(up("Alba", "booklet.pdf"), pdf(["white"]));
  gen(up("Arctic Riff", "01 Vashkar.flac"), { tags: { title: "Vashkar", artist: "Marcin Wasilewski Trio", album: "Arctic Riff", track: 1 } });
  picture(up("Arctic Riff", "cover.jpg"), "red");
  // One iBroadcast has already (uploaded some time before): its MD5 among iBroadcast's.
  gen(up("Had", "01 Had.flac"), { tags: { title: "Had", artist: "Someone", album: "Had", track: 1 } });

  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
  ib.md5s.push(crypto.createHash("md5").update(fs.readFileSync(up("Had", "01 Had.flac"))).digest("hex"));
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
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

  await t.test("a file iBroadcast had already is noted with the name it goes as", async () => {
    const had = JSON.parse(db.prepare("SELECT value FROM cache WHERE ns = 'ibroadcast-upload' AND key = ?").get(up("Had", "01 Had.flac")).value);
    assert.equal(had.sent_as, "Had/01 Had.flac", JSON.stringify(had));
  });

  // Both albums in iBroadcast's library; the newer's cover refused by the database, as a busy one would.
  const sent = name => ib.uploads.find(u => u.name === name).file_path;
  const album = (id, name, file) => ({ id, name, artist: { id: 9, name: "ECM" }, year: 2016,
    tracks: [{ id: id * 10, title: name, track: 1, type: "audio/flac", artwork_id: id + 100, path: sent(file) }] });
  ib.albums = [album(801, "Alba", "01 What Can I Do For You.flac"), album(802, "Arctic Riff", "01 Vashkar.flac")];
  db.exec("CREATE TRIGGER refuse_arctic BEFORE UPDATE OF art_path ON albums WHEN NEW.key = 'ibroadcast:802' BEGIN SELECT RAISE(ABORT, 'refused for the test'); END");
  ib.changed();
  assert.equal((await post("/library")).status, 200);
  const row = id => db.prepare("SELECT art_path, art_hash FROM albums WHERE key = ?").get("ibroadcast:" + id);

  await t.test("the other album gets its folder's cover and its booklet; the refused one is said", async () => {
    const alba = await until(() => { const r = row(801); return r && r.art_hash && r.art_hash.startsWith("ibf") && r; }, 20000, "Alba's cover");
    assert.deepEqual(fs.readFileSync(alba.art_path), fs.readFileSync(up("Alba", "cover.jpg")));
    await until(() => fs.existsSync(path.join(lib.data, "ibroadcast", "booklets", "801", "booklet.pdf")), 20000, "Alba's booklet kept");
    const said = await until(() => ctx.logs.find(l => /\[ibroadcast\] covers: \d+ album\(s\) looked at/.test(l)), 20000, "the covers' line");
    assert.match(said, /— 1 from their folders, .*; 1 failed, tried again at the next reading \(first: ibroadcast:802: SqliteException: .*refused for the test/, said);
    assert.equal(row(802).art_path, null, "refused: no cover yet");
  });

  await t.test("the database takes it again: the next reading gives it its folder's cover", async () => {
    db.exec("DROP TRIGGER refuse_arctic");
    ib.changed();
    assert.equal((await post("/library")).status, 200);
    const arctic = await until(() => { const r = row(802); return r && r.art_hash && r.art_hash.startsWith("ibf") && r; }, 20000, "Arctic Riff's cover");
    assert.deepEqual(fs.readFileSync(arctic.art_path), fs.readFileSync(up("Arctic Riff", "cover.jpg")));
  });
});
