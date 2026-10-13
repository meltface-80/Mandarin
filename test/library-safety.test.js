"use strict";
/*
 * Nothing you did is lost, and nothing is read again from scratch, when the
 * container is replaced or updated: moved mounts are recognised, a drive that
 * isn't mounted keeps its albums, and album edits come back even if the
 * database itself has to start over.
 *
 * On the C# server (v0.8.50, stage 7 part 5; lib/library's scanner, database
 * and copy before): its scans asked for as Rescan asks (their results as
 * /api/status gives them), its folders let go and removed as Settings does,
 * its edits made and read as the album page does, and its database opened by
 * `mandarin-server db`. "No file read again" is a scan that added and changed
 * nothing: the scan counts a file read as one or the other (Scanner.cs).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { built, BIN } = require("./server");
const { libraryServer } = require("./library-server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const T = { skip, timeout: 120000 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/* An album's id by the title its files carry. */
const idOf = (s, title) => (s.db.raw.prepare("SELECT id FROM albums WHERE title = ?").get(title) || {}).id;
/* Every album, by the title its files carry, with its id. */
const albumIds = (s) => s.db.raw.prepare("SELECT title, id FROM albums ORDER BY title, id").raw().all();
/* The album as its Edit page shows it: { title, artist, year, edited, image_key, scanned, … }. */
const edited = (s, id) => s.getJ("/api/album/edit?offset=" + id);
async function until(fn, what, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(150);
  }
}
/* A folder let go (the page's Forget on a missing folder): { status, removed, error }. */
async function forget(s, dir) {
  const r = await s.postJ("/api/library/forget-folder", { dir });
  return Object.assign({ status: r.status }, r.j);
}
/* A music folder added in Settings, and the scan it starts waited for until [ready]. */
async function addFolder(s, dir, ready) {
  const r = await s.postJ("/api/library/folders", { add: dir });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  await until(async () => { const st = await s.status(); return !st.scan.running && ready(); }, "the added folder read");
}

test("a moved music mount keeps every album, id and edit, and reads no file again", T, async (t) => {
  const lib = makeLibrary();
  let s = await libraryServer(t, lib);
  const before = albumIds(s);
  const oneId = idOf(s, "Album One");
  const r0 = await s.postJ("/api/album/edit", { offset: oneId, title: "Album One (fixed)", year: 1999 });
  assert.equal(r0.status, 200, JSON.stringify(r0.j));
  await s.stop();

  // /music  →  /music/4tb, as when a second drive is added.
  const root = path.join(lib.root, "mroot");
  fs.mkdirSync(root);
  fs.renameSync(lib.music, path.join(root, "4tb"));
  const db = new Database(path.join(lib.data, "musicd.db"), { readonly: true });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM albums").get().n, 3, "albums are there before any scan");
  db.close();
  s = await libraryServer(t, { music: root, data: lib.data });
  const r = (await s.status()).scan.last;
  assert.equal(r.added, 0, "no file read again");
  assert.equal(r.changed, 0, "no file read again");
  assert.equal(r.relocated, 7);
  assert.equal(r.removed, 0);
  assert.deepEqual(albumIds(s), before);
  const one = await edited(s, oneId);
  assert.equal(one.title, "Album One (fixed)");
  assert.equal(one.year, 1999);
  const paths = s.db.raw.prepare("SELECT path FROM tracks WHERE album_id = ?").pluck().all(oneId);
  assert.equal(paths.length, 3);
  assert.ok(paths.every(p => p.startsWith(path.join(root, "4tb") + "/")), paths.join("\n"));
});

