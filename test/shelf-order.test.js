"use strict";
/*
 * Shelf's orders: A → Z by artist (the server's, the Library wall's), and
 * since item 206 Rouen's by label and catalogue №, by catalogue №, by year and
 * random, all in the Order tab; each device keeps its own, a shuffle aside.
 * Item 213 (the owner, as Rouen's v1.9.70-t5): A → Z, Z → A and #N are the
 * Genres tab's, the order of its tiles (#N, the most albums first, the
 * default), kept per device; Mandarin's A → Z by album (v1.0.1) is gone from
 * the Order tab, and a device that kept it opens by artist.
 * One look since item 206 (Rouen v1.9.68): the spines; a device that kept
 * another gets them.
 * The browser half is skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// makeLibrary's three albums and eight more: one titled with a number, one with a leading "The"; genres whose
// commonest first (Electronic 4, Rock 3, Jazz 2, Soul 1) is neither A → Z nor Z → A.
function library() {
  const lib = makeLibrary();
  const more = [["The Beatles", "Abbey Road", 1969, "Rock"], ["Björk", "Homogenic", 1997, "Electronic"], ["Miles Davis", "Kind of Blue", 1959, "Jazz"],
    ["10cc", "The Original Soundtrack", 1975, "Rock"], ["!!!", "Myth Takes", 2007, "Electronic"], ["Daft Punk", "Discovery", 2001, "Electronic"],
    ["Nina Simone", "Pastel Blues", 1965, "Soul"], ["Adele", "21", 2011, "Electronic"]];
  for (const [artist, album, year, genre] of more) {
    gen(path.join(lib.music, artist, album, "01 x.flac"), { seconds: 1, tags: { title: album + " one", artist, album, track: 1, genre, date: String(year) } });
  }
  return lib;
}

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

test("Shelf: the Order tab files it by artist, by label and catalogue №, by catalogue №, by year or at random; kept per device; one look, the spines", { skip, timeout: 180000 }, async () => {
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

    // Moved on to an album, then by year: the same album still in front.
    await page.eval(`(async () => { const sleep = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById("stage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      for (let i = 0; i < 100 && window.__shelfState().mode !== "idle"; i++) await sleep(50); return true; })()`);
    r = await page.eval(choose("year"));
    assert.deepEqual(r.tiles, ["artist", "label", "catno", "year*", "random"], "Rouen's orders, and no A → Z by album (item 213)");
    assert.equal(r.label, "By year");
    assert.deepEqual(r.order, byYear, "oldest first, the undated last");
    assert.equal(r.after, r.before, "the album in front stays in front");
    assert.deepEqual(page.errors, []);

    // Kept on this device: the next visit opens by year, its chip on.
    page = await open();
    r = await page.eval(STATE);
    assert.equal(r.label, "By year");
    assert.deepEqual(r.order, byYear);
    assert.deepEqual(r.chips, ["By year"]);
    r = await page.eval(choose("artist"));
    assert.equal(r.label, "A → Z by artist");
    assert.deepEqual(r.order, byArtist);

    // A device that kept A → Z by album (before item 213): by artist, no chip.
    page = await open(`localStorage.setItem("rra-shelf-order", "album");`);
    r = await page.eval(STATE);
    assert.equal(r.label, "A → Z by artist");
    assert.deepEqual(r.order, byArtist);
    assert.deepEqual(r.chips, []);

    // Random: not kept — the next visit opens in the order before it.
    await page.eval(choose("year"));
    r = await page.eval(choose("random"));
    assert.equal(r.label, "Random order");
    assert.deepEqual(r.order.slice().sort(), byArtist.slice().sort(), "the same albums");
    page = await open();
    assert.equal((await page.eval(STATE)).label, "By year", "a shuffle isn't kept: the order before it is");
    // Reset shelf: the artist order again, and kept so.
    await page.eval(`(() => { document.getElementById("reset-all").click(); return true; })()`);
    page = await open();
    assert.equal((await page.eval(STATE)).label, "A → Z by artist");
    assert.deepEqual(page.errors, []);

    // Item 213: the Genres tab's own order, #N (the most albums first), A → Z or Z → A, kept on this device.
    const GENRES = `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 300 && !document.querySelector(".tile[data-cat=genre]"); i++) { document.querySelector('.tab[data-tab="genre"]').click(); await sleep(50); }
      return { sorts: [...document.querySelectorAll(".g-sort")].map(b => b.textContent.trim() + (b.getAttribute("aria-pressed") === "true" ? "*" : "")),
        said: [...document.querySelectorAll(".g-sort")].map(b => b.getAttribute("aria-label")),
        names: [...document.querySelectorAll(".tile[data-cat=genre] .ch")].map(n => n.textContent.trim()),
        counts: [...document.querySelectorAll(".tile[data-cat=genre] .t-count")].map(n => n.textContent.trim()) };
    })()`;
    const sortBy = (id) => `(async () => { document.querySelector('.g-sort[data-sort="${id}"]').click(); return ${GENRES}; })()`;
    r = await page.eval(GENRES);
    assert.deepEqual(r.sorts, ["#N*", "A → Z", "Z → A"], "the three, #N the default");
    assert.deepEqual(r.said, ["Most albums first", "A to Z", "Z to A"]);
    assert.deepEqual(r.names, ["Electronic", "Rock", "Jazz", "Soul"], "#N: the most albums first, as the server sends them");
    assert.deepEqual(r.counts, ["4", "3", "2", "1"]);
    r = await page.eval(sortBy("az"));
    assert.deepEqual([r.sorts, r.names, r.counts], [["#N", "A → Z*", "Z → A"], ["Electronic", "Jazz", "Rock", "Soul"], ["4", "2", "3", "1"]], "A → Z, each with its own count");
    page = await open();
    await page.eval(STATE);
    r = await page.eval(GENRES);
    assert.deepEqual([r.sorts, r.names], [["#N", "A → Z*", "Z → A"], ["Electronic", "Jazz", "Rock", "Soul"]], "kept on this device");
    r = await page.eval(sortBy("za"));
    assert.deepEqual(r.names, ["Soul", "Rock", "Jazz", "Electronic"], "Z → A");
    // A genre chosen in this order is that genre: its chip, and the shelf its albums.
    r = await page.eval(`(async () => { document.querySelectorAll(".tile[data-cat=genre]")[2].click(); await new Promise(r => setTimeout(r, 50));
      return { chips: [...document.querySelectorAll(".chip")].map(c => c.textContent.replace("×", "").trim()), n: window.__shelfState().N,
        pressed: [...document.querySelectorAll(".tile[data-cat=genre]")].filter(t => t.getAttribute("aria-pressed") === "true").map(t => t.querySelector(".ch").textContent.trim()) }; })()`);
    assert.deepEqual(r.chips, ["Jazz"], "the third tile Z → A is Jazz");
    assert.deepEqual(r.pressed, ["Jazz"]);
    assert.equal(r.n, 2, "Jazz's two albums on the shelf");
    r = await page.eval(sortBy("count"));
    assert.deepEqual(r.names, ["Electronic", "Rock", "Jazz", "Soul"], "#N again");
    assert.deepEqual(page.errors, []);
  } finally { await b.close(); await srv.stop(); }
});
