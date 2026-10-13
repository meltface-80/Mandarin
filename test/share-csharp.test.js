"use strict";
/*
 * A playlist shared as text (v0.8.21): the C# server's MDRP1 blob
 * (server/Mandarin.Server/Extras/ShareBlob.cs) held to lib/server/share.js —
 * the fields, a track's entry and the whole document made the same; each
 * side's blob read by the other; and pastes read the same, passing and
 * failing alike: words around the blob, wrapped, quoted, the marker
 * lower-cased, the sender's words after it (under 40 characters and over),
 * cut short, gzip's corners (members one after another, a zero byte after
 * one, header fields, a stored block, a bad checksum) and contents that
 * aren't a playlist. Through `mandarin-server score`; skipped where the C#
 * server isn't built. The routes run against the C# server in
 * test/playlists.test.js.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's answers are kept
 * (test/golden.js's answers(), test/golden/share-csharp.json), made with
 * RECORD_SHARE=1 while lib/ was here, with the blobs it wrote and the pastes
 * (gzip's bytes are this machine's zlib's, so they are kept whole); the C#
 * program alone is held to them case for case, and its own blobs are read
 * with Node's zlib as MusicD Remote reads them.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");
const { answers } = require("./golden");

const RECORD = process.env.RECORD_SHARE === "1";
// The Node server's share.js, asked while recording (lib/, until v0.8.50).
const SH = RECORD ? require("../lib/server/share") : null;
const kept = answers("share-csharp", RECORD);

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!RECORD && !kept.exists() && "no recording of the Node server's answers (RECORD_SHARE=1 made it)");
test.after(() => { if (!skip) kept.done(); });
// The version and date a document carries, as recorded (the Node server wrote its own version).
const VERSION = "0.8.50";
const DATE = "2026-10-08T12:34:56.789Z";

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(Object.assign({ fn: "blob" }, job)) + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
const plain = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const nodeDecode = blob => { try { return { doc: SH.decodeSharePayload(blob) }; } catch (e) { return { error: e.message }; } };
/* Each answer the Node server's (kept), the first that isn't shown with its case. */
const same = (what, cases, got, want) => kept.same(what, cases.map((_, i) => what + " " + i), cases, got, RECORD && (() => plain(want())));
/* Documents made by the C# server (held to the Node server's in the test below), for the blobs and pastes. */
const docOf = (name, tracks) => csharp({ docs: [{ name, tracks }], date: DATE, version: VERSION }).doc[0].doc;
/* An MDRP1 blob read as MusicD Remote reads one: base64url, gunzip, JSON. */
const readBlob = blob => JSON.parse(zlib.gunzipSync(Buffer.from(blob.slice(6), "base64url")).toString("utf8"));

const STRINGS = ["Song 1", "  spaced   out  ", "Tab\tname\nline", " nbsp　", "﻿bom﻿", "\u0085nel\u0085", " ls ", "a".repeat(600),
  " ".repeat(10) + "x".repeat(498) + "  y", "Ünïcode 😀", "😀".repeat(300), "\ud800lone", "lone\udc00", "", " ", "᠎", "​ x ​"];
const VALUES = [null, 0, 5, true, ["a"], { x: 1 }];

test("the fields: text, numbers and addresses as share.js keeps them", { skip }, () => {
  const texts = [], ints = [], uris = [];
  for (const v of STRINGS.concat(VALUES)) for (const max of [500, 200, 32, 3]) texts.push([v, max]);
  const nums = ["7", " 12abc", "-3", "1e3", 3.9, "0x1F", "", null, true, [5], ["5", "6"], "999", "1000", "2999", "3000", 1e21, 1e-7, -0, "   42",
    "﻿42", "\u008542", "+8", "08", "１２", 86400000, "86400001", { a: 1 }];
  for (const v of nums) for (const [min, max] of [[1, 999], [1000, 2999], [1, 99], [1, 86400000], [0, 50000000]]) ints.push([v, min, max]);
  uris.push(null, "spotify:x", [], ["https://a", " spotify:track:1 ", "nope", "1http:x", "x:y", "x:y", 5, null, "kK:x", "ſ:x", "a".repeat(499) + ":", "a".repeat(500) + ":",
    "mailto:a", "urn:x", "e:5"], ["a:1", "b:2", "a:1", "c:3", "d:4", "e:5"], [" A+.-9:zz ", "+a:x", "a b:x", "é:x", "ab"]);
  const out = csharp({ texts, ints, uris });
  const p = plain({ texts, ints, uris });
  same("shareText", p.texts, out.text, () => p.texts.map(([v, max]) => SH.shareText(v, max)));
  same("shareInt", p.ints, out.int, () => p.ints.map(([v, min, max]) => SH.shareInt(v, min, max)));
  same("shareUriList", p.uris, out.uris, () => p.uris.map(v => SH.shareUriList(v)));
});

