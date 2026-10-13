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
 * Since v0.8.50 (stage 7 part 5) the Node server's databases, what it said
 * and the edits it wrote are kept (test/golden.js's answers(),
 * test/golden/db-csharp.json, made with RECORD_DB=1 while lib/ was here; its
 * folder named "<dir>"), and `mandarin-server db` alone is held to them.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");
const { answers } = require("./golden");

const RECORD = process.env.RECORD_DB === "1";
// The Node server's database code, asked while recording (lib/, until v0.8.50).
const DB = RECORD ? require("../lib/library/db") : null;
const Features = RECORD ? require("../lib/server/features").Features : null;
const kept = answers("db-csharp", RECORD);
const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!RECORD && !kept.exists() && "no recording of the Node server's databases (RECORD_DB=1 made it)");
test.after(() => { if (!skip) kept.done(); });

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

/* The Node server's side of a step (its database, what it said, a file it wrote: [node]() while recording), and the C# program's beside it ([mine]). */
function held(what, mine, node) {
  const names = Object.keys(mine);
  kept.same(what, names, names, names.map(k => mine[k]), RECORD && (() => { const n = node(); return names.map(k => n[k]); }));
}
/* What was said, the folder named. */
const said = (lines, dir) => lines.map(l => l.replace(/musicd\.old-\d+\.db/g, "musicd.old-<ms>.db").split(dir).join("<dir>"));

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
  const c = byCsharp(b);
  assert.deepEqual(c.said, { ok: true, existed: false, aside: null, version: 1 });
  held("a new database", { said: said(c.lines, b), db: dump(path.join(b, "musicd.db")) }, () => {
    const n = byNode(a);
    assert.equal(n.made, "node");
    return { said: said(n.lines, a), db: dump(path.join(a, "musicd.db")) };
  });
  // Asked again: nothing changes.
  assert.deepEqual(byCsharp(b).said, { ok: true, existed: true, aside: null, version: 1 });
  held("a new database, asked again", { db: dump(path.join(b, "musicd.db")) }, () => ({ db: dump(path.join(a, "musicd.db")) }));
  assert.ok(!fs.existsSync(path.join(b, "album-edits.json")), "no edits, no file");
});

test("one from before the columns added since: brought up to date the same, its rows kept", { skip }, () => {
  const { a, b } = twins(oldDatabase);
  const c = byCsharp(b);
  assert.deepEqual(c.said, { ok: true, existed: true, aside: null, version: 1 });
  const dc = dump(path.join(b, "musicd.db"));
  held("one from before the columns added since", { db: dc }, () => { byNode(a); return { db: dump(path.join(a, "musicd.db")) }; });
  assert.ok(dc.columns.albums.some(x => x.name === "mb_group") && dc.columns.album_matches.some(x => x.name === "itunes"));
  assert.equal(dc.rows.albums.length, 1, "its album kept");
});

test("one made by something else: moved aside, a fresh one made, what is worth keeping carried over", { skip }, () => {
  const { a, b } = twins(foreignDatabase);
  const c = byCsharp(b);
  const aside = dir => fs.readdirSync(dir).find(f => /^musicd\.old-\d+\.db$/.test(f));
  const asideB = aside(b);
  assert.ok(asideB, "moved it aside: " + fs.readdirSync(b).join(", "));
  assert.equal(c.said.aside, path.join(b, asideB));
  // The old one as it was, the new one with what was kept, said as the Node server says it (the file names aside), and the
  // edits it kept written beside it too.
  const edits = dir => JSON.parse(fs.readFileSync(path.join(dir, "album-edits.json"), "utf8")).edits;
  held("one made by something else", { old: dump(path.join(b, asideB)), db: dump(path.join(b, "musicd.db")), said: said(c.lines, b), edits: edits(b) }, () => {
    const n = byNode(a);
    assert.ok(aside(a), "the Node server moved it aside");
    return { old: dump(path.join(a, aside(a))), db: dump(path.join(a, "musicd.db")), said: said(n.lines, a), edits: edits(a) };
  });
  assert.ok(c.lines.some(l => /kept 2 plays row\(s\)/.test(l)) && c.lines.some(l => /kept 1 album edits row\(s\)/.test(l)), c.lines.join("\n"));
});

test("one from a newer version (its user_version ahead): kept and used as it is", { skip }, () => {
  const { a, b } = twins(dir => {
    const db = new Database(path.join(dir, "musicd.db"));
    db.exec("CREATE TABLE albums (id INTEGER PRIMARY KEY, name TEXT); PRAGMA user_version = 7;");
    db.close();
  });
  assert.equal(byCsharp(b).said.aside, null);
  held("one from a newer version", { db: dump(path.join(b, "musicd.db")) }, () => { byNode(a); return { db: dump(path.join(a, "musicd.db")) }; });
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
  const c = byCsharp(b);
  const restored = (lines, dir) => said(lines.filter(l => /restored/.test(l)), dir);
  held("the album edits read back", { db: dump(path.join(b, "musicd.db")), said: restored(c.lines, b) }, () => {
    const n = byNode(a);
    return { db: dump(path.join(a, "musicd.db")), said: restored(n.lines, a) };
  });
  assert.match(c.lines.join("\n"), /restored 2 album edit\(s\)/);
  // Written: edits in the database, no file yet.
  for (const d of [a, b]) fs.rmSync(path.join(d, "album-edits.json"));
  byCsharp(b);
  const file = dir => JSON.parse(fs.readFileSync(path.join(dir, "album-edits.json"), "utf8"));
  const fb = file(b);
  assert.ok(Math.abs(fb.saved_at - Date.now()) < 60000);
  held("the album edits written", { file: Object.assign({}, fb, { saved_at: 0 }) }, () => { byNode(a); return { file: Object.assign({}, file(a), { saved_at: 0 }) }; });
  assert.equal(fb.edits.length, 2);
  // An unreadable file: nothing read, the database made all the same.
  const { a: a2, b: b2 } = twins(dir => fs.writeFileSync(path.join(dir, "album-edits.json"), "{ not json"));
  const c2 = byCsharp(b2);
  assert.ok(c2.lines.some(l => /is unreadable/.test(l)));
  held("an unreadable album-edits.json", { db: dump(path.join(b2, "musicd.db")) }, () => {
    const n2 = byNode(a2);
    assert.ok(n2.lines.some(l => /is unreadable/.test(l)));
    return { db: dump(path.join(a2, "musicd.db")) };
  });
});
