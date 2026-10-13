"use strict";
/*
 * Last.fm, read-only (from Rouen, MusicD Remote v1.9.3), and the album view's
 * sections under the review:
 *   - the client, against a fake that records every request: no call without
 *     a key, one call at a time and four a second, each artist asked once a
 *     week, the grey placeholder star never shown as an artist's picture, one
 *     unreadable artist costing one entry and not the row;
 *   - the routes, against a fake Last.fm on loopback: nothing without a key,
 *     the key checked, kept, masked, taken from the environment until one is
 *     saved, a refused key said so; what is in the library found by its
 *     credited names, never the title alone;
 *   - the album view in a real browser: More by the lead artist (not the
 *     album open), what they appear on, A to Z, three and More; then
 *     Last.fm's similar artists and albums, each saying where it opens.
 *
 * The C# server's (Extras/Lastfm.cs, LastfmRoutes.cs; lib/lastfm.js until
 * v0.8.50): the client run step by step through `mandarin-server score`
 * { fn: "lastfm" } (Extras/LastfmCommand.cs), the rest through the server.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawnSync } = require("child_process");
const { haveFfmpeg, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { built, BIN } = require("./server");
const { score, scoreAsync } = require("./score");

const rules = built();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Last.fm's grey star: every artist picture since 2019.
const STAR = "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png";
const img = (u) => [{ "#text": u.replace(".jpg", "-s.jpg"), size: "small" }, { "#text": u, size: "extralarge" }];

/*
 * The client, one run: Last.fm on loopback answering by routes(query) — an
 * answer, or { delay, body } to answer late — and each call noted with when
 * it came and how many were open at once. → { results, picks, sites, log, most }
 */
