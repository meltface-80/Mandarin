"use strict";
/*
 * Favourites: the heart on an album, kept on the server by the album's
 * identity, listed newest first, and still there after the library reloads.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port();
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

test("favourites", { skip, timeout: 60000 }, async () => {
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
    const cd = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");
    assert.equal(cd.favourite, undefined);
    assert.deepEqual((await api("favourites")).albums, []);

    let r = await api("favourites", { offset: cd.offset, on: true });
    assert.equal(r.status, 200); assert.equal(r.favourite, true);
    await new Promise(res => setTimeout(res, 5));
    r = await api("favourites", { offset: hi.offset, on: true });
    assert.equal(r.favourite, true);
    // Newest heart first, and the heart shows on the album itself and in every list.
    assert.deepEqual((await api("favourites")).albums.map(a => a.title), ["Hi Res", "Album One"]);
    assert.equal((await api("album?offset=" + cd.offset)).album.favourite, true);
    assert.ok((await api("library/albums?sort=album")).albums.find(a => a.title === "Album One").favourite);

    // Survives the library being rebuilt from the files.
    ctx.library.reload();
    assert.deepEqual((await api("favourites")).albums.map(a => a.title), ["Hi Res", "Album One"]);

    r = await api("favourites", { offset: cd.offset, on: false });
    assert.equal(r.favourite, false);
    assert.deepEqual((await api("favourites")).albums.map(a => a.title), ["Hi Res"]);
    assert.equal((await api("album?offset=" + cd.offset)).album.favourite, undefined);
    assert.equal((await api("favourites", { offset: 999999, on: true })).status, 404);
  } finally {
    await srv.stop();
  }
});
