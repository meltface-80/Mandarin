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
 * test/Mandarin.Tests/PlaylistsTests.cs.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's answers are kept
 * (test/golden.js's answers(), test/golden/share-csharp.json), made
 * while lib/ was here, with the blobs it wrote and the pastes
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

const kept = answers("share-csharp");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!kept.exists() && "no recording of the Node server's answers");
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
/* Each answer the Node server's (kept), the first that isn't shown with its case. */
const same = (what, cases, got) => kept.same(what, cases.map((_, i) => what + " " + i), cases, got);
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
  same("shareText", p.texts, out.text);
  same("shareInt", p.ints, out.int);
  same("shareUriList", p.uris, out.uris);
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
  same("a track's entry", p.entries, out.entry);
  same("the document", p.docs, out.doc);
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
  }
  const nodeBlobs = kept.input("the Node server's blobs");
  const both = encoded.concat(nodeBlobs);
  const { decoded } = csharp({ decodes: both });
  assert.deepStrictEqual(decoded.slice(0, encoded.length), docs.map(d => ({ doc: plain(d) })), "the C# server reads its own");
  same("each side's blob read", both, decoded);
  assert.ok(decoded.every(d => d.doc), "all read");
});

test("pastes read the same, passing and failing alike", { skip }, () => {
  // Kept as made, but for the large stored one, written here by hand the same everywhere: a blob
  // as it is, pasted in a message, quoted, with words or junk after it, cut short, its prefix in
  // other cases and look-alike letters; JSON that isn't a playlist; gzip members joined, with
  // junk after them, cut, with every header field, a bad CRC or length, stored, a big one, a
  // flipped byte; bytes that aren't UTF-8, deep nesting, and not gzip at all.
  const pastes = kept.input("the pastes").map(p => p === BIG_STORED ? bigStored() : p);
  const { decoded } = csharp({ decodes: pastes });
  assert.equal(decoded.length, pastes.length);
  same("pastes", pastes.map(p => p.slice(0, 60)), decoded);
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