test("a track's entry and the whole document, made the same", { skip }, () => {
  const entries = [
    { title: "Song 1", artist: "Artist A", album: "Album One", track_no: 1 },
    { title: "  Song   2 ", artist: " A ", album: "", track_no: "02", duration_ms: "215000", isrc: "GBAYE0601498", upc: " 0886 ", year: "1997", disc: 2,
      qobuz_album_id: "abc123", tidal_album_id: 42, identifier: ["https://musicbrainz.org/recording/x", "nope", "isrc:GB1"], location: ["file:///x.flac"] },
    { title: "" }, { title: "   " }, { artist: "No title" }, null, "Song", 5, ["title"], { title: 5 }, { title: ["x"] },
    { title: "Edge", track_no: 0, duration_ms: 0, year: 999, disc: 100, isrc: "x".repeat(40), identifier: "https://x" },
    { title: "Years", year: "2999.9", disc: "1e2", track_no: 999.5, duration_ms: 86400000 },
    { title: "Order", extension: { evil: true }, creator: "ignored", trackNum: 9 },
    { title: "\ud800lone", artist: " ", album: "😀".repeat(260) }
  ];
  const many = n => Array.from({ length: n }, (_, i) => i % 3 === 0 ? { artist: "untitled " + i } : { title: "T" + i, artist: "A" + (i % 7), album: "B" + (i % 5), track_no: (i % 30) + 1 });
  const docs = [
    { name: "Mine", tracks: entries },
    { name: "  Road\ttrip  ", annotation: " for the car ", tracks: entries.slice(0, 2) },
    { name: "", annotation: "", tracks: [entries[0]] },
    { name: 5, annotation: ["x"], tracks: [] },
    { name: "x".repeat(300), annotation: "y".repeat(700), tracks: "not a list" },
    { tracks: many(3100) },
    { name: "Exactly", tracks: many(3000).filter(t => t.title).slice(0, 2000).concat([{ title: "one more" }]) }
  ];
  const out = csharp({ entries, docs, date: DATE, version: VERSION });
  const p = plain({ entries, docs });
  same("a track's entry", p.entries, out.entry, () => p.entries.map(e => SH.buildShareDoc({}, [e]).doc.playlist.track[0] || null));
  same("the document", p.docs, out.doc, () => p.docs.map(d => {
    const b = SH.buildShareDoc({ name: d.name, annotation: d.annotation }, d.tracks);
    b.doc.playlist.date = DATE;
    return b;
  }));
  assert.deepStrictEqual(out.doc.map(w => [w.track_count, w.skipped, w.truncated]), [[6, 9, false], [2, 0, false], [1, 0, false], [0, 0, false], [0, 0, false], [2000, 1000, true], [2000, 0, true]]);
});

test("each side's blob read by the other", { skip }, () => {
  const docs = [
    docOf("Mine", [{ title: "Song 1", artist: "Artist A", album: "Album One", track_no: 1 }]),
    docOf("Ünïcode 😀", Array.from({ length: 400 }, (_, i) => ({ title: "Track " + i + " " + "é".repeat(i % 23), artist: "Artist " + (i % 9), album: "Album " + (i % 17), track_no: (i % 25) + 1 }))),
    { playlist: { title: "\ud800 lone", track: [] } }
  ];
  const { encoded } = csharp({ encodes: docs });
  assert.equal(encoded.length, docs.length);
  for (const [i, blob] of encoded.entries()) {
    assert.match(blob, /^MDRP1:[A-Za-z0-9_-]+$/);
    assert.deepStrictEqual(readBlob(blob), plain(docs[i]), "the C# server's blob read as MusicD Remote reads it");
    if (RECORD) assert.deepStrictEqual(SH.decodeSharePayload(blob), plain(docs[i]), "the Node server reads the C# server's blob");
  }
  const nodeBlobs = kept.input("the Node server's blobs", RECORD && (() => docs.map(d => SH.encodeSharePayload(d))));
  const both = encoded.concat(nodeBlobs);
  const { decoded } = csharp({ decodes: both });
  assert.deepStrictEqual(decoded.slice(0, encoded.length), docs.map(d => ({ doc: plain(d) })), "the C# server reads its own");
  same("each side's blob read", both, decoded, () => both.map(b => nodeDecode(b)));
  assert.ok(decoded.every(d => d.doc), "all read");
});

