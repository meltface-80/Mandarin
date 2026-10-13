"use strict";
/*
 * Untagged files named from their folders (v0.6.0-RC10, lib/library/names.js):
 * the artist from the folder above the album's, the album and year from its
 * own, the track from the file name — only what the tags leave empty; and a
 * library scanned before is put right, its albums keeping their ids.
 *
 * The C# server's since v0.8.50 (Scan/ScanNames.cs, asked through
 * `mandarin-server score`; a library through test/library-server.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { built } = require("./server");
const { libraryServer } = require("./library-server");
const { score } = require("./score");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const R = "/music";
/* What a file's folders and name say, as the scan reads them. */
const fromNames = (file, roots) => score({ fn: "fromnames", files: [[file, roots]] }).names[0];
/* A track's own row: its title, number and what was taken from its names. */
const tracksIn = (s, albumId) => s.db.raw.prepare("SELECT track_no, title, names_from FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no, path").all(albumId);

test("what the names say", { skip: built() }, () => {
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

test("an untagged album takes its names from its folders; a tagged one is left alone", { skip, timeout: 60000 }, async (t) => {
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
  const s = await libraryServer(t, lib);
  const albums = await s.albums();
  const tx = albums.find(a => a.title === "10x10");
  assert.ok(tx, JSON.stringify(albums.map(a => [a.title, a.subtitle])));
  assert.equal(tx.subtitle, "808 State");
  assert.equal(tx.year, 1993);
  const tracks = tracksIn(s, tx.offset);
  assert.deepEqual(tracks.map(x => [x.track_no, x.title]), [[1, "10x10 (Radio Mix)"], [2, "La Luz (Acid Mix)"]]);
  assert.equal(tracks[0].names_from, "artist,album,title,track,year");
  assert.equal((await s.album(tx.offset)).names_from_folders, true, "its page says so");
  const ninety = albums.find(a => a.title === "Ninety");
  assert.equal(ninety.subtitle, "808 State");
  assert.equal(tracksIn(s, ninety.offset)[0].title, "Magical Dream");
  assert.equal(tracksIn(s, ninety.offset)[0].names_from, "album,track,year");
  // Album One, fully tagged: nothing from its names.
  const one = albums.find(a => a.title === "Album One");
  assert.ok(tracksIn(s, one.offset).every(x => !x.names_from));
  assert.equal((await s.album(one.offset)).names_from_folders, false);
});

test("a library scanned before: Unknown Artist albums named from their folders, keeping their ids and hearts", { skip, timeout: 90000 }, async (t) => {
  const lib = makeLibrary();
  const p = path.join(lib.music, "808 State", "Pacific (1989)", "01 - Pacific (707).flac");
  fs.mkdirSync(path.dirname(p), { recursive: true });
  spawnSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=500:duration=1", "-ac", "2", "-map_metadata", "-1", p]);
  const s = await libraryServer(t, lib);
  // Make it as v0.6.0-RC9 left it: Unknown Artist, the folder as the title, read at TAGS_V 1, unidentified.
  const raw = s.db.raw;
  const al = raw.prepare("SELECT a.* FROM albums a JOIN tracks t ON t.album_id = a.id WHERE t.path = ?").get(p);
  const oldKey = "unknown artist\u0001pacific 1989\u0001" + al.key.split("\u0001")[2];
  raw.prepare("UPDATE albums SET key = ?, artist = 'Unknown Artist', title = 'Pacific (1989)' WHERE id = ?").run(oldKey, al.id);
  raw.prepare("UPDATE tracks SET artist = '', album_artist = '', album = '', title = '01 - Pacific (707)', names_from = NULL WHERE path = ?").run(p);
  raw.prepare("UPDATE tracks SET tags_v = 1").run();
  raw.prepare("INSERT INTO favourites(key, added_at) VALUES(?, ?)").run(oldKey, Date.now());
  raw.prepare("INSERT INTO album_matches(key, status, checked_at) VALUES(?, 'unidentified', ?)").run(oldKey, Date.now());
  s.db.setSetting("names_v", 0);

  // The update starts: only the untagged track is read again, as its scan says.
  s.ctx.logs.length = 0;
  await s.restart();
  const again = s.ctx.logs.find(l => /without an artist or album tag will be read again/.test(l));
  assert.match(again || s.ctx.logs.join("\n"), /\b1 tracks without an artist or album tag will be read again, their names taken from their folders \(\d+ others left as they are\)/);
  assert.equal(s.db.setting("names_v"), 1, "done once");
  const now = (await s.albums()).find(a => a.offset === al.id);
  assert.ok(now, "the same album id");
  assert.equal(now.subtitle, "808 State");
  assert.equal(now.title, "Pacific");
  assert.equal(now.favourite, true);
  assert.equal(tracksIn(s, now.offset)[0].title, "Pacific (707)");
  // Looked up again under its new names.
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM album_matches WHERE status = 'unidentified'").get().n, 0);
});

test("Beatles are The Beatles: one artist, filed under B", { skip, timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  gen(path.join(lib.music, "The Beatles", "Abbey Road", "01.flac"), { seconds: 1, tags: { title: "Come Together", artist: "Beatles", album_artist: "Beatles", album: "Abbey Road", track: 1 } });
  gen(path.join(lib.music, "The Beatles", "Let It Be", "01.flac"), { seconds: 1, tags: { title: "Two of Us", artist: "The Beatles", album_artist: "The Beatles", album: "Let It Be", track: 1 } });
  const s = await libraryServer(t, lib);
  const ar = (await s.albums()).find(a => a.title === "Abbey Road");
  assert.equal(ar.subtitle, "The Beatles");
  assert.equal(s.db.raw.prepare("SELECT sort_artist FROM albums WHERE id = ?").get(ar.offset).sort_artist, "beatles");
  const { primary, featured } = await s.getJ("/api/artist-albums?artist=" + encodeURIComponent("The Beatles"));
  assert.deepEqual(primary.map(a => a.title).sort(), ["Abbey Road", "Let It Be"]);
  assert.equal(featured.length, 0);
  assert.deepEqual((await s.getJ("/api/artist-albums?artist=Beatles")).primary.length, 2);
});
