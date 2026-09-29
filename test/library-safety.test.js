"use strict";
/*
 * Nothing you did is lost, and nothing is read again from scratch, when the
 * container is replaced or updated: moved mounts are recognised, a drive that
 * isn't mounted keeps its albums, and album edits come back even if the
 * database itself has to start over.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const DB = require("../lib/library/db");
const { Library } = require("../lib/library");
const { Scanner } = require("../lib/library/scanner");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const quiet = () => {};

function open(data, root, opts = {}) {
  const db = DB.open(data, { log: quiet });
  const library = new Library(db, { musicRoot: root, log: quiet });
  const scanner = new Scanner(Object.assign({ db, root, log: quiet }, opts));
  return { db, library, scanner };
}
const byTitle = (lib, t) => lib.albums.find(a => a.scanned.title === t);

test("a moved music mount keeps every album, id and edit, and reads no file again", { skip }, async () => {
  const lib = makeLibrary();
  let s = open(lib.data, lib.music);
  await s.scanner.scan();
  s.library.reload();
  const before = s.library.albums.map(a => [a.scanned.title, a.id]).sort();
  s.library.saveEdit(byTitle(s.library, "Album One").id, { title: "Album One (fixed)", year: 1999 });
  s.db.close();

  // /music  →  /music/4tb, as when a second drive is added.
  const root = path.join(lib.root, "mroot");
  fs.mkdirSync(root);
  fs.renameSync(lib.music, path.join(root, "4tb"));
  s = open(lib.data, root);
  s.library.reload();
  assert.equal(s.library.count, 3, "albums are there before any scan");
  const r = await s.scanner.scan();
  s.library.reload();
  assert.equal(s.scanner.state.parsed, 0, "no file read again");
  assert.equal(r.relocated, 7);
  assert.equal(r.removed, 0);
  assert.deepEqual(s.library.albums.map(a => [a.scanned.title, a.id]).sort(), before);
  const one = byTitle(s.library, "Album One");
  assert.equal(one.title, "Album One (fixed)");
  assert.equal(one.year, 1999);
  assert.ok(s.library.tracks(one.id).every(t => t.path.startsWith(path.join(root, "4tb"))));
  s.db.close();
});

test("a drive that isn't mounted keeps its albums until it's back", { skip }, async () => {
  const lib = makeLibrary();
  const root = path.join(lib.root, "mroot");
  fs.mkdirSync(path.join(root, "2tb"), { recursive: true });
  fs.renameSync(lib.music, path.join(root, "4tb"));
  fs.renameSync(path.join(root, "4tb", "Artist B"), path.join(root, "2tb", "Artist B"));
  let s = open(lib.data, root);
  await s.scanner.scan();

  // The 2tb drive isn't there: Docker still shows its mount point, empty.
  const stash = path.join(lib.root, "stash");
  fs.renameSync(path.join(root, "2tb"), stash);
  fs.mkdirSync(path.join(root, "2tb"));
  let r = await s.scanner.scan();
  s.library.reload();
  assert.equal(r.removed, 0);
  assert.equal(r.kept_offline, 2);
  assert.ok(byTitle(s.library, "Hi Res"), "Hi Res is still in the library");

  // Nothing at all mounted: everything kept.
  const stash4 = path.join(lib.root, "stash4");
  fs.renameSync(path.join(root, "4tb"), stash4);
  fs.mkdirSync(path.join(root, "4tb"));
  r = await s.scanner.scan();
  assert.equal(r.removed, 0);
  assert.equal(s.db.raw.prepare("SELECT COUNT(*) n FROM tracks").get().n, 7);

  // Back again: nothing to read.
  fs.rmdirSync(path.join(root, "2tb")); fs.renameSync(stash, path.join(root, "2tb"));
  fs.rmdirSync(path.join(root, "4tb")); fs.renameSync(stash4, path.join(root, "4tb"));
  const parsedBefore = 0;
  r = await s.scanner.scan();
  assert.equal(r.status, "unchanged");
  assert.equal(s.scanner.state.parsed, parsedBefore);

  // A folder really deleted (not an empty mount point) is removed.
  fs.rmSync(path.join(root, "2tb", "Artist B"), { recursive: true });
  fs.writeFileSync(path.join(root, "2tb", "readme.txt"), "not music");
  r = await s.scanner.scan();
  assert.equal(r.removed, 2);
  s.db.close();
});

test("a music folder left off a new container keeps its albums, says so, and can be forgotten", { skip }, async () => {
  const lib = makeLibrary();
  const root = path.join(lib.root, "mroot");
  fs.mkdirSync(path.join(root, "HiRes"), { recursive: true });
  fs.renameSync(lib.music, path.join(root, "Main"));
  fs.renameSync(path.join(root, "Main", "Artist B"), path.join(root, "HiRes", "Artist B"));
  let s = open(lib.data, root);
  await s.scanner.scan();
  s.library.reload();
  const hiResId = byTitle(s.library, "Hi Res").id;

  // Re-created without its -v line: the folder isn't there at all (not even empty).
  const stash = path.join(lib.root, "stash");
  fs.renameSync(path.join(root, "HiRes"), stash);
  let r = await s.scanner.scan();
  s.library.reload();
  assert.equal(r.removed, 0, "nothing removed");
  assert.equal(r.kept_offline, 2);
  assert.deepEqual(r.offline_dirs.map(d => [d.name, d.tracks, d.missing]), [["HiRes", 2, true]]);
  assert.equal(byTitle(s.library, "Hi Res").id, hiResId, "the same album, id and all");

  // Forgetting a folder that's there takes only files that are gone (none here),
  // and only in one of the music folders.
  assert.equal(s.scanner.forget(path.join(root, "Main")), 0);
  assert.throws(() => s.scanner.forget("/etc"), /music folders/);

  // Back: the same album, nothing read again.
  fs.renameSync(stash, path.join(root, "HiRes"));
  r = await s.scanner.scan();
  s.library.reload();
  assert.equal(r.status, "unchanged");
  assert.deepEqual(r.offline_dirs, []);
  assert.equal(byTitle(s.library, "Hi Res").id, hiResId);

  // Gone for good, and forgotten: its tracks and albums leave.
  fs.rmSync(path.join(root, "HiRes"), { recursive: true });
  r = await s.scanner.scan();
  assert.equal(r.removed, 0);
  assert.equal(s.scanner.forget(path.join(root, "HiRes")), 2);
  s.library.reload();
  assert.equal(byTitle(s.library, "Hi Res"), undefined);
  assert.deepEqual(s.scanner.state.lastResult.offline_dirs, []);
  s.db.close();
});

test("album edits come back when the database has to start over", { skip }, async () => {
  const lib = makeLibrary();
  let s = open(lib.data, lib.music);
  await s.scanner.scan();
  s.library.reload();
  s.library.saveEdit(byTitle(s.library, "Hi Res").id, { artist: "Artist B (fixed)", art: { buf: Buffer.from("x"), source: "Deezer" } });
  s.db.close();
  assert.ok(fs.existsSync(path.join(lib.data, "album-edits.json")));

  for (const f of fs.readdirSync(lib.data)) if (f.startsWith("musicd.db")) fs.rmSync(path.join(lib.data, f));
  s = open(lib.data, lib.music);
  await s.scanner.scan();
  s.library.reload();
  const hr = byTitle(s.library, "Hi Res");
  assert.equal(hr.artist, "Artist B (fixed)");
  assert.equal(hr.customArt, true);
  assert.equal(String(s.library.editedArt(hr.id)), "x");
  s.db.close();
});

test("a database that has to be replaced hands over edits, plays and settings", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "musicd-db-"));
  const old = new Database(path.join(dir, "musicd.db"));
  old.exec(`CREATE TABLE tracks (id INTEGER PRIMARY KEY, path TEXT);
            CREATE TABLE album_edits (key TEXT PRIMARY KEY, title TEXT, artist TEXT, year INTEGER, art BLOB, art_hash TEXT, art_source TEXT, updated_at INTEGER NOT NULL);
            INSERT INTO album_edits(key, title, updated_at) VALUES('a\u0001b', 'Fixed', 1);
            CREATE TABLE plays (id INTEGER PRIMARY KEY, album_id INTEGER, title TEXT, ts INTEGER NOT NULL);
            INSERT INTO plays(album_id, title, ts) VALUES(4, 'x', 5);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO settings VALUES('fanartKey', '"k"');`);
  old.close();
  const db = DB.open(dir, { log: quiet });
  assert.equal(db.raw.prepare("SELECT title FROM album_edits").get().title, "Fixed");
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM plays").get().n, 1);
  assert.equal(db.setting("fanartKey"), "k");
  db.close();
});

test("a database from a newer version is used, never moved aside", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "musicd-db-"));
  let db = DB.open(dir, { log: quiet });
  db.setSetting("k", 1);
  db.raw.pragma(`user_version = ${DB.SCHEMA_VERSION + 5}`);
  db.close();
  db = DB.open(dir, { log: quiet });
  assert.equal(db.setting("k"), 1);
  db.close();
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes("old")), []);
});

test("an album is found by its edited names, its scanned names, and a title of punctuation", () => {
  const dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "musicd-db-"));
  const db = DB.open(dir, { log: quiet });
  const ins = db.raw.prepare("INSERT INTO albums(key, title, artist, added_at, updated_at) VALUES(?, ?, ?, 1, 1)");
  ins.run("sigur ros\u0001", "( )", "Sigur Rós");
  ins.run("sigur ros\u0001takk", "Takk...", "Sigur Rós");
  ins.run("x\u0001old", "Old Name", "X");
  const library = new Library(db, { log: quiet });
  library.reload();
  assert.equal(library.relocate("( )", "Sigur Rós").title, "( )");
  const x = library.albums.find(a => a.title === "Old Name");
  library.saveEdit(x.id, { title: "New Name", artist: "Y", year: 2001 });
  assert.equal(library.relocate("New Name", "Y").id, x.id);
  assert.equal(library.relocate("Old Name", "X").id, x.id);
  assert.equal(library.relocate("Old Name", "X").year, 2001);
  db.close();
});

test("a folder that can't be read keeps its albums; most of a folder gone at once is kept until you say", { skip }, async () => {
  const lib = makeLibrary();
  const s = open(lib.data, lib.music, { massRemoval: 1 });
  await s.scanner.scan();
  s.library.reload();
  const idB = byTitle(s.library, "Hi Res").id;

  // Unreadable (a share that dropped mid-scan): nothing of it is taken for deleted.
  const readdir = fs.promises.readdir;
  const bad = path.join(lib.music, "Artist B");
  fs.promises.readdir = function (d, ...rest) {
    if (d === bad) return Promise.reject(Object.assign(new Error("EIO: i/o error"), { code: "EIO" }));
    return readdir.call(this, d, ...rest);
  };
  let r0;
  try { r0 = await s.scanner.scan(); } finally { fs.promises.readdir = readdir; }
  assert.equal(r0.removed, 0);
  assert.deepEqual(r0.offline_dirs.map(d => [d.name, d.reason]), [["Artist B", "unreadable"]]);

  // Most of the library gone in one scan, its folders still there: kept, and said.
  const stash = path.join(lib.root, "stash-a");
  fs.renameSync(path.join(lib.music, "Artist A"), stash);
  fs.mkdirSync(path.join(lib.music, "Artist A"));
  fs.writeFileSync(path.join(lib.music, "Artist A", "notes.txt"), "still here");
  let r = await s.scanner.scan();
  assert.equal(r.removed, 0);
  assert.ok(r.offline_dirs.some(d => d.reason === "vanished"), JSON.stringify(r.offline_dirs));
  // Told they're gone for good: those files leave, nothing else.
  const n = s.scanner.forget(r.offline_dirs.find(d => d.reason === "vanished").dir);
  assert.ok(n > 0);
  s.library.reload();
  assert.ok(byTitle(s.library, "Hi Res"));
  assert.equal(byTitle(s.library, "Album One"), undefined);

  // Back later: the same album ids as before, so plays, downloads and playlists find them.
  fs.rmSync(path.join(lib.music, "Artist A"), { recursive: true });
  fs.renameSync(stash, path.join(lib.music, "Artist A"));
  r = await s.scanner.scan();
  s.library.reload();
  assert.ok(byTitle(s.library, "Album One"));
  assert.equal(byTitle(s.library, "Hi Res").id, idB);
  s.db.close();
});

test("an album that leaves and comes back gets its id back", { skip }, async () => {
  const lib = makeLibrary();
  // A folder added in Settings (not the server's own music folder, whose
  // folders are taken for mounted drives).
  const s = open(lib.data, path.join(lib.root, "none"), { roots: () => [lib.music] });
  await s.scanner.scan();
  s.library.reload();
  const id = byTitle(s.library, "Album One").id;
  const stash = path.join(lib.root, "stash-one");
  const dir = path.dirname(s.library.tracks(id)[0].path);
  fs.renameSync(dir, stash);
  let r = await s.scanner.scan();
  assert.ok(r.removed > 0);
  s.library.reload();
  assert.equal(byTitle(s.library, "Album One"), undefined);
  fs.renameSync(stash, dir);
  await s.scanner.scan();
  s.library.reload();
  assert.equal(byTitle(s.library, "Album One").id, id);
  s.db.close();
});

test("several watched folders, anywhere", { skip }, async () => {
  const lib = makeLibrary();
  const other = path.join(lib.root, "elsewhere");
  fs.mkdirSync(other);
  fs.renameSync(path.join(lib.music, "Artist B"), path.join(other, "Artist B"));
  let roots = [lib.music];
  const s = open(lib.data, lib.music, { roots: () => roots });
  let r = await s.scanner.scan();
  s.library.reload();
  assert.equal(byTitle(s.library, "Hi Res"), undefined);
  roots = [lib.music, other, path.join(other, "Artist B")];   // one inside another counts once
  assert.deepEqual(s.scanner.roots(), [lib.music, other].sort());
  r = await s.scanner.scan();
  s.library.reload();
  assert.ok(byTitle(s.library, "Hi Res"));
  assert.ok(byTitle(s.library, "Album One"));
  assert.equal(s.scanner.countUnder(other), 2);
  // A watched folder that goes missing keeps its albums.
  const stash = path.join(lib.root, "stash-other");
  fs.renameSync(other, stash);
  r = await s.scanner.scan();
  assert.equal(r.removed, 0);
  assert.deepEqual(r.offline_dirs.map(d => [d.dir, d.reason]), [[other, "missing"]]);
  // Removed from the list on purpose: its tracks go with it.
  assert.equal(s.scanner.removeUnder(other), 2);
  s.db.close();
});
