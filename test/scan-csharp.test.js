"use strict";
/*
 * The library scan made by the C# server (v0.8.18, server/Mandarin.Server/
 * Scan/) writes what the Node server's scan writes: one music folder, every
 * kind of thing a scan has to decide about, scanned into two databases — one
 * by each — and every table compared, value for value and as the same kind
 * of value, after the first scan and after each change to the folder (a file
 * changed, a folder renamed, files gone, most of a folder gone at once, a
 * drive gone, a forced rescan, the regroup). Their results and what they say
 * are compared too. Skipped where the C# server isn't built.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's side is kept
 * (test/golden.js's answers(), test/golden/scan-csharp.json, made with
 * RECORD_SCAN=1 while lib/ was here) and `mandarin-server scan` alone is held
 * to it, step for step. What depends on the machine is held by rule: the
 * folder's own path; a file's length and time as the file has them, and the
 * cover's key the scan makes from those; a lossy file's length in seconds as
 * the C# reader reads it (test/tags-front.test.js holds the reader to
 * music-metadata) and an album's as its tracks' sum; ffmpeg's name in the
 * tags it writes; times of the scan as "<now>". The emptied folder is filled
 * again before the regroup (its forgetting, Settings' and the C# server's own
 * now, is held in test/scans-csharp.test.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");
const { haveFfmpeg, gen, FFMPEG } = require("./fixtures");
const { answers } = require("./golden");

const RECORD = process.env.RECORD_SCAN === "1";
// The Node server's scanner, asked while recording (lib/, until v0.8.50).
const NODE = RECORD ? { DB: require("../lib/library/db"), Scanner: require("../lib/library/scanner").Scanner } : null;
const kept = answers("scan-csharp", RECORD);

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") ||
  (!RECORD && !kept.exists() && "no recording of the Node server's scans (RECORD_SCAN=1 made it)");

/* A music folder with something of everything. */
function makeMixedLibrary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-scan-"));
  const music = path.join(root, "music");
  const T = (p, tags = {}, opts = {}) => gen(path.join(music, p), Object.assign({ seconds: 1, tags }, opts));
  const mp3 = { fmt: null, codecArgs: ["-b:a", "128k"] };
  const img = (p, colour = "red") => {
    fs.mkdirSync(path.dirname(path.join(music, p)), { recursive: true });
    spawnSync(FFMPEG, ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `color=c=${colour}:s=64x64`, "-frames:v", "1", path.join(music, p)]);
  };
  // A tagged album, its cover and its back; the release's identifiers and loudness.
  T("Artist A/Album One/01 Song 1.flac", { title: "Song 1", artist: "Artist A", album: "Album One", track: 1, date: "1997-02-04", originaldate: "1997",
    genre: "Rock;Pop", label: "Parlophone", REPLAYGAIN_TRACK_GAIN: "-7.21 dB", REPLAYGAIN_TRACK_PEAK: "0.988", BARCODE: "0039841500523", CATALOGNUMBER: "XL 123" });
  T("Artist A/Album One/02 Song 2.flac", { title: "Song 2", artist: "Artist A", album: "Album One", track: 2, date: "1997", genre: "rock", label: "Parlophone" });
  img("Artist A/Album One/cover.jpg");
  img("Artist A/Album One/back.jpg", "blue");
  fs.writeFileSync(path.join(music, "Artist A/Album One/.DS_Store"), "x");
  fs.writeFileSync(path.join(music, "Artist A/Album One/._01 Song 1.flac"), "x");
  // Hi-res.
  T("Artist B/Hi Res/01 Hi 1.flac", { title: "Hi 1", artist: "Artist B", album: "Hi Res", track: 1, date: "2020" },
    { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"] });
  // Two albums in one folder.
  T("Mixed/01 a.flac", { title: "a", artist: "M", album: "First" });
  T("Mixed/02 b.flac", { title: "b", artist: "M", album: "Second" });
  // One album over two disc folders, by different artists: Various Artists.
  T("Comp/CD1/01.mp3", { title: "C1", artist: "X", album: "Best Of", track: 1 }, mp3);
  T("Comp/CD2/01.mp3", { title: "C2", artist: "Y", album: "Best Of", track: 1, disc: 2 }, mp3);
  // Flagged a compilation; an album artist; an artist's sort name.
  T("Flagged/01.flac", { title: "f1", artist: "P", album: "Hits", compilation: "1" });
  T("Flagged/02.flac", { title: "f2", artist: "P", album: "Hits", compilation: "1" });
  T("AA/01.flac", { title: "duet", artist: "X & Y", album: "Duets", album_artist: "X" });
  T("A Tribe/The Low End Theory/01.flac", { title: "Excursions", artist: "A Tribe Called Quest", album: "The Low End Theory", ARTISTSORT: "Tribe Called Quest, A" });
  // No tags: the names from the folders and files.
  T("808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac");
  T("808 State - Ninety (1989)/Disc 2/03 - Ancodia.flac");
  T("Yes - The Box/Disc 4 - Tales From Topographic Oceans (1973)/01 - The Revealing Science.flac");
  T("Music/Some Album/1-01 - Intro.flac");
  // Names beyond ASCII: accents, a Greek final sigma, an emoji, a ligature; "The" and not.
  T("Björk/Homogénic/01 Jóga.flac", { title: "Jóga", artist: "Björk", album: "Homogénic", date: "1997" });
  T("Greek/ΟΔΥΣΣΕΑΣ/01.flac", { title: "Α", artist: "ΣΩΣ", album: "ΟΔΥΣΣΕΑΣ" });
  T("Ünïcode 😀/Ålbum ﬀ/01.flac", { title: "x", artist: "Ünïcode 😀", album: "Ålbum ﬀ" });
  T("The Beatles/Abbey Road/01.flac", { title: "Come Together", artist: "The Beatles", album: "Abbey Road" });
  T("Beatles/Help/01.flac", { title: "Help!", artist: "Beatles", album: "Help!" });
  // Covers: two unnamed (neither), one in a disc folder, two named the same but for case.
  T("Art/Two Unnamed/01.flac", { title: "u", artist: "Art", album: "Two Unnamed" });
  img("Art/Two Unnamed/x.jpg");
  img("Art/Two Unnamed/y.png");
  T("Art/Disc Art/CD1/01.flac", { title: "d", artist: "Art", album: "Disc Art" });
  img("Art/Disc Art/CD1/folder.jpg");
  T("Art/Front Ties/01.flac", { title: "t", artist: "Art", album: "Front Ties" });
  img("Art/Front Ties/front.jpg");
  img("Art/Front Ties/Front.png", "green");
  // Other containers.
  T("M4A/01.m4a", { title: "m", artist: "Mp4", album: "In A Box", track: 3, date: "2001" }, { fmt: null, codecArgs: ["-c:a", "aac", "-b:a", "64k"] });
  T("Wav/01.wav", { title: "w", artist: "Wave", album: "Riff" });
  // A file that can't be read; a link to a folder, a loop, a link to nothing.
  fs.mkdirSync(path.join(music, "Broken/Bad"), { recursive: true });
  fs.writeFileSync(path.join(music, "Broken/Bad/01.mp3"), Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0x10]));   // an ID3 tag, cut short
  fs.symlinkSync(path.join(music, "Wav"), path.join(music, "Linked Wav"));
  fs.mkdirSync(path.join(music, "Loop"));
  T("Loop/01.flac", { title: "l", artist: "Loop", album: "Loop" });
  fs.symlinkSync(path.join(music, "Loop"), path.join(music, "Loop", "again"));
  fs.symlinkSync("/nonexistent/anything.flac", path.join(music, "Dangling.flac"));
  return { root, music };
}

