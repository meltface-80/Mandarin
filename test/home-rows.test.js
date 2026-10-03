"use strict";
/*
 * Home's first row (v0.6.0-RC4): Album of the day is the same album for
 * every device from 00:01, gone from all of them once played; "Not played in
 * 6 months" offers nothing until Mandarin has six months of listening.
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

    // Played: gone, for every device that asks; the day still said.
    const al = ctx.library.album(a1.album.offset);
    const t = ctx.library.tracks(al.id)[0];
    const play = (ts) => ctx.features.insertPlay.run(al.id, t.id, t.title, t.artist || "", al.title, "TEST", ts);
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

    // The day turns over at 00:01: 00:00:30 is still yesterday, 00:01:30 today.
    const y = new Date(2026, 9, 3, 0, 0, 30), z = new Date(2026, 9, 3, 0, 1, 30);
    assert.equal(ctx.library.dayKey(y), "2026-10-2");
    assert.equal(ctx.library.dayKey(z), "2026-10-3");
    assert.equal(ctx.library.dayStart(z), new Date(2026, 9, 3, 0, 1, 0).getTime());
  } finally {
    await srv.stop();
  }
});
