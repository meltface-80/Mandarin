"use strict";
/*
 * Shelf's orders: A → Z by artist (the server's, the Library wall's) and A → Z
 * by album (v1.0.1, public/shelforder.js: titles read as the server reads
 * them, "The" and accents aside; signs, then numbers, then letters), and since
 * item 206 Rouen's by label and catalogue №, by catalogue №, by year and
 * random, all in the Order tab; each device keeps its own, a shuffle aside.
 * One look since item 206 (Rouen v1.9.68): the spines; a device that kept
 * another gets them.
 * The browser half is skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// public/shelforder.js as the page has it: its window.ShelfOrder.
function shelfOrder() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "shelforder.js"), "utf8"), { window, Intl, String });
  return window.ShelfOrder;
}

test("by album: a title as the server files it, and signs, numbers, then letters", () => {
  const o = shelfOrder();
  assert.equal(o.titleKey("The Wall"), "wall");
  assert.equal(o.titleKey("Wall, The"), "wall");
  assert.equal(o.titleKey("A Love Supreme"), "love supreme");
  assert.equal(o.titleKey("Theatre"), "theatre", "only a whole word");
  assert.equal(o.titleKey("Sigur Rós & Friends"), "sigur ros and friends");
  assert.deepEqual(["a", "z", "1", "9", "0", "", "é"].map(o.bucket), ["A", "Z", "1", "9", "#", "#", "#"]);
  const albums = ["Zed", "The Apple", "10 Years", "abba", "!!!", "2 Fast", "Ägypten", "Abba"].map((t, i) => ({ t, i }));
  const out = o.byAlbum(albums.slice());
  assert.deepEqual(out.map(a => a.t), ["!!!", "10 Years", "2 Fast", "abba", "Abba", "Ägypten", "The Apple", "Zed"]);
  assert.deepEqual(out.map(a => a.tb), ["#", "1", "2", "A", "A", "A", "A", "Z"], "each title's letter, for the spines' tabs");
  assert.ok(out[3] === albums[3], "the same albums, not copies");
  assert.deepEqual(albums.map(a => a.t)[0], "Zed", "the list given keeps its order");
});

// makeLibrary's three albums and eight more: one titled with a number, one with a leading "The".
function library() {
  const lib = makeLibrary();
  const more = [["The Beatles", "Abbey Road", 1969], ["Björk", "Homogenic", 1997], ["Miles Davis", "Kind of Blue", 1959],
    ["10cc", "The Original Soundtrack", 1975], ["!!!", "Myth Takes", 2007], ["Daft Punk", "Discovery", 2001],
    ["Nina Simone", "Pastel Blues", 1965], ["Adele", "21", 2011]];
  for (const [artist, album, year] of more) {
    gen(path.join(lib.music, artist, album, "01 x.flac"), { seconds: 1, tags: { title: album + " one", artist, album, track: 1, genre: "Rock", date: String(year) } });
  }
  return lib;
}

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("Shelf: the Order tab files it by artist, by album, by label and catalogue №, by catalogue №, by year or at random; kept per device; one look, the spines", { skip, timeout: 180000 }, async () => {
  const lib = library();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    await fetch(B + "/api/settings/shelf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled: true }) });   // a new install: Shelf off until switched on (v1.0.2)
    for (let i = 0; i < 150; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 11 && !st.scan.running) break;
      await sleep(100);
    }
    const list = (await (await fetch(B + "/api/shelf/albums", { headers: H })).json()).albums;
    const byArtist = list.map(a => a.t);
    assert.deepEqual(byArtist.slice(0, 4), ["Myth Takes", "The Original Soundtrack", "21", "Album One"], "by artist (!!!, 10cc, Adele, Artist A): signs, numbers, then letters");
    const byAlbum = ["21", "Abbey Road", "Album One", "Best Of", "Discovery", "Hi Res", "Homogenic", "Kind of Blue", "Myth Takes", "The Original Soundtrack", "Pastel Blues"];
    const byYear = list.slice().sort((x, y) => (!x.y !== !y.y ? (x.y ? -1 : 1) : (x.y || 0) - (y.y || 0))).map(a => a.t);

    const open = async (before) => b.page(B + "/shelf", { cookies: [{ name: "musicd_session", value: token, url: B }], init: before || "" });
    const STATE = `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
      await until(() => window.__shelfState && window.__shelfState().N === 11);
      return { label: document.getElementById("shelf-order").textContent, order: window.__shelfOrder(), look: window.__shelfState().look,
        looks: document.querySelectorAll("#looks button").length, spines: document.getElementById("stage").classList.contains("look-spines"),
        chips: [...document.querySelectorAll(".chip")].map(c => c.textContent.replace("×", "").trim()) };
    })()`;
    const choose = (id) => `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      document.querySelector('.tab[data-tab="order"]').click();
      const before = window.__shelfState().title;
      document.querySelector('.tile[data-cat="order"][data-id="${id}"]').click();
      await sleep(50);
      return { before, after: window.__shelfState().title, label: document.getElementById("shelf-order").textContent, order: window.__shelfOrder(),
        tiles: [...document.querySelectorAll('.tile[data-cat="order"]')].map(t => t.dataset.id + (t.getAttribute("aria-pressed") === "true" ? "*" : "")) };
    })()`;

    // A device that kept another look (the covers): the spines, the only look (item 206, Rouen v1.9.68).
    let page = await open(`localStorage.setItem("rra-shelf-look", "covers");`);
    let r = await page.eval(STATE);
    assert.deepEqual([r.look, r.spines, r.looks], ["spines", true, 0], "one look, no choosing it");
    assert.equal(r.label, "A → Z by artist");
    assert.deepEqual(r.order, byArtist, "by artist, as the server sends it");

    // Moved on to an album, then by album: the same album still in front.
    await page.eval(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById("stage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      for (let i = 0; i < 100 && window.__shelfState().mode !== "idle"; i++) await sleep(50); return true; })()`);
    r = await page.eval(choose("album"));
    assert.deepEqual(r.tiles, ["artist", "album*", "label", "catno", "year", "random"], "the orders, Mandarin's by album among Rouen's");
    assert.equal(r.label, "A → Z by album");
    assert.deepEqual(r.order, byAlbum, "by title: the number first, \"The\" aside");
    assert.equal(r.after, r.before, "the album in front stays in front");
    assert.deepEqual(page.errors, []);

    // Kept on this device: the next visit opens by album, its chip on.
    page = await open();
    r = await page.eval(STATE);
    assert.equal(r.label, "A → Z by album");
    assert.deepEqual(r.order, byAlbum);
    assert.deepEqual(r.chips, ["A → Z by album"]);
    r = await page.eval(choose("year"));
    assert.equal(r.label, "By year");
    assert.deepEqual(r.order, byYear, "oldest first, the undated last");
    r = await page.eval(choose("artist"));
    assert.equal(r.label, "A → Z by artist");
    assert.deepEqual(r.order, byArtist);

    // Random: not kept — the next visit opens in the order before it.
    await page.eval(choose("album"));
    r = await page.eval(choose("random"));
    assert.equal(r.label, "Random order");
    assert.deepEqual(r.order.slice().sort(), byArtist.slice().sort(), "the same albums");
    page = await open();
    assert.equal((await page.eval(STATE)).label, "A → Z by album", "a shuffle isn't kept: the order before it is");
    // Reset shelf: the artist order again, and kept so.
    await page.eval(`(() => { document.getElementById("reset-all").click(); return true; })()`);
    page = await open();
    assert.equal((await page.eval(STATE)).label, "A → Z by artist");
    assert.deepEqual(page.errors, []);
  } finally { await b.close(); await srv.stop(); }
});
