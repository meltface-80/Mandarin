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
 * run against the C# server in test/backup.test.js in MANDARIN_FRONT=1.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const B = require("../lib/backup");
const { newer, partsOf } = require("../lib/server/api-backup");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(Object.assign({ fn: "backup" }, job)) + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
const plain = v => JSON.parse(JSON.stringify(v));

const MANIFEST = { app: "mandarin", format: 1, version: "0.8.22", created: 1760000000000, from: { name: "iPhone · Safari", kind: "browser" }, phone: null, parts: ["settings", "database"] };
const SERVER = { settings: { homeRows: [{ id: "later", on: true }], smartPicksHour: 7, music_folders: ["/music", "/mnt/ünïcode"] },
  collection: { settings: { userPlaylists: [] }, tables: { favourites: [{ key: "album-a", added_at: 1 }], album_edits: [{ key: "k", art: { $b64: "AAEC" } }] } },
  odd: { "2": "b", "1": "a", "": null, "\ud800": "lone", emoji: "😀", nested: [[], {}, [1, [2]]], n: [0, -0, 1e21, 1.5e-7] } };

async function nodeRead(file, db) {
  try {
    const r = await B.readBackup(fs.createReadStream(file), { dbFile: db });
    const out = { parts: r.parts, hasDb: r.hasDb };
    if (r.hasDb && db) out.db = fs.readFileSync(db).toString("base64");
    return out;
  } catch (e) { return { error: e.message }; }
}

test("a backup written by either is read by the other: its parts and the database copy", { skip }, async () => {
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
  const byNode = [], byCs = [];
  for (const [i, entries] of sets.entries()) {
    const n = path.join(dir, `node-${i}.tar.gz`), c = path.join(dir, `cs-${i}.tar.gz`);
    await B.writeBackup(fs.createWriteStream(n), entries);
    byNode.push(n); byCs.push({ to: c, entries });
  }
  csharp({ writes: byCs });
  const files = byNode.concat(byCs.map(w => w.to));
  const out = csharp({ reads: files.map((f, i) => ({ file: f, db: path.join(dir, `cs-read-${i}.db`) })) });
  const want = [];
  for (const [i, f] of files.entries()) want.push(plain(await nodeRead(f, path.join(dir, `node-read-${i}.db`))));
  assert.deepStrictEqual(out.read, want);
  assert.ok(want.every(w => w.parts && w.parts.manifest), JSON.stringify(want.map(w => w.error)));
  assert.equal(want[0].db, fs.readFileSync(db).toString("base64"), "the database copy, byte for byte");
  // The same tar, header for header: only the gzip around it differs.
  for (let i = 0; i < sets.length; i++) {
    const a = zlib.gunzipSync(fs.readFileSync(byNode[i])), b = zlib.gunzipSync(fs.readFileSync(byCs[i].to));
    const strip = buf => { const c = Buffer.from(buf); for (let o = 0; o + 512 <= c.length; o += 512) { if (c[o + 257] === 0x75) { c.fill(0x30, o + 136, o + 147); c.fill(0x20, o + 148, o + 156); } } return c; };
    assert.ok(strip(a).equals(strip(b)), `set ${i}: the same tar but for the times written`);
  }
});

test("damaged and foreign files are refused in the same words", { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-bk-"));
  const good = path.join(dir, "good.tar.gz");
  await B.writeBackup(fs.createWriteStream(good), [{ name: "manifest.json", data: MANIFEST }, { name: "server.json", data: SERVER }]);
  const g = fs.readFileSync(good);
  const raw = zlib.gunzipSync(g);
  const files = {
    good: g,
    notGzip: Buffer.from("hello, not a backup at all"),
    empty: Buffer.alloc(0),
    oneByte: Buffer.from([0x1f]),
    twoBytes: Buffer.from([0x1f, 0x8b]),
    zip: Buffer.from("504b0304140000000800", "hex"),
    method: Buffer.concat([Buffer.from([0x1f, 0x8b, 7, 0]), g.subarray(4)]),
    flags: Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0x20]), g.subarray(4)]),
    cutTrailer: g.subarray(0, g.length - 3),
    cutHalf: g.subarray(0, Math.floor(g.length / 2)),
    cutMost: g.subarray(0, 30),
    zeroPadded: Buffer.concat([g, Buffer.alloc(700)]),
    junkAfter: Buffer.concat([g, Buffer.from("junk")]),
    badCrc: (() => { const b = Buffer.from(g); b[b.length - 6] ^= 1; return b; })(),
    tarCut: zlib.gzipSync(raw.subarray(0, 700)),
    tarNoEnd: zlib.gzipSync(raw.subarray(0, 512 * 3)),
    notOurs: await (async () => { const f = path.join(dir, "o.tar.gz"); await B.writeBackup(fs.createWriteStream(f), [{ name: "manifest.json", data: { app: "else" } }]); return fs.readFileSync(f); })(),
    noManifest: await (async () => { const f = path.join(dir, "n.tar.gz"); await B.writeBackup(fs.createWriteStream(f), [{ name: "server.json", data: {} }]); return fs.readFileSync(f); })(),
    badJson: await (async () => { const f = path.join(dir, "j.tar.gz"); await B.writeBackup(fs.createWriteStream(f), [{ name: "manifest.json", data: "{not json" }]); return fs.readFileSync(f); })(),
    bomJson: await (async () => { const f = path.join(dir, "bom.tar.gz"); await B.writeBackup(fs.createWriteStream(f), [{ name: "manifest.json", data: "﻿{\"app\":\"mandarin\"}" }]); return fs.readFileSync(f); })(),
    emptyJson: await (async () => { const f = path.join(dir, "e.tar.gz"); await B.writeBackup(fs.createWriteStream(f), [{ name: "manifest.json", data: Buffer.alloc(0) }]); return fs.readFileSync(f); })(),
    plainTar: raw
  };
  const names = Object.keys(files);
  for (const n of names) fs.writeFileSync(path.join(dir, n + ".bin"), files[n]);
  // A database in it, none asked for: refused.
  const withDb = path.join(dir, "withdb.bin");
  const tiny = path.join(dir, "tiny.db"); fs.writeFileSync(tiny, "x");
  await B.writeBackup(fs.createWriteStream(withDb), [{ name: "manifest.json", data: MANIFEST }, { name: "musicd.db", file: tiny }]);
  const reads = names.map(n => ({ file: path.join(dir, n + ".bin"), db: path.join(dir, n + ".cs.db") })).concat([{ file: withDb }]);
  const out = csharp({ reads });
  const want = [];
  for (const r of reads) want.push(plain(await nodeRead(r.file, r.db ? r.db.replace(".cs.db", ".node.db") : undefined)));
  for (const [i, r] of reads.entries()) assert.deepStrictEqual(out.read[i], want[i], (names[i] || "withdb") + ": " + JSON.stringify(want[i].error || "read"));
  const said = Object.fromEntries(reads.map((r, i) => [names[i] || "withdb", want[i].error || "ok"]));
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
  assert.deepStrictEqual(out.newer, pairs.map(([a, b]) => newer(a, b)));
  assert.deepStrictEqual(out.parts_of, plain(values).map(v => plain(partsOf(v))));
  assert.deepStrictEqual(out.pretty, plain(docs).map(d => JSON.stringify(d, null, 1)));
});
