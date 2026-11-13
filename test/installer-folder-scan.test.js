"use strict";
/*
 * Mandarin OS's Installer (item 405): in Mandarin OS 0.1.5 a folder in the music folder itself (/data/Storage); from 0.1.6
 * (item 406) beside it at the top of the share, and this stays a guard for a box still on 0.1.5. Apply makes it and
 * the reinstaller reads (a file there whose name starts with "dev"). Its files are no music: the library scan reads
 * audio files alone, by their names (Scanner.cs, AudioExt), so a README.txt and a dev.bin there (even one holding a
 * track's bytes) add no album, no track, and nothing the scan read or changed, and the library is what it was.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { built } = require("./server");
const { libraryServer } = require("./library-server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("Storage/Installer's README.txt and dev.bin add nothing to the library", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const s = await libraryServer(t, lib);
  const count = (table) => s.db.raw.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
  const before = { albums: count("albums"), tracks: count("tracks") };
  assert.ok(before.albums > 0 && before.tracks > 0, "the library read first");

  fs.mkdirSync(path.join(lib.music, "Installer"));
  fs.writeFileSync(path.join(lib.music, "Installer", "README.txt"), "Used by Mandarin's reinstaller. Leave it as it is.\n");
  // Whatever the file holds: here a track's own bytes, so only its name keeps it out.
  fs.copyFileSync(path.join(lib.music, "Artist A", "Album One", "01 Song 1.flac"), path.join(lib.music, "Installer", "dev.bin"));
  const r = await s.scan();
  assert.deepEqual([r.added, r.changed, r.removed], [0, 0, 0], JSON.stringify(r));
  assert.deepEqual({ albums: count("albums"), tracks: count("tracks") }, before);
  assert.equal(s.db.raw.prepare("SELECT COUNT(*) n FROM tracks WHERE path LIKE ?").get("%/Installer/%").n, 0);
  assert.ok(!(await s.albums()).some(a => /Installer/.test(a.title + " " + (a.subtitle || ""))), "no album of it");
});
