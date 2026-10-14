"use strict";
/*
 * Shelf (v1.0.1): two orders and two looks. The order's name above the shelf
 * switches A → Z by artist (the server's, the Library wall's) and A → Z by
 * album (public/shelforder.js: titles read as the server reads them, "The"
 * and accents aside; signs, then numbers, then letters), each device keeping
 * its own; Random order turns it off. The carousel look is gone: covers and
 * spines, and a device that had the carousel gets the covers.
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

test("Shelf: the order's name switches by artist and by album, kept per device; covers and spines, no carousel", { skip, timeout: 180000 }, async () => {
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
    const byArtist = (await (await fetch(B + "/api/shelf/albums", { headers: H })).json()).albums.map(a => a.t);
    assert.deepEqual(byArtist.slice(0, 4), ["Myth Takes", "The Original Soundtrack", "21", "Album One"], "by artist (!!!, 10cc, Adele, Artist A): signs, numbers, then letters");
    const byAlbum = ["21", "Abbey Road", "Album One", "Best Of", "Discovery", "Hi Res", "Homogenic", "Kind of Blue", "Myth Takes", "The Original Soundtrack", "Pastel Blues"];

    const open = async (before) => {
      const pg = await b.page(B + "/shelf", { cookies: [{ name: "musicd_session", value: token, url: B }], init: before || "" });
      return pg;
    };
    const STATE = `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
      await until(() => window.__shelfState && window.__shelfState().N === 11);
      const o = document.getElementById("shelf-order");
      return { label: o.textContent, disabled: o.disabled, tag: o.tagName, order: window.__shelfOrder(), look: window.__shelfState().look,
        looks: [...document.querySelectorAll("#looks button")].map(x => x.dataset.look), ringfloor: !!document.getElementById("ringfloor"),
        front: window.__shelfState().title };
    })()`;

    // A device that had the carousel: the covers. The looks are covers and spines.
    let page = await open(`localStorage.setItem("rra-shelf-look", "ring");`);
    let r = await page.eval(STATE);
    assert.deepEqual(r.looks, ["covers", "spines"]);
    assert.equal(r.ringfloor, false, "no carousel's floor");
    assert.equal(r.look, "covers", "the carousel kept from before: the covers");
    assert.equal(r.tag, "BUTTON");
    assert.equal(r.label, "A → Z by artist");
    assert.deepEqual(r.order, byArtist, "by artist, as the server sends it");

    // Moved on to an album, then switched: by album, the same album still in front.
    r = await page.eval(`(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      document.getElementById("stage").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      for (let i = 0; i < 100 && window.__shelfState().mode !== "idle"; i++) await sleep(50);
      const before = window.__shelfState().title;
      document.getElementById("shelf-order").click();
      return { before, after: window.__shelfState().title, label: document.getElementById("shelf-order").textContent, order: window.__shelfOrder() };
    })()`);
    assert.equal(r.label, "A → Z by album");
    assert.deepEqual(r.order, byAlbum, "by title: the number first, \"The\" aside");
    assert.equal(r.after, r.before, "the album in front stays in front");
    assert.deepEqual(page.errors, []);

    // Kept on this device: the next visit opens by album; switched back, by artist.
    page = await open();
    r = await page.eval(STATE);
    assert.equal(r.label, "A → Z by album");
    assert.deepEqual(r.order, byAlbum);
    r = await page.eval(`(() => { document.getElementById("shelf-order").click(); return { label: document.getElementById("shelf-order").textContent, order: window.__shelfOrder() }; })()`);
    assert.equal(r.label, "A → Z by artist");
    assert.deepEqual(r.order, byArtist);

    // Random order: the name says so, and doesn't switch anything.
    r = await page.eval(`(() => { document.querySelector('.tab[data-tab="random"]').click(); document.querySelector('.tile[data-cat="random"][data-id="order"]').click();
      const o = document.getElementById("shelf-order"); return { label: o.textContent, disabled: o.disabled }; })()`);
    assert.deepEqual(r, { label: "Random order", disabled: true });
    assert.deepEqual(page.errors, []);
  } finally { await b.close(); await srv.stop(); }
});
