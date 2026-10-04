"use strict";
/*
 * An album is its folder (v0.6.0-RC8): two copies of a record in two folders
 * are two albums, whatever their tags say; disc folders ("Disc 1", "CD2",
 * "DISC 1"…) inside one album's folder are one album. A library scanned by
 * an older version is put right on the first start, with favourites and
 * edits kept.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const DB = require("../lib/library/db");
const { Library } = require("../lib/library");
const { Scanner } = require("../lib/library/scanner");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const quiet = () => {};

function open(data, root) {
  const db = DB.open(data, { log: quiet });
  const library = new Library(db, { musicRoot: root, log: quiet });
  const scanner = new Scanner({ db, root, log: quiet });
  return { db, library, scanner };
}

const tags = (n, disc) => ({ title: `Track ${n}`, artist: "Daft Punk", album_artist: "Daft Punk", album: "Random Access Memories", track: n, disc: disc || 1, date: "2013" });

function ram(music) {
  const two = path.join(music, "Daft Punk", "Random Access Memories (2023)");
  for (let i = 1; i <= 2; i++) gen(path.join(two, "Disc 1", `0${i}.flac`), { freq: 200 + i * 50, seconds: 1, tags: tags(i, 1) });
  for (let i = 1; i <= 2; i++) gen(path.join(two, "Disc 2", `0${i}.flac`), { freq: 400 + i * 50, seconds: 1, tags: tags(i, 2) });
  const one = path.join(music, "Daft Punk", "Random Access Memories (2013)");
  for (let i = 1; i <= 3; i++) gen(path.join(one, `0${i}.flac`), { freq: 600 + i * 50, seconds: 1, tags: tags(i) });
}

test("two folders of the same record are two albums; disc folders are one", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  ram(lib.music);
  // Disc folders named every usual way, in one album's folder: one album.
  const set = path.join(lib.music, "Band", "Box Set");
  ["CD1", "DISC 2", "cd 3", "Disc4"].forEach((d, i) => gen(path.join(set, d, "01.flac"), { freq: 300 + i * 40, seconds: 1,
    tags: { title: `Disc ${i + 1} opener`, artist: "Band", album: "Box Set", track: 1, disc: i + 1 } }));
  const s = open(lib.data, lib.music);
  await s.scanner.scan();
  s.library.reload();
  const rams = s.library.albums.filter(a => a.title === "Random Access Memories");
  assert.equal(rams.length, 2, "never merged with the other folder's copy");
  assert.deepEqual(rams.map(a => s.library.tracks(a.id).length).sort(), [3, 4]);
  const twoDisc = rams.find(a => s.library.tracks(a.id).length === 4);
  assert.deepEqual(s.library.tracks(twoDisc.id).map(t => t.disc_no), [1, 1, 2, 2]);
  // Its tiles say so (v0.6.0); a single disc says nothing.
  assert.equal(s.library.json(twoDisc).discs, 2);
  assert.equal(s.library.json(rams.find(a => a !== twoDisc)).discs, undefined);
  const box = s.library.albums.filter(a => a.title === "Box Set");
  assert.equal(box.length, 1);
  assert.deepEqual(s.library.tracks(box[0].id).map(t => t.disc_no), [1, 2, 3, 4]);
  assert.equal(s.library.json(box[0]).discs, 4);
  s.db.close();
});

test("a library from before: the merged album comes apart, its favourite and edit kept", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  ram(lib.music);
  let s = open(lib.data, lib.music);
  await s.scanner.scan();
  s.library.reload();
  // Make it as an older version left it: keys without the folder, the two
  // copies one album, a favourite and an edit on it.
  const raw = s.db.raw;
  const rams = s.library.albums.filter(a => a.title === "Random Access Memories").sort((a, b) => s.library.tracks(b.id).length - s.library.tracks(a.id).length);
  const keep = rams[0], other = rams[1];
  const legacy = keep.key.split("\u0001").slice(0, 2).join("\u0001");
  raw.prepare("UPDATE tracks SET album_id = ? WHERE album_id = ?").run(keep.id, other.id);
  raw.prepare("DELETE FROM albums WHERE id = ?").run(other.id);
  for (const a of raw.prepare("SELECT id, key FROM albums").all()) {
    raw.prepare("UPDATE albums SET key = ? WHERE id = ?").run(a.key.split("\u0001").slice(0, 2).join("\u0001"), a.id);
  }
  raw.prepare("INSERT INTO favourites(key, added_at) VALUES(?, ?)").run(legacy, Date.now());
  raw.prepare("INSERT INTO album_edits(key, year, updated_at) VALUES(?, ?, ?)").run(legacy, 1999, Date.now());
  s.db.setSetting("album_key_v", 1);
  s.library.reload();
  assert.equal(s.library.albums.filter(a => a.title === "Random Access Memories").length, 1);
  s.db.close();

  // The update starts: keys gain their folder, the next scan regroups.
  s = open(lib.data, lib.music);
  assert.equal(s.db.setting("album_key_v"), 2);
  const r = await s.scanner.scan();
  assert.equal(r.status, "updated");
  assert.equal(s.db.setting("album_regroup"), false, "done once");
  s.library.reload();
  const now = s.library.albums.filter(a => a.scanned.title === "Random Access Memories");
  assert.equal(now.length, 2);
  const first = now.find(a => a.id === keep.id);
  assert.ok(first, "the album keeps its id");
  assert.equal(s.library.tracks(first.id).length, 4);
  assert.equal(s.library.isFavourite(first), true);
  assert.equal(first.year, 1999);
  const second = now.find(a => a.id !== keep.id);
  assert.equal(s.library.tracks(second.id).length, 3);
  assert.equal(s.library.isFavourite(second), false);
  s.db.close();
});

test("a renamed album folder is the same album", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const s = open(lib.data, lib.music);
  await s.scanner.scan();
  s.library.reload();
  const al = s.library.albums.find(a => a.title === "Album One");
  s.library.setFavourite(al.id, true);
  fs.renameSync(path.join(lib.music, "Artist A", "Album One"), path.join(lib.music, "Artist A", "Album One (1997)"));
  // A file touched too, so the folder is read and regrouped.
  const f = fs.readdirSync(path.join(lib.music, "Artist A", "Album One (1997)")).find(n => n.endsWith(".flac"));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(lib.music, "Artist A", "Album One (1997)", f), later, later);
  await s.scanner.scan();
  s.library.reload();
  const again = s.library.albums.filter(a => a.title === "Album One");
  assert.equal(again.length, 1);
  assert.equal(again[0].id, al.id);
  assert.equal(s.library.isFavourite(again[0]), true);
  s.db.close();
});

test("a box set filed as discs that are albums: each its own album, each knowing its box (v0.6.3)", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const box = path.join(lib.music, "Yes - The Steven Wilson Remixes (2018)");
  const discs = [["Disc 1 - The Yes Album (1971)", "The Yes Album"], ["Disc 4 - Tales From Topographic Oceans (1973)", "Tales From Topographic Oceans"], ["Disc 5 - Relayer (1974)", "Relayer"]];
  discs.forEach(([folder, album], d) => {
    for (let i = 1; i <= 2; i++) gen(path.join(box, folder, `0${i}.flac`), { freq: 200 + d * 100 + i * 20, seconds: 1, tags: { title: `${album} ${i}`, artist: "Yes", album, track: i } });
  });
  // Plain disc folders of one album stay one album, with no box.
  const set = path.join(lib.music, "Band", "Double");
  ["CD1", "CD2"].forEach((d, i) => gen(path.join(set, d, "01.flac"), { freq: 700 + i * 30, seconds: 1, tags: { title: "T" + i, artist: "Band", album: "Double", track: 1, disc: i + 1 } }));
  const s = open(lib.data, lib.music);
  await s.scanner.scan();
  s.library.reload();
  const yes = s.library.albums.filter(a => a.artist === "Yes");
  assert.equal(yes.length, 3, "three albums, not one");
  // "of" is at least the highest disc filed: disc 4 of 5, though 2 and 3 aren't here.
  const tales = yes.find(a => a.title === "Tales From Topographic Oceans");
  assert.deepEqual(s.library.json(tales).box, { name: "The Steven Wilson Remixes (2018)", disc: 4, of: 5 });
  assert.deepEqual(tales.box.ids.map(id => s.library.album(id).title), ["The Yes Album", "Tales From Topographic Oceans", "Relayer"]);
  const double = s.library.albums.find(a => a.title === "Double");
  assert.equal(double.box, null);
  assert.equal(s.library.json(double).box, undefined);
  s.db.close();
});
