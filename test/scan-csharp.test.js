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
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { haveFfmpeg, gen, FFMPEG } = require("./fixtures");
const DB = require("../lib/library/db");
const { Scanner } = require("../lib/library/scanner");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)");

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
function dump(db) {
  const out = {};
  for (const { name } of db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()) {
    const cols = db.raw.prepare(`PRAGMA table_info(${name})`).all().map(c => c.name).filter(c => !(VOLATILE[name] || []).includes(c));
    if (!cols.length) continue;
    const list = cols.map(c => `"${c}", typeof("${c}")`).join(", ");
    out[name] = db.raw.prepare(`SELECT ${list} FROM ${name} ORDER BY rowid`).raw().all();
  }
  return out;
}

function same(a, b, what) {
  const da = dump(a), db = dump(b);
  for (const t of Object.keys(da)) assert.deepStrictEqual(db[t], da[t], `${what}: table ${t}`);
  assert.deepStrictEqual(Object.keys(db), Object.keys(da), what + ": the tables");
}

const said = (lines) => lines
  .filter(l => !/made by the C# server/.test(l))
  .map(l => l.replace(/ in \d+\.\ds$/, " in …s"));

function result(r) {
  const o = Object.assign({}, r);
  delete o.ms;
  return o;
}

test("the scan made by the C# server writes what the Node server's scan writes", { skip, timeout: 300000 }, async () => {
  const lib = makeMixedLibrary();
  const dbs = { node: DB.open(path.join(lib.root, "data-node"), { log: () => {} }), cs: DB.open(path.join(lib.root, "data-cs"), { log: () => {} }) };
  const lines = { node: [], cs: [] };
  const scanners = (opts = {}) => ({
    node: new Scanner(Object.assign({ db: dbs.node, root: lib.music, log: l => lines.node.push(l), program: null }, opts)),
    cs: new Scanner(Object.assign({ db: dbs.cs, root: lib.music, log: l => lines.cs.push(l), program: BIN }, opts))
  });
  let s = scanners();
  const both = async (what, opts = {}) => {
    lines.node.length = 0;
    lines.cs.length = 0;
    const a = await s.node.scan(opts);
    const b = await s.cs.scan(opts);
    assert.ok(lines.cs.some(l => /made by the C# server/.test(l)), what + ": the C# server made it\n" + lines.cs.join("\n"));
    assert.deepStrictEqual(result(b), result(a), what + ": the results");
    assert.deepStrictEqual(said(lines.cs), said(lines.node), what + ": what each said");
    for (const k of ["files", "parsed", "errors", "progress", "running"]) assert.strictEqual(s.cs.state[k], s.node.state[k], `${what}: state.${k}`);
    same(dbs.node, dbs.cs, what);
    return a;
  };
  try {
    const first = await both("the first scan");
    assert.equal(first.status, "updated");
    assert.ok(first.albums >= 20, "albums: " + first.albums);
    assert.ok(first.errors >= 1, "the broken file said so");

    // What hangs on an album's key, put on Album One in each database.
    const key = dbs.node.raw.prepare("SELECT key FROM albums WHERE title = 'Album One'").get().key;
    const song1 = dbs.node.raw.prepare("SELECT id FROM tracks WHERE title = 'Song 1'").get().id;
    for (const d of [dbs.node, dbs.cs]) {
      d.raw.prepare("INSERT INTO favourites(key, added_at) VALUES(?, 1)").run(key);
      d.raw.prepare("INSERT INTO album_edits(key, year, updated_at) VALUES(?, 1998, 1)").run(key);
      d.raw.prepare("INSERT INTO album_matches(key, status, checked_at) VALUES(?, 'unidentified', 1)").run(key);
      d.raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('mbday', ?, '{\"date\":\"1997-02-04\"}', 1)").run(key);
      d.raw.prepare("INSERT INTO track_loudness(track_id, lufs, peak, measured_at) VALUES(?, -9.5, -0.2, 1)").run(song1);
      d.setSetting("album_of_the_day", { date: "2026-10-08", key, why: "ÿ" });
    }
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
    const moved = dbs.cs.raw.prepare("SELECT key FROM albums WHERE title = 'Album One'").get();
    assert.ok(moved && moved.key !== key, "Album One has its new folder's key");
    assert.equal(dbs.cs.raw.prepare("SELECT COUNT(*) AS n FROM favourites WHERE key = ?").get(moved.key).n, 1, "its heart went with it");
    assert.equal(dbs.cs.setting("album_of_the_day", null).key, moved.key, "and Album of the day");

    // Most of a folder gone at once is kept; so is a drive that isn't there.
    s = scanners({ massRemoval: 1 });
    fs.unlinkSync(path.join(lib.music, "Flagged/01.flac"));
    fs.unlinkSync(path.join(lib.music, "Flagged/02.flac"));
    const kept = await both("most of a folder gone at once");
    assert.equal(kept.removed, 0);
    assert.ok(kept.kept_offline >= 2, JSON.stringify(kept));
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

    // Everything read again; and every folder regrouped.
    s = scanners();
    await both("a forced rescan", { force: true });
    for (const d of [dbs.node, dbs.cs]) d.setSetting("album_regroup", true);
    // (The emptied folder let go of, as Settings does, so the regroup is done everywhere.)
    for (const x of [s.node, s.cs]) x.forget(path.join(lib.music, "Flagged"));
    const rg = await both("the regroup");
    assert.deepEqual(rg.offline_dirs, []);
    assert.equal(dbs.cs.setting("album_regroup", null), false, "the regroup done");

    // No music at all: nothing touched.
    s = { node: new Scanner({ db: dbs.node, root: path.join(lib.root, "nowhere"), log: l => lines.node.push(l), program: null }),
      cs: new Scanner({ db: dbs.cs, root: path.join(lib.root, "nowhere"), log: l => lines.cs.push(l), program: BIN }) };
    assert.equal((await both("no music folder")).status, "no-music");
  } finally {
    dbs.node.close();
    dbs.cs.close();
  }
});

test("the Node server scans as before when the C# server's program can't be started", { skip, timeout: 120000 }, async () => {
  const lib = makeMixedLibrary();
  const db = DB.open(path.join(lib.root, "data"), { log: () => {} });
  try {
    // A program that isn't one: not started, the scan made here, and not tried again.
    const fake = path.join(lib.root, "not-a-program");
    fs.writeFileSync(fake, "nothing to run", { mode: 0o644 });
    const lines = [];
    const sc = new Scanner({ db, root: lib.music, log: l => lines.push(l), program: fake });
    const r = await sc.scan();
    assert.equal(r.status, "updated");
    assert.ok(lines.some(l => /didn't start/.test(l)), lines.join("\n"));
    assert.ok(!lines.some(l => /made by the C# server/.test(l)));
    assert.equal(sc.programNow(), null, "not asked again");
    // None at all: the same, quietly.
    const none = new Scanner({ db, root: lib.music, log: () => {}, program: path.join(lib.root, "missing") });
    assert.equal(none.programNow(), null);
    assert.equal((await none.scan()).status, "unchanged");
  } finally {
    db.close();
  }
});
