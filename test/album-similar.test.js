"use strict";
/*
 * The album view's sections under the review (from Rouen, MusicD Remote
 * v1.9.3), in a real browser: More by the lead artist (not the album open),
 * what they appear on, A to Z, three and More; then the lead artist's similar
 * artists and similar albums, as the artist page has them: Deezer's related
 * acts, which need no key (item 494: Last.fm's went with its key). Every tile
 * opens in Mandarin; nothing says Last.fm.
 *
 * Deezer is a stand-in on loopback; its related list for Thom Yorke is slow,
 * so an album left before it answers is seen not to be painted over.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { haveFfmpeg, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");

const rules = built();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const SLOW_MS = 1500;

/* Deezer on loopback: a search finds the act by name, its related list is the act's neighbours. */
function deezerServer() {
  const acts = { Radiohead: 1, "Thom Yorke": 2, "Atoms for Peace": 3, Muse: 4 };
  const related = { 1: ["Thom Yorke", "Atoms for Peace", "Muse"], 2: ["Radiohead"] };
  const asked = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const send = (body) => { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(body)); };
    // What it has been asked so far, for the page to wait on (not a call of Deezer's).
    if (u.pathname === "/asked") return send(asked);
    asked.push(u.pathname + u.search);
    if (u.pathname === "/search/artist") {
      const q = u.searchParams.get("q");
      return send({ data: acts[q] ? [{ id: acts[q], name: q, nb_fan: 1000 }] : [] });
    }
    const m = /^\/artist\/(\d+)\/related$/.exec(u.pathname);
    if (m) {
      const data = (related[m[1]] || []).map(n => ({ id: acts[n], name: n }));
      if (m[1] === "2") return void setTimeout(() => send({ data }), SLOW_MS);
      return send({ data });
    }
    send({ data: [] });
  });
  return {
    start: () => new Promise(r => server.listen(0, "127.0.0.1", () => r("http://127.0.0.1:" + server.address().port))),
    stop: () => new Promise(r => { server.closeAllConnections(); server.close(r); })
  };
}

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-similar-"));
  const music = path.join(root, "music");
  const one = (artist, album, title) => gen(path.join(music, artist.replace(/\W+/g, "_"), album, "01 x.flac"),
    { seconds: 1, tags: { title, artist, album, track: 1, genre: "Rock" } });
  one("Radiohead", "OK Computer", "Airbag");
  one("Radiohead", "Kid A", "Everything in Its Right Place");
  one("Radiohead", "Amnesiac", "Packt Like Sardines");
  one("Radiohead", "Hail to the Thief", "2 + 2 = 5");
  one("Thom Yorke feat. Radiohead", "Duets", "Together");
  one("Thom Yorke", "The Eraser", "The Eraser");
  one("Bonnie Prince Billy", "I See a Darkness", "A Minor Place");
  return { root, music, data: path.join(root, "data") };
}

