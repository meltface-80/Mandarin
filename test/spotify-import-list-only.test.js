"use strict";
/*
 * Spotify's import takes the saved list only (item 519), as Music Assistant brings a library in. Each album the list
 * gave without its tracks, or with only their first page, was asked for again, one request an album: the owner's 2,450
 * saved albums would be as many requests, the burst that had Spotify shut Mandarin out for a day; and every album a week
 * old was asked for again at the next import. Now the import asks Spotify for the list and nothing more; an album's
 * missing tracks are fetched once, when it is opened, and kept.
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
const ALBUMS = Array.from({ length: 6 }, (_, i) => ({ id: "album" + String(i).padStart(12, "0"), name: "Album " + i, artist: "Artist " + i, date: "2020-01-01",
  tracks: tracks("a" + i, i === 5 ? 60 : 3) }));
const SAVED = ALBUMS.map((a, i) => ({ id: a.id, added_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

test("item 519: the import asks for the saved list only; an album's missing tracks fetched once, when it is opened", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: SAVED, page: 50 }).start();
  t.after(() => spotify.stop());
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: false, spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, spotifyPaceMs: 0 });
  const ctx = await srv.start();
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
  const offsetOf = id => ctx.db.raw.prepare("SELECT id FROM albums WHERE key = ?").get("spotify:" + id).id;
  const trackCount = id => ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks t JOIN albums a ON a.id = t.album_id WHERE a.key = ?").get("spotify:" + id).n;

  // The saved list as Spotify may give it: no album's tracks in it.
  spotify.listTracks = false;
  await t.test("the import: the saved list asked for, and nothing more; every album in the library", async () => {
    const n = spotify.calls.length;
    assert.equal((await call("POST", "settings/spotify", { import: true })).status, 200);
    await until(async () => { const s = (await call("GET", "settings/spotify")).j; return !s.importing && s.kept === 6; }, 30000, "the import");
    assert.deepEqual(spotify.calls.slice(n).map(c => c.path.split("?")[0]), ["me/albums"], "only the saved list");
    for (const a of ALBUMS) assert.ok(offsetOf(a.id), a.id + " in the library");
  });

  await t.test("an album opened: its tracks fetched now, once, and kept", async () => {
    const id = ALBUMS[0].id;
    const n = spotify.calls.length;
    const page = await call("GET", "album?offset=" + offsetOf(id));
    assert.equal(page.status, 200, page.text);
    assert.equal(page.j.tracks.length, 3, "its three tracks on the page");
    assert.equal(trackCount(id), 3);
    assert.ok(spotify.calls.slice(n).some(c => c.path.startsWith("albums/" + id)), "asked for once");
    const m = spotify.calls.length;
    assert.equal((await call("GET", "album?offset=" + offsetOf(id))).j.tracks.length, 3);
    assert.deepEqual(spotify.calls.slice(m).filter(c => c.path.startsWith("albums/")).map(c => c.path), [], "not asked again");
  });

  await t.test("the list giving each album's first page: the import asks for no second page; opened, the album gets it", async () => {
    spotify.listTracks = true;
    const big = ALBUMS[5].id;
    ctx.db.raw.prepare("DELETE FROM albums WHERE key = ?").run("spotify:" + big);
    ctx.db.raw.prepare("DELETE FROM cache WHERE ns = 'spotify-kept' AND key = ?").run("spotify:" + big);
    const n = spotify.calls.length;
    assert.equal((await call("POST", "settings/spotify/import")).status, 200);
    await until(async () => { const s = (await call("GET", "settings/spotify")).j; return !s.importing && s.kept === 6; }, 30000, "the import again");
    assert.deepEqual(spotify.calls.slice(n).map(c => c.path.split("?")[0]), ["me/albums"], "only the saved list");
    assert.equal(trackCount(big), 50, "the first page, as listed");
    const page = await call("GET", "album?offset=" + offsetOf(big));
    assert.equal(page.j.tracks.length, 60, "opened: all sixty");
  });
});
