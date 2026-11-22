"use strict";
/*
 * Every request to Spotify in one queue, one at a time and spaced (item 518), as Music Assistant asks it. Mandarin had
 * no such gate: an import asked as fast as Spotify answered, the owner's thousand saved albums made 500 requests in 13
 * minutes, and Spotify shut Mandarin out for a day. Against a Spotify on loopback (test/fake-spotify.js), with a gap of
 * 400 ms (two seconds as installed): requests asked for at once reach Spotify spaced; and a page's ask goes ahead of
 * the import in the background, so a search answers while the import runs.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeSpotify } = require("./fake-spotify");
const { createServer, built } = require("./server");
const { until } = require("./helpers");

const GAP = 400;
const tracks = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id + "t" + (i + 1), name: "Song " + (i + 1) }));
// Saved albums listed one a page: the import makes a request an album (item 519: it asks for the saved list alone).
const ALBUMS = Array.from({ length: 8 }, (_, i) => ({ id: "album" + String(i).padStart(12, "0"), name: "Album " + i, artist: "Artist", date: "2020-01-01", tracks: tracks("a" + i, 60) }));
const SAVED = ALBUMS.map((a, i) => ({ id: a.id, added_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

test("item 518: Spotify asked one request at a time, spaced; a page's ask before the import's", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: SAVED, page: 1 }).start();
  t.after(() => spotify.stop());
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: false, spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, spotifyPaceMs: 0, spotifyIntervalMs: GAP });
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

  // The import: a page of the saved list an album, the gap apart.
  await t.test("a search while the import runs: answered ahead of the import's next requests", async () => {
    assert.equal((await call("POST", "settings/spotify", { import: true })).status, 200);
    await until(() => spotify.calls.some(c => c.path.startsWith("me/albums?offset=")), 30000, "the import under way");
    const n = spotify.calls.length;
    const t0 = Date.now();
    const found = await call("GET", "spotify/search?q=now&offset=0");
    assert.equal(found.status, 200, found.text);
    assert.ok(Date.now() - t0 < GAP * 2.5, "answered within a turn or two: " + (Date.now() - t0) + " ms");
    const next = spotify.calls.slice(n).map(c => c.path.split("?")[0]);
    assert.ok(next.indexOf("search") >= 0 && next.indexOf("search") <= 1, "the search the next request or the one after: " + next.join(" "));
    assert.ok(spotify.calls.slice(n).some(c => c.path.startsWith("me/albums")), "the import still had requests to make: " + next.join(" "));
    await until(async () => { const st = (await call("GET", "settings/spotify")).j; return !st.importing && st.kept === 8; }, 60000, "the import");
  });

  await t.test("asked for at once, they reach Spotify one at a time, the gap apart", async () => {
    const n = spotify.calls.length;
    const answers = await Promise.all(["a", "b", "c", "d"].map(q => call("GET", "spotify/search?q=" + q + "&offset=0")));
    assert.deepEqual(answers.map(a => a.status), [200, 200, 200, 200]);
    const at = spotify.calls.slice(n).map(c => c.at);
    assert.ok(at.length >= 4, "every search asked: " + at.length);
    for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] >= GAP - 30, "gaps: " + at.map((x, j) => j ? x - at[j - 1] : 0).join(", "));
  });
});