test("a drive that isn't mounted keeps its albums until it's back", T, async (t) => {
  const lib = makeLibrary();
  const root = path.join(lib.root, "mroot");
  fs.mkdirSync(path.join(root, "2tb"), { recursive: true });
  fs.renameSync(lib.music, path.join(root, "4tb"));
  fs.renameSync(path.join(root, "4tb", "Artist B"), path.join(root, "2tb", "Artist B"));
  const s = await libraryServer(t, { music: root, data: lib.data });

  // The 2tb drive isn't there: Docker still shows its mount point, empty.
  const stash = path.join(lib.root, "stash");
  fs.renameSync(path.join(root, "2tb"), stash);
  fs.mkdirSync(path.join(root, "2tb"));
  let r = await s.scan();
  assert.equal(r.removed, 0);
  assert.equal(r.kept_offline, 2);
  assert.ok(idOf(s, "Hi Res"), "Hi Res is still in the library");
  assert.ok((await s.albums()).some(a => a.title === "Hi Res"), "and in its lists");

  // Nothing at all mounted: everything kept.
  const stash4 = path.join(lib.root, "stash4");
  fs.renameSync(path.join(root, "4tb"), stash4);
  fs.mkdirSync(path.join(root, "4tb"));
  r = await s.scan();
  assert.equal(r.removed, 0);
  assert.equal(s.db.raw.prepare("SELECT COUNT(*) n FROM tracks").get().n, 7);

  // Back again: nothing to read.
  fs.rmdirSync(path.join(root, "2tb")); fs.renameSync(stash, path.join(root, "2tb"));
  fs.rmdirSync(path.join(root, "4tb")); fs.renameSync(stash4, path.join(root, "4tb"));
  r = await s.scan();
  assert.equal(r.status, "unchanged");
  assert.equal(r.added + r.changed, 0, "no file read again");

  // A folder really deleted (not an empty mount point) is removed.
  fs.rmSync(path.join(root, "2tb", "Artist B"), { recursive: true });
  fs.writeFileSync(path.join(root, "2tb", "readme.txt"), "not music");
  r = await s.scan();
  assert.equal(r.removed, 2);
});

test("a music folder left off a new container keeps its albums, says so, and can be forgotten", T, async (t) => {
  const lib = makeLibrary();
  const root = path.join(lib.root, "mroot");
  fs.mkdirSync(path.join(root, "HiRes"), { recursive: true });
  fs.renameSync(lib.music, path.join(root, "Main"));
  fs.renameSync(path.join(root, "Main", "Artist B"), path.join(root, "HiRes", "Artist B"));
  const s = await libraryServer(t, { music: root, data: lib.data });
  const hiResId = idOf(s, "Hi Res");

  // Re-created without its -v line: the folder isn't there at all (not even empty).
  const stash = path.join(lib.root, "stash");
  fs.renameSync(path.join(root, "HiRes"), stash);
  let r = await s.scan();
  assert.equal(r.removed, 0, "nothing removed");
  assert.equal(r.kept_offline, 2);
  assert.deepEqual(r.offline_dirs.map(d => [d.name, d.tracks, d.missing]), [["HiRes", 2, true]]);
  assert.equal(idOf(s, "Hi Res"), hiResId, "the same album, id and all");

  // Forgetting a folder that's there takes only files that are gone (none here),
  // and only in one of the music folders.
  const main = await forget(s, path.join(root, "Main"));
  assert.equal(main.status, 200, JSON.stringify(main));
  assert.equal(main.removed, 0);
  const etc = await forget(s, "/etc");
  assert.equal(etc.status, 400);
  assert.match(etc.error, /music folders/);

  // Back: the same album, nothing read again.
  fs.renameSync(stash, path.join(root, "HiRes"));
  r = await s.scan();
  assert.equal(r.status, "unchanged");
  assert.deepEqual(r.offline_dirs, []);
  assert.equal(idOf(s, "Hi Res"), hiResId);

  // Gone for good, and forgotten: its tracks and albums leave.
  fs.rmSync(path.join(root, "HiRes"), { recursive: true });
  r = await s.scan();
  assert.equal(r.removed, 0);
  const gone = await forget(s, path.join(root, "HiRes"));
  assert.equal(gone.removed, 2);
  assert.equal(idOf(s, "Hi Res"), undefined);
  assert.ok(!(await s.albums()).some(a => a.title === "Hi Res"), "out of its lists");
  assert.deepEqual((await s.status()).scan.last.offline_dirs, []);
});

test("album edits come back when the database has to start over", T, async (t) => {
  const lib = makeLibrary();
  // A cover found on the web: here, the other album's picture, from an address on this machine.
  const cover = fs.readFileSync(path.join(lib.music, "Artist A", "Album One", "cover.jpg"));
  const web = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(cover); });
  await new Promise(r => web.listen(0, "127.0.0.1", r));
  t.after(() => web.close());
  let s = await libraryServer(t, lib);
  const saved = await s.postJ("/api/album/edit", { offset: idOf(s, "Hi Res"), artist: "Artist B (fixed)", art_url: `http://127.0.0.1:${web.address().port}/cover.jpg`, art_source: "Deezer" });
  assert.equal(saved.status, 200, JSON.stringify(saved.j));
  const art = s.db.raw.prepare("SELECT art, art_source FROM album_edits").get();
  assert.ok(art.art && art.art.length > 0);
  assert.equal(art.art_source, "Deezer");
  await s.stop();
  assert.ok(fs.existsSync(path.join(lib.data, "album-edits.json")));

  for (const f of fs.readdirSync(lib.data)) if (f.startsWith("musicd.db")) fs.rmSync(path.join(lib.data, f));
  s = await libraryServer(t, lib);
  const hr = await edited(s, idOf(s, "Hi Res"));
  assert.equal(hr.artist, "Artist B (fixed)");
  assert.equal(hr.edited, true);
  assert.match(hr.image_key, /-e[0-9a-f]+$/, "its own cover");
  const back = s.db.raw.prepare("SELECT art, art_source FROM album_edits").get();
  assert.ok(Buffer.from(back.art).equals(Buffer.from(art.art)), "the same picture");
  assert.equal(back.art_source, "Deezer");
});

