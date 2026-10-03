"use strict";
/*
 * Untagged files named from their folders (v0.6.0-RC10, lib/library/names.js):
 * the artist from the folder above the album's, the album and year from its
 * own, the track from the file name — only what the tags leave empty; and a
 * library scanned before is put right, its albums keeping their ids.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const DB = require("../lib/library/db");
const { Library } = require("../lib/library");
const { Scanner } = require("../lib/library/scanner");
const { fromNames } = require("../lib/library/names");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const quiet = () => {};
const R = "/music";

test("what the names say", () => {
  const n = f => fromNames(path.join(R, f), [R]);
  assert.deepEqual(n("4tb/Music/808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac"),
    { artist: "808 State", album: "10x10", year: 1993, disc: null, track: 1, title: "10x10 (Radio Mix)" });
  assert.deepEqual(n("4tb/Music/808 State/ESP_ The 808 State Effect (2021)/1-01 - Pacific State.flac"),
    { artist: "808 State", album: "ESP_ The 808 State Effect", year: 2021, disc: 1, track: 1, title: "Pacific State" });
  // A disc folder: the album and artist from the folders above it.
  assert.deepEqual(n("808 State/Box [2000]/CD2/03. Cübik.flac"),
    { artist: "808 State", album: "Box", year: 2000, disc: 2, track: 3, title: "Cübik" });
  // "Artist - Album (Year)" as the album's folder, under a folder that isn't an artist.
  assert.deepEqual(n("Music/808 State - Ninety (1989)/02 808 State - Ancodia.flac"),
    { artist: "808 State", album: "Ninety", year: 1989, disc: null, track: 2, title: "Ancodia" });
  // An album straight in a music folder, or under "Music" / "4tb": no artist from that.
  assert.equal(n("Album (1999)/01 - One.flac").artist, null);
  assert.equal(n("Music/Album (1999)/01 - One.flac").artist, null);
  assert.equal(n("4tb/Album (1999)/01 - One.flac").artist, null);
  // A folder named for its parts, not for an artist: the parent's name kept.
  assert.equal(n("Band/Live - Tokyo (1993)/01 - One.flac").album, "Live - Tokyo");
});

test("an untagged album takes its names from its folders; a tagged one is left alone", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const bare = (rel, f) => {
    const p = path.join(lib.music, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const r = spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=${f}:duration=1`, "-ac", "2", "-map_metadata", "-1", p]);
    assert.equal(r.status, 0, String(r.stderr));
  };
  bare("808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac", 300);
  bare("808 State/10x10 (1993)/02 - La Luz (Acid Mix).flac", 350);
  // Partly tagged: the title and artist are the file's own; the album from the folder.
  gen(path.join(lib.music, "808 State", "Ninety (1989)", "01 - x.flac"), { seconds: 1, tags: { title: "Magical Dream", artist: "808 State" } });
  const db = DB.open(lib.data, { log: quiet });
  const library = new Library(db, { musicRoot: lib.music, log: quiet });
  const scanner = new Scanner({ db, root: lib.music, log: quiet });
  await scanner.scan();
  library.reload();
  const tx = library.albums.find(a => a.title === "10x10");
  assert.ok(tx, JSON.stringify(library.albums.map(a => [a.title, a.artist])));
  assert.equal(tx.artist, "808 State");
  assert.equal(tx.year, 1993);
  const tracks = library.tracks(tx.id);
  assert.deepEqual(tracks.map(t => [t.track_no, t.title]), [[1, "10x10 (Radio Mix)"], [2, "La Luz (Acid Mix)"]]);
  assert.equal(tracks[0].names_from, "artist,album,title,track,year");
  const ninety = library.albums.find(a => a.title === "Ninety");
  assert.equal(ninety.artist, "808 State");
  assert.equal(library.tracks(ninety.id)[0].title, "Magical Dream");
  assert.equal(library.tracks(ninety.id)[0].names_from, "album,track,year");
  // Album One, fully tagged: nothing from its names.
  const one = library.albums.find(a => a.title === "Album One");
  assert.ok(library.tracks(one.id).every(t => !t.names_from));
  db.close();
});

test("a library scanned before: Unknown Artist albums named from their folders, keeping their ids and hearts", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const p = path.join(lib.music, "808 State", "Pacific (1989)", "01 - Pacific (707).flac");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=500:duration=1", "-ac", "2", "-map_metadata", "-1", p]);
  let db = DB.open(lib.data, { log: quiet });
  let library = new Library(db, { musicRoot: lib.music, log: quiet });
  let scanner = new Scanner({ db, root: lib.music, log: quiet });
  await scanner.scan();
  // Make it as v0.6.0-RC9 left it: Unknown Artist, the folder as the title, read at TAGS_V 1, unidentified.
  const raw = db.raw;
  const al = raw.prepare("SELECT a.* FROM albums a JOIN tracks t ON t.album_id = a.id WHERE t.path = ?").get(p);
  const oldKey = "unknown artist\u0001pacific 1989\u0001" + al.key.split("\u0001")[2];
  raw.prepare("UPDATE albums SET key = ?, artist = 'Unknown Artist', title = 'Pacific (1989)' WHERE id = ?").run(oldKey, al.id);
  raw.prepare("UPDATE tracks SET artist = '', album_artist = '', album = '', title = '01 - Pacific (707)', names_from = NULL WHERE path = ?").run(p);
  raw.prepare("UPDATE tracks SET tags_v = 1").run();
  raw.prepare("INSERT INTO favourites(key, added_at) VALUES(?, ?)").run(oldKey, Date.now());
  raw.prepare("INSERT INTO album_matches(key, status, checked_at) VALUES(?, 'unidentified', ?)").run(oldKey, Date.now());
  db.setSetting("names_v", 0);
  db.close();

  db = DB.open(lib.data, { log: quiet });
  library = new Library(db, { musicRoot: lib.music, log: quiet });
  scanner = new Scanner({ db, root: lib.music, log: quiet });
  // Only the untagged track is read again.
  assert.deepEqual(db.raw.prepare("SELECT path FROM tracks WHERE tags_v < 2").all().map(r => path.basename(r.path)), ["01 - Pacific (707).flac"]);
  await scanner.scan();
  library.reload();
  const now = library.album(al.id);
  assert.ok(now, "the same album id");
  assert.equal(now.artist, "808 State");
  assert.equal(now.title, "Pacific");
  assert.equal(library.isFavourite(now), true);
  assert.equal(library.tracks(now.id)[0].title, "Pacific (707)");
  // Looked up again under its new names.
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM album_matches WHERE status = 'unidentified'").get().n, 0);
  db.close();
});

test("Beatles are The Beatles: one artist, filed under B", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  gen(path.join(lib.music, "The Beatles", "Abbey Road", "01.flac"), { seconds: 1, tags: { title: "Come Together", artist: "Beatles", album_artist: "Beatles", album: "Abbey Road", track: 1 } });
  gen(path.join(lib.music, "The Beatles", "Let It Be", "01.flac"), { seconds: 1, tags: { title: "Two of Us", artist: "The Beatles", album_artist: "The Beatles", album: "Let It Be", track: 1 } });
  const db = DB.open(lib.data, { log: quiet });
  const library = new Library(db, { musicRoot: lib.music, log: quiet });
  await new Scanner({ db, root: lib.music, log: quiet }).scan();
  library.reload();
  const ar = library.albums.find(a => a.title === "Abbey Road");
  assert.equal(ar.artist, "The Beatles");
  assert.equal(ar.sortArtist, "beatles");
  const { primary, featured } = library.artistAlbums("The Beatles");
  assert.deepEqual(primary.map(a => a.title).sort(), ["Abbey Road", "Let It Be"]);
  assert.equal(featured.length, 0);
  assert.deepEqual(library.artistAlbums("Beatles").primary.length, 2);
  db.close();
});