test("the album view's sections under the review", { skip: rules || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no browser"), timeout: 180000 }, async () => {
  const deezer = deezerServer();
  const base = await deezer.start();
  const lib = library();
  const { createServer } = require("./server");
  const dead = "http://127.0.0.1:9";
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    deezerBaseUrl: base, mbBaseUrl: dead, wikipediaBaseUrl: dead, fanartBaseUrl: dead, itunesBaseUrl: dead });
  await srv.start();
  const token = await signIn(B);
  const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
  try {
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 150 && (await (await fetch(B + "/api/status", { headers: H })).json()).index_count < 7; i++) await sleep(100);
    const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
    const r = await page.eval(`(async (deezer) => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const until = async (f, ms = 20000) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
      const $ = s => document.querySelector(s);
      const sec = id => { const s = document.getElementById(id); if (!s || s.classList.contains("hidden")) return null;
        return { title: s.querySelector(".more-title").textContent, tiles: [...s.querySelectorAll(".more-grid > *")].map(e => ({ text: (e.querySelector(".album-title, .more-artist-name") || e).textContent, hidden: e.classList.contains("hidden") })),
          more: !s.querySelector(".more-toggle").classList.contains("hidden") }; };
      const ids = ["album-more-by", "album-more-appears", "album-similar-artists", "album-similar-albums"];
      await until(() => document.querySelector("#home-view .album"));
      const albums = (await (await fetch("/api/library/albums?count=50")).json()).albums;
      window.__openAlbum(albums.find(a => a.title === "OK Computer"), {});
      const shown = id => !document.getElementById(id).classList.contains("hidden");
      if (!await until(() => ids.every(shown))) return { why: "not all four shown: " + ids.filter(shown) };
      const out = { by: sec("album-more-by"), appears: sec("album-more-appears"), artists: sec("album-similar-artists"), albums: sec("album-similar-albums"),
        cols: getComputedStyle($("#album-more-by .more-grid")).gridTemplateColumns.split(" ").length,
        lastfm: /last\\.fm/i.test(document.querySelector("#album-more-by").parentElement.textContent) || !!document.querySelector(".more-site, .more-ext, .is-external"),
        // where they are: the album view's aside, or its left-hand column in three (item 214)
        order: [...$("#album-more-by").parentElement.children].filter(e => ids.includes(e.id) && !e.classList.contains("hidden")).map(e => e.id) };
      $("#album-more-by .more-toggle").click();
      out.expanded = sec("album-more-by");
      // Another album: everything cleared first.
      window.__openAlbum(albums.find(a => a.title === "I See a Darkness"), {});
      out.cleared = ids.map(id => document.getElementById(id).classList.contains("hidden"));
      // An act Deezer doesn't know: nothing similar, the sections stay hidden.
      await sleep(1500);
      out.after = { by: sec("album-more-by"), artists: sec("album-similar-artists") };
      // Out of order: Thom Yorke's related list is slow; the album is left before it comes.
      window.__openAlbum(albums.find(a => a.title === "The Eraser"), {});
      out.slowAsked = await until(async () => (await (await fetch(deezer + "/asked")).json()).some(p => p.startsWith("/artist/2/related")));
      window.__openAlbum(albums.find(a => a.title === "I See a Darkness"), {});
      await sleep(${SLOW_MS} + 3000);
      out.late = ids.map(id => document.getElementById(id).classList.contains("hidden"));
      // Its similar artist opens their page here.
      window.__openAlbum(albums.find(a => a.title === "OK Computer"), {});
      await until(() => shown("album-similar-artists"));
      [...document.querySelectorAll("#album-similar-artists .more-artist")].find(e => e.textContent.includes("Muse")).click();
      out.opened = await until(() => window.__artistViewActive() && /Muse/.test(document.getElementById("album-count").textContent), 5000);
      out.href = location.href;
      return out;
    })(${JSON.stringify(base)})`);
    assert.ok(!r.why, r.why);
    assert.equal(r.by.title, "More by Radiohead");
    assert.deepEqual(r.by.tiles.map(x => x.text), ["Amnesiac", "Hail to the Thief", "Kid A"], "A to Z, not the album open");
    assert.equal(r.by.more, false, "three: no More");
    assert.equal(r.appears.title, "Radiohead appears on");
    assert.deepEqual(r.appears.tiles.map(x => x.text), ["Duets"]);
    assert.deepEqual(r.artists.tiles.map(x => x.text), ["Thom Yorke", "Atoms for Peace", "Muse"], "Deezer's order, in the library or not");
    assert.deepEqual(r.albums.tiles.map(x => x.text), ["The Eraser"], "the library's alone");
    assert.equal(r.lastfm, false, "nothing says Last.fm, nothing leaves the app");
    assert.equal(r.cols, 3, "three across");
    assert.deepEqual(r.order, ["album-more-by", "album-more-appears", "album-similar-artists", "album-similar-albums"], "under the review (none here), in this order");
    assert.deepEqual(r.cleared, [true, true, true, true]);
    assert.equal(r.after.by, null, "Bonnie Prince Billy has nothing more, and no Prince");
    assert.equal(r.after.artists, null, "nothing similar: the section stays hidden");
    assert.deepEqual(r.late, [true, true, true, true], "a late answer for an album left is not painted");
    assert.equal(r.slowAsked, true, "Thom Yorke's slow list was asked for before the album was left");
    assert.equal(r.opened, true, "a similar artist outside the library opens their page here: " + r.href);
    assert.deepEqual(page.errors, []);
  } finally {
    await b.close();
    await srv.stop();
    await deezer.stop();
  }
});
