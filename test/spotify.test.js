"use strict";
/*
 * Spotify, item 497: signing in and your saved albums in the library, against a Spotify on loopback
 * (test/fake-spotify.js), through the server's routes as the page and the app ask them:
 *   - the sign-in: Spotify's address with Mandarin's app, the loopback address to come back to and PKCE's S256
 *     challenge; the address Spotify sends back pasted, the code exchanged with the verifier, the account kept;
 *     refused in plain words for a refusal on Spotify, an address that isn't its answer, a sign-in begun elsewhere;
 *   - finished twice at once (the app catching it while the address is pasted), Spotify slow to answer: one code
 *     exchanged, both answered signed in;
 *   - the import: every saved album, each page of Spotify's list followed, an album's tracks past its first page,
 *     an entry Development Mode calls "item"; in the library as Spotify's, with its cover, newest saved first;
 *   - the token: refused by Spotify, refreshed once and the call made again; the new refresh token kept at once, so a
 *     restarted server goes on with it (Spotify's old one stops working); a list's next page elsewhere is not asked;
 *   - a moment's 429 waited out; signing out; and the page in a browser: Sign in on Spotify, the address pasted,
 *     Finish sign-in, signed in with the switch as it was.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeSpotify } = require("./fake-spotify");
const { built } = require("./server");
const { Browser, findBrowser } = require("./browser-harness");

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(100);
  }
}

const tracks = (id, n) => Array.from({ length: n }, (_, i) => ({ id: id + "t" + (i + 1), name: "Song " + (i + 1), ms: 200000 + i }));
const ALBUMS = [
  { id: "sp1", name: "Blue Lines", artist: "Massive Attack", date: "1991-04-08", upc: "0724378660527", tracks: tracks("sp1", 3) },
  { id: "sp2", name: "Dummy", artist: "Portishead", date: "1994-08-22", tracks: tracks("sp2", 5) },
  { id: "sp3", name: "Maxinquaye", artist: "Tricky", date: "1995", tracks: tracks("sp3", 2) }
];
const SAVED = [
  { id: "sp2", added_at: "2026-11-20T10:00:00Z" },
  { id: "sp1", added_at: "2026-10-01T10:00:00Z", as: "item" },
  { id: "sp3", added_at: "2026-01-05T10:00:00Z" }
];

test("Spotify: signing in, your saved albums in the library, the token kept", { skip: built(), timeout: 180000 }, async (t) => {
  const spotify = await new FakeSpotify({ albums: ALBUMS, saved: SAVED, page: 2, trackPage: 3 }).start();
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const opts = { port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    spotifyBaseUrl: spotify.apiUrl, spotifyAuthUrl: spotify.accountsUrl, qobuzSyncDelayMs: 1e9, serviceWatchMs: 1e9 };
  let srv = require("./server").createServer(opts);
  await srv.start();
  let H;
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, H), body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, j, text };
  };
  const get = p => call("GET", p), post = (p, b) => call("POST", p, b || {});
  try {
    H = { Authorization: "Bearer " + await signIn(B) };

    await t.test("signed out: the page's state, with where Spotify sends you back", async () => {
      const r = await get("settings/spotify");
      assert.equal(r.status, 200, r.text);
      assert.equal(r.j.connected, false);
      assert.equal(r.j.import, false);
      assert.equal(r.j.redirect, "http://127.0.0.1:43143/mandarin-spotify");
      assert.equal("spotify" in (await get("library/cleanup")).j, false, "Clean up says nothing of Spotify before it is used");
    });

    await t.test("refused in plain words: turned down on Spotify, not Spotify's answer, begun elsewhere", async () => {
      const begun = await post("settings/spotify/signin");
      assert.equal(begun.status, 200, begun.text);
      const no = await post("settings/spotify/signin/finish", { address: spotify.approve(begun.j.url, { deny: true }) });
      assert.deepEqual([no.status, no.j.error], [400, "Spotify says you didn't allow Mandarin: sign in again and choose Agree"]);
      const junk = await post("settings/spotify/signin/finish", { address: "http://127.0.0.1:43143/mandarin-spotify" });
      assert.equal(junk.status, 400);
      assert.match(junk.j.error, /copy the whole address/);
      const elsewhere = await post("settings/spotify/signin/finish", { code: "code-x", state: "not-begun-here" });
      assert.deepEqual([elsewhere.status, elsewhere.j.error], [400, "That sign-in has expired or was begun elsewhere: sign in again"]);
      assert.equal(spotify.grants.length, 0, "Spotify asked for no token");
    });

    await t.test("signing in: PKCE with Mandarin's app; finished twice at once while Spotify is slow, one code exchanged", async () => {
      const begun = await post("settings/spotify/signin");
      const u = new URL(begun.j.url);
      assert.equal(u.origin + u.pathname, spotify.base + "/authorize");
      const q = Object.fromEntries(u.searchParams);
      assert.equal(q.client_id, "5938a1a6cf2c4b5ebf7756be64378e1f");
      assert.equal(q.redirect_uri, "http://127.0.0.1:43143/mandarin-spotify");
      assert.equal(q.code_challenge_method, "S256");
      assert.match(q.code_challenge, /^[A-Za-z0-9_-]{43}$/);
      assert.equal(q.scope, "user-library-read user-library-modify user-follow-read");
      assert.equal((await get("settings/spotify")).j.pending, true, "the page shows where to paste");
      const back = spotify.approve(begun.j.url);
      spotify.tokenDelayMs = 800;
      const [a, b] = await Promise.all([
        post("settings/spotify/signin/finish", { address: back }),
        sleep(100).then(() => post("settings/spotify/signin/finish", { code: new URL(back).searchParams.get("code"), state: new URL(back).searchParams.get("state") }))]);
      spotify.tokenDelayMs = 0;
      assert.equal(a.status, 200, a.text);
      assert.equal(b.status, 200, b.text);
      assert.equal(spotify.grants.filter(g => g.grant_type === "authorization_code").length, 1, "the code exchanged once");
      const st = await until(async () => { const r = await get("settings/spotify"); return r.j.connected && r; }, 10000, "signed in");
      assert.deepEqual([st.j.user.name, st.j.user.login, st.j.pending], ["A Listener", "listener1", false]);
    });

    await t.test("the import: every saved album, each page followed, in the library as Spotify's", async () => {
      const r = await post("settings/spotify", { import: true });
      assert.equal(r.status, 200, r.text);
      await until(async () => (await get("settings/spotify")).j.kept === 3 && !(await get("settings/spotify")).j.importing, 30000, "the import");
      assert.ok(spotify.calls.some(c => c.path.startsWith("me/albums?offset=2")), "the second page followed");
      assert.ok(spotify.calls.some(c => c.path.startsWith("albums/sp2/tracks?offset=3")), "the album's tracks past the first page");
      const albums = await until(async () => { const l = (await get("library/albums?sort=album&count=50")).j.albums.filter(a => a.source === "spotify"); return l.length === 3 && l; }, 15000, "on the walls");
      const by = Object.fromEntries(albums.map(a => [a.title, a]));
      assert.deepEqual(Object.keys(by).sort(), ["Blue Lines", "Dummy", "Maxinquaye"], "the 'item' entry too");
      assert.equal(by["Dummy"].subtitle, "Portishead");
      assert.ok(by["Dummy"].image_key, "its cover kept");
      const one = (await get("album?offset=" + by["Dummy"].offset)).j;
      assert.equal((one.tracks || []).length, 5, JSON.stringify(one).slice(0, 300));
      assert.deepEqual((await get("library/cleanup")).j.spotify, { albums: 0, signed_in: true }, "counted once in use");
    });

    await t.test("the token: refused, refreshed once, the call made again; the new refresh token kept through a restart", async () => {
      spotify.expireAccess();
      const before = spotify.grants.filter(g => g.grant_type === "refresh_token").length;
      const r = await post("settings/spotify/import");
      assert.equal(r.status, 200, r.text);
      await until(async () => !(await get("settings/spotify")).j.importing, 20000, "the import");
      assert.equal(spotify.grants.filter(g => g.grant_type === "refresh_token").length, before + 1, "one refresh");
      assert.equal(spotify.grants.at(-1).client_id, "5938a1a6cf2c4b5ebf7756be64378e1f");
      await srv.stop();
      spotify.expireAccess();
      srv = require("./server").createServer(opts);
      await srv.start();
      H = { Authorization: "Bearer " + await signIn(B) };
      const again = await post("settings/spotify/import");
      assert.equal(again.status, 200, again.text);
      await until(async () => !(await get("settings/spotify")).j.importing, 20000, "the import after a restart");
      const st = (await get("settings/spotify")).j;
      assert.deepEqual([st.connected, st.kept], [true, 3], "went on with the refresh token kept");
      assert.equal(spotify.grants.filter(g => g.grant_type === "refresh_token").length, before + 2);
    });

    await t.test("a moment's 429 waited out; a next page elsewhere never asked", async () => {
      spotify.busyOnce = true;
      await post("settings/spotify/import");
      await until(async () => !(await get("settings/spotify")).j.importing, 20000, "the import");
      assert.equal((await get("settings/spotify")).j.kept, 3, "the import went on after the 429");
      const elsewhere = await new FakeSpotify().start();
      try {
        spotify.nextElsewhere = elsewhere.apiUrl + "me/albums?offset=2";
        await post("settings/spotify/import");
        await until(async () => !(await get("settings/spotify")).j.importing, 20000, "the import");
        assert.equal(elsewhere.calls.length, 0, "the token went nowhere else");
      } finally {
        spotify.nextElsewhere = null;
        await elsewhere.stop();
      }
    });

    await t.test("signing out: signed out", async () => {
      const r = await post("settings/spotify/signout");
      assert.equal(r.status, 200, r.text);
      assert.equal(r.j.connected, false);
      assert.equal((await get("settings/spotify")).j.connected, false);
    });

    if (!findBrowser() && !process.env.CI) return;
    await t.test("the page: Sign in on Spotify, the address pasted, Finish sign-in: signed in, the switch shown", async () => {
      const b = await Browser.launch({ width: 412, height: 915 });
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: H.Authorization.slice(7), url: B }] });
        const opened = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
          const shown = e => !!e && e.getClientRects().length > 0;
          window.__opened = [];
          window.open = (u) => { window.__opened.push(u); return null; };
          await until(() => document.querySelector("#settings-toggle"));
          document.querySelector("#settings-toggle").click(); await sleep(300);
          document.querySelector('.settings-nav-item[data-pane="streaming"]').click(); await sleep(200);
          document.querySelector('.settings-nav-item[data-pane="spotify"]').click();
          await until(() => shown(document.getElementById("spotify-signin")));
          document.getElementById("spotify-signin").click();
          await until(() => window.__opened.length && shown(document.getElementById("spotify-paste")));
          return { url: window.__opened[0], finishShown: shown(document.getElementById("spotify-finish")) };
        })()`);
        assert.ok(opened.url && opened.url.startsWith(spotify.base + "/authorize?"), JSON.stringify(opened));
        assert.equal(opened.finishShown, true);
        const back = spotify.approve(opened.url);
        const r = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
          const shown = e => !!e && e.getClientRects().length > 0;
          document.getElementById("spotify-paste").value = ${JSON.stringify(back)};
          document.getElementById("spotify-finish").click();
          await until(() => shown(document.getElementById("spotify-import")) || shown(document.getElementById("spotify-signed")));
          return { status: document.getElementById("spotify-status").textContent, signed: shown(document.getElementById("spotify-signed")),
            form: shown(document.getElementById("spotify-signin-form")), importOn: document.getElementById("spotify-import").checked };
        })()`);
        assert.deepEqual(r, { status: "Signed in as A Listener", signed: true, form: false, importOn: true });
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
    });
  } finally {
    await srv.stop();
    await spotify.stop();
  }
});
