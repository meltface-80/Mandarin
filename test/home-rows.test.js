"use strict";
/*
 * Home's first row (v0.6.0-RC4): Album of the day is the same album for
 * every device all day, shown even once played; "Not played in 6 months"
 * offers nothing until Mandarin has a play history.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3617;
const B = "http://127.0.0.1:" + PORT;

test("Album of the day and Not played in 6 months", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
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
    assert.equal(a1.day, ctx.library.dayKey());

    // Played today: still shown, marked played (it used to vanish).
    const al = ctx.library.album(a1.album.offset);
    const t = ctx.library.tracks(al.id)[0];
    ctx.features.insertPlay.run(al.id, t.id, t.title, t.artist || "", al.title, "TEST", Date.now());
    const a3 = await get("/api/home/album-of-the-day");
    assert.equal(a3.album.offset, a1.album.offset);
    assert.equal(a3.played, true);

    // With a history, the albums not heard lately are offered.
    u = await get("/api/home/unplayed?months=6&count=30");
    assert.equal(u.no_history, false);
    assert.ok(u.albums.length >= 1);
    assert.ok(!u.albums.some(x => x.offset === al.id), "the album just played isn't offered");
  } finally {
    await srv.stop();
  }
});