// albums.updated_at is the time of the write; everything else must be the same.
const VOLATILE = { albums: ["updated_at"] };
/* Every table: its columns and its rows, each value beside the kind SQLite keeps it as. */
function dump(raw) {
  const out = {};
  for (const { name } of raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
    const cols = raw.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name).filter(c => !(VOLATILE[name] || []).includes(c));
    if (!cols.length) continue;
    const list = cols.map(c => `"${c}", typeof("${c}")`).join(", ");
    out[name] = { cols, rows: raw.prepare(`SELECT ${list} FROM ${name} ORDER BY rowid`).raw().all() };
  }
  return out;
}

/* The scan made by the C# server's program, as the server has it made: the job on its input, a line of JSON each thing it says. */
function scanCs(dataDir, root, { force = false, massRemoval = 500 } = {}) {
  const r = spawnSync(BIN, ["scan"], { input: JSON.stringify({ dataDir, root, roots: [path.resolve(root)], massRemoval, force, slots: 2 }), maxBuffer: 256 * 1024 * 1024 });
  const out = { lines: [], result: null, state: null };
  for (const l of String(r.stdout).split("\n").filter(Boolean)) {
    const m = JSON.parse(l);
    if (m.type === "log") out.lines.push(m.line);
    else if (m.type === "state" || m.type === "progress") out.state = m.state;
    else if (m.type === "result") { out.result = m.result; out.state = m.state; }
    else if (m.type === "error") throw new Error(m.message);
  }
  assert.ok(out.result, "the scan's result\n" + r.stderr);
  return out;
}

