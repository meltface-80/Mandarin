"use strict";
/*
 * The tag reader in C# (v0.8.13, server/Mandarin.Server/Tags/): every file
 * read as the scanner reads it today (scanner.js readTags, music-metadata)
 * and by the C# reader (mandarin-server tags), and the two must be the same,
 * to the byte, as JSON — for every format and tag layout (test/tagfixtures.js)
 * and for each of them damaged, where a file one reader can't read must be
 * one the other can't either.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's reading is kept as the
 * oracle (test/tag-oracle.js: scanner.js's readTags over music-metadata
 * 11.16.0, a test dependency now): the fixtures are made by this machine's
 * ffmpeg, so they are read both ways here rather than recorded. The check
 * that compared the two readers on the library, and the Node scanner's
 * switch between them, went with the Node server.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { haveFfmpeg } = require("./fixtures");
const { build } = require("./tagfixtures");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skipRead = !fs.existsSync(BIN) ? "the C# server isn't built (server/build.sh)" : !haveFfmpeg() ? "no ffmpeg" : false;

// readTags in child processes: music-metadata can bring Node itself down on a damaged file.
const READER = `
const { readTags } = require(${JSON.stringify(path.join(__dirname, "tag-oracle"))});
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
