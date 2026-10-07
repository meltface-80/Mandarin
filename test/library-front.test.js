"use strict";
/*
 * The library read in C# (v0.8.4, server/Mandarin.Server/Library.cs): every
 * screen it answers gives what the Node server gives, asked the same thing.
 * Runs when the suite goes through the C# server (MANDARIN_FRONT=1). Each
 * question is put to both — through the front door (C#) and straight to the
 * Node server behind it — and the answers must be the same, field for field;
 * then the library changes (a heart, Listen later, an edit, labels switched
 * on, a merge, a play) and they must still be.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const fs = require("fs");
const os = require("os");

const skip = process.env.MANDARIN_FRONT !== "1" && "the suite isn't going through the C# server (MANDARIN_FRONT=1)";

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-libfront-"));
  const music = path.join(root, "music");
  const one = (dir, file, tags, opts = {}) => gen(path.join(music, dir, file), Object.assign({ seconds: 1, tags }, opts));
  one("The Beatles/Abbey Road", "01 Come Together.flac", { title: "Come Together", artist: "The Beatles", album: "Abbey Road", track: 1, date: "1969-09-26", genre: "Rock", label: "Apple Records" });
  one("The Beatles/Abbey Road", "02 Something.flac", { title: "Something", artist: "The Beatles", album: "Abbey Road", track: 2, date: "1969-09-26", genre: "Rock", label: "Apple Records" });
  one("Beatles/Help", "01 Help.flac", { title: "Help!", artist: "Beatles", album: "Help!", track: 1, date: "1965", genre: "rock", label: "Parlophone" });
  one("Bjork/Homogenic", "01 Hunter.flac", { title: "Hunter", artist: "Björk", album: "Homogenic", track: 1, date: "1997", genre: "Electronic", label: "One Little Indian" });
  one("Simon/Bridge", "01 Bridge.flac", { title: "Bridge Over Troubled Water", artist: "Simon & Garfunkel", album: "Bridge Over Troubled Water", track: 1, date: "1970", genre: "Folk Rock", label: "Columbia" });
  one("Daft/Discovery", "01 One More Time.flac", { title: "One More Time", artist: "Daft Punk", album: "Discovery", track: 1, date: "2001-03", genre: "Dance; Electronic", label: "Virgin Records" });
  one("Miles/Kind of Blue", "01 So What.flac", { title: "So What", artist: "Miles Davis", album: "Kind of Blue", track: 1, date: "1959", genre: "Jazz", label: "Columbia Records" },
    { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"] });
  one("Coltrane/A Love Supreme", "01 Acknowledgement.flac", { title: "Acknowledgement", artist: "John Coltrane feat. McCoy Tyner", album: "A Love Supreme", track: 1, date: "1965", genre: "Jazz", label: "Impulse!" });
  one("Box/Yes - The Remixes (2018)/Disc 1 - The Yes Album (1971)", "01 Yours.flac", { title: "Yours Is No Disgrace", artist: "Yes", album: "The Yes Album", track: 1, date: "1971", genre: "Prog Rock" });
  one("Box/Yes - The Remixes (2018)/Disc 2 - Fragile (1971)", "01 Roundabout.flac", { title: "Roundabout", artist: "Yes", album: "Fragile", track: 1, date: "1971", genre: "Prog Rock" });
  one("Comp/Now 1", "01 A.mp3", { title: "A", artist: "Daft Punk", album: "Now 1", album_artist: "Various Artists", track: 1, compilation: 1, date: "2001", genre: "Pop" }, { fmt: null, codecArgs: ["-b:a", "192k"] });
  one("Comp/Now 1", "02 B.mp3", { title: "B", artist: "Björk", album: "Now 1", album_artist: "Various Artists", track: 2, compilation: 1, date: "2001", genre: "Pop" }, { fmt: null, codecArgs: ["-b:a", "192k"] });
  one("Misc/Untitled", "01 x.flac", { title: "x", artist: "anonymous", album: "( )", track: 1 });
  return { root, music, data: path.join(root, "data") };
}

test("the library in C# answers as the Node server does", { skip, timeout: 120000 }, async () => {
  const lib = library();
  const PORT = 3696, B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  const N = "http://127.0.0.1:" + ctx.listeningOn;
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 300; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count > 0 && !st.scan.running) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const post = async (p, body) => { const r = await fetch(B + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(body) }); assert.equal(r.status, 200, p); return r.json(); };

    const ids = (await (await fetch(N + "/api/library/albums?count=200", { headers: H })).json()).albums.map(a => a.offset);
    assert.equal(ids.length, 11, "the library read");
    const same = async (p, label) => {
      const [c, n] = await Promise.all([fetch(B + p, { headers: H }), fetch(N + p, { headers: H })]);
      const cj = await c.json(), nj = await n.json();
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", (label || "") + p + ": answered by C#");
      assert.equal(c.status, n.status, p + ": the same status");
      assert.deepStrictEqual(cj, nj, (label || "") + p + ": the same answer");
      return cj;
    };
    const battery = async (label) => {
      const qs = ["", "?sort=artist", "?sort=year&dir=desc", "?sort=year", "?sort=added&dir=desc", "?sort=random&seed=42", "?sort=plays&dir=desc",
        "?sort=lastplayed", "?genre=Rock", "?genre=!Rock&genre=Jazz", "?decade=1960", "?format=FLAC&rate=96000", "?bits=24", "?letter=A",
        "?added=7", "?prefix=the", "?prefix=b", "?played=never", "?played=played", "?played=6", "?label=Columbia", "?offset=3&count=2", "?count=0"];
      for (const q of qs) await same("/api/library/albums" + q, label);
      await same("/api/library/facets", label);
      for (const q of ["beatles", "the beatles", "bjork", "björk", "abbey", "abby rd", "a", "jazz", "dark moon", "simon garfunkel", "&", "columbia", "  ", "zzzz", "kndblue"])
        await same("/api/search?q=" + encodeURIComponent(q), label);
      for (const q of ["", "?sort=albums", "?sort=random&seed=7", "?offset=2&limit=3"]) await same("/api/artists" + q, label);
      for (const a of ["The Beatles", "Beatles", "Björk", "Daft Punk", "McCoy Tyner", "Garfunkel", "nobody"]) await same("/api/artist-albums?artist=" + encodeURIComponent(a), label);
      await same("/api/artist-albums", label);
      for (const id of ids) await same("/api/album?offset=" + id, label);
      await same("/api/album?offset=999999", label);
      await same("/api/album", label);
      for (const p of ["/api/filters/genres", "/api/filters/decades", "/api/favourites", "/api/listen-later", "/api/home/genre-groups", "/api/library-stats",
        "/api/random-albums?seed=3&count=5", "/api/random-albums?seed=3&filter_type=genre&filter_value=rock", "/api/random-albums?seed=1&filter_type=decade&filter_value=1960"])
        await same(p, label);
      // Drawn at random: the same pool, whichever answers.
      const r = await (await fetch(B + "/api/random-albums?count=4", { headers: H })).json();
      assert.equal(r.albums.length, 4);
      assert.equal(r.total, ids.length);
    };

    await battery("as scanned: ");
    // The library changes on the Node server's side; C# follows.
    await post("/api/favourites", { offset: ids[2], on: true });
    await post("/api/favourites", { offset: ids[0], on: true });
    await post("/api/listen-later", { offsets: [ids[1], ids[4]], on: true });
    await post("/api/album/edit", { offset: ids[3], title: "Edited Title", artist: "The Edited", year: 1988 });
    await post("/api/settings/labels", { enabled: true });
    await post("/api/labels/merge", { items: [{ key: "columbia", display: "Columbia" }, { key: "impulse", display: "Impulse!" }] });
    const now = Date.now();
    const ins = ctx.db.raw.prepare("INSERT INTO plays(album_id, track_id, ts) VALUES(?, NULL, ?)");
    ins.run(ids[5], now - 1000); ins.run(ids[5], now - 2000); ins.run(ids[6], now - 400 * 86400000);
    await battery("after changes: ");
    const fav = await same("/api/favourites");
    assert.deepEqual(fav.albums.map(a => a.offset), [ids[0], ids[2]], "hearts, newest first");
    const s = await same("/api/search?q=columbia");
    assert.ok(s.labels.length >= 1, "labels found by search once on");
    // What hasn't moved is still passed on.
    const st = await fetch(B + "/api/status", { headers: H });
    assert.equal(st.headers.get("x-mandarin-answered"), null, "the status: still the Node server's");
  } finally { await srv.stop(); }
});
