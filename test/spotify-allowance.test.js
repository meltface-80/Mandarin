"use strict";
/*
 * Spotify's allowance, item 500: Spotify gives an app a day's worth of asks, and the owner's was used up in hours (the
 * favourites watch read the whole saved list every two minutes and asked for each album not yet in; the import ran
 * again after every rescan), so Spotify shut Mandarin out for a day ("asked again in 1302 min"). Against a Spotify on
 * loopback (test/fake-spotify.js), every ask counted:
 *   - the import reads the saved albums fifty at a time, and nothing more for albums it lists whole;
 *   - no watch asks Spotify anything, however often the watch runs;
 *   - the page's marks and an album page opening ask nothing: they read the library;
 *   - a rescan within the hour of an import leaves Spotify out (said by name for the others);
 *   - saving an album from the page: Spotify asked once to save it, and the library has it at once.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeSpotify } = require("./fake-spotify");
const { built } = require("./server");

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(100);
  }
}

const tracks = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id + "t" + (i + 1), name: "Song " + (i + 1) }));
const ALBUMS = Array.from({ length: 12 }, (_, i) => ({ id: "a" + i, name: "Album " + String(i).padStart(2, "0"), artist: "Artist " + (i % 3), date: "2020-01-01", tracks: tracks("a" + i, 2) }));
const SAVED = ALBUMS.slice(0, 11).map((a, i) => ({ id: a.id, added_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

test("Spotify's allowance: the import reads fifty at a time, no watch, the page's marks from the library, no rescan's import within the hour", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: SAVED, page: 50 }).start();
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("./server").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: false, spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, serviceWatchMs: 400, spotifyPaceMs: 0 });
  const ctx = await srv.start();
  let H;
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, H), body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, j, text };
  };
  const get = p => call("GET", p), post = (p, b) => call("POST", p, b || {});
  const since = n => spotify.calls.slice(n).map(c => c.path);
  try {
    H = { Authorization: "Bearer " + await signIn(B) };
    const begun = await post("settings/spotify/signin");
    assert.equal((await post("settings/spotify/signin/finish", { address: spotify.approve(begun.j.url) })).status, 200);

    await t.test("the import: the saved albums fifty at a time, nothing more asked", async () => {
      const n = spotify.calls.length;
      const r = await post("settings/spotify", { import: true });
      assert.equal(r.status, 200, r.text);
      await until(async () => { const s = (await get("settings/spotify")).j; return !s.importing && s.kept === 11; }, 30000, "the import");
      assert.deepEqual(since(n), ["me/albums?limit=50"], "one page of fifty: the whole saved list, and nothing else");
    });

    await t.test("no watch asks Spotify anything, however often it runs", async () => {
      const n = spotify.calls.length;
      const w = await ctx.internal("/internal/jobs/watch");
      assert.equal("spotify" in (w.services || {}), false, "Spotify left out of the watch: " + JSON.stringify(w));
      await sleep(2500);   // the timer's watch every 400 ms: six of them
      assert.deepEqual(since(n), []);
    });

    await t.test("the page's marks and an album page opening read the library", async () => {
      const albums = (await get("library/albums?sort=album&count=50")).j.albums.filter(a => a.source === "spotify");
      const n = spotify.calls.length;
      const page = await get("album?offset=" + albums[0].offset);
      assert.equal(page.status, 200, page.text);
      const found = await get("spotify/search?q=album&offset=0");
      assert.equal(found.j.albums.filter(a => a.favourited).length, 10, "the first ten found, all saved");
      assert.deepEqual(since(n).map(p => p.split("?")[0]), ["search"], "only the search asked");
    });

    await t.test("a rescan within the hour of an import leaves Spotify out", async () => {
      const n = spotify.calls.length;
      const r = await post("library/rescan");
      assert.equal(r.status, 200, r.text);
      assert.deepEqual(r.j.services || [], [], "no service's import begun");
      await sleep(1000);
      assert.deepEqual(since(n), []);
    });

    await t.test("saving from the page: Spotify asked once to save it, the library has it at once", async () => {
      const n = spotify.calls.length;
      const on = await post("spotify/favorite", { album_id: "a11" });
      assert.equal(on.status, 200, on.text);
      // Read as the library has it: the saved list (forgotten by the save) not asked for again.
      assert.equal((await get("spotify/state?album_id=a11")).j.favourite, true);
      assert.equal((await get("settings/spotify")).j.kept, 12);
      assert.deepEqual(since(n).map(p => p.split("?")[0]), ["me/library", "albums/a11"], "saved there, then the album read for the library");
    });
  } finally {
    await srv.stop();
    await spotify.stop();
  }
});