test("pastes read the same, passing and failing alike", { skip }, () => {
  // Kept as made, but for the large stored one, written here by hand the same everywhere.
  const pastes = kept.input("the pastes", RECORD && (() => pastesOf())).map(p => p === BIG_STORED ? bigStored() : p);
  const { decoded } = csharp({ decodes: pastes });
  assert.equal(decoded.length, pastes.length);
  same("pastes", pastes.map(p => p.slice(0, 60)), decoded, () => pastes.map(p => nodeDecode(p)));
  // The cases meant: read, and refused for each reason.
  const said = decoded.map(d => d.doc ? "ok" : d.error.split(" — ")[0]);
  assert.deepStrictEqual(said.slice(0, 9), ["ok", "ok", "ok", "That playlist is damaged", "ok", "ok", "ok", "That playlist is damaged", "That playlist is damaged"]);
  assert.ok(said.includes("That doesn't look like a MusicD Remote playlist") && said.includes("That playlist is empty") &&
    said.includes("That playlist has no tracks in it") && said.filter(s => s === "ok").length > 15, said.join(" | "));
});

/* A large playlist, as a gzip member of stored deflate blocks (written by hand: no zlib's choices in it). */
const BIG_STORED = "<the large playlist, stored>";
const bigJson = () => Buffer.from(JSON.stringify(docOf("Big", Array.from({ length: 900 }, (_, i) => ({ title: "Track " + i, artist: "Artist " + (i % 11), album: "Album " + (i % 31), track_no: (i % 20) + 1, isrc: "GB" + (1000000 + i * 7919) })))));
function bigStored() {
  const data = bigJson(), blocks = [];
  for (let at = 0; at < data.length; at += 65535) {
    const chunk = data.subarray(at, at + 65535), h = Buffer.alloc(5);
    h[0] = at + 65535 >= data.length ? 1 : 0;
    h.writeUInt16LE(chunk.length, 1);
    h.writeUInt16LE(~chunk.length & 0xffff, 3);
    blocks.push(h, chunk);
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(zlib.crc32(data) >>> 0);
  trailer.writeUInt32LE(data.length, 4);
  return "MDRP1:" + Buffer.concat([Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3]), ...blocks, trailer]).toString("base64url");
}

