"use strict";
/*
 * Spotify's "Your albums" from what Mandarin keeps (item 516). It read every saved album from Spotify each time it was
 * opened, fifty at a time: the owner's thousand took longer than the app waits ("Couldn't load: timeout"), and each
 * opening spent twenty of the day's requests again. With the import on, the list is the import's reading, kept: answered
 * at once, newest saved first, covers as Spotify gave them, and Spotify not asked. An album saved since from Mandarin's
 * page is first; one taken off is gone.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeSpotify } = require("./fake-spotify");
const { createServer, built } = require("./server");
const { until } = require("./helpers");

const tracks = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id + "t" + (i + 1), name: "Song " + (i + 1) }));
const ALBUMS = Array.from({ length: 6 }, (_, i) => ({ id: "a" + i, name: "Album " + i, artist: "Artist " + i, date: "2020-01-01", tracks: tracks("a" + i, 2) }));
// Saved one day apart, a0 first: newest saved is a4.
const SAVED = ALBUMS.slice(0, 5).map((a, i) => ({ id: a.id, added_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

test("item 516: Your albums from what the import keeps: at once, newest first, Spotify not asked", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: SAVED, page: 50 }).start();
  t.after(() => spotify.stop());
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: false, spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, spotifyPaceMs: 0 });
  await srv.start();
  t.after(() => srv.stop());
  let H;
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, H), body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, j, text };
  };
  H = { Authorization: "Bearer " + await signIn(B) };
  const begun = await call("POST", "settings/spotify/signin");
  assert.equal((await call("POST", "settings/spotify/signin/finish", { address: spotify.approve(begun.j.url) })).status, 200);
  assert.equal((await call("POST", "settings/spotify", { import: true })).status, 200);
  await until(async () => { const s = (await call("GET", "settings/spotify")).j; return !s.importing && s.kept === 5; }, 30000, "the import");
  const yours = async () => { const r = await call("GET", "spotify/featured?type=your-albums"); assert.equal(r.status, 200, r.text); return r.j.albums || r.j.items || r.j; };

  await t.test("answered from the import's reading, newest saved first, with covers, Spotify not asked", async () => {
    const n = spotify.calls.length;
    const list = await yours();
    assert.deepEqual(list.map(a => a.id), ["a4", "a3", "a2", "a1", "a0"]);
    assert.ok(list.every(a => a.image && a.favourited), JSON.stringify(list[0]));
    assert.deepEqual(spotify.calls.slice(n).map(c => c.path), [], "Spotify not asked");
  });

  await t.test("saved from Mandarin's page: first; taken off: gone", async () => {
    assert.equal((await call("POST", "spotify/favorite", { album_id: "a5" })).status, 200);
    assert.equal((await call("POST", "spotify/unfavorite", { album_id: "a0" })).status, 200);
    const n = spotify.calls.length;
    const list = await yours();
    assert.deepEqual(list.map(a => a.id), ["a5", "a4", "a3", "a2", "a1"]);
    assert.deepEqual(spotify.calls.slice(n).map(c => c.path), [], "Spotify not asked");
  });
});
