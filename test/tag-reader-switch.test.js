"use strict";
/*
 * The scanner's tags read by the C# server (v0.8.14): a folder's files sent
 * together and each reading taken in its place; the files read here instead
 * when it doesn't answer; and the switch made only once the check
 * (lib/library/tagcheck.js) has read every file the same both ways, and
 * undone when a file read since comes out differently. The C# server itself
 * is test/tags-front.test.js's; here a stand-in answers as it does.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const DB = require("../lib/library/db");
const { Scanner, readTags } = require("../lib/library/scanner");
const { TagCheck } = require("../lib/library/tagcheck");

const skip = !haveFfmpeg() && "ffmpeg is not installed";

const rows = (db) => db.raw.prepare(`SELECT t.path, t.title, t.artist, t.album, t.track_no, t.duration, t.codec, t.sample_rate, t.bits,
  t.year, t.genres, a.key AS album_key, g.tags FROM tracks t JOIN albums a ON a.id = t.album_id
  LEFT JOIN track_tags g ON g.track_id = t.id ORDER BY t.path`).all();

/* The C# server's /internal/tags, as it answers: this server's own readings, written as it writes them. */
function standIn() {
  const asked = [];
  const replacer = (k, v) => typeof v === "bigint" ? { $bigint: String(v) } : (typeof v === "number" && !Number.isFinite(v)) ? { $num: String(v) } : v;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    if (req.url !== "/internal/tags" || req.headers["x-mandarin-front-key"] !== "key") { res.statusCode = 404; return res.end(); }
    const paths = JSON.parse(body);
    asked.push(paths.length);
    const out = [];
    // In another order than asked, as threads finish: each is taken by its path.
    for (const p of paths.slice().reverse()) {
      try { out.push({ path: p, ok: true, tags: JSON.parse(JSON.stringify(await readTags(p), replacer)) }); }
      catch (e) { out.push({ path: p, ok: false, error: e.message }); }
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Tag-Reader", "1");
    res.end(JSON.stringify(out));
  });
  return new Promise(r => server.listen(0, "127.0.0.1", () => r({ server, asked, url: "http://127.0.0.1:" + server.address().port })));
}

test("a scan with the C# server reading the tags makes the library a scan reading them itself does", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const a = DB.open(lib.data, { log: () => {} });
  await new Scanner({ db: a, root: lib.music, log: () => {} }).scan();
  const mine = rows(a);
  a.close();
  const s = await standIn();
  // The same files, into a database of their own.
  const b = DB.open(require("path").join(lib.root, "data-cs"), { log: () => {} });
  try {
    const lines = [];
    await new Scanner({ db: b, root: lib.music, log: (l) => lines.push(l), reader: () => ({ url: s.url, key: "key" }) }).scan();
    assert.ok(lines.some(l => /tags read by the C# server/.test(l)), lines.join("\n"));
    assert.ok(s.asked.length > 0 && s.asked.every(n => n >= 1 && n <= 64), "asked a folder at a time: " + s.asked);
    assert.ok(mine.length > 0);
    assert.deepStrictEqual(rows(b), mine);
  } finally {
    b.close();
    s.server.close();
  }
});

test("the C# server not answering: the scan reads the tags itself, said once", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const db = DB.open(lib.data, { log: () => {} });
  try {
    const lines = [];
    // Port 9 on loopback: nothing there.
    const r = await new Scanner({ db, root: lib.music, log: (l) => lines.push(l), reader: { url: "http://127.0.0.1:9", key: "key" } }).scan();
    assert.ok(r.added > 0, JSON.stringify(r));
    assert.equal(lines.filter(l => /didn't read the tags/.test(l)).length, 1, lines.join("\n"));
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM tracks").get().n, r.added);
  } finally {
    db.close();
  }
});

test("the scanner moves to the C# reader once a pass reads every file the same, and back on a difference", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const db = DB.open(lib.data, { log: () => {} });
  try {
    await new Scanner({ db, root: lib.music, log: () => {} }).scan();
    const tracks = db.raw.prepare("SELECT id, mtime, size FROM tracks").all();
    const lines = [];
    const check = (version) => {
      const c = new TagCheck({ db, dataDir: lib.data, scanner: null, version, log: (l) => lines.push(l), enabled: true });
      c.setFront("http://127.0.0.1:9", "key");
      return c;
    };
    const tc = check("1.0.0");
    assert.equal(tc.verdict().ready, false, "nothing checked yet");
    const put = db.raw.prepare(`INSERT INTO tag_checks(track_id, mtime, size, outcome, detail, checked_at) VALUES(?, ?, ?, ?, NULL, 0)
      ON CONFLICT(track_id) DO UPDATE SET outcome = excluded.outcome`);
    // Part of the way: not yet.
    put.run(tracks[0].id, tracks[0].mtime, tracks[0].size, "same");
    tc.passed();
    assert.equal(tc.verdict().ready, false, "a pass that didn't read every file");
    for (const t of tracks) put.run(t.id, t.mtime, t.size, "same");
    tc.passed();
    assert.deepEqual(tc.verdict(), { ready: true, passed: true, odd: 0 });
    assert.ok(lines.some(l => /the scanner reads tags with the C# server from now on/.test(l)), lines.join("\n"));
    // A file that read the same both ways: unchanged by the files neither could read.
    put.run(tracks[0].id, tracks[0].mtime, tracks[0].size, "both_failed");
    assert.equal(tc.verdict().ready, true);
    // One read since that came out differently: back to this server's reading.
    put.run(tracks[1].id, tracks[1].mtime, tracks[1].size, "different");
    assert.equal(tc.verdict().ready, false);
    tc.passed();
    assert.equal(tc.verdict().passed, false, "the pass no longer stands");
    put.run(tracks[1].id, tracks[1].mtime, tracks[1].size, "same");
    tc.passed();
    assert.equal(tc.verdict().ready, true);
    // Another version of the server: checked again before the switch.
    assert.equal(check("1.0.1").verdict().ready, false);
    // Without the C# server, never.
    const off = new TagCheck({ db, dataDir: lib.data, scanner: null, version: "1.0.0", log: () => {}, enabled: true });
    assert.equal(off.verdict().ready, false);
  } finally {
    db.close();
  }
});
