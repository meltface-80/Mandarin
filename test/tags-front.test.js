"use strict";
/*
 * The tag reader in C# (v0.8.13, server/Mandarin.Server/Tags/): every file
 * read as the scanner reads it today (scanner.js readTags, music-metadata)
 * and by the C# reader (mandarin-server tags), and the two must be the same,
 * to the byte, as JSON — for every format and tag layout (test/tagfixtures.js)
 * and for each of them damaged, where a file one reader can't read must be
 * one the other can't either. Then the check that does this on the library
 * itself (lib/library/tagcheck.js), through the C# server; and the scanner
 * reading tags with the C# server (v0.8.14): the library it makes is the one
 * the scanner makes reading them itself, row for row.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { haveFfmpeg } = require("./fixtures");
const { build } = require("./tagfixtures");
const { signIn } = require("./auth-helper");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skipRead = !fs.existsSync(BIN) ? "the C# server isn't built (server/build.sh)" : !haveFfmpeg() ? "no ffmpeg" : false;
const skipFront = process.env.MANDARIN_FRONT !== "1" ? "the suite isn't going through the C# server (MANDARIN_FRONT=1)" : skipRead;

// readTags in child processes: music-metadata can bring Node itself down on a damaged file.
const READER = `
const { readTags } = require(${JSON.stringify(path.join(__dirname, "..", "lib", "library", "scanner"))});
const replacer = (k, v) => typeof v === "bigint" ? { $bigint: String(v) } : (typeof v === "number" && !Number.isFinite(v)) ? { $num: String(v) } : v;
(async () => {
  for (const f of require("fs").readFileSync(0, "utf8").split("\\n").filter(Boolean)) {
    let line;
    try { line = { path: f, ok: true, json: JSON.stringify(await readTags(f), replacer) }; }
    catch (e) { line = { path: f, ok: false, error: String(e && e.message) }; }
    require("fs").writeSync(1, JSON.stringify(line) + "\\n");
  }
})();`;

function nodeReadings(files) {
  const out = new Map();
  let rest = files.slice();
  while (rest.length) {
    const r = spawnSync(process.execPath, ["-e", READER], { input: rest.join("\n"), maxBuffer: 1 << 30 });
    const lines = String(r.stdout).split("\n").filter(Boolean).map(l => JSON.parse(l));
    for (const l of lines) out.set(l.path, l);
    rest = rest.slice(lines.length);
    if (rest.length) { out.set(rest[0], { path: rest[0], ok: false, crashed: true }); rest = rest.slice(1); }
  }
  return out;
}

test("the C# tag reader reads every file as music-metadata does", { skip: skipRead, timeout: 300000 }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-tags-"));
  try {
    const files = build(dir);
    assert.ok(files.length > 400, "the files made: " + files.length);
    const node = nodeReadings(files);
    const r = spawnSync(BIN, ["tags"], { input: files.join("\n"), maxBuffer: 1 << 30 });
    assert.equal(r.status, 0, String(r.stderr));
    const cs = new Map(String(r.stdout).trim().split("\n").map(l => JSON.parse(l)).map(x => [x.path, x]));
    let same = 0, failed = 0;
    const bad = [];
    for (const f of files) {
      const n = node.get(f), c = cs.get(f);
      assert.ok(n && c, "both read " + f);
      if (!n.ok && !c.ok) { failed++; continue; }
      if (n.ok && c.ok && n.json === JSON.stringify(c.tags)) { same++; continue; }
      if (bad.length < 15) {
        if (!n.ok || !c.ok) bad.push(`${path.basename(f)}: Node ${n.ok ? "read it" : n.crashed ? "crashed" : "failed: " + n.error} | C# ${c.ok ? "read it" : "failed: " + c.error}`);
        else {
          const a = JSON.parse(n.json), b = c.tags;
          const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
          bad.push(`${path.basename(f)}: ` + (keys.length ? keys.map(k => `${k}: Node ${JSON.stringify(a[k]).slice(0, 200)} | C# ${JSON.stringify(b[k]).slice(0, 200)}`).join("; ") : "key order"));
        }
      }
    }
    assert.deepStrictEqual(bad, [], "files read differently");
    assert.ok(same > 300, `read the same: ${same} (and ${failed} by neither)`);
    // The clean files themselves were read, not just failed alike.
    for (const name of ["rich_v23.mp3", "rich_v24.mp3", "vorbis_rich.flac", "aac.m4a", "plain.dsf", "plain.dff", "monkey.ape", "renamed.aiff"]) {
      const c = cs.get(path.join(dir, name));
      if (c) assert.ok(c.ok, name + " read: " + c.error);
    }
    const rich = cs.get(path.join(dir, "rich_v23.mp3"));
    if (rich) {
      assert.equal(rich.tags.title, "Rich Title ü");
      assert.equal(rich.tags.mb_recording, "9ab1c2d3-e4f5-6789-abcd-ef0123456789");
      assert.equal(rich.tags.rg_track_gain, -7.21);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the check reads the library both ways and reports", { skip: skipFront, timeout: 180000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-tagcheck-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  const made = build(path.join(music, "Various"), { damage: 0 })
    .filter(f => /\.(flac|mp3|m4a|ogg|opus|wav|aif|dsf|dff|ape)$/.test(f) && !/v25|toolarge|bigcomment/.test(f));
  const PORT = 3697, B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false, tagcheck: true, tagcheckDelayMs: 0, tagReader: "auto" });
  let ctx;
  try {
    ctx = await srv.start();
    const H = { Authorization: "Bearer " + await signIn(B) };
    const until = async (fn, ms, what) => {
      const end = Date.now() + ms;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error("timed out: " + what);
        await new Promise(r => setTimeout(r, 250));
      }
    };
    const summary = async () => (await fetch(B + "/api/tagcheck", { headers: H })).json();
    const tracks = await until(() => { const n = ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks").get().n; return !ctx.scanner.state.running && n >= made.length * 0.8 && n; }, 60000, "the scan");
    const done = await until(async () => { const s = await summary(); return s.state === "done" && s.checked === s.total && s; }, 120000, "the check");
    assert.equal(done.available, true);
    assert.equal(done.total, tracks);
    assert.equal(done.same + done.both_failed, tracks, "every file the same: " + JSON.stringify(done));
    let report = await (await fetch(B + "/api/tagcheck/report", { headers: H })).text();
    assert.match(report, new RegExp(`Files read both ways: ${tracks} of ${tracks}\\.`));
    assert.match(report, /Different: 0\./);
    // Every file read the same both ways: the scanner reads tags with the C# server from now on (v0.8.14).
    assert.equal(done.reader, "csharp");
    assert.equal(done.passed, true);
    assert.ok(ctx.scanner.readerNow());

    // A file that brings music-metadata (and Node) down: noted, and the check goes on. Kept out
    // of the music folder (the scan itself would read it), and given to the library by hand.
    const wav = path.join(root, "elsewhere", "crash.wav");
    fs.mkdirSync(path.dirname(wav), { recursive: true });
    const big = Buffer.alloc(8); big.write("INAM", 0); big.writeUInt32LE(0x80000000, 4);
    const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([0xf0, 0xff, 0xff, 0xff]), Buffer.from("INFO"), big, Buffer.alloc(64)]);
    fs.writeFileSync(wav, Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0x7f]), Buffer.from("WAVE"), list]));
    const st = fs.statSync(wav);
    const album = ctx.db.raw.prepare("SELECT album_id FROM tracks LIMIT 1").get().album_id;
    const id = ctx.db.raw.prepare("INSERT INTO tracks(album_id, path, mtime, size, title) VALUES(?, ?, ?, ?, 'crash')").run(album, wav, Math.floor(st.mtimeMs), st.size).lastInsertRowid;
    // And a difference, as the report shows one.
    const first = ctx.db.raw.prepare("SELECT id, mtime, size FROM tracks WHERE id != ? ORDER BY id LIMIT 1").get(id);
    ctx.tagcheck.kick();
    const after = await until(async () => { const s = await summary(); return s.state === "done" && s.checked === s.total && s; }, 60000, "the check after the crash");
    const row = ctx.db.raw.prepare("SELECT outcome FROM tag_checks WHERE track_id = ?").get(id);
    assert.ok(row && (row.outcome === "crashed" || row.outcome === "both_failed"), "the bad file noted: " + JSON.stringify(row));
    assert.equal(after.checked, tracks + 1);
    ctx.db.raw.prepare("UPDATE tag_checks SET outcome = 'different', detail = ? WHERE track_id = ?")
      .run(JSON.stringify([{ field: "duration", node: "245.3", csharp: "245.29" }]), first.id);
    report = await (await fetch(B + "/api/tagcheck/report", { headers: H })).text();
    assert.match(report, /Different: 1\./);
    // One file read differently: back to this server's own reading until it's put right.
    assert.equal((await summary()).reader, "node");
    assert.equal(ctx.scanner.readerNow(), null);
    assert.match(report, /duration: Node 245\.3 \| C# 245\.29/);
    if (row.outcome === "crashed") assert.match(report, /Stopped the Node reader: 1\.[\s\S]*crash\.wav/);
  } finally {
    await srv.stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The library a scan made: every track (and its album, and all its tags), by path.
function dump(raw) {
  return raw.prepare(`SELECT t.path, t.mtime, t.size, t.title, t.artist, t.album_artist, t.album, t.track_no, t.disc_no, t.duration,
      t.codec, t.container, t.sample_rate, t.bits, t.channels, t.lossless, t.year, t.date, t.label, t.genres, t.tags_v,
      t.isrc, t.barcode, t.catno, t.country, t.mb_album, t.mb_group, t.mb_recording,
      t.rg_track_gain, t.rg_track_peak, t.rg_album_gain, t.rg_album_peak, t.names_from,
      a.key AS album_key, a.title AS album_title, a.artist AS album_by, a.compilation, g.tags
    FROM tracks t JOIN albums a ON a.id = t.album_id LEFT JOIN track_tags g ON g.track_id = t.id ORDER BY t.path`).all();
}

test("the scanner reading tags with the C# server makes the same library as reading them itself", { skip: skipFront, timeout: 300000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-tagscan-"));
  const music = path.join(root, "music");
  // The clean files only: a damaged one can bring music-metadata, and the
  // whole server with it, down (the check has its own test for those).
  const made = build(path.join(music, "Various"), { damage: 0 });
  for (const f of made) if (/v25|toolarge|bigcomment/.test(f)) fs.rmSync(f, { force: true });
  const until = async (fn, ms, what) => {
    const end = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error("timed out: " + what);
      await new Promise(r => setTimeout(r, 200));
    }
  };
  // Each reader in turn, over its own copy of the database: the first scan as
  // the server starts, then every file read again (force) by that reader.
  const scanWith = async (reader) => {
    const PORT = 3699;
    const lines = [];
    const srv = require("../index.js").createServer({ port: PORT, musicDir: music, dataDir: path.join(root, "data-" + reader), serverIp: "127.0.0.1",
      sonosHosts: [], upnpMulticast: false, identify: false, tagcheck: false, tagReader: reader });
    let ctx;
    try {
      ctx = await srv.start();
      await until(() => ctx.scanner.state.lastResult && !ctx.scanner.state.running, 120000, "the first scan");
      const log = ctx.scanner.log;
      ctx.scanner.log = (l) => { lines.push(String(l)); log(l); };
      const r = await ctx.scanner.scan({ force: true });
      assert.ok(r && r.status !== "running", "the scan ran: " + JSON.stringify(r));
      return { rows: dump(ctx.db.raw), lines };
    } finally {
      await srv.stop().catch(() => {});
    }
  };
  try {
    const node = await scanWith("node");
    const cs = await scanWith("csharp");
    // Its tags read by the C# server for this one's scan (v0.8.14), or the whole scan made there (v0.8.18).
    assert.ok(cs.lines.some(l => /tags read by the C# server|made by the C# server/.test(l)), "read by the C# server: " + cs.lines.join("\n"));
    assert.ok(!cs.lines.some(l => /didn't read the tags/.test(l)), cs.lines.join("\n"));
    assert.ok(!node.lines.some(l => /tags read by the C# server/.test(l)));
    assert.ok(node.rows.length > 50, "tracks: " + node.rows.length + " of " + made.length + " files");
    assert.equal(cs.rows.length, node.rows.length);
    for (let i = 0; i < node.rows.length; i++) assert.deepStrictEqual(cs.rows[i], node.rows[i], node.rows[i].path);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
