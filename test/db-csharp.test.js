"use strict";
/*
 * The database's tables and migrations made by the C# server (v0.8.48, stage 5
 * part 8; server/Mandarin.Server/Schema.cs, `mandarin-server db`), held to
 * lib/library/db.js and the Features constructor making them from the same
 * start, file for file:
 *
 *   - a new database: the same tables, indexes and their CREATE text, the
 *     same columns, version and journal;
 *   - one from before the columns added since (v0.3.13 to v0.6.0-RC10): the
 *     same columns added, its rows kept;
 *   - one made by something else (tables lacking columns ours need): moved
 *     aside as musicd.old-<ms>.db, a fresh one made, what is worth keeping
 *     carried over, row for row;
 *   - one from a newer version (its user_version ahead): kept as it is;
 *   - the album edits kept twice: read back from album-edits.json into an
 *     empty table, and the file written where there are edits and none.
 *
 * And through the server: the Node server's database is the C# program's
 * (DB.open asks it, MANDARIN_SERVER_DB=1), the Features constructor making
 * none of its own; with a program that fails, the Node server's own code.
 *
 * Through the C# server only (MANDARIN_FRONT=1), which has the program built.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");
const { makeLibrary } = require("./fixtures");

const skip = process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1";
const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const DB = require("../lib/library/db");
const { Features } = require("../lib/server/features");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "mandarin-db-"));

/* Made by the Node server, as it starts: DB.open, then the Features constructor. */
function byNode(dir) {
  const lines = [];
  const db = DB.open(dir, { log: l => lines.push(l) });
  new Features({ db, log: () => {} });
  const made = db.madeBy;
  db.close();
  return { lines, made };
}