/* The database opened as the server opens it (`mandarin-server db <dir>`). */
function openDb(dir) {
  const r = spawnSync(BIN, ["db", dir], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return new Database(path.join(dir, "musicd.db"));
}

test("a database that has to be replaced hands over edits, plays and settings", { skip: built() }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-db-"));
  const old = new Database(path.join(dir, "musicd.db"));
  old.exec(`CREATE TABLE tracks (id INTEGER PRIMARY KEY, path TEXT);
            CREATE TABLE album_edits (key TEXT PRIMARY KEY, title TEXT, artist TEXT, year INTEGER, art BLOB, art_hash TEXT, art_source TEXT, updated_at INTEGER NOT NULL);
            INSERT INTO album_edits(key, title, updated_at) VALUES('a\u0001b', 'Fixed', 1);
            CREATE TABLE plays (id INTEGER PRIMARY KEY, album_id INTEGER, title TEXT, ts INTEGER NOT NULL);
            INSERT INTO plays(album_id, title, ts) VALUES(4, 'x', 5);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO settings VALUES('fanartKey', '"k"');`);
  old.close();
  const db = openDb(dir);
  assert.equal(db.prepare("SELECT title FROM album_edits").get().title, "Fixed");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM plays").get().n, 1);
  assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'fanartKey'").get().value), "k");
  db.close();
});

test("a database from a newer version is used, never moved aside", { skip: built() }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-db-"));
  let db = openDb(dir);
  db.prepare("INSERT INTO settings(key, value) VALUES('k', '1')").run();
  const version = db.pragma("user_version", { simple: true });
  assert.ok(version > 0);
  db.pragma(`user_version = ${version + 5}`);
  db.close();
  db = openDb(dir);
  assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'k'").get().value, "1");
  assert.equal(db.pragma("user_version", { simple: true }), version + 5);
  db.close();
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes("old")), []);
});

test("an album is found by its edited names, its scanned names, and a title of punctuation", T, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-relocate-"));
  const lib = { root, music: path.join(root, "music"), data: path.join(root, "data") };
  fs.mkdirSync(lib.music);
  const s = await libraryServer(t, lib);
  const ins = s.db.raw.prepare("INSERT INTO albums(key, title, artist, year, track_count, added_at, updated_at) VALUES(?, ?, ?, ?, 1, 1, 1)");
  const track = s.db.raw.prepare("INSERT INTO tracks(album_id, path, mtime, size, title, artist, album) VALUES(?, ?, 0, 0, 'One', ?, ?)");
  for (const [key, title, artist, year] of [["sigur ros\u0001", "( )", "Sigur Rós", 2002], ["sigur ros\u0001takk", "Takk...", "Sigur Rós", 2005], ["x\u0001old", "Old Name", "X", null]]) {
    const id = ins.run(key, title, artist, year).lastInsertRowid;
    track.run(id, path.join(lib.music, title, "01.flac"), artist, title);
  }
  await s.reload();
  // The album extras find the album by its names (Library.Relocate) and give its year.
  const yearOf = async (title, artist) => (await s.getJ("/api/album/extras?fast=1&title=" + encodeURIComponent(title) + "&artist=" + encodeURIComponent(artist))).year;
  assert.equal(await yearOf("( )", "Sigur Rós"), "2002");
  const x = idOf(s, "Old Name");
  assert.equal(await yearOf("Old Name", "X"), null);
  const r = await s.postJ("/api/album/edit", { offset: x, title: "New Name", artist: "Y", year: 2001 });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(await yearOf("New Name", "Y"), "2001");
  assert.equal(await yearOf("Old Name", "X"), "2001");
});