async function client(routes, steps, more = {}) {
  const log = [];
  let open = 0, most = 0;
  const server = http.createServer(async (req, res) => {
    const q = Object.fromEntries(new URL(req.url, "http://x").searchParams);
    log.push({ at: performance.now(), q });
    open++; most = Math.max(most, open);
    let body = routes(q);
    if (body && body.delay) { await sleep(body.delay); body = body.body; } else await new Promise(r => setImmediate(r));
    open--;
    res.writeHead(body && body.error ? (body.error === 10 ? 403 : 400) : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const r = await scoreAsync(Object.assign({ fn: "lastfm", base: "http://127.0.0.1:" + server.address().port + "/2.0/", key: "k", steps }, more));
    return Object.assign(r, { log, most });
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}

const SIMILAR = {
  similarartists: {
    "@attr": { artist: "Radiohead" },
    artist: [
      { name: "Thom Yorke", match: "1", url: "https://www.last.fm/music/Thom+Yorke", image: [{ "#text": STAR, size: "large" }] },
      { name: "Atoms for Peace", match: "0.8", url: "https://www.last.fm/music/Atoms+for+Peace", image: [] },
      { name: "Muse", match: "0.6", url: "https://www.last.fm/music/Muse", image: [] },
      { name: "muse", match: "0.5", url: "https://www.last.fm/music/Muse", image: [] },
    ],
  },
};
const TOP = (artist) => ({
  topalbums: { album: [
    { name: "(null)", artist: { name: artist }, url: "https://www.last.fm/music/x/(null)", image: [] },
    { name: artist + " LP", artist: { name: artist }, url: "https://www.last.fm/music/" + artist + "/LP",
      image: img("https://lastfm.freetls.fastly.net/i/u/300x300/" + artist.length + ".jpg") },
  ] },
});

function routes(q) {
  if (q.method === "artist.getSimilar") return SIMILAR;
  if (q.method === "artist.getTopAlbums") {
    if (q.artist === "Atoms for Peace") return { error: 6, message: "The artist you supplied could not be found" };
    return TOP(q.artist);
  }
  return { error: 3, message: "Invalid Method" };
}
const tops = log => log.filter(x => x.q.method === "artist.getTopAlbums").length;

test("the Last.fm client", { skip: rules }, async (t) => {
  await t.test("similar artists: closest first, one row per name, Last.fm's own name and page", async () => {
    const [r] = (await client(routes, [{ similar: "radiohead" }])).results;
    assert.equal(r.artist, "Radiohead");
    assert.equal(r.url, "https://www.last.fm/music/Radiohead");
    assert.deepEqual(r.artists.map((a) => a.name), ["Thom Yorke", "Atoms for Peace", "Muse"]);
  });
  await t.test("the grey star is never an artist's picture", async () => {
    const { results: [r], picks } = await client(routes, [{ similar: "radiohead" }], { picks: [[{ "#text": STAR, size: "mega" }], [{ "#text": "http://lastfm.example/a.jpg", size: "mega" }]] });
    assert.equal(r.artists[0].image, "");
    assert.deepEqual(picks, ["", ""], "never the star; https only");
  });
  await t.test("one result is a list of one", async () => {
    const [r] = (await client(() => ({ similarartists: { "@attr": { artist: "X" }, artist: { name: "Only One", url: "https://www.last.fm/music/Only+One" } } }), [{ similar: "X" }])).results;
    assert.deepEqual(r.artists.map(a => a.name), ["Only One"]);
  });
  await t.test("similar albums: each similar artist's top album, skipping untitled rows and unknown artists", async () => {
    const [r] = (await client(routes, [{ albums: ["Radiohead", 9] }])).results;
    assert.deepEqual(r.albums.map((a) => a.title), ["Thom Yorke LP", "Muse LP"]);
    assert.equal(r.albums[0].image, "https://lastfm.freetls.fastly.net/i/u/300x300/10.jpg", "the largest picture");
  });
  await t.test("one call at a time, at least 250 ms apart", async () => {
    const f = await client(routes, [{ albums: ["Radiohead", 9] }]);
    assert.equal(f.most, 1, "calls overlapped");
    assert.ok(f.log.length >= 4);
    for (let i = 1; i < f.log.length; i++) assert.ok(f.log[i].at - f.log[i - 1].at >= 250, "calls " + (i - 1) + " and " + i + " were too close");
  });
  await t.test("each answer is remembered: a second album view of the same artist costs nothing", async () => {
    const once = (await client(routes, [{ albums: ["Radiohead", 9] }])).log.length;
    assert.equal((await client(routes, [{ albums: ["Radiohead", 9] }, { similar: "Radiohead" }, { albums: ["Radiohead", 9] }])).log.length, once);
  });
  await t.test("…for a week, then asked again", async () => {
    assert.equal((await client(routes, [{ similar: "Radiohead" }, { tick: 7 * 24 * 60 * 60 * 1000 + 1 }, { similar: "Radiohead" }])).log.length, 2);
  });
  await t.test("two views asking at once share one call", async () => {
    const f = await client(routes, [{ both: "Radiohead" }]);
    assert.equal(f.log.length, 1);
    assert.deepEqual(f.results[0][0], f.results[0][1]);
  });
  await t.test("no key: no call at all, and a key saved later works on the next ask", async () => {
    const f = await client(() => SIMILAR, [{ similar: "Radiohead" }, { key: "k" }, { similar: "Radiohead" }], { key: "" });
    assert.equal(f.results[0].code, "nokey");
    assert.equal(f.log.length, 1, "only the ask with the key");
    assert.equal(f.results[2].artists.length, 3);
  });
  await t.test("similar albums stop asking once nobody wants the answer", async () => {
    assert.equal(tops((await client(routes, [{ albums: ["Radiohead", 9, 1] }])).log), 1, "kept asking for an album view that had gone");
  });
  await t.test("a refused key fails the whole row, not one entry at a time", async () => {
    const [r] = (await client((q) => (q.method === "artist.getSimilar" ? SIMILAR : { error: 10, message: "Invalid API key" }), [{ albums: ["Radiohead", 9] }])).results;
    assert.equal(r.code, 10);
  });
  await t.test("a moment's rate limit is not remembered against the artist, and costs one entry, not the row", async () => {
    let limited = 1;
    const [first, again] = (await client((q) => {
      if (q.method === "artist.getTopAlbums" && q.artist === "Thom Yorke" && limited-- > 0) return { error: 29, message: "Rate limit exceeded" };
      return routes(q);
    }, [{ albums: ["Radiohead", 9] }, { albums: ["Radiohead", 9] }])).results;
    assert.deepEqual(first.albums.map((a) => a.title), ["Muse LP"]);
    assert.deepEqual(again.albums.map((a) => a.title), ["Thom Yorke LP", "Muse LP"], "the rate limit was remembered");
  });
  await t.test("an answer to a call made with the old key is not kept after a new key is saved", async () => {
    // The call is under way when everything is forgotten (a new key saved); its refusal comes after.
    const f = await client(() => ({ delay: 300, body: { error: 10, message: "Invalid API key" } }), [{ start: "Radiohead" }, { clear: true }, { wait: true }, { similar: "Radiohead" }]);
    assert.equal(f.results[2].code, 10);
    assert.equal(f.log.length, 2, "the old key's refusal was served from the cache");
  });
  await t.test("only Last.fm's own https pages are linked", async () => {
    const { sites } = await client(routes, [], { sites: ["https://www.last.fm/music/Muse", "https://last.fm/music/Muse", "http://www.last.fm/music/Muse", "https://evil.example/last.fm/", "javascript:alert(1)"] });
    assert.deepEqual(sites, ["https://www.last.fm/music/Muse", "https://last.fm/music/Muse", "", "", ""]);
  });
  await t.test("the key goes to Last.fm and nowhere else, as api_key", async () => {
    const { log } = await client(routes, [{ similar: "Radiohead" }]);
    assert.deepEqual([log[0].q.api_key, log[0].q.method, log[0].q.format, log[0].q.autocorrect, log[0].q.limit], ["k", "artist.getSimilar", "json", "1", "24"]);
  });
});

test("the Last.fm key travels with a backup's other keys", { skip: rules }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-lastfm-keys-"));
  assert.equal(spawnSync(BIN, ["db", dir]).status, 0, "the database made");
  const db = path.join(dir, "musicd.db");
  score({ fn: "backup", applies: [{ db, server: { keys: { lastfmKey: "from-the-backup" } }, include: ["keys"], map: {} }] });
  const raw = new (require("better-sqlite3"))(db, { readonly: true });
  try { assert.equal(JSON.parse(raw.prepare("SELECT value FROM settings WHERE key = 'lastfmKey'").get().value), "from-the-backup"); } finally { raw.close(); }
});

// ---- The routes and the album view, against a fake Last.fm on loopback ----

const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const MUSE_ART = "https://lastfm.freetls.fastly.net/i/u/300x300/muse.jpg";

/*
 * Last.fm on loopback: "good" is a key it takes, anything else it refuses.
 * In a thread of its own: the moment each call comes is noted there, not on
 * this thread, which also runs the Node server under test (behind the C#
 * one) and can be held up by it long enough to note a call late. calls()
 * gives every call noted so far, in order.
 */
function lastfmServer() {
  const { Worker } = require("worker_threads");
  const w = new Worker(`
    const http = require("http");
    const { parentPort, workerData: { STAR, MUSE_ART } } = require("worker_threads");
    const calls = [];
    const server = http.createServer((req, res) => {
      const q = Object.fromEntries(new URL(req.url, "http://x").searchParams);
      calls.push(Object.assign({}, q, { at: Date.now() }));
      const send = (status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (q.api_key !== "good") return send(403, { message: "Invalid API key - You must be granted a valid key by last.fm", error: 10 });
      if (q.method === "artist.getInfo") return send(200, { artist: { name: q.artist } });
      if (q.method === "artist.getSimilar") {
        if (q.artist !== "Radiohead") return send(200, { similarartists: { "@attr": { artist: q.artist }, artist: [] } });
        return send(200, { similarartists: { "@attr": { artist: "Radiohead" }, artist: [
          { name: "Thom Yorke", url: "https://www.last.fm/music/Thom+Yorke", image: [{ "#text": STAR, size: "large" }] },
          { name: "Atoms for Peace", url: "https://www.last.fm/music/Atoms+for+Peace", image: [] },
          { name: "Muse", url: "https://www.last.fm/music/Muse", image: [{ "#text": MUSE_ART, size: "extralarge" }] }] } });
      }
      if (q.method === "artist.getTopAlbums") {
        const top = { "Thom Yorke": { name: "The Eraser", artist: { name: "Thom Yorke" }, url: "https://www.last.fm/music/Thom+Yorke/The+Eraser", image: [] },
          "Muse": { name: "Origin of Symmetry", artist: { name: "Muse" }, url: "https://www.last.fm/music/Muse/Origin+of+Symmetry", image: [{ "#text": MUSE_ART, size: "extralarge" }] } }[q.artist];
        if (!top) return send(200, { error: 6, message: "The artist you supplied could not be found" });
        return send(200, { topalbums: { album: [top] } });
      }
      send(400, { error: 3, message: "Invalid Method" });
    });
    parentPort.on("message", (m) => {
      if (m === "start") server.listen(0, "127.0.0.1", () => parentPort.postMessage({ base: "http://127.0.0.1:" + server.address().port + "/2.0/" }));
      if (m === "calls") parentPort.postMessage({ calls });
      if (m === "stop") { server.closeAllConnections(); server.close(() => parentPort.postMessage({ stopped: true })); }
    });
  `, { eval: true, workerData: { STAR, MUSE_ART } });
  const ask = (m, key) => new Promise((resolve) => {
    const on = (x) => { if (x && key in x) { w.off("message", on); resolve(x[key]); } };
    w.on("message", on);
    w.postMessage(m);
  });
  return { start: () => ask("start", "base"), calls: () => ask("calls", "calls"),
    stop: async () => { await ask("stop", "stopped"); await w.terminate(); } };
}

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-lastfm-"));
  const music = path.join(root, "music");
  const one = (artist, album, title, extra) => gen(path.join(music, artist.replace(/\W+/g, "_"), album, "01 x.flac"),
    { seconds: 1, tags: Object.assign({ title, artist, album, track: 1, genre: "Rock" }, extra) });
  one("Radiohead", "OK Computer", "Airbag");
  one("Radiohead", "Kid A", "Everything in Its Right Place");
  one("Radiohead", "Amnesiac", "Packt Like Sardines");
  one("Radiohead", "Hail to the Thief", "2 + 2 = 5");
  one("Thom Yorke feat. Radiohead", "Duets", "Together");
  one("Thom Yorke", "The Eraser", "The Eraser");
  one("Bonnie Prince Billy", "I See a Darkness", "A Minor Place");
  return { root, music, data: path.join(root, "data") };
}

test("Last.fm's routes, and the album view's sections under the review", { skip: rules || (!haveFfmpeg() && "ffmpeg is not installed"), timeout: 180000 }, async (t) => {
  const fake = lastfmServer();
  const base = await fake.start();
  const lib = library();
  const { createServer } = require("./server");
  // Started with LASTFM_KEY or without (createServer's lastfmKey): the key from the
  // environment is the server's from its start, on either server (v0.8.26).
  let srv, token;
  const start = async (envKey) => {
    srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
      lastfmBaseUrl: base, lastfmKey: envKey });
    await srv.start();
    token = await signIn(B);
  };
  await start("");
  try {
    const H = () => ({ Authorization: "Bearer " + token });
    const get = async (p) => (await fetch(B + p, { headers: H() })).json();
    const post = async (p, body) => (await fetch(B + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H()), body: JSON.stringify(body) })).json();
    for (let i = 0; i < 150 && (await get("/api/status")).index_count < 7; i++) await sleep(100);
    const albums = (await get("/api/library/albums?count=50")).albums;
    const id = (title) => albums.find(a => a.title === title).offset;

    await t.test("no key: nothing, and Last.fm is never asked", async () => {
      assert.deepEqual(await get("/api/settings/lastfm-key"), { set: false, configured: false, masked: "", source: "", check: null });
      assert.deepEqual(await get("/api/lastfm/similar-artists?artist=Radiohead"), { enabled: false });
      assert.deepEqual(await get("/api/lastfm/similar-albums?artist=Radiohead"), { enabled: false });
      assert.equal((await fetch(B + "/api/lastfm/similar-artists", { headers: H() })).status, 400, "an artist is needed");
      assert.equal((await fake.calls()).length, 0);
    });

    await t.test("a key from the environment until one is saved; a refused one said so", async () => {
      await srv.stop();
      await start("good");
      assert.deepEqual(await get("/api/settings/lastfm-key"), { set: true, configured: true, masked: "••••good", source: "env", check: "ok" });
      const bad = await post("/api/settings/lastfm-key", { key: "  wrongkey " });
      assert.deepEqual(bad, { ok: true, set: true, masked: "••••gkey", source: "settings", check: "invalid" }, "a saved key wins, checked at once");
      assert.deepEqual(await get("/api/lastfm/similar-artists?artist=Radiohead"), { enabled: true, error: "Last.fm refused the API key" });
      assert.deepEqual(await get("/api/lastfm/similar-albums?artist=Radiohead"), { enabled: true, error: "Last.fm refused the API key" });
      assert.equal((await post("/api/settings/lastfm-key", { key: "" })).set, false, "saved empty: off, whatever the environment says");
      assert.deepEqual(await get("/api/lastfm/similar-artists?artist=Radiohead"), { enabled: false });
      assert.equal((await post("/api/settings/lastfm-key", { key: "good" })).check, "ok", "and the refusal before it isn't kept");
    });

    await t.test("similar artists: in the library or not, decided before the tap", async () => {
      const j = await get("/api/lastfm/similar-artists?artist=" + encodeURIComponent("Radiohead & Someone Else"));
      assert.equal(j.enabled, true);
      assert.equal(j.artist, "Radiohead", "the credit's lead artist is asked about");
      assert.equal(j.url, "https://www.last.fm/music/Radiohead");
      const thom = j.artists.find(a => a.name === "Thom Yorke"), atoms = j.artists.find(a => a.name === "Atoms for Peace"), muse = j.artists.find(a => a.name === "Muse");
      assert.equal(thom.in_library, true);
      assert.ok(albums.filter(a => a.title === "Duets" || a.title === "The Eraser").map(a => a.image_key).includes(thom.image_key), "a cover of theirs");
      assert.equal(thom.image, "", "never the grey star");
      assert.deepEqual([atoms.in_library, atoms.image_key, atoms.url], [false, null, "https://www.last.fm/music/Atoms+for+Peace"]);
      assert.equal(muse.in_library, false);
      assert.equal(muse.image_key, "u-" + Buffer.from(MUSE_ART).toString("base64url"), "Last.fm's picture, through this server");
    });

    await t.test("similar albums: the library's own when it has it — by title and a credited name — else Last.fm's page", async () => {
      const j = await get("/api/lastfm/similar-albums?artist=Radiohead");
      assert.equal(j.enabled, true);
      assert.deepEqual(j.albums.map(a => a.title), ["The Eraser", "Origin of Symmetry"], "Atoms for Peace, unknown to Last.fm, costs its own entry only");
      assert.equal(j.albums[0].album.offset, id("The Eraser"));
      assert.equal(j.albums[1].album, null);
      assert.equal(j.albums[1].url, "https://www.last.fm/music/Muse/Origin+of+Symmetry");
      const calls = (await fake.calls()).length;
      await get("/api/lastfm/similar-albums?artist=Radiohead");
      assert.equal((await fake.calls()).length, calls, "remembered: the second view asks Last.fm nothing");
      // One call at a time, a quarter of a second apart (Last.fm's terms), whichever server asks.
      const asked = (await fake.calls()).filter(c => c.method !== "artist.getInfo").map(c => c.at);
      assert.ok(asked.length >= 4);
      for (let i = 1; i < asked.length; i++) assert.ok(asked[i] - asked[i - 1] >= 240, `${asked[i] - asked[i - 1]} ms apart`);
      // Answered by the C# server (v0.8.26), from its own environment (v0.8.48: LASTFM_URL, LASTFM_KEY; nothing handed over).
      for (const p of ["/api/settings/lastfm-key", "/api/lastfm/similar-artists?artist=Radiohead", "/api/lastfm/similar-albums?artist=Radiohead"]) {
        const r = await fetch(B + p, { headers: H() });
        assert.equal(r.headers.get("x-mandarin-answered"), "C#", p);
      }
    });

    if (!findBrowser() && !process.env.CI) return;
    await t.test("the album view: More by, Appears on, then Last.fm's — each in its place", async () => {
      const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        const r = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (f, ms = 10000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
          const $ = s => document.querySelector(s);
          const sec = id => { const s = document.getElementById(id); if (!s || s.classList.contains("hidden")) return null;
            return { title: s.querySelector(".more-title").textContent, tiles: [...s.querySelectorAll(".more-grid > *")].map(e => ({ text: (e.querySelector(".album-title, .more-artist-name") || e).textContent, hidden: e.classList.contains("hidden"), ext: !!e.querySelector(".more-ext") })),
              more: !s.querySelector(".more-toggle").classList.contains("hidden") }; };
          await until(() => document.querySelector("#home-view .album"));
          const albums = (await (await fetch("/api/library/albums?count=50")).json()).albums;
          window.__openAlbum(albums.find(a => a.title === "OK Computer"), {});
          await until(() => !document.getElementById("album-lastfm-albums").classList.contains("hidden"));
          const out = { by: sec("album-more-by"), appears: sec("album-more-appears"), artists: sec("album-lastfm-artists"), albums: sec("album-lastfm-albums"),
            site: $("#album-lastfm-artists .more-site").href, cols: getComputedStyle($("#album-more-by .more-grid")).gridTemplateColumns.split(" ").length,
            order: [...$("#modal-aside").children].filter(e => !e.classList.contains("hidden")).map(e => e.id) };
          $("#album-more-by .more-toggle").click();
          out.expanded = sec("album-more-by");
          out.less = $("#album-more-by .more-toggle").textContent;
          // Another album: everything cleared first.
          window.__openAlbum(albums.find(a => a.title === "I See a Darkness"), {});
          out.cleared = ["album-more-by", "album-more-appears", "album-lastfm-artists", "album-lastfm-albums"].map(id => document.getElementById(id).classList.contains("hidden"));
          await sleep(1500);
          out.after = { by: sec("album-more-by"), artists: sec("album-lastfm-artists") };
          return out;
        })()`);
        assert.equal(r.by.title, "More by Radiohead");
        assert.deepEqual(r.by.tiles.map(x => x.text), ["Amnesiac", "Hail to the Thief", "Kid A"], "A to Z, not the album open");
        assert.deepEqual(r.by.tiles.map(x => x.hidden), [false, false, false]);
        assert.equal(r.by.more, false, "three: no More");
        assert.equal(r.appears.title, "Radiohead appears on");
        assert.deepEqual(r.appears.tiles.map(x => x.text), ["Duets"]);
        assert.deepEqual(r.artists.tiles.map(x => [x.text, x.ext]), [["Thom Yorke", false], ["Atoms for Peace", true], ["Muse", true]]);
        assert.deepEqual(r.albums.tiles.map(x => [x.text, x.ext]), [["The Eraser", false], ["Origin of Symmetry", true]]);
        assert.equal(r.site, "https://www.last.fm/music/Radiohead");
        assert.equal(r.cols, 3, "three across");
        assert.deepEqual(r.order, ["album-more-by", "album-more-appears", "album-lastfm-artists", "album-lastfm-albums"], "under the review (none here), in this order");
        assert.deepEqual(r.cleared, [true, true, true, true]);
        assert.equal(r.after.by, null, "Bonnie Prince Billy has nothing more, and no Prince");
        assert.equal(r.after.artists, null, "nothing similar: the section stays hidden");
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
    });
  } finally {
    await srv.stop();
    await fake.stop();
  }
});

