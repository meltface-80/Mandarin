"use strict";
/*
 * Spotify's import without asking for each album again (item 499), against a Spotify on loopback (test/fake-spotify.js)
 * whose albums give their tracks as Spotify does, without an ISRC: the owner's first import of six hundred saved
 * albums failed on every one (the ISRC read unguarded), then ran into Spotify's limit asking for each album again.
 *   - the saved albums imported from the listing alone: nothing asked of any album (item 519: not even the tracks
 *     past a long album's first page, fetched when it is opened); every album in the library;
 *   - Spotify busy a moment (429, Retry-After: 1): waited out, the import goes on;
 *   - Spotify busy for a few seconds: the page's asks answered at once that it is busy (the phone gives up after six
 *     seconds; the owner's page timed out), while the import waits it out and goes on;
 *   - new from the artists you follow, gathered slowly the first time: the page answered within the phone's six
 *     seconds, saying it is still gathering, then the list once gathered;
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
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: SAVED, page: 5, trackPage: 5, followed: [{ id: "ar0", name: "Artist 0" }] }).start();
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("./server").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: false, spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, serviceWatchMs: 1e9, spotifyPaceMs: 0 });
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

    await t.test("from the listing alone: nothing asked of any album; every album in; a long one's tracks when opened", async () => {
      const n = spotify.calls.length;
      spotify.busyAtCall = n + 2;   // the saved list's second page refused once: a busy moment, waited out
      assert.equal((await post("settings/spotify", { import: true })).status, 200);
      const st = await imported();
      const asked = spotify.calls.slice(n).map(c => c.path);
      assert.deepEqual(asked.filter(p => /^albums\/[^/?]+$/.test(p)), [], "no album asked for again");
      assert.deepEqual(asked.filter(p => p.startsWith("albums/")), [], "nothing asked of any album, not even a long one's tracks (item 519)");
      assert.deepEqual([st.last_import.albums, st.last_import.failed, st.kept], [12, 0, 12], "every album, none failed (a busy moment waited out)");
      const albums = (await get("library/albums?sort=album&count=50")).j.albums.filter(a => a.source === "spotify");
      assert.equal(albums.length, 12);
      const first = (await get("album?offset=" + albums.find(a => a.title === "Album 00").offset)).j;
      assert.equal((first.tracks || []).length, 7, "opened: all seven tracks, those past the first page fetched now (item 519)");
    });

    await t.test("busy a few seconds: the page told at once, the import waits it out", async () => {
      spotify.busyFor = 2;
      const importing = post("settings/spotify/import");
      await sleep(300);
      const t0 = Date.now();
      const page = await get("spotify/search?q=album&offset=0");
      assert.ok(Date.now() - t0 < 1500, "answered in " + (Date.now() - t0) + " ms");
      assert.deepEqual([page.status, page.j.error], [503, "Spotify is busy: try again in a minute"]);
      setTimeout(() => { spotify.busyFor = 0; }, 1000);
      const r = await importing;
      assert.equal(r.status, 200, r.text);
      assert.deepEqual([r.j.result.albums, r.j.result.failed], [12, 0], "the import waited and went on");
    });

    await t.test("new from those followed, slow the first time: answered in time, saying it is still gathering", async () => {
      spotify.followDelayMs = 6000;
      const t0 = Date.now();
      const first = await get("spotify/new-releases?days=90");
      assert.ok(Date.now() - t0 < 5500, "answered in " + (Date.now() - t0) + " ms, within the phone's six seconds");
      assert.deepEqual([first.status, first.j.building, first.j.albums], [200, true, []]);
      spotify.followDelayMs = 0;
      const done = await until(async () => { const j = (await get("spotify/new-releases?days=90")).j; return j.building === false && j; }, 20000, "gathered");
      assert.deepEqual(done.albums, [], "Artist 0's albums older than three months");
    });

    await t.test("a long wait asked for: kept, said, and Spotify asked nothing meanwhile", async () => {
      spotify.busyFor = 3600;
      const r = await post("settings/spotify/import");
      assert.equal(r.status, 503, r.text);
      assert.match(r.j.error, /^Spotify asked Mandarin to wait: it is asked again in 60 min$/);
      const n = spotify.calls.length;
      spotify.busyFor = 0;
      // Your albums from what Mandarin keeps (item 516): answered while Spotify has it wait, Spotify not asked.
      const page = await get("spotify/featured?type=your-albums");
      assert.equal(page.status, 200, page.text);
      assert.equal((page.j.albums || page.j.items || page.j).length, 12);
      assert.equal(spotify.calls.length, n, "nothing asked of Spotify while it said to wait");
      assert.equal((await get("settings/spotify")).j.kept, 12, "the albums kept as they were");
    });
  } finally {
    await srv.stop();
    await spotify.stop();
  }
});
