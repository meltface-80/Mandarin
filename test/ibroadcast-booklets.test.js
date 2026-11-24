"use strict";
/*
 * An iBroadcast album's booklets (item 505), against a stand-in on loopback (test/fake-ibroadcast.js): an album Mandarin
 * uploaded has the PDFs of the folder it was sent from (and of a folder in it with no music, "Scans"), as an album of
 * files has, and their pages drawn; one iBroadcast has from elsewhere has none. The page and the app ask for them on an
 * iBroadcast album as on one of files (public/app/page-state.js, AlbumScreen.kt). And (item 510) each album's booklets
 * are kept in the data folder while its drive is here, so they show once the drives are taken away; Settings →
 * iBroadcast says how many albums' are kept, and how many wait for their drive. And (item 511) a backup carries the
 * covers and booklets kept here: lost, a restore puts them back, the folder's cover shown again and the booklets.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg, gen, pdf } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const havePoppler = () => spawnSync("pdftoppm", ["-v"]).status === 0;
const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!havePoppler() && !process.env.CI && "poppler (pdftoppm) is not installed");
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

test("item 505: an uploaded iBroadcast album has the booklets of the folder it was sent from", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const dir = path.join(lib.music, "Up", "Slow Snow");
  gen(path.join(dir, "01 Shelter.flac"), { tags: { title: "Shelter", artist: "Tore Brunborg", album: "Slow Snow", track: 1 } });
  fs.writeFileSync(path.join(dir, "booklet.pdf"), pdf(["0 0 1", "1 0 0"]));
  fs.copyFileSync(path.join(lib.music, "Artist A", "Album One", "cover.jpg"), path.join(dir, "cover.jpg"));
  fs.mkdirSync(path.join(dir, "Scans"));
  fs.writeFileSync(path.join(dir, "Scans", "Inlay.pdf"), pdf(["0 1 0"]));
  // Uploaded before item 480 (item 509): its whole path at iBroadcast, nothing of it in the upload's records.
  const old = path.join(lib.root, "Old Drive", "Old Upload");
  gen(path.join(old, "01 Four.flac"), { tags: { title: "Four", artist: "Old Band", album: "Old Upload", track: 1 } });
  fs.writeFileSync(path.join(old, "booklet.pdf"), pdf(["1 1 0"]));

  const ib = await new FakeIBroadcast().start();
  ib.slowOnce = false;
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
  await until(async () => db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path LIKE '%/Up/%'").get().n >= 1 && !(await call("GET", "status")).scanning, 60000, "the library");
  await post("/signin");
  ib.approve();
  await until(async () => (await state()).connected, 15000, "signed in");
  assert.equal((await post("/upload/settings", { from: "all" })).status, 200);
  assert.equal((await post("/upload")).status, 200);
  await until(async () => { const s = await state(); return s.upload && !s.upload.running && s.upload.finished > 0; }, 120000, "the upload done");

  const sent = ib.uploads.find(u => u.name === "01 Shelter.flac").file_path;
  ib.albums = [
    { id: 801, name: "Slow Snow (iBroadcast)", artist: { id: 9, name: "At iBroadcast" }, year: 2015, tracks: [{ id: 8010, title: "Shelter", track: 1, type: "audio/flac", artwork_id: 1, path: sent }] },
    { id: 802, name: "From Elsewhere", artist: { id: 9, name: "At iBroadcast" }, year: 2015, tracks: [{ id: 8020, title: "Away", track: 1, type: "audio/flac", artwork_id: 2, path: "elsewhere/Away.flac" }] },
    { id: 803, name: "Old Upload", artist: { id: 9, name: "At iBroadcast" }, year: 2015, tracks: [{ id: 8030, title: "Four", track: 1, type: "audio/flac", artwork_id: 3, path: path.join(old, "01 Four.flac") }] },
    // Uploaded from a drive that isn't connected now: its booklets wait for it.
    { id: 804, name: "Drive Away", artist: { id: 9, name: "At iBroadcast" }, year: 2015, tracks: [{ id: 8040, title: "Five", track: 1, type: "audio/flac", artwork_id: 4, path: "/media/Away Drive/Drive Away/01 Five.flac" }] },
  ];
  ib.changed();
  assert.equal((await post("/library")).status, 200);
  const offset = key => until(() => db.prepare("SELECT id FROM albums WHERE key = ?").get(key)?.id, 15000, key);
  const uploaded = await offset("ibroadcast:801"), elsewhere = await offset("ibroadcast:802");

  // Kept here once the reading has looked (item 510): two albums' booklets, one album waiting for its drive.
  const kept = await until(async () => { const b = (await state()).library?.booklets; return b && b.albums === 2 && b; }, 30000, "the booklets kept");
  assert.equal(kept.waiting, 1, JSON.stringify(kept));
  assert.ok(kept.bytes > 0);
  // The drives taken away: the booklets are still there.
  fs.renameSync(dir, dir + " (gone)");
  fs.renameSync(old, old + " (gone)");
  const booklets = await until(async () => { const b = await call("GET", "album/booklets?offset=" + uploaded); return b.booklets && b.booklets.length === 2 && b.booklets; }, 20000, "the booklets");
  assert.deepEqual(booklets.map(b => [b.name, b.pages]).sort(), [["Scans - Inlay", 1], ["booklet", 2]]);
  const page = await fetch(`${base}/api/booklet/page?offset=${uploaded}&id=${booklets.find(b => b.name === "booklet").id}&page=2&w=480`, { headers: H });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), "image/jpeg");
  assert.deepEqual((await call("GET", "album/booklets?offset=" + elsewhere)).booklets, [], "not uploaded from here: none");

  // A backup with the iBroadcast albums' covers and booklets (item 511); all of them then lost; restored: back.
  const art = () => db.prepare("SELECT art_path, art_hash FROM albums WHERE key = 'ibroadcast:801'").get();
  const cover = await until(() => { const a = art(); return a && a.art_hash && a.art_hash.startsWith("ibf") && a; }, 20000, "the folder's cover kept");
  const coverBytes = fs.readFileSync(cover.art_path);
  const made = await fetch(base + "/api/backup/file", { method: "POST", headers: H, body: JSON.stringify({ include: ["ibroadcast"] }) });
  assert.equal(made.status, 200);
  const backup = Buffer.from(await made.arrayBuffer());
  fs.rmSync(path.join(lib.data, "ibroadcast", "booklets"), { recursive: true, force: true });
  fs.rmSync(cover.art_path);
  db.prepare("DELETE FROM cache WHERE ns IN ('ibroadcast-art2', 'ibroadcast-booklets')").run();
  db.prepare("UPDATE albums SET art_path = NULL, art_hash = NULL WHERE key = 'ibroadcast:801'").run();
  assert.deepEqual((await call("GET", "album/booklets?offset=" + uploaded)).booklets, [], "lost, with the drives gone");
  const boot = async () => { try { return (await (await fetch(base + "/server-info")).json()).boot; } catch (e) { return null; } };
  const boot0 = await boot();
  const back = await fetch(base + "/api/backup/restore?parts=ibroadcast", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip" }, body: backup });
  const restored = await back.json();
  assert.equal(back.status, 200, JSON.stringify(restored));
  assert.deepEqual(restored.restored, ["ibroadcast"]);
  await until(async () => { const b = await boot(); return b && b !== boot0; }, 30000, "the server started again");
  assert.deepEqual(fs.readFileSync(cover.art_path), coverBytes, "the folder's cover back in the data folder");
  const again = await until(async () => { const b = await call("GET", "album/booklets?offset=" + uploaded); return b.booklets && b.booklets.length === 2 && b.booklets; }, 20000, "the booklets back");
  assert.deepEqual(again.map(b => b.name).sort(), ["Scans - Inlay", "booklet"]);
  // The album's cover from it again at the next reading, its drive still gone.
  ib.changed();
  assert.equal((await post("/library")).status, 200);
  await until(() => { const a = art(); return a && a.art_hash && a.art_hash.startsWith("ibf"); }, 20000, "the folder's cover shown again");
  const older = await offset("ibroadcast:803");
  assert.deepEqual((await call("GET", "album/booklets?offset=" + older)).booklets.map(b => [b.name, b.pages]), [["booklet", 1]], "uploaded before item 480: traced by its whole path");

  // The page and the app ask for an iBroadcast album's booklets, as for one of files (they asked only for those).
  const root = path.join(__dirname, "..");
  assert.match(fs.readFileSync(path.join(root, "public/app/page-state.js"), "utf8"), /album\.source !== "local" && album\.source !== "ibroadcast"\)\) return;/);
  assert.match(fs.readFileSync(path.join(root, "android/app/src/main/java/com/musicd/server/android/AlbumScreen.kt"), "utf8"),
    /a\.album\.source == "local" \|\| a\.album\.source == "ibroadcast"\) booklets =/);
});