/* The pastes, made while recording (this machine's zlib wrote their gzip). */
function pastesOf() {
  const doc = docOf("Mine", [{ title: "Song 1", artist: "Artist A", album: "Album One", track_no: 1 }, { title: "Song 2", artist: "Artist A" }]);
  const json = Buffer.from(JSON.stringify(doc));
  const b64 = buf => buf.toString("base64url");
  const gz = (data, opts) => zlib.gzipSync(typeof data === "string" ? Buffer.from(data) : data, opts);
  const blob = "MDRP1:" + b64(gz(json, { level: 9 }));
  const of = data => "MDRP1:" + b64(Buffer.isBuffer(data) ? data : gz(data));
  // A member written by hand: header fields, and its CRC-32 right or wrong.
  function member(data, o = {}) {
    const head = Buffer.from([0x1f, 0x8b, 8, (o.text ? 1 : 0) | (o.hcrc ? 2 : 0) | (o.extra ? 4 : 0) | (o.name ? 8 : 0) | (o.comment ? 16 : 0) | (o.reserved ? 32 : 0), 0, 0, 0, 0, 2, 3]);
    const parts = [head];
    if (o.extra) { const x = Buffer.alloc(2); x.writeUInt16LE(o.extra.length); parts.push(x, o.extra); }
    if (o.name) parts.push(Buffer.from(o.name + "\0", "latin1"));
    if (o.comment) parts.push(Buffer.from(o.comment + "\0", "latin1"));
    if (o.hcrc) { const c = Buffer.alloc(2); c.writeUInt16LE((zlib.crc32(Buffer.concat(parts)) & 0xffff) ^ (o.hcrc === "bad" ? 1 : 0)); parts.push(c); }
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE((zlib.crc32(data) ^ (o.badCrc ? 1 : 0)) >>> 0);
    trailer.writeUInt32LE((data.length + (o.badLength ? 1 : 0)) >>> 0, 4);
    return Buffer.concat([...parts, o.raw || zlib.deflateRawSync(data, { level: o.level === undefined ? 9 : o.level }), trailer]);
  }
  const half = Math.floor(json.length / 2);
  const flipped = Buffer.from(gz(json)); flipped[Math.floor(flipped.length / 2)] ^= 0x55;
  const big = bigJson();
  return [
    blob,
    "Here you go:\n" + blob.replace("MDRP1", "mdrp1").replace(/(.{40})/g, "$1\n") + "\nEnjoy",
    blob.replace(/(.{30})/g, "$1\n> ").replace(/^/, "> "),
    blob + " Enjoy this playlist I made for you on a sunny Sunday afternoon",
    blob + " thanks",
    blob + "A",
    blob + "H4sIAAAA",
    blob.slice(0, -5),
    blob.slice(0, -1),
    "nothing here", "MDRP1", "MDRP1:", "MDRP1:!!!", "  mDrP1 : " + blob.slice(6), "MD\u0085RP1:" + blob.slice(6), "MD RP1:" + blob.slice(6),
    "ßMDRP1:" + blob.slice(6), "ﬀ" + blob, "x " + blob.replace(/(.{10})/g, "$1　"),
    of("not json"), of(JSON.stringify({ playlist: { title: "x" } })), of("null"), of('{"playlist":{"track":{}}}'), of('"str"'), of("[1,2]"),
    of('{"playlist":"x"}'), of('{"playlist":[]}'), of("﻿" + JSON.stringify(doc)), of(""),
    of(Buffer.concat([gz(json.subarray(0, half)), gz(json.subarray(half))])),
    of(Buffer.concat([gz(json), Buffer.from([0, 0, 0x41, 0x42])])),
    of(Buffer.concat([gz(json), Buffer.from("junk")])),
    of(Buffer.concat([gz(json), Buffer.from([0x1f, 0x8b, 8, 0])])),
    of(Buffer.concat([gz(json.subarray(0, half)), Buffer.from([0]), gz(json.subarray(half))])),
    of(Buffer.concat([gz(json.subarray(0, half)), gz("x").subarray(0, 12)])),
    of(member(json, { name: "list.json", comment: "from a friend", extra: Buffer.from("AB\x02\x00hi"), hcrc: true, text: true })),
    of(member(json, { hcrc: "bad" })), of(member(json, { reserved: true })), of(member(json, { badCrc: true })), of(member(json, { badLength: true })),
    of(member(json, { level: 0 })), of(member(json, { level: 1 })), of(member(big)), BIG_STORED, of(flipped),
    of(member(json, { raw: Buffer.from([0x07, 0, 0, 0]) })), of(member(Buffer.alloc(0), { raw: Buffer.from([0x03, 0x00]) })),
    // Bytes that aren't UTF-8 in a title: each read as U+FFFD, the same number of them.
    of(gz(Buffer.concat([Buffer.from('{"playlist":{"title":"'), Buffer.from([0xff, 0xc3, 0x28, 0xed, 0xa0, 0x80, 0xf0, 0x9f, 0x98]), Buffer.from('","track":[]}}')]))),
    of('{"playlist":{"title":"\\ud800x","track":[{"title":"t","x":1e400,"y":-0}],"track2":1}}'),
    of('{"__proto__":{"x":1},"playlist":{"track":[],"track":[{"title":"later"}],"2":"b","1":"a"}}'),
    of("[".repeat(100) + "]".repeat(100)), of('{"playlist":{"track":[' + "[".repeat(300) + "]".repeat(300) + "]}}"),
    of('  {"playlist":{"track":[]}}\n\t'), of('{"playlist":{"track":[]}} x'), of('{"playlist":{"track":[01]}}'), of('{"playlist":{"track":["\\x"]}}'),
    "MDRP1:" + b64(Buffer.from("not gzip at all, just words")), "MDRP1:" + "A".repeat(100), "MDRP1:H4sI", "MDRP1:H4sIAAAAAAAAA"
  ];
}