const said = (lines) => lines
  .filter(l => !/made by the C# server/.test(l))
  .map(l => l.replace(/ in \d+\.\ds$/, " in …s"));
function result(r) {
  const o = Object.assign({}, r);
  delete o.ms;
  return o;
}
const STATE = ["files", "parsed", "errors", "progress", "running"];

/*
 * What the files are, read before each scan: each one's length and time (the last seen, for one gone since), and
 * a lossy file's length in seconds as the C# reader reads it.
 */
function looker(music) {
  const stats = new Map(), seconds = new Map();
  const walk = (dir) => {
    let names;
    try { names = fs.readdirSync(dir); } catch (e) { return; }
    for (const n of names) {
      const p = path.join(dir, n);
      let st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      if (st.isDirectory()) { if (!fs.lstatSync(p).isSymbolicLink() || !stats.has(p + "/")) { stats.set(p + "/", st); walk(p); } }
      else stats.set(p, st);
    }
  };
  return {
    stats, seconds,
    look() {
      for (const k of [...stats.keys()]) if (k.endsWith("/")) stats.delete(k);
      walk(music);
      const lossy = [...stats.keys()].filter(p => /\.(mp3|m4a)$/i.test(p) && fs.existsSync(p));
      if (lossy.length) {
        const r = spawnSync(BIN, ["tags"], { input: lossy.join("\n") });
        for (const l of String(r.stdout).trim().split("\n").filter(Boolean)) { const x = JSON.parse(l); if (x.ok) seconds.set(x.path, x.tags.duration); }
      }
    }
  };
}

/* A database's tables, with what depends on the machine held by rule (above) and named for it. */
function normalised(tables, root, files) {
  const now = Date.now(), DAY = 86400000;
  const text = v => typeof v === "string" ? v.split(root).join("<root>").replace(/Lav[fc]\d+(\.\d+)+/g, "Lav<ffmpeg>") : v;
  const at = (t, c) => tables[t] ? tables[t].cols.indexOf(c) * 2 : -1;
  const T = tables.tracks, A = tables.albums;
  const ruled = new Set();   // "table:row:col" held by rule
  if (T) {
    const [pathAt, mtimeAt, sizeAt, durAt, lossAt, albumAt] = ["path", "mtime", "size", "duration", "lossless", "album_id"].map(c => at("tracks", c));
    for (const [i, r] of T.rows.entries()) {
      const st = files.stats.get(r[pathAt]);
      if (st && r[mtimeAt] === Math.floor(st.mtimeMs)) { r[mtimeAt] = "<the file's time>"; ruled.add(`tracks:${i}:${mtimeAt}`); }
      if (st && r[sizeAt] === st.size) { r[sizeAt] = "<the file's length>"; ruled.add(`tracks:${i}:${sizeAt}`); }
      if (r[lossAt] === 0 && files.seconds.has(r[pathAt]) && r[durAt] === files.seconds.get(r[pathAt])) { r[durAt] = "<as the reader reads it>"; ruled.add(`tracks:${i}:${durAt}`); }
    }
    if (A) {
      const [idAt, hashAt, artAt, aDurAt] = ["id", "art_hash", "art_path", "duration"].map(c => at("albums", c));
      for (const [i, a] of A.rows.entries()) {
        const mine = T.rows.filter(r => r[albumAt] === a[idAt]);
        // Its cover's key: sha1 of a file's path, length and time (the cover's, else a track's).
        const keyOf = (p) => { const st = files.stats.get(p); return st ? crypto.createHash("sha1").update(`${p}|${st.size}|${st.mtimeMs}`).digest("hex").slice(0, 10) : null; };
        const from = [a[artAt]].concat(mine.map(r => r[pathAt])).find(p => p && a[hashAt] && keyOf(p) === a[hashAt]);
        if (from) { a[hashAt] = "<the key of " + text(from) + ">"; ruled.add(`albums:${i}:${hashAt}`); }
        // A lossy album's length: its tracks' as read, summed.
        if (mine.some(r => r[lossAt] === 0)) {
          const durs = mine.map(r => files.seconds.has(r[pathAt]) && r[lossAt] === 0 ? files.seconds.get(r[pathAt]) : r[durAt]);
          const sum = durs.reduce((x, y) => x + y, 0), back = durs.slice().reverse().reduce((x, y) => x + y, 0);
          if (a[aDurAt] === sum || a[aDurAt] === back) { a[aDurAt] = "<its tracks' summed>"; ruled.add(`albums:${i}:${aDurAt}`); }
        }
      }
    }
  }
  for (const [t, { rows }] of Object.entries(tables)) {
    for (const [i, r] of rows.entries()) {
      for (let j = 0; j < r.length; j += 2) {
        if (ruled.has(`${t}:${i}:${j}`)) continue;
        if (typeof r[j] === "number" && r[j] > now - 3 * DAY && r[j] < now + DAY && !(t === "tracks" && j === at("tracks", "mtime"))) r[j] = "<now>";
        else r[j] = text(r[j]);
      }
    }
  }
  return tables;
}
/* Anything else said: the folder's own path, and times, by name. */
const named = (v, root) => JSON.parse(JSON.stringify(v), (k, x) => typeof x === "string" ? x.split(root).join("<root>") : typeof x === "number" && x > Date.now() - 3 * 86400000 ? "<now>" : x);

test("the scan made by the C# server writes what the Node server's scan writes", { skip, timeout: 300000 }, async () => {
  const lib = makeMixedLibrary();
  const files = looker(lib.music);
  const csData = path.join(lib.root, "data-cs");
  assert.equal(spawnSync(BIN, ["db", csData]).status, 0, "the C# server's database made");
  // The Node server's database as it started one (DB.open, then the Features constructor's tables), as `mandarin-server db` makes it.
  const node = RECORD ? { db: NODE.DB.open(path.join(lib.root, "data-node"), { log: () => {} }), lines: [] } : null;
  if (RECORD) new (require("../lib/server/features").Features)({ db: node.db, log: () => {} });
  const nodeScanner = (opts = {}) => new NODE.Scanner(Object.assign({ db: node.db, root: lib.music, log: l => node.lines.push(l), program: null }, opts));
  let s = RECORD ? nodeScanner() : null, massRemoval = 500, scanRoot = lib.music;
  // Each database, opened for a moment: written to between scans, or read whole.
  const withDb = (fn) => { const d = new Database(path.join(csData, "musicd.db")); try { return fn(d); } finally { d.close(); } };
  const both = async (what, opts = {}) => {
    files.look();
    let want = null;
    if (RECORD) {
      node.lines.length = 0;
      const a = await s.scan(opts);
      want = { result: named(result(a), lib.root), said: named(said(node.lines), lib.root), state: STATE.map(k => s.state[k]), tables: normalised(dump(node.db.raw), lib.root, files) };
    }
    const c = scanCs(csData, scanRoot, Object.assign({ massRemoval }, opts));
    assert.ok(c.lines.some(l => /made by the C# server/.test(l)), what + ": the C# server made it\n" + c.lines.join("\n"));
    const tables = normalised(withDb(d => dump(d)), lib.root, files);
    kept.same(what + ": the result, what was said, the state", ["result", "said", "state"], [what], [named(result(c.result), lib.root), named(said(c.lines), lib.root), STATE.map(k => c.state[k])],
      RECORD && (() => [want.result, want.said, want.state]));
    kept.same(what + ": the tables", ["tables"], [what], [Object.keys(tables)], RECORD && (() => [Object.keys(want.tables)]));
    for (const t of Object.keys(tables)) {
      kept.same(`${what}: table ${t}`, tables[t].rows.map((_, i) => `${t} row ${i + 1}`), tables[t].rows.map(() => tables[t].cols), tables[t].rows, RECORD && (() => want.tables[t].rows));
    }
    return c.result;
  };
  try {
    const first = await both("the first scan");
    assert.equal(first.status, "updated");
    assert.ok(first.albums >= 20, "albums: " + first.albums);
    assert.ok(first.errors >= 1, "the broken file said so");

    // What hangs on an album's key, put on Album One in each database.
    const put = (d, set) => {
      const key = d.prepare("SELECT key FROM albums WHERE title = 'Album One'").get().key;
      const song1 = d.prepare("SELECT id FROM tracks WHERE title = 'Song 1'").get().id;
      d.prepare("INSERT INTO favourites(key, added_at) VALUES(?, 1)").run(key);
      d.prepare("INSERT INTO album_edits(key, year, updated_at) VALUES(?, 1998, 1)").run(key);
      d.prepare("INSERT INTO album_matches(key, status, checked_at) VALUES(?, 'unidentified', 1)").run(key);
      d.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('mbday', ?, '{\"date\":\"1997-02-04\"}', 1)").run(key);
      d.prepare("INSERT INTO track_loudness(track_id, lufs, peak, measured_at) VALUES(?, -9.5, -0.2, 1)").run(song1);
      set(d, "album_of_the_day", { date: "2026-10-08", key, why: "ÿ" });
      return key;
    };
    const setRaw = (d, k, v) => d.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, JSON.stringify(v));
    const key = withDb(d => put(d, setRaw));
    if (RECORD) put(node.db.raw, (d, k, v) => node.db.setSetting(k, v));
    assert.equal((await both("nothing changed")).status, "unchanged");

    // A file changed, a folder renamed, a file gone, one new, an album's tags rewritten.
    const one = path.join(lib.music, "Artist A/Album One");
    fs.utimesSync(path.join(one, "01 Song 1.flac"), new Date(), new Date(Date.now() - 3600e3));
    fs.renameSync(one, one + " (Remaster)");
    fs.unlinkSync(path.join(lib.music, "Mixed/02 b.flac"));
    gen(path.join(lib.music, "Mixed/03 c.flac"), { seconds: 1, tags: { title: "c", artist: "M", album: "First" } });
    gen(path.join(lib.music, "AA/01.flac"), { seconds: 1, tags: { title: "duet", artist: "X & Y", album: "Duets (Deluxe)", album_artist: "X" } });
    const changed = await both("files changed, renamed, gone and new");
    assert.ok(changed.relocated >= 1 && changed.removed >= 1, JSON.stringify(changed));
    withDb(d => {
      const moved = d.prepare("SELECT key FROM albums WHERE title = 'Album One'").get();
      assert.ok(moved && moved.key !== key, "Album One has its new folder's key");
      assert.equal(d.prepare("SELECT COUNT(*) AS n FROM favourites WHERE key = ?").get(moved.key).n, 1, "its heart went with it");
      assert.equal(JSON.parse(d.prepare("SELECT value FROM settings WHERE key = 'album_of_the_day'").get().value).key, moved.key, "and Album of the day");
    });

    // Most of a folder gone at once is kept; so is a drive that isn't there.
    massRemoval = 1;
    if (RECORD) s = nodeScanner({ massRemoval: 1 });
    fs.unlinkSync(path.join(lib.music, "Flagged/01.flac"));
    fs.unlinkSync(path.join(lib.music, "Flagged/02.flac"));
    const kept1 = await both("most of a folder gone at once");
    assert.equal(kept1.removed, 0);
    assert.ok(kept1.kept_offline >= 2, JSON.stringify(kept1));
    fs.renameSync(path.join(lib.music, "Artist B"), path.join(lib.root, "Artist B"));
    fs.mkdirSync(path.join(lib.music, "Artist B"));
    const drive = await both("a drive not mounted");
    assert.ok(drive.offline_dirs.some(d => d.name === "Artist B" && d.reason === "empty"), JSON.stringify(drive.offline_dirs));
    fs.rmdirSync(path.join(lib.music, "Artist B"));
    fs.renameSync(path.join(lib.root, "Artist B"), path.join(lib.music, "Artist B"));
    // A folder that can't be read (here a link that loops onto itself): its albums kept.
    const unnamed = path.join(lib.music, "Art/Two Unnamed");
    fs.renameSync(unnamed, path.join(lib.root, "Two Unnamed"));
    fs.symlinkSync(unnamed, unnamed);
    const unreadable = await both("a folder that can't be read");
    assert.ok(unreadable.offline_dirs.some(d => d.reason === "unreadable"), JSON.stringify(unreadable.offline_dirs));
    fs.unlinkSync(unnamed);
    fs.renameSync(path.join(lib.root, "Two Unnamed"), unnamed);

    // Everything read again; and every folder regrouped (the emptied folder filled again first).
    massRemoval = 500;
    if (RECORD) s = nodeScanner();
    await both("a forced rescan", { force: true });
    withDb(d => setRaw(d, "album_regroup", true));
    if (RECORD) node.db.setSetting("album_regroup", true);
    gen(path.join(lib.music, "Flagged/01.flac"), { seconds: 1, tags: { title: "f1", artist: "P", album: "Hits", compilation: "1" } });
    gen(path.join(lib.music, "Flagged/02.flac"), { seconds: 1, tags: { title: "f2", artist: "P", album: "Hits", compilation: "1" } });
    const rg = await both("the regroup");
    assert.deepEqual(rg.offline_dirs, []);
    assert.equal(withDb(d => JSON.parse(d.prepare("SELECT value FROM settings WHERE key = 'album_regroup'").get().value)), false, "the regroup done");

    // No music at all: nothing touched.
    scanRoot = path.join(lib.root, "nowhere");
    if (RECORD) s = new NODE.Scanner({ db: node.db, root: scanRoot, log: l => node.lines.push(l), program: null });
    assert.equal((await both("no music folder")).status, "no-music");
    kept.done();
  } finally {
    if (RECORD) node.db.close();
  }
});
