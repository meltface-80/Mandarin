"use strict";
/*
 * Listen later (Stage 7): albums put aside, kept on the server by the album's
 * identity, newest first; off the list once every track has been played
 * since — a play recorded by the zones, as history is — or by hand.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3612;
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 100));
  }
}

test("listen later", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false });
  const ctx = await srv.start();
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  try {
    await until(async () => (await api("status")).index_count === 3);
    const albums = (await api("library/albums?sort=album")).albums;
    const cd = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res"), best = albums.find(a => a.title === "Best Of");
    assert.equal(cd.later, undefined);
    assert.deepEqual((await api("listen-later")).albums, []);

    // One at a time, and several at once (the selection menu).
    let r = await api("listen-later", { offset: cd.offset, on: true });
    assert.equal(r.status, 200); assert.equal(r.later, true);
    await new Promise(res => setTimeout(res, 5));
    r = await api("listen-later", { offsets: [hi.offset, best.offset], on: true });
    assert.equal(r.count, 2);
    const titles = (await api("listen-later")).albums.map(a => a.title);
    assert.deepEqual(titles.slice().sort(), ["Album One", "Best Of", "Hi Res"]);
    assert.equal(titles[2], "Album One", "newest first: the one put aside first is last");
    assert.equal((await api("album?offset=" + cd.offset)).album.later, true);
    assert.ok((await api("library/albums?sort=album")).albums.find(a => a.title === "Album One").later);
    assert.ok((await api("settings/home-rows")).rows.some(x => x.id === "later"), "a Home row of its own");

    // Survives the library being rebuilt from the files.
    ctx.library.reload();
    assert.equal((await api("listen-later")).albums.length, 3);

    // By hand.
    r = await api("listen-later", { offset: best.offset, on: false });
    assert.equal(r.later, false);
    assert.deepEqual((await api("listen-later")).albums.map(a => a.title), ["Hi Res", "Album One"]);
    assert.equal((await api("listen-later", { offset: 999999, on: true })).status, 404);

    // Played through: a play for each track, as the zones record them. Two of
    // three leaves it on the list; the third takes it off.
    const tracks = ctx.library.tracks(cd.offset);
    assert.equal(tracks.length, 3);
    for (const t of tracks.slice(0, 2)) ctx.zones.emit("played", { zoneId: "Kitchen", trackId: t.id, title: t.title });
    await new Promise(res => setTimeout(res, 50));
    assert.ok((await api("listen-later")).albums.some(a => a.title === "Album One"), "two of three played: still on the list");
    ctx.zones.emit("played", { zoneId: "Kitchen", trackId: tracks[2].id, title: tracks[2].title });
    await new Promise(res => setTimeout(res, 50));
    assert.deepEqual((await api("listen-later")).albums.map(a => a.title), ["Hi Res"], "every track played: off the list");
    // Plays from before it was put aside don't count: the same album again.
    await api("listen-later", { offset: cd.offset, on: true });
    assert.ok((await api("listen-later")).albums.some(a => a.title === "Album One"));
  } finally {
    await srv.stop();
  }
});