/* Made by the C# program, as the Node server asks it. */
function byCsharp(dir) {
  const r = spawnSync(BIN, ["db", dir], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const lines = r.stdout.split("\n").filter(Boolean);
  return { said: JSON.parse(lines.pop()), lines };
}

/* Everything a database is: its tables and indexes as written, their columns, its version and journal, and every row. */
function dump(file) {
  const db = new Database(file, { readonly: true });
  try {
    const master = db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all();
    const columns = {}, rows = {};
    for (const { name } of master.filter(m => m.type === "table")) {
      columns[name] = db.prepare(`PRAGMA table_info(${name})`).all();
      rows[name] = db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all().map(r => JSON.stringify(r, (k, v) => (v && v.type === "Buffer" ? Buffer.from(v.data).toString("base64") : v)));
    }
    return {
      master, columns, rows,
      version: db.pragma("user_version", { simple: true }),
      journal: db.pragma("journal_mode", { simple: true }),
      // Only what a write in the file itself says: WAL is the file's header.
      foreignKeyList: master.filter(m => m.type === "table").map(m => [m.name, db.prepare(`PRAGMA foreign_key_list(${m.name})`).all()])
    };
  } finally { db.close(); }
}

/* Two copies of one start, a and b. */
function twins(prepare) {
  const a = tmp(), b = tmp();
  if (prepare) { prepare(a); prepare(b); }
  return { a, b };
}

/* A database as the server made it before the columns added since its tables first shipped. */
function oldDatabase(dir) {
  const db = new Database(path.join(dir, "musicd.db"));
  db.exec(`
    CREATE TABLE albums (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, artist TEXT NOT NULL,
      sort_title TEXT NOT NULL DEFAULT '', sort_artist TEXT NOT NULL DEFAULT '', year INTEGER, label TEXT,
      genres TEXT NOT NULL DEFAULT '[]', dir TEXT NOT NULL DEFAULT '', art_path TEXT, art_embedded TEXT, art_hash TEXT,
      track_count INTEGER NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, max_rate INTEGER, max_bits INTEGER,
      lossless INTEGER NOT NULL DEFAULT 1, container TEXT, compilation INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE album_matches (key TEXT PRIMARY KEY, mbid TEXT, distance REAL, status TEXT NOT NULL, candidate TEXT,
      before TEXT, checked_at INTEGER NOT NULL, applied_at INTEGER);
    INSERT INTO albums(key, title, artist, added_at, updated_at) VALUES('k1', 'Old', 'Someone', 1, 2);
    INSERT INTO settings(key, value) VALUES('displaySeconds', '30');
    INSERT INTO album_matches(key, status, checked_at) VALUES('k1', 'applied', 3);
  `);
  db.close();
}

/* A database another program wrote (an older project on the same volume): its albums lack our columns. */
function foreignDatabase(dir) {
  const db = new Database(path.join(dir, "musicd.db"));
  db.exec(`
    CREATE TABLE albums (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, extra TEXT);
    CREATE TABLE plays (id INTEGER PRIMARY KEY, album_id INTEGER, title TEXT, ts INTEGER NOT NULL);
    CREATE TABLE favourites (key TEXT PRIMARY KEY, added_at INTEGER NOT NULL);
    CREATE TABLE album_edits (key TEXT PRIMARY KEY, title TEXT, updated_at INTEGER NOT NULL);
    INSERT INTO albums(name) VALUES('theirs');
    INSERT INTO settings(key, value, extra) VALUES('a', '1', 'x'), ('b', '"two"', NULL);
    INSERT INTO plays(album_id, title, ts) VALUES(4, 'Song', 100), (NULL, 'Other', 200);
    INSERT INTO favourites(key, added_at) VALUES('fav', 5);
    INSERT INTO album_edits(key, title, updated_at) VALUES('ed', 'Fixed', 6);
  `);
  db.close();
}

test("a new database: the same tables, indexes, columns, version and journal", { skip }, () => {
  const { a, b } = twins();
  const n = byNode(a), c = byCsharp(b);
  assert.equal(n.made, "node");
  assert.deepEqual(c.said, { ok: true, existed: false, aside: null, version: 1 });
  assert.deepEqual(c.lines, ["[musicd] new database at " + path.join(b, "musicd.db")], "said as the Node server says it");
  assert.deepEqual(dump(path.join(b, "musicd.db")), dump(path.join(a, "musicd.db")));
  // Asked again: nothing changes.
  assert.deepEqual(byCsharp(b).said, { ok: true, existed: true, aside: null, version: 1 });
  assert.deepEqual(dump(path.join(b, "musicd.db")), dump(path.join(a, "musicd.db")));
  assert.ok(!fs.existsSync(path.join(b, "album-edits.json")), "no edits, no file");
});

test("one from before the columns added since: brought up to date the same, its rows kept", { skip }, () => {
  const { a, b } = twins(oldDatabase);
  byNode(a);
  const c = byCsharp(b);
  assert.deepEqual(c.said, { ok: true, existed: true, aside: null, version: 1 });
  const da = dump(path.join(a, "musicd.db")), dc = dump(path.join(b, "musicd.db"));
  assert.deepEqual(dc, da);
  assert.ok(da.columns.albums.some(x => x.name === "mb_group") && da.columns.album_matches.some(x => x.name === "itunes"));
  assert.equal(da.rows.albums.length, 1, "its album kept");
});

test("one made by something else: moved aside, a fresh one made, what is worth keeping carried over", { skip }, () => {
  const { a, b } = twins(foreignDatabase);
  const n = byNode(a), c = byCsharp(b);
  const asideA = fs.readdirSync(a).find(f => /^musicd\.old-\d+\.db$/.test(f));
  const asideB = fs.readdirSync(b).find(f => /^musicd\.old-\d+\.db$/.test(f));
  assert.ok(asideA && asideB, "both moved it aside: " + fs.readdirSync(b).join(", "));
  assert.equal(c.said.aside, path.join(b, asideB));
  assert.deepEqual(dump(path.join(b, asideB)), dump(path.join(a, asideA)), "the old one as it was");
  assert.deepEqual(dump(path.join(b, "musicd.db")), dump(path.join(a, "musicd.db")), "the new one, with what was kept");
  // Said as the Node server says it (the file names aside).
  const same = l => l.replace(/musicd\.old-\d+\.db/g, "musicd.old-<ms>.db").split(a).join("<dir>").split(b).join("<dir>");
  assert.deepEqual(c.lines.map(same), n.lines.map(same));
  assert.ok(n.lines.some(l => /kept 2 plays row\(s\)/.test(l)) && n.lines.some(l => /kept 1 album edits row\(s\)/.test(l)), n.lines.join("\n"));
  // The edits it kept are written beside it too.
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b, "album-edits.json"), "utf8")).edits, JSON.parse(fs.readFileSync(path.join(a, "album-edits.json"), "utf8")).edits);
});

