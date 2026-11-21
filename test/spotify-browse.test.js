"use strict";
/*
 * Spotify's page in the side menu, item 498, against a Spotify on loopback (test/fake-spotify.js):
 *   - New from artists you follow: the artists you follow read a page at a time (Spotify's cursor), each one's albums
 *     and singles; those of the last three months, newest first, an older one left out; asked twice at once the first
 *     time, each artist asked once; kept, so asked again it asks Spotify nothing;
 *   - Your albums: the saved albums;
 *   - search, ten a page (Spotify's most since February 2026), more said and the next page asked; an artist's page;
 *     an album with its tracks;
 *   - an album saved on Spotify from the page, and unsaved: Spotify's one library call, its URI;
 *   - the page in a browser: the side menu's Spotify, its two tabs, their albums.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeSpotify } = require("./fake-spotify");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const ago = days => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
const tracks = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id + "t" + (i + 1), name: "Song " + (i + 1) }));
const ALBUMS = [
  { id: "n1", name: "Fresh One", artist: "Artist North", date: ago(5), tracks: tracks("n1", 2) },
  { id: "n2", name: "Fresh Single", artist: "Artist North", date: ago(40), type: "single", tracks: tracks("n2", 1) },
  { id: "n3", name: "Old Times", artist: "Artist North", date: ago(400), tracks: tracks("n3", 2) },
  { id: "s1", name: "South Rising", artist: "Artist South", date: ago(20), tracks: tracks("s1", 3) },
  { id: "e1", name: "East Echo", artist: "Artist East", date: ago(200), tracks: tracks("e1", 2) },
  ...Array.from({ length: 13 }, (_, i) => ({ id: "m" + i, name: "Many " + String(i).padStart(2, "0"), artist: "Prolific", date: ago(1000 + i), tracks: tracks("m" + i, 1) }))
];
const FOLLOWED = [{ id: "arN", name: "Artist North" }, { id: "arS", name: "Artist South" }, { id: "arE", name: "Artist East" }];

test("Spotify's page: new from artists you follow, your albums, search, artists, albums, saving", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: [{ id: "s1", added_at: "2026-11-01T00:00:00Z" }], followed: FOLLOWED }).start();
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
  const titles = j => (j.albums || []).map(a => a.title);
  try {
    const token = await signIn(B);
    H = { Authorization: "Bearer " + token };
    // Signed in to Spotify as the page does it.
    const begun = await post("settings/spotify/signin");
    assert.equal((await post("settings/spotify/signin/finish", { address: spotify.approve(begun.j.url) })).status, 200);
    spotify.followPage = 2;
    spotify.followDelayMs = 600;

    await t.test("new from artists you follow: the last three months, newest first; asked twice at once, each artist asked once", async () => {
      const calls0 = spotify.artistAlbumCalls || 0, following = () => spotify.calls.filter(c => c.path.startsWith("me/following")).length;
      const [a, b] = await Promise.all([get("spotify/new-releases?days=90"), get("spotify/new-releases?days=90")]);
      assert.equal(a.status, 200, a.text);
      assert.deepEqual(titles(a.j), ["Fresh One", "South Rising", "Fresh Single"], "newest first; Old Times and East Echo older");
      assert.deepEqual(titles(b.j), titles(a.j));
      assert.equal(a.j.days, 90);
      assert.equal((spotify.artistAlbumCalls || 0) - calls0, 3, "each followed artist asked once");
      assert.ok(spotify.calls.some(c => c.path.startsWith("me/following") && c.path.includes("after=")), "the second page of those followed, by cursor");
      assert.equal(following(), 2, "those followed read once (two pages), however many asked at once");
      assert.equal(a.j.albums.find(x => x.title === "South Rising").favourited, true, "a saved one marked");
      const n = spotify.calls.length;
      const again = await get("spotify/new-releases?days=30");
      assert.deepEqual(titles(again.j), ["Fresh One", "South Rising"], "the last 30 days of the kept list");
      assert.equal(spotify.calls.filter((c, i) => i >= n && !c.path.startsWith("me/albums")).length, 0, "kept: Spotify asked nothing more of it");
    });

    await t.test("your albums: the saved albums", async () => {
      const r = await get("spotify/featured?type=your-albums");
      assert.deepEqual(titles(r.j), ["South Rising"]);
      assert.equal((await get("spotify/featured?type=nothing")).status, 404);
    });

    await t.test("search: ten a page, more said, the next page asked; artists found", async () => {
      const first = await get("spotify/search?q=many&offset=0");
      assert.equal(first.status, 200, first.text);
      assert.equal(first.j.albums.length, 10);
      assert.deepEqual([first.j.total, first.j.has_more, first.j.limit], [13, true, 10]);
      assert.deepEqual(first.j.artists.map(a => a.name), ["Prolific"]);
      const next = await get("spotify/search?q=many&offset=10");
      assert.deepEqual([next.j.albums.length, next.j.has_more], [3, false]);
    });

    await t.test("an artist's page and an album's", async () => {
      const ar = await get("spotify/artist-albums?artist_id=arN&offset=0");
      assert.equal(ar.status, 200, ar.text);
      assert.equal(ar.j.artist.name, "Artist North");
      assert.deepEqual(titles(ar.j), ["Fresh One", "Fresh Single", "Old Times"]);
      const al = await get("spotify/album?id=n1");
      assert.equal(al.status, 200, al.text);
      assert.deepEqual([al.j.album.title, al.j.tracks.length], ["Fresh One", 2]);
    });

    await t.test("saving an album on Spotify and unsaving it: its URI in Spotify's one library call", async () => {
      const on = await post("spotify/favorite", { album_id: "n1" });
      assert.equal(on.status, 200, on.text);
      assert.deepEqual(spotify.library.at(-1), { method: "PUT", uris: ["spotify:album:n1"] });
      assert.equal((await get("spotify/state?album_id=n1")).j.favourite, true, "saved, read afresh");
      const off = await post("spotify/unfavorite", { album_id: "n1" });
      assert.equal(off.status, 200, off.text);
      assert.deepEqual(spotify.library.at(-1), { method: "DELETE", uris: ["spotify:album:n1"] });
      assert.equal((await get("spotify/state?album_id=n1")).j.favourite, false);
    });

    if (!findBrowser() && !process.env.CI) return;
    await t.test("the page: the side menu's Spotify, its two tabs and their albums", async () => {
      const b = await Browser.launch({ width: 412, height: 915 });
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        const r = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
          const shown = e => !!e && e.getClientRects().length > 0;
          const tiles = () => [...document.querySelectorAll("#spotify-nr-list .album-title")].map(e => e.textContent);
          const out = {};
          out.row = await until(() => !document.getElementById("menu-item-spotify").classList.contains("hidden"));
          document.getElementById("spotify-toggle").click();
          out.open = await until(() => shown(document.getElementById("spotify-overlay")) && tiles().length > 0);
          out.tabs = [...document.querySelectorAll("#spotify-tabs .qobuz-tab")].map(e => e.textContent);
          out.followed = tiles();
          out.status = document.getElementById("spotify-nr-status").textContent;
          document.querySelector('#spotify-tabs [data-qtab="your-albums"]').click();
          await until(() => tiles().join() === "South Rising");
          out.yours = tiles();
          return out;
        })()`);
        assert.deepEqual([r.row, r.open], [true, true], JSON.stringify(r));
        assert.deepEqual(r.tabs, ["New from artists you follow", "Your albums"]);
        assert.deepEqual(r.followed, ["Fresh One", "South Rising", "Fresh Single"]);
        assert.equal(r.status, "3 releases in the last 90 days");
        assert.deepEqual(r.yours, ["South Rising"]);
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
    });
  } finally {
    await srv.stop();
    await spotify.stop();
  }
});
