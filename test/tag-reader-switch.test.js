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

/* The C# server's /internal/tags as far as the check's first question goes: which reader it is. */
function readerSays(version) {
  const server = http.createServer(async (req, res) => {
    for await (const c of req) { /* drained */ }
    if (req.url !== "/internal/tags" || req.headers["x-mandarin-front-key"] !== "key") { res.statusCode = 404; return res.end(); }
    res.setHeader("Content-Type", "application/json");
    if (server.version) res.setHeader("X-Tag-Reader", server.version);
    res.end("[]");
  });
  server.version = version;
  return new Promise(r => server.listen(0, "127.0.0.1", () => r(server)));
}

test("the scanner moves to the C# reader once a pass reads every file the same, and back on a difference", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const db = DB.open(lib.data, { log: () => {} });
  const cs = await readerSays("1");
  try {
    await new Scanner({ db, root: lib.music, log: () => {} }).scan();
    const tracks = db.raw.prepare("SELECT id, mtime, size FROM tracks").all();
    const lines = [];
    const check = async (version) => {
      const c = new TagCheck({ db, dataDir: lib.data, scanner: null, version, log: (l) => lines.push(l), enabled: true });
      c.setFront("http://127.0.0.1:" + cs.address().port, "key");
      await c.probe();
      return c;
    };
    const tc = await check("1.0.0");
    assert.equal(tc.readers, "music-metadata 11.16.0 | C# 1");
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
    // Another version of the server with the same two readers (v0.8.15): what was found stands.
    const next = await check("1.0.1");
    assert.equal(next.verdict().ready, true, "kept across an update");
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM tag_checks").get().n, tracks.length);
    // The C# reader changed: every file read both ways again, the scanner waiting for it.
    cs.version = "2";
    const changed = await check("1.0.2");
    assert.equal(changed.readers, "music-metadata 11.16.0 | C# 2");
    assert.equal(changed.verdict().ready, false);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM tag_checks").get().n, 0);
    assert.ok(lines.some(l => /a tag reader changed .*C# 1 → .*C# 2/.test(l)), lines.join("\n"));
    // Without the C# server, never.
    const off = new TagCheck({ db, dataDir: lib.data, scanner: null, version: "1.0.0", log: () => {}, enabled: true });
    assert.equal(off.verdict().ready, false);
  } finally {
    db.close();
    cs.close();
  }
});

test("an install checked by v0.8.13 or v0.8.14 keeps what was found when it updates", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const db = DB.open(lib.data, { log: () => {} });
  const cs = await readerSays(null);   // v0.8.13's C# server says nothing
  try {
    await new Scanner({ db, root: lib.music, log: () => {} }).scan();
    const tracks = db.raw.prepare("SELECT id, mtime, size FROM tracks").all();
    const put = db.raw.prepare("INSERT INTO tag_checks(track_id, mtime, size, outcome, detail, checked_at) VALUES(?, ?, ?, 'same', NULL, 0)");
    for (const t of tracks.slice(1)) put.run(t.id, t.mtime, t.size);
    // As v0.8.14 left it: its version, and part of a pass.
    db.setSetting("tagcheckVersion", "0.8.14");
    const tc = new TagCheck({ db, dataDir: lib.data, scanner: null, version: "0.8.15", log: () => {}, enabled: true });
    tc.setFront("http://127.0.0.1:" + cs.address().port, "key");
    await tc.probe();
    assert.equal(tc.readers, "music-metadata 11.16.0 | C# 1");
    assert.equal(tc.summary().checked, tracks.length - 1, "the files read both ways before the update stand");
    // A pass v0.8.14 finished: finished still.
    db.setSetting("tagcheckReaders", null);
    db.setSetting("tagcheckPassed", "0.8.14");
    put.run(tracks[0].id, tracks[0].mtime, tracks[0].size);
    const again = new TagCheck({ db, dataDir: lib.data, scanner: null, version: "0.8.15", log: () => {}, enabled: true });
    again.setFront("http://127.0.0.1:" + cs.address().port, "key");
    await again.probe();
    assert.equal(again.verdict().ready, true);
  } finally {
    db.close();
    cs.close();
  }
});

