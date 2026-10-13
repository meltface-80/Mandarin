"use strict";
/*
 * Home's first row (v0.6.0-RC4): Album of the day is the same album for
 * every device from 00:01, gone from all of them once played; "Not played in
 * 6 months" offers nothing until Mandarin has six months of listening.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
// The day's key ("2026-10-3"), turning over at 00:01: a minute taken off, as the server keys it.
const dayKeyOf = (d) => { const x = new Date(d.getTime() - 60000); return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`; };

test("Album of the day and Not played in 6 months", { skip, timeout: 90000 }, async () => {
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [] });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const get = async p => (await fetch(B + p, { headers: { Authorization: "Bearer " + token } })).json();
    for (let i = 0; i < 100 && (await get("/api/status")).index_count !== 3; i++) await new Promise(r => setTimeout(r, 100));

    // Nothing played yet: no selection, said so.
    let u = await get("/api/home/unplayed?months=6&count=30");
    assert.deepEqual(u.albums, []);
    assert.equal(u.no_history, true);

    // Album of the day: the same answer to everyone, with the day it is for.
    const a1 = await get("/api/home/album-of-the-day");
    const a2 = await get("/api/home/album-of-the-day");
    assert.ok(a1.album && a1.album.title);
    assert.equal(a1.album.offset, a2.album.offset);
    assert.equal(a1.played, false);
    assert.equal(a1.day, dayKeyOf(new Date()));

    // Played: gone, for every device that asks; the day still said.
    const al = Object.assign({ id: a1.album.offset }, (await get("/api/album?offset=" + a1.album.offset)).album);
    const t = (await get("/api/album?offset=" + al.id)).tracks[0];
    const play = (ts) => ctx.features.insertPlay.run(al.id, t.track_id, t.title, t.artist || "", al.title, "TEST", ts);
    play(Date.now());
    const a3 = await get("/api/home/album-of-the-day");
    assert.equal(a3.album, null);
    assert.equal(a3.played, true);
    assert.equal(a3.day, a1.day);

    // A day's listening isn't six months: still nothing, and when it will be.
    u = await get("/api/home/unplayed?months=6&count=30");
    assert.deepEqual(u.albums, []);
    assert.equal(u.no_history, true);
    assert.ok(u.ready_at > Date.now());

    // Six months and more of listening: the albums not heard lately are offered.
    play(Date.now() - 200 * 24 * 3600 * 1000);
    u = await get("/api/home/unplayed?months=6&count=30");
    assert.equal(u.no_history, false);
    assert.ok(u.albums.length >= 1);
    assert.ok(!u.albums.some(x => x.offset === al.id), "the album just played isn't offered");

    // The library changes (an album added, the scan run) and the server is
    // restarted, as an update does: still the same day's album, still played —
    // not a new one in its place (v0.6.0-RC8).
    for (let i = 1; i <= 2; i++) {
      gen(path.join(lib.music, "Artist N", "New Arrival", `0${i}.flac`), { freq: 300 + 100 * i, tags: { title: `N${i}`, artist: "Artist N", album: "New Arrival", track: i } });
    }
    await fetch(B + "/api/library/rescan", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });
    for (let i = 0; i < 300 && (await get("/api/status")).index_count !== 4; i++) await new Promise(r => setTimeout(r, 100));
    assert.equal((await get("/api/status")).index_count, 4);
    let a4 = await get("/api/home/album-of-the-day");
    assert.equal(a4.album, null);
    assert.equal(a4.played, true);
    assert.equal(ctx.db.setting("album_of_the_day").day, a1.day, "the day's choice kept, for the same day");
    await srv.stop();
    const srv2 = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [] });
    const ctx2 = await srv2.start();
    try {
      // (The first connections can be the old server's kept-alive ones: asked again.)
      let token2 = null;
      for (let i = 0; i < 50 && !token2; i++) token2 = await signIn(B).catch(() => new Promise(r => setTimeout(() => r(null), 100)));
      a4 = await (await fetch(B + "/api/home/album-of-the-day", { headers: { Authorization: "Bearer " + token2 } })).json();
      assert.equal(a4.album, null, "still played after a restart");
      assert.equal(a4.played, true);
      assert.equal(a4.day, a1.day);
      assert.equal(ctx2.db.setting("album_of_the_day").day, a1.day, "the same day's choice, kept across the restart");
    } finally { await srv2.stop(); }
  } finally {
    await srv.stop();
  }
});
