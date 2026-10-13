"use strict";
/*
 * Backup & restore's file (v0.8.22): the C# server's (server/Mandarin.Server/
 * Admin/Backup.cs) held to lib/backup.js — a backup written by either read by
 * the other, the parts and the database copy the same; damaged files refused
 * in the same words (not gzip, cut short, something after it, padded with
 * zeros, not a Mandarin backup, a part that won't parse, a database where
 * none was asked for); the versions compared, the parts asked for read, and
 * the JSON written one space a level, as JSON.stringify writes it. Through
 * `mandarin-server score`; skipped where the C# server isn't built. The routes
 * run against the C# server in test/backup.test.js.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's side is kept
 * (test/golden.js's answers(), test/golden/backup-csharp.json), made while
 * lib/ was here: the backups it wrote (and the damaged
 * files made from them) whole, and its readings of every file; the C#
 * program alone is held to them.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { answers } = require("./golden");

const kept = answers("backup-csharp");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!kept.exists() && "no recording of the Node server's answers");
test.after(() => { if (!skip) kept.done(); });

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(Object.assign({ fn: "backup" }, job)) + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
/* Each answer the Node server's (kept), the first that isn't shown with its case. */
const same = (what, labels, cases, got) => kept.same(what, labels, cases, got);
/* Files the Node server wrote, kept whole and laid down in [dir] as they were: { name: file }. */
function nodeFiles(label, dir) {
  const b64 = kept.input(label);
  return Object.fromEntries(Object.entries(b64).map(([name, v]) => { const f = path.join(dir, name); fs.writeFileSync(f, Buffer.from(v, "base64")); return [name, f]; }));
}

const MANIFEST = { app: "mandarin", format: 1, version: "0.8.22", created: 1760000000000, from: { name: "iPhone · Safari", kind: "browser" }, phone: null, parts: ["settings", "database"] };
const SERVER = { settings: { homeRows: [{ id: "later", on: true }], smartPicksHour: 7, music_folders: ["/music", "/mnt/ünïcode"] },
  collection: { settings: { userPlaylists: [] }, tables: { favourites: [{ key: "album-a", added_at: 1 }], album_edits: [{ key: "k", art: { $b64: "AAEC" } }] } },
  odd: { "2": "b", "1": "a", "": null, "\ud800": "lone", emoji: "😀", nested: [[], {}, [1, [2]]], n: [0, -0, 1e21, 1.5e-7] } };

test("a backup written by either is read by the other: its parts and the database copy", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-bk-"));
  const db = path.join(dir, "x.db");
  fs.writeFileSync(db, Buffer.from(Array.from({ length: 70001 }, (_, i) => (i * 7) & 0xff)));
  const empty = path.join(dir, "empty.db");
  fs.writeFileSync(empty, "");
  const sets = [
    [{ name: "manifest.json", data: MANIFEST }, { name: "server.json", data: SERVER }, { name: "page.json", data: { "rra-ui-text": "1.25" } }, { name: "musicd.db", file: db }],
    [{ name: "manifest.json", data: Object.assign({}, MANIFEST, { parts: [] }) }],
    [{ name: "manifest.json", data: MANIFEST }, { name: "musicd.db", file: empty }, { name: "other.txt", data: "ignored" }, { name: "x".repeat(120) + ".json", data: { long: true } }]
  ];
  // Its backups of the same three sets.
  const written = nodeFiles("the Node server's backups", dir);
  const byNode = sets.map((_, i) => written[`node-${i}.tar.gz`]);
  const byCs = sets.map((entries, i) => ({ to: path.join(dir, `cs-${i}.tar.gz`), entries }));
  csharp({ writes: byCs });
  const files = byNode.concat(byCs.map(w => w.to));
  const out = csharp({ reads: files.map((f, i) => ({ file: f, db: path.join(dir, `cs-read-${i}.db`) })) });
  same("read", files.map(f => path.basename(f)), files.map(f => path.basename(f)), out.read);
  assert.ok(out.read.every(w => w.parts && w.parts.manifest), JSON.stringify(out.read.map(w => w.error)));
  assert.equal(out.read[0].db, fs.readFileSync(db).toString("base64"), "the database copy, byte for byte");
  // The same tar, header for header: only the gzip around it differs.
  for (let i = 0; i < sets.length; i++) {
    const a = zlib.gunzipSync(fs.readFileSync(byNode[i])), b = zlib.gunzipSync(fs.readFileSync(byCs[i].to));
    const strip = buf => { const c = Buffer.from(buf); for (let o = 0; o + 512 <= c.length; o += 512) { if (c[o + 257] === 0x75) { c.fill(0x30, o + 136, o + 147); c.fill(0x20, o + 148, o + 156); } } return c; };
    assert.ok(strip(a).equals(strip(b)), `set ${i}: the same tar but for the times written`);
  }
});