test("a file that brings the reader down among several in hand is found, read one at a time", { skip, timeout: 120000 }, async () => {
  const fs = require("fs");
  const path = require("path");
  const lib = makeLibrary();
  const db = DB.open(lib.data, { log: () => {} });
  const s = await standIn();
  try {
    // The tracks by hand (the scan would read the bad file in this very process): the bad one in the middle.
    const files = [];
    for (const d of ["Artist A/Album One", "Artist B/Hi Res"]) for (const f of fs.readdirSync(path.join(lib.music, d))) if (f.endsWith(".flac")) files.push(path.join(lib.music, d, f));
    const wav = path.join(lib.root, "elsewhere", "crash.wav");
    fs.mkdirSync(path.dirname(wav), { recursive: true });
    const big = Buffer.alloc(8); big.write("INAM", 0); big.writeUInt32LE(0x80000000, 4);
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([0xf0, 0xff, 0xff, 0xff]), Buffer.from("INFO"), big, Buffer.alloc(64)]);
    fs.writeFileSync(wav, Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0x7f]), Buffer.from("WAVE"), list]));
    files.splice(2, 0, wav);
    const album = db.raw.prepare("INSERT INTO albums(key, title, artist, added_at, updated_at) VALUES('k', 'x', 'y', 1, 1)").run().lastInsertRowid;
    const ins = db.raw.prepare("INSERT INTO tracks(album_id, path, mtime, size, title) VALUES(?, ?, ?, ?, 't')");
    for (const f of files) { const st = fs.statSync(f); ins.run(album, f, Math.floor(st.mtimeMs), st.size); }
    // The stand-in reads in this process: the bad file is said to fail there instead.
    s.server.removeAllListeners("request");
    s.server.on("request", async (req, res) => {
      let body = "";
      for await (const c of req) body += c;
      const replacer = (k, v) => typeof v === "bigint" ? { $bigint: String(v) } : (typeof v === "number" && !Number.isFinite(v)) ? { $num: String(v) } : v;
      const out = [];
      for (const p of JSON.parse(body)) {
        if (p === wav) { out.push({ path: p, ok: false, error: "stand-in" }); continue; }
        try { out.push({ path: p, ok: true, tags: JSON.parse(JSON.stringify(await readTags(p), replacer)) }); }
        catch (e) { out.push({ path: p, ok: false, error: e.message }); }
      }
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Tag-Reader", "1");
      res.end(JSON.stringify(out));
    });
    const lines = [];
    const tc = new TagCheck({ db, dataDir: lib.data, scanner: null, version: "t", log: (l) => lines.push(l), enabled: true, delayMs: 0 });
    tc.setFront(s.url, "key");
    tc.start();
    const end = Date.now() + 60000;
    while (!(tc.state === "done" && tc.summary().checked === files.length)) {
      if (Date.now() > end) throw new Error("the check didn't finish: " + JSON.stringify(tc.summary()) + "\n" + lines.join("\n"));
      await new Promise(r => setTimeout(r, 100));
    }
    tc.stop();
    const out = db.raw.prepare("SELECT t.path, c.outcome FROM tag_checks c JOIN tracks t ON t.id = c.track_id ORDER BY t.id").all();
    assert.deepEqual(out.map(r => r.outcome), files.map(f => f === wav ? "crashed" : "same"), lines.join("\n"));
    assert.ok(lines.some(l => /crash\.wav stopped the reader/.test(l)), lines.join("\n"));
  } finally {
    db.close();
    s.server.close();
  }
});

test("the time left, at the pace of the last few minutes", () => {
  const tc = new TagCheck({ db: null, dataDir: "", scanner: null, version: "t", log: () => {}, enabled: true });
  tc.state = "checking";
  assert.equal(tc.timeLeft(1000), null, "not yet known");
  tc.sample(0, 1000000);
  tc.sample(600, 1060000);   // 600 files in a minute
  assert.equal(tc.timeLeft(6000), 600000, "6,000 files: ten minutes");
  tc.state = "paused";
  assert.equal(tc.timeLeft(6000), null, "not while it waits");
  tc.state = "checking";
  tc.sample(600, 2060000);   // nothing for a quarter of an hour and more: the old samples go
  assert.equal(tc.timeLeft(6000), null);
});
