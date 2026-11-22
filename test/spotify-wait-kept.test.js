"use strict";
/*
 * Spotify's wait kept through a restart (item 514). Spotify shut Mandarin out for a day ("asked again in 1302 min") and
 * Mandarin kept that wait only in memory: each of the five restarts that day (updates installed) asked Spotify again
 * straight away, and was refused again. A long wait is kept in the settings now, so after a restart Mandarin says
 * Spotify is busy, and how long for, without asking it; once the wait is over it asks again.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeSpotify } = require("./fake-spotify");
const { createServer, built } = require("./server");

const tracks = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id + "t" + (i + 1), name: "Song " + (i + 1) }));
const ALBUMS = Array.from({ length: 3 }, (_, i) => ({ id: "a" + i, name: "Album " + i, artist: "Artist", date: "2020-01-01", tracks: tracks("a" + i, 2) }));

test("item 514: Spotify's long wait outlasts a restart: Spotify not asked until it is over", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: [], page: 50 }).start();
  t.after(() => spotify.stop());
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const opts = { port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, spotifyPaceMs: 0 };
  let srv = createServer(opts);
  let ctx = await srv.start();
  t.after(() => srv && srv.stop());
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

  // Spotify shuts Mandarin out for two hours.
  spotify.busyFor = 7200;
  const first = await call("GET", "spotify/search?q=album&offset=0");
  assert.equal(first.status, 503, first.text);
  assert.match(first.j.error, /asked again in 120 min/);
  const kept = Number(ctx.db.raw.prepare("SELECT value FROM settings WHERE key = 'spotifyWaitUntil'").get()?.value);
  assert.ok(kept > Date.now() + 7000e3 && kept < Date.now() + 7300e3, "the wait kept: " + kept);

  await t.test("restarted: Spotify said to be busy, and not asked", async () => {
    await srv.stop();
    srv = createServer(opts);
    ctx = await srv.start();
    H = { Authorization: "Bearer " + await signIn(B) };
    const n = spotify.calls.length;
    const again = await call("GET", "spotify/search?q=album&offset=0");
    assert.equal(again.status, 503, again.text);
    assert.match(again.j.error, /asked again in 1[12]\d min/);
    assert.deepEqual(spotify.calls.slice(n).map(c => c.path), [], "Spotify not asked while it has Mandarin wait");
  });

  await t.test("the wait over: Spotify asked again", async () => {
    await srv.stop();
    ctx.db.raw.prepare("UPDATE settings SET value = ? WHERE key = 'spotifyWaitUntil'").run(String(Date.now() - 1000));
    spotify.busyFor = 0;
    srv = createServer(opts);
    ctx = await srv.start();
    H = { Authorization: "Bearer " + await signIn(B) };
    const ok = await call("GET", "spotify/search?q=album&offset=0");
    assert.equal(ok.status, 200, ok.text);
  });
});