test("damaged and foreign files are refused in the same words", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-bk-"));
  // A good backup of the Node server's, and files made from it: not gzip, empty,
  // one and two bytes, a zip, the wrong method and flags, cut at the trailer,
  // halfway and almost at once, padded with zeros, junk after it, a bad CRC,
  // the tar cut short and with no end, not ours, no manifest, a manifest that
  // won't parse, one with a byte-order mark, an empty one, a plain tar, and a
  // database in one where none was asked for.
  const made = nodeFiles("the damaged and foreign files", dir);
  const names = Object.keys(made).map(n => n.replace(/\.bin$/, ""));
  const reads = names.map(n => n === "withdb" ? { file: made[n + ".bin"] } : { file: made[n + ".bin"], db: path.join(dir, n + ".cs.db") });
  const out = csharp({ reads });
  same("refused", names, names, out.read);
  const said = Object.fromEntries(names.map((n, i) => [n, out.read[i].error || "ok"]));
  assert.deepStrictEqual([said.good, said.zeroPadded, said.notGzip, said.cutHalf, said.notOurs, said.badJson, said.withdb],
    ["ok", "ok", "incorrect header check", "unexpected end of file", "That isn't a Mandarin backup", "The backup's manifest.json is unreadable", "A database copy wasn't expected here"]);
});

test("versions compared, parts read, JSON written as JSON.stringify(v, null, 1)", { skip }, () => {
  const pairs = [["0.6.14", "0.6.9"], ["0.6.9", "0.6.14"], ["0.6.14", "0.6.14"], ["0.6.0", "0.6.0-RC4"], ["0.6.0-RC4", "0.6.0"], ["0.6.0-RC10", "0.6.0-RC9"],
    ["1", "0.9.9"], ["", "0.1"], [null, "0.0.1"], [0.8, "0.8"], ["0.8.22", "0.8.21"], ["0.8.21", "0.8.22"], ["9.9.9", "0.8.22"], ["0.8.22.1", "0.8.22"], ["0.8", "0.8.0"],
    ["a.b", "a.c"], ["1.a", "1.1"], ["1.1", "1.a"], ["01.2", "1.2"], ["1..2", "1.2"], ["-1", "1"]];
  const values = ["settings,keys,bogus", "settings, keys ,page,app", "", "database", ["settings", 5, null, "keys", ["devices"]], { database: 1, page: true, devices: false, nope: true },
    { "2": true, settings: "yes", keys: 0 }, null, 5, true, ["app", "app", "page"]];
  const docs = [MANIFEST, SERVER, {}, [], [[]], { a: {} }, { a: [] }, "text", 5, null, { u: undefined, f: [undefined, 1] }, { "1": 1, "0": 0, b: 2, a: 1 }];
  const out = csharp({ newer: pairs, parts_of: plain(values), pretty: plain(docs) });
  same("newer", pairs.map(() => "pair"), pairs, out.newer);
  same("partsOf", values.map(() => "value"), plain(values), out.parts_of);
  assert.deepStrictEqual(out.pretty, plain(docs).map(d => JSON.stringify(d, null, 1)));
});
