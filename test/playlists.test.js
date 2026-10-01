"use strict";
/*
 * Playlists: a user playlist made from tracks or whole albums, a Dynamic
 * Playlist saved from a Library view, and sharing — the MDRP1 blob MusicD
 * Remote writes and reads, so a playlist goes either way between the two.
 */
const test = require("node:test");
const assert = require("node:assert");
const SH = require("../lib/server/share");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3616;
const B = "http://127.0.0.1:" + PORT;

test("the share blob is MusicD Remote's: MDRP1, gzip, JSPF", () => {
  const built = SH.buildShareDoc({ name: "Mine" }, [{ title: "Song 1", artist: "Artist A", album: "Album One", track_no: 1 }, { title: "" }]);
  assert.equal(built.track_count, 1); assert.equal(built.skipped, 1);
  const blob = SH.encodeSharePayload(built.doc);
  assert.match(blob, /^MDRP1:[A-Za-z0-9_-]+$/);
  // Pasted with words around it, wrapped, and the marker lower-cased by a phone.
  const doc = SH.decodeSharePayload("Here you go:\n" + blob.replace("MDRP1", "mdrp1").replace(/(.{40})/g, "$1\n") + "\nEnjoy");
  assert.equal(doc.playlist.title, "Mine");
  assert.deepEqual(doc.playlist.track[0], { title: "Song 1", creator: "Artist A", album: "Album One", trackNum: 1 });
  assert.throws(() => SH.decodeSharePayload("nothing here"), /MusicD Remote playlist/);
});

test("playlists", { skip, timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false });
  await srv.start();
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  try {
    for (let i = 0; i < 100 && (await api("status")).index_count !== 3; i++) await new Promise(r => setTimeout(r, 100));
    const albums = (await api("library/albums?sort=album")).albums;
    const one = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");

    await t.test("a new playlist from chosen tracks, then whole albums into it", async () => {
      const tracks = (await api("album?offset=" + one.offset)).tracks;
      const entries = tracks.slice(0, 2).map((tr, i) => ({ album_offset: one.offset, album_title: one.title, album_subtitle: one.subtitle, track_index: i, title: tr.title, subtitle: tr.subtitle, image_key: one.image_key, track_no: i + 1 }));
      const r = await api("user-playlists/add", { name: "Road trip", tracks: entries });
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.added, 2); assert.equal(r.track_total, 2);
      const list = (await api("user-playlists")).playlists;
      assert.deepEqual(list.map(p => [p.name, p.track_total]), [["Road trip", 2]]);
      const r2 = await api("user-playlists/add-albums", { id: list[0].id, albums: [{ offset: hi.offset }] });
      assert.equal(r2.track_total, 4);
      const full = await api("user-playlist?id=" + list[0].id);
      assert.deepEqual(full.tracks.map(x => x.title), ["Song 1", "Song 2", "Hi 1", "Hi 2"]);
      assert.equal((await api("user-playlists/add", { name: "", tracks: entries })).status, 400);
      assert.equal((await api("user-playlists/add", { name: "Empty" })).status, 400, "tracks required");
    });

    await t.test("a Dynamic Playlist from a Library view", async () => {
      const r = await api("smart-playlists", { name: "Rock, shuffled", view: { sort: "album", genre: ["Rock"] }, order: "random", limit: 25 });
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.playlist.order, "random");
      const list = (await api("smart-playlists")).playlists;
      assert.equal(list.length, 1);
      assert.equal(list[0].matched, 1, "Album One is the Rock album");
      assert.deepEqual((await api("smart-playlist/albums?id=" + list[0].id)).albums.map(a => a.title), ["Album One"]);
      assert.equal((await api("smart-playlists", { view: {} })).status, 400, "a name is needed");
    });

    await t.test("shared out and imported back; a playlist from MusicD Remote reads the same", async () => {
      const id = (await api("user-playlists")).playlists[0].id;
      const pl = await api("user-playlist?id=" + id);
      const enc = await api("share/encode", { name: pl.name, tracks: pl.tracks.map(x => ({ title: x.title, artist: x.subtitle, album: x.album_title, track_no: x.track_no })) });
      assert.equal(enc.track_count, 4);
      assert.match(enc.blob, /^MDRP1:/);
      const imp = await api("share/import", { blob: enc.blob });
      assert.equal(imp.ok, true);
      assert.equal(imp.name, "Road trip");
      assert.equal(imp.resolved.length, 4);
      assert.deepEqual(imp.missing, []);
      assert.equal(imp.resolved[0].album_offset, one.offset, "placed on the album it names");
      // Saved from the import report: a playlist like any other.
      const saved = await api("user-playlists/add", { name: imp.name + " (shared)", tracks: imp.resolved });
      assert.equal(saved.track_total, 4);
      // What MusicD Remote writes: the same document, its own generator stamp, and
      // a track whose album this library doesn't have under that name.
      const theirs = SH.buildShareDoc({ name: "From Roon" }, [
        { title: "Song 3", artist: "Artist A", album: "Album One (Deluxe)", track_no: 3 },
        { title: "Never Heard", artist: "Nobody", album: "Nothing" }
      ]).doc;
      theirs.playlist.extension["https://musicbrainz.org/doc/jspf#playlist"].additional_metadata.generator = "MusicD Remote";
      const imp2 = await api("share/import", { blob: SH.encodeSharePayload(theirs) });
      assert.equal(imp2.name, "From Roon");
      assert.equal(imp2.resolved.length, 1);
      assert.deepEqual(imp2.substituted.map(s => [s.title, s.found_album]), [["Song 3", "Album One"]], "found by title and artist, the album substitution reported");
      assert.deepEqual(imp2.missing.map(m => m.title), ["Never Heard"]);
      assert.equal((await api("share/import", { blob: "hello" })).status, 400);
    });
  } finally {
    await srv.stop();
  }
});