test("a folder that can't be read keeps its albums; most of a folder gone at once is kept until you say", T, async (t) => {
  const lib = makeLibrary();
  const s = await libraryServer(t, lib, { massRemoval: 1 });
  const idB = idOf(s, "Hi Res");
  const idOne = idOf(s, "Album One");

  // Unreadable (a share that dropped mid-scan; here a link in Artist B that loops onto itself, a folder
  // down from the music folder's own, whose folders are taken for drives): nothing of it is taken for deleted.
  const bad = path.join(lib.music, "Artist B", "Hi Res");
  const away = path.join(lib.root, "Hi Res");
  fs.renameSync(bad, away);
  fs.symlinkSync(bad, bad);
  const r0 = await s.scan();
  fs.unlinkSync(bad);
  fs.renameSync(away, bad);
  assert.equal(r0.removed, 0);
  assert.deepEqual(r0.offline_dirs.map(d => [d.name, d.reason]), [["Artist B", "unreadable"]]);
  assert.equal(idOf(s, "Hi Res"), idB);

  // Most of the library gone in one scan, its folders still there: kept, and said.
  const stash = path.join(lib.root, "stash-a");
  fs.renameSync(path.join(lib.music, "Artist A"), stash);
  fs.mkdirSync(path.join(lib.music, "Artist A"));
  fs.writeFileSync(path.join(lib.music, "Artist A", "notes.txt"), "still here");
  const r = await s.scan();
  assert.equal(r.removed, 0);
  const vanished = r.offline_dirs.find(d => d.reason === "vanished");
  assert.ok(vanished, JSON.stringify(r.offline_dirs));
  // Told they're gone for good: those files leave, nothing else.
  const f = await forget(s, vanished.dir);
  assert.equal(f.status, 200, JSON.stringify(f));
  assert.ok(f.removed > 0);
  assert.ok(idOf(s, "Hi Res"));
  assert.equal(idOf(s, "Album One"), undefined);

  // Back later: the same album ids as before, so plays, downloads and playlists find them.
  fs.rmSync(path.join(lib.music, "Artist A"), { recursive: true });
  fs.renameSync(stash, path.join(lib.music, "Artist A"));
  await s.scan();
  assert.equal(idOf(s, "Album One"), idOne);
  assert.equal(idOf(s, "Hi Res"), idB);
});

test("an album that leaves and comes back gets its id back", T, async (t) => {
  const lib = makeLibrary();
  // A folder added in Settings (not the server's own music folder, whose
  // folders are taken for mounted drives).
  const none = path.join(lib.root, "none");
  fs.mkdirSync(none);
  const s = await libraryServer(t, { music: none, data: lib.data });
  await addFolder(s, lib.music, () => idOf(s, "Album One"));
  const id = idOf(s, "Album One");
  const stash = path.join(lib.root, "stash-one");
  const dir = path.join(lib.music, "Artist A", "Album One");
  fs.renameSync(dir, stash);
  const r = await s.scan();
  assert.ok(r.removed > 0, JSON.stringify(r));
  assert.equal(idOf(s, "Album One"), undefined);
  fs.renameSync(stash, dir);
  await s.scan();
  assert.equal(idOf(s, "Album One"), id);
});

test("several watched folders, anywhere", T, async (t) => {
  const lib = makeLibrary();
  const other = path.join(lib.root, "elsewhere");
  fs.mkdirSync(other);
  fs.renameSync(path.join(lib.music, "Artist B"), path.join(other, "Artist B"));
  const s = await libraryServer(t, lib);
  assert.equal(idOf(s, "Hi Res"), undefined);
  await addFolder(s, other, () => idOf(s, "Hi Res"));
  // One inside another counts once.
  const inside = await s.postJ("/api/library/folders", { add: path.join(other, "Artist B") });
  assert.equal(inside.status, 400);
  assert.match(inside.j.error, /Already in the library, as part of /);
  const folders = (await s.getJ("/api/library/folders")).folders;
  assert.deepEqual(folders.map(f => f.path), [lib.music, other].sort());
  assert.ok(idOf(s, "Hi Res"));
  assert.ok(idOf(s, "Album One"));
  assert.equal(folders.find(f => f.path === other).tracks, 2);
  // A watched folder that goes missing keeps its albums.
  const stash = path.join(lib.root, "stash-other");
  fs.renameSync(other, stash);
  const r = await s.scan();
  assert.equal(r.removed, 0);
  assert.deepEqual(r.offline_dirs.map(d => [d.dir, d.reason]), [[other, "missing"]]);
  // Removed from the list on purpose: its tracks go with it.
  const gone = await s.postJ("/api/library/folders", { remove: other });
  assert.equal(gone.status, 200, JSON.stringify(gone.j));
  assert.equal(gone.j.removed, 2);
  assert.equal(idOf(s, "Hi Res"), undefined);
});
