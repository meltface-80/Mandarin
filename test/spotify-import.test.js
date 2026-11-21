"use strict";
/*
 * Spotify's import without asking for each album again (item 499), against a Spotify on loopback (test/fake-spotify.js)
 * whose albums give their tracks as Spotify does, without an ISRC: the owner's first import of six hundred saved
 * albums failed on every one (the ISRC read unguarded), then ran into Spotify's limit asking for each album again.
 *   - the saved albums imported from the listing alone: no album asked for again, only tracks past an album's first
 *     page; every album in the library, its tracks with it;
 *   - Spotify busy a moment (429, Retry-After: 1): waited out, the import goes on;
 *   - Spotify asking for a long wait (Retry-After: an hour): Mandarin stops asking until then, says so, and asks
 *     nothing more of it meanwhile (the page's lists answered at once).
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
const ALBUMS = Array.from({ length: 12 }, (_, i) => ({ id: "a" + i, name: "Album " + String(i).padStart(2, "0"), artist: "Artist " + (i % 3), date: "2020-01-01",
  tracks: tracks("a" + i, i === 0 ? 7 : 2) }));
const SAVED = ALBUMS.map((a, i) => ({ id: a.id, added_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString() }));

test("Spotify's import: from the listing alone, a busy moment waited out, a long wait kept", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: SAVED, page: 5, trackPage: 5 }).start();
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("./server").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: false, spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, serviceWatchMs: 1e9 });
  await srv.start();
  let H;
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, H), body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, j, text };
  };
  const get = p => call("GET", p), post = (p, b) => call("POST", p, b || {});
  const imported = () => until(async () => { const s = (await get("settings/spotify")).j; return !s.importing && s.last_import && s; }, 30000, "the import");
  try {
    H = { Authorization: "Bearer " + await signIn(B) };
    const begun = await post("settings/spotify/signin");
    assert.equal((await post("settings/spotify/signin/finish", { address: spotify.approve(begun.j.url) })).status, 200);

    await t.test("from the listing alone: no album asked for again, only tracks past a first page; every album in", async () => {
      const n = spotify.calls.length;
      busyOnceAt(spotify, 4);
      assert.equal((await post("settings/spotify", { import: true })).status, 200);
      const st = await imported();
      const asked = spotify.calls.slice(n).map(c => c.path);
      assert.deepEqual(asked.filter(p => /^albums\/[^/?]+$/.test(p)), [], "no album asked for again");
      assert.deepEqual([...new Set(asked.filter(p => p.startsWith("albums/")).map(p => p.split("?")[0]))], ["albums/a0/tracks"], "the long album's tracks past its first page");
      assert.deepEqual([st.last_import.albums, st.last_import.failed, st.kept], [12, 0, 12], "every album, none failed (a busy moment waited out)");
      const albums = (await get("library/albums?sort=album&count=50")).j.albums.filter(a => a.source === "spotify");
      assert.equal(albums.length, 12);
      const first = (await get("album?offset=" + albums.find(a => a.title === "Album 00").offset)).j;
      assert.equal((first.tracks || []).length, 7, "all seven tracks, without ISRCs");
    });

    await t.test("a long wait asked for: kept, said, and Spotify asked nothing meanwhile", async () => {
      spotify.busyFor = 3600;
      const r = await post("settings/spotify/import");
      assert.equal(r.status, 503, r.text);
      assert.match(r.j.error, /^Spotify asked Mandarin to wait: it is asked again in 60 min$/);
      const n = spotify.calls.length;
      spotify.busyFor = 0;
      const page = await get("spotify/featured?type=your-albums");
      assert.equal(page.status, 503);
      assert.match(page.j.error, /asked again in \d+ min/);
      assert.equal(spotify.calls.length, n, "nothing asked of Spotify while it said to wait");
      assert.equal((await get("settings/spotify")).j.kept, 12, "the albums kept as they were");
    });
  } finally {
    await srv.stop();
    await spotify.stop();
  }
});

/* The [nth] call from now answered busy for a moment (Retry-After: 1). */
function busyOnceAt(spotify, nth) {
  const start = spotify.calls.length;
  const check = setInterval(() => { if (spotify.calls.length >= start + nth - 1) { spotify.busyOnce = true; clearInterval(check); } }, 5);
  check.unref();
}