test("one from a newer version (its user_version ahead): kept and used as it is", { skip }, () => {
  const { a, b } = twins(dir => {
    const db = new Database(path.join(dir, "musicd.db"));
    db.exec("CREATE TABLE albums (id INTEGER PRIMARY KEY, name TEXT); PRAGMA user_version = 7;");
    db.close();
  });
  byNode(a);
  assert.equal(byCsharp(b).said.aside, null);
  assert.deepEqual(dump(path.join(b, "musicd.db")), dump(path.join(a, "musicd.db")));
  assert.ok(!fs.readdirSync(b).some(f => f.startsWith("musicd.old-")));
});

test("the album edits kept twice: read back from album-edits.json, and the file written where there is none", { skip }, () => {
  // Read back: a new database beside the file a lost one left.
  const edits = { version: 1, saved_at: 1, edits: [
    { key: "k1", title: "Fixed", artist: null, year: 1999, art: Buffer.from("not really a jpeg").toString("base64"), art_hash: "h", art_source: "https://example.com/x.jpg", updated_at: 1700000000000 },
    { key: "k2", title: "", artist: "Them", year: 0, art: null, art_hash: null, art_source: null, updated_at: 5 },
    { title: "no key" }
  ] };
  const { a, b } = twins(dir => fs.writeFileSync(path.join(dir, "album-edits.json"), JSON.stringify(edits)));
  const n = byNode(a), c = byCsharp(b);
  assert.deepEqual(dump(path.join(b, "musicd.db")), dump(path.join(a, "musicd.db")));
  assert.deepEqual(c.lines.filter(l => /restored/.test(l)).map(l => l.split(b).join("<dir>")), n.lines.filter(l => /restored/.test(l)).map(l => l.split(a).join("<dir>")));
  assert.match(n.lines.join("\n"), /restored 2 album edit\(s\)/);
  // Written: edits in the database, no file yet.
  for (const d of [a, b]) fs.rmSync(path.join(d, "album-edits.json"));
  byNode(a);
  byCsharp(b);
  const fa = JSON.parse(fs.readFileSync(path.join(a, "album-edits.json"), "utf8"));
  const fb = JSON.parse(fs.readFileSync(path.join(b, "album-edits.json"), "utf8"));
  assert.ok(Math.abs(fb.saved_at - Date.now()) < 60000);
  assert.deepEqual(Object.assign({}, fb, { saved_at: 0 }), Object.assign({}, fa, { saved_at: 0 }));
  assert.equal(fa.edits.length, 2);
  // An unreadable file: nothing read, the database made all the same.
  const { a: a2, b: b2 } = twins(dir => fs.writeFileSync(path.join(dir, "album-edits.json"), "{ not json"));
  const n2 = byNode(a2), c2 = byCsharp(b2);
  assert.ok(n2.lines.some(l => /is unreadable/.test(l)) && c2.lines.some(l => /is unreadable/.test(l)));
  assert.deepEqual(dump(path.join(b2, "musicd.db")), dump(path.join(a2, "musicd.db")));
});

test("through the server: the Node server's database made by the C# program; one that fails, made by the Node server", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const PORT = ports.port();
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    assert.equal(ctx.db.madeBy, "csharp", "made by the C# program");
    assert.ok(ctx.db.raw.prepare("SELECT 1 FROM sqlite_master WHERE name = 'radio_played'").get(), "Smart Picks' and the radio's tables with it");
  } finally { await srv.stop(); }
  // A program that can't (here, one that isn't there): the Node server's own code, as before.
  const dir = tmp();
  const lines = [];
  const db = DB.open(dir, { log: l => lines.push(l), program: path.join(dir, "no-such-program") });
  try {
    assert.equal(db.madeBy, "node");
    assert.ok(lines.some(l => /the C# server didn't make the database/.test(l)), lines.join("\n"));
    new Features({ db, log: () => {} });
    const ref = tmp();
    byCsharp(ref);
    db.raw.pragma("wal_checkpoint(TRUNCATE)");
    assert.deepEqual(dump(path.join(dir, "musicd.db")).master, dump(path.join(ref, "musicd.db")).master);
  } finally { db.close(); }
});
