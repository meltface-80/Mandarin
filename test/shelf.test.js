"use strict";
/*
 * Shelf (/shelf), ported from Rouen (MusicD Remote v1.9.3, brought up to
 * v1.9.7 in v0.8.27):
 *   - lib/shelf.js: the letter an artist is filed under, the list in artist
 *     order with each album's genres and year, the signature;
 *   - /api/shelf/albums: the whole library with Mandarin's version, and "the
 *     same" for a signature still current (the C# server's answer is held to
 *     this one in test/library-front.test.js; the page and the list are C#'s,
 *     test/front.test.js);
 *   - the page in a real browser, against the real server and a fake Sonos
 *     household: no pinch zoom, the gesture legend gone and said once in a
 *     first-use popup instead, the remote's transport bar fixed and flat at
 *     the shelf's foot (play/pause, volume, the zone, the playing record
 *     brought to the front, previous and next), choosing what is on the
 *     shelf (decades too), choosing tracks on the back of the case, a set's
 *     discs under their own headings, the queue pane and the lane's fold.
 * The browser part is skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const Shelf = require("../lib/shelf");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const PORT = 3652;
const VERSION = require("../package.json").version;
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("the letter an artist is filed under", () => {
  assert.equal(Shelf.shelfBucket("beatles"), "B");
  assert.equal(Shelf.shelfBucket("Beatles, The"), "B");
  assert.equal(Shelf.shelfBucket("Ólafur Arnalds"), "O", "accents folded");
  assert.equal(Shelf.shelfBucket("10cc"), "1");
  assert.equal(Shelf.shelfBucket("0 Degrees"), "#", "0 is under #");
  assert.equal(Shelf.shelfBucket("!!!"), "#");
  assert.equal(Shelf.shelfBucket("Кино"), "#", "another script is under #");
  assert.equal(Shelf.shelfBucket("坂本龍一"), "#");
  assert.equal(Shelf.shelfBucket(""), "#");
  assert.equal(Shelf.shelfBucket(null), "#");
});

test("the shelf's list: genres commonest first, each album's genres as places in it", () => {
  const al = (id, title, artist, sortArtist, genres, year) => ({ id, title, artist, sortArtist, genres, image_key: "al-" + id + "-0", year });
  const shelf = Shelf.buildShelf([
    al(1, "Abbey Road", "The Beatles", "beatles", ["Rock", "Pop"], 1969),
    al(2, "Homogenic", "Björk", "bjork", ["Electronic"]),
    al(3, "Kind of Blue", "Miles Davis", "miles davis", ["Jazz"]),
    al(4, "Discovery", "Daft Punk", "daft punk", ["Electronic", "Electronic", ""]),
    al(5, "Untitled", "!!!", "", [])
  ]);
  assert.deepEqual(shelf.genres, [{ name: "Electronic", count: 2 }, { name: "Jazz", count: 1 }, { name: "Pop", count: 1 }, { name: "Rock", count: 1 }]);
  assert.deepEqual(shelf.albums[0], { o: 1, t: "Abbey Road", a: "The Beatles", k: "al-1-0", g: [2, 3], b: "B", y: 1969 });
  assert.deepEqual(shelf.albums.map(a => a.y), [1969, null, null, null, null], "no year: null");
  assert.deepEqual(shelf.albums.map(a => a.g), [[2, 3], [0], [1], [0], []], "a genre once per album, empty names left out");
  assert.deepEqual(shelf.albums.map(a => a.b), ["B", "B", "M", "D", "#"]);
  const sig = Shelf.shelfSignature(shelf);
  assert.match(sig, /^[0-9a-f]{16}$/);
  assert.equal(Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Rock", "Pop"])])),
    Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Pop", "Rock"])])), "the same shelf, the same signature");
  assert.notEqual(Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Rock"])])),
    Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road (Remaster)", "The Beatles", "beatles", ["Rock"])])), "a new title, a new signature");
  assert.notEqual(Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Rock"], 1969)])),
    Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Rock"], 2019)])), "a new year, a new signature");
});

// The library: makeLibrary's three albums (1997, 2020 and a set with no year)
// and seven more, across genres, letters and decades.
function library() {
  const lib = makeLibrary();
  const more = [["The Beatles", "Abbey Road", "Rock", 1969], ["Björk", "Homogenic", "Electronic", 1997], ["Miles Davis", "Kind of Blue", "Jazz", 1959],
    ["10cc", "The Original Soundtrack", "Rock", 1975], ["!!!", "Myth Takes", "Dance", 2007], ["Daft Punk", "Discovery", "Electronic", 2001],
    ["Nina Simone", "Pastel Blues", "Jazz", 1965]];
  for (const [artist, album, genre, year] of more) {
    gen(path.join(lib.music, artist, album, "01 x.flac"), { seconds: 1, tags: { title: album + " one", artist, album, track: 1, genre, date: String(year) } });
  }
  return lib;
}

// Before the page's own scripts: every POST written down, which server
// answered each request (window.__by), and any address answered with a
// stand-in (window.__fake) or refused (window.__fail).
const INIT = `(() => {
  window.__log = []; window.__fake = {}; window.__fail = {}; window.__by = [];
  const real = window.fetch.bind(window);
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (init && init.method === "POST") window.__log.push({ path: url.pathname, body: init.body ? JSON.parse(init.body) : null });
    if (window.__fail[url.pathname]) return json({ error: "Refused: " + url.pathname }, window.__fail[url.pathname]);
    if (window.__fake[url.pathname]) return json(window.__fake[url.pathname], 200);
    const r = await real(input, init);
    window.__by.push(url.pathname + " " + (r.headers.get("x-mandarin-answered") || "Node"));
    return r;
  };
})();`;

const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = s => document.querySelector(s);
  const shown = s => { const e = $(s); return !!e && !e.classList.contains("hidden") && getComputedStyle(e).display !== "none"; };
  const posts = p => window.__log.filter(x => x.path === p).map(x => x.body);
  const poll = () => document.dispatchEvent(new Event("visibilitychange"));   // the page asks for the zone again
  const tile = (cat, label) => [...document.querySelectorAll('.tile[data-cat="' + cat + '"]')].find(t => t.textContent.includes(label));
`;

// A finger on the shelf (as Rouen's own shelf tests drive it): taps, long
// presses, the case at the front turned over, and the rows on its back.
const DRIVE = `
  const S = () => window.__shelfState();
  const stage = $("#stage");
  let pid = 20;
  const pe = (type, x, y, id) => stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
  const tap = (x, y) => { const id = ++pid; pe("pointerdown", x, y, id); pe("pointerup", x, y, id); };
  const hold = async (x, y) => { const id = ++pid; pe("pointerdown", x, y, id); await sleep(650); pe("pointerup", x, y, id); await sleep(60); };
  const mid = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  // The cover on show at the front: a pooled one put away may still carry its number.
  const front = () => [...document.querySelectorAll('.it[data-v="' + Math.round(S().p) + '"]')].find(e => e.getBoundingClientRect().width > 0);
  const turnOver = async () => { await until(() => front(), 4000); const c = mid(front()); tap(c.x, c.y); await until(() => document.querySelector(".it.flipped .bk-tracks li"), 6000); await sleep(900); };
  const row = (i) => document.querySelector('.it.flipped li[data-i="' + i + '"]');
  const tapRow = async (i) => { const c = mid(row(i)); tap(c.x, c.y); await sleep(60); };
  const holdRow = async (i) => { const c = mid(row(i)); await hold(c.x, c.y); };
  const rows = () => [...document.querySelectorAll(".it.flipped .bk-tracks li")].map(li => li.classList.contains("bk-disc") ? "# " + li.textContent
    : (li.classList.contains("sel") ? "✓" : li.querySelector("i").textContent) + " " + li.querySelector("span").textContent);
`;

test("Shelf in a browser", { skip: (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)"), timeout: 180000 }, async (t) => {
  const lib = library();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"], upnpMulticast: false, identify: false });
  await srv.start();
  const b = await Browser.launch({ width: 1440, height: 900, mouse: true });
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 150; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 10 && !st.scan.running && st.zone_count >= 2) break;
      await sleep(100);
    }
    const open = (url = "/shelf") => b.page(B + url, { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT });
    const ready = `await until(() => window.__shelfState && window.__shelfState().N === 10 && document.getElementById("mt-zone").textContent === "Kitchen", 15000);`;

    await t.test("the list: the whole library in artist order, and the same for a signature still current", async () => {
      const j = await (await fetch(B + "/api/shelf/albums", { headers: H })).json();
      assert.equal(j.total, 10);
      assert.deepEqual(j.albums.map(a => a.b + " " + a.a), ["# !!!", "1 10cc", "A Artist A", "A Artist B", "B The Beatles", "B Björk", "D Daft Punk",
        "M Miles Davis", "N Nina Simone", "V Various Artists"]);
      assert.deepEqual(j.genres.map(g => g.name + " " + g.count), ["Jazz 3", "Rock 3", "Electronic 2", "Dance 1"]);
      assert.deepEqual(j.albums.map(a => a.y), [2007, 1975, 1997, 2020, 1969, 1997, 2001, 1959, 1965, null], "each album's year, null for none");
      assert.equal(j.version, VERSION, "Mandarin's version, for the help popup");
      assert.deepEqual(await (await fetch(B + "/api/shelf/albums?sig=" + j.sig, { headers: H })).json(), { same: true, sig: j.sig });
      const page = await fetch(B + "/shelf", { headers: H });
      assert.equal(page.status, 200);
      assert.match(await page.text(), /<title>Mandarin Shelf<\/title>/);
      // Signed out, the page sends you to sign in, and back.
      const out = await fetch(B + "/shelf", { redirect: "manual" });
      assert.equal(out.status, 302);
      assert.equal(out.headers.get("location"), "/login?next=%2Fshelf");
    });

    await t.test("no zoom: the viewport, double-tap and the pinch", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const ev = (e, on = document) => { on.dispatchEvent(e); return e.defaultPrevented; };
        const touch = (n) => { const ts = []; for (let i = 0; i < n; i++) ts.push(new Touch({ identifier: i, target: document.body, clientX: 100 + i * 50, clientY: 100 })); return new TouchEvent("touchmove", { touches: ts, cancelable: true, bubbles: true }); };
        return {
          viewport: $('meta[name="viewport"]').content,
          html: getComputedStyle(document.documentElement).touchAction, body: getComputedStyle(document.body).touchAction,
          stage: getComputedStyle($("#stage")).touchAction,
          gesture: ["gesturestart", "gesturechange", "gestureend"].map(n => ev(new Event(n, { cancelable: true }))),
          two: ev(touch(2), document.body), one: ev(touch(1), document.body),
          ctrlWheel: ev(new WheelEvent("wheel", { ctrlKey: true, deltaY: 10, cancelable: true, bubbles: true }), document.body),
          wheel: ev(new WheelEvent("wheel", { deltaY: 10, cancelable: true, bubbles: true }), document.body)
        };
      })()`);
      assert.match(r.viewport, /user-scalable=no/);
      assert.match(r.viewport, /viewport-fit=cover/);
      assert.doesNotMatch(r.viewport, /maximum-scale/);
      assert.equal(r.html, "manipulation");
      assert.equal(r.body, "manipulation");
      assert.equal(r.stage, "none", "the shelf keeps its own gestures");
      assert.deepEqual(r.gesture, [true, true, true], "WebKit's pinch stopped");
      assert.equal(r.two, true, "a two-finger move is stopped");
      assert.equal(r.one, false, "a one-finger move is not");
      assert.equal(r.ctrlWheel, true, "a trackpad pinch is stopped");
      assert.equal(r.wheel, false, "a plain wheel is not");
      assert.deepEqual(page.errors, []);
    });

    await t.test("the gestures: no legend on the shelf, said once in a popup — again after an update, never once ticked", async () => {
      const state = `JSON.parse(localStorage.getItem("rra-shelf-help") || "null")`;
      const look = (then) => `(async () => { ${HELPERS} ${ready} await sleep(600);
        const out = { help: shown("#help"), items: [...document.querySelectorAll("#help li")].map(li => li.textContent.trim()),
          focus: document.activeElement && document.activeElement.id, saved: ${state},
          legend: [...document.querySelectorAll("body *")].filter(e => !e.closest("#help") && /Swipe one album|keeps turning|Flick spins|turns it over/i.test(e.textContent) && !e.children.length).length };
        ${then || ""}
        out.after = ${state}; out.helpAfter = shown("#help");
        return out; })()`;
      {
        const first = await (await open()).eval(look(`$("#help-ok").click(); await sleep(100);`));
        assert.equal(first.help, true, "shown the first time");
        assert.equal(first.saved, null);
        assert.equal(first.focus, "help-ok", "Dismiss has the focus");
        assert.equal(first.items.length, 6);
        assert.match(first.items[0], /^Swipe moves one album/);
        assert.match(first.items[3], /^Tap a cover at the side/);
        assert.match(first.items[4], /^Hold a track on the back of the case to choose it/);
        assert.match(first.items[5], /tabs at the edges fold the choices away/);
        assert.equal(first.legend, 0, "nothing on the shelf itself says how it moves");
        assert.equal(first.helpAfter, false);
        assert.deepEqual(first.after, { seen: VERSION, never: false });
      }
      const again = await (await open()).eval(look());
      assert.equal(again.help, false, "not again on the same version");
      const updated = await (await open()).eval(`localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "0.0.1", never: false }))`).then(() => open());
      const r = await updated.eval(look(`$("#help-never").checked = true; document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await sleep(100);`));
      assert.equal(r.help, true, "again after an update");
      assert.equal(r.helpAfter, false, "Escape dismisses it");
      assert.deepEqual(r.after, { seen: VERSION, never: true });
      const ticked = await (await open()).eval(`localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "0.8.1", never: true }))`).then(() => open());
      assert.equal((await ticked.eval(look())).help, false, "never, once ticked — whatever the version");
    });

    await t.test("choosing: genres OR, letters narrow them, Undo and Reset", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const out = {};
        tile("genre", "Jazz").click(); tile("genre", "Rock").click();
        out.two = window.__shelfState().N; out.sum = $("#pick-sum").textContent; out.clear = shown("#sec-clear");
        $('.tab[data-tab="artist"]').click();
        out.counts = Object.fromEntries([...document.querySelectorAll(".t-letter")].filter(t => t.querySelector(".t-count").textContent !== "0").map(t => [t.dataset.id, +t.querySelector(".t-count").textContent]));
        tile("artist", "M").click();
        out.narrowed = window.__shelfOrder();
        out.reset = shown("#reset-all");
        out.chips = [...document.querySelectorAll(".chip")].map(c => c.textContent.replace("×", "").trim());
        tile("artist", "Z").click();
        out.orLetters = window.__shelfOrder();
        $("#reset-all").click();
        out.all = window.__shelfState().N;
        // Nothing left: said so, with Undo and Reset.
        $('.tab[data-tab="genre"]').click(); tile("genre", "Dance").click();
        $('.tab[data-tab="artist"]').click(); tile("artist", "M").click();
        out.empty = { note: shown("#note"), title: $("#note-title").textContent, why: $("#note-why").textContent, info: shown("#info") };
        $("#undo").click();
        out.undone = window.__shelfOrder();
        $("#note-reset").click();
        out.reset2 = window.__shelfState().N;
        return out; })()`);
      assert.equal(r.two, 6, "Jazz or Rock");
      assert.equal(r.sum, "6 of 10 albums on the shelf");
      assert.equal(r.clear, true, "Clear all with two chosen");
      assert.deepEqual(r.counts, { 1: 1, A: 2, B: 1, M: 1, N: 1 }, "a letter counts what the genres leave");
      assert.deepEqual(r.narrowed, ["Kind of Blue"]);
      assert.equal(r.reset, true);
      assert.deepEqual(r.chips, ["Jazz", "Rock", "ArtistsM"]);
      assert.deepEqual(r.orLetters, ["Kind of Blue"], "letters OR among themselves");
      assert.equal(r.all, 10, "Reset shelf");
      assert.deepEqual(r.empty, { note: true, title: "Nothing on this shelf", why: "No albums match Dance and artists under M.", info: false });
      assert.deepEqual(r.undone, ["Myth Takes"], "Undo takes back the last choice");
      assert.equal(r.reset2, 10);
      assert.deepEqual(page.errors, []);
    });

    await t.test("decades: a Years tab, newest first and Undated last; decades OR, and narrow genres and letters as they narrow them", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const out = {};
        const counts = (sel, name) => Object.fromEntries([...document.querySelectorAll(sel)].map(t => [t.querySelector(name).textContent, +t.querySelector(".t-count").textContent]));
        out.tabs = [...document.querySelectorAll(".tab")].map(t => t.textContent.trim());
        $('.tab[data-tab="year"]').click();
        out.tiles = [...document.querySelectorAll(".t-decade")].map(t => t.querySelector(".ch").textContent + " " + t.querySelector(".t-count").textContent);
        out.note = $("#sec-note").textContent;
        tile("year", "1960s").click();
        out.sixties = window.__shelfOrder();
        tile("year", "1990s").click();
        out.or = window.__shelfOrder();
        out.sum = $("#pick-sum").textContent; out.badge = $('.tab[data-tab="year"] .badge').textContent; out.note2 = $("#sec-note").textContent;
        out.chips = [...document.querySelectorAll(".chip")].map(c => c.textContent.replace("×", "").trim());
        $('.tab[data-tab="genre"]').click();
        out.genreCounts = counts(".t-genre", ".t-name");
        tile("genre", "Jazz").click();
        out.narrowed = window.__shelfOrder();
        $('.tab[data-tab="year"]').click();
        out.yearCounts = counts(".t-decade", ".ch");
        $("#reset-all").click();
        out.all = window.__shelfState().N;
        tile("year", "1950s").click();
        $('.tab[data-tab="genre"]').click(); tile("genre", "Dance").click();
        out.why = $("#note-why").textContent;
        $("#note-reset").click();
        $('.tab[data-tab="year"]').click(); tile("year", "Undated").click();
        out.undated = window.__shelfOrder();
        tile("year", "Undated").click(); tile("year", "1990s").click();
        $('.tab[data-tab="random"]').click();
        out.randomNote = $(".t-rand .t-note").textContent;
        $('.tile[data-cat="random"]').click();
        out.random = window.__shelfOrder().slice().sort();
        return out; })()`);
      assert.deepEqual(r.tabs, ["Genres", "Artists", "Years", "Random"]);
      assert.deepEqual(r.tiles, ["2020s 1", "2000s 2", "1990s 2", "1970s 1", "1960s 2", "1950s 1", "Undated 1"], "newest first, the albums with no year last");
      assert.equal(r.note, "Tap decades. Choose as many as you like.");
      assert.deepEqual(r.sixties, ["Abbey Road", "Pastel Blues"], "1960–1969, in artist order");
      assert.deepEqual(r.or, ["Album One", "Abbey Road", "Homogenic", "Pastel Blues"], "decades OR among themselves");
      assert.equal(r.sum, "4 of 10 albums on the shelf");
      assert.equal(r.badge, "2");
      assert.equal(r.note2, "2 decades chosen");
      assert.deepEqual(r.chips, ["1960s", "1990s"]);
      assert.deepEqual(r.genreCounts, { Jazz: 1, Rock: 2, Electronic: 1, Dance: 0 }, "a genre counts what the decades leave");
      assert.deepEqual(r.narrowed, ["Pastel Blues"], "a genre narrows the decades");
      assert.deepEqual(r.yearCounts, { "2020s": 1, "2000s": 0, "1990s": 0, "1970s": 0, "1960s": 1, "1950s": 1, Undated: 0 }, "a decade counts what the genres leave");
      assert.equal(r.all, 10, "Reset shelf clears the decades too");
      assert.equal(r.why, "No albums match the 1950s and Dance.");
      assert.deepEqual(r.undated, ["Best Of"]);
      assert.match(r.randomNote, /decades/);
      assert.deepEqual(r.random, ["Album One", "Homogenic"], "Random keeps to the decades chosen");
      assert.deepEqual(page.errors, []);
    });

    await t.test("the transport bar: square, flat, in the page's flow at the shelf's foot, full width", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const bar = $("#mt"), shelf = $("#shelf"), info = $("#info");
        const bb = bar.getBoundingClientRect(), sb = shelf.getBoundingClientRect(), ib = info.getBoundingClientRect();
        const cs = getComputedStyle(bar);
        return { position: cs.position, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, left: bb.left - sb.left, width: bb.width - sb.width,
          bottom: sb.bottom - bb.bottom, under: bb.top >= ib.bottom - 1, parent: bar.parentElement.id, last: [...shelf.children].filter(e => getComputedStyle(e).position !== "absolute").pop().id,
          zone: $("#mt-zone").textContent, title: $("#mt-title").textContent, oldLine: !!document.querySelector(".np-line, #np-line, .legend") };
      })()`);
      assert.equal(r.position, "relative", "not fixed, not floating");
      assert.equal(r.radius, "0px");
      assert.equal(r.shadow, "none");
      assert.equal(r.parent, "shelf");
      assert.equal(r.last, "mt", "the last thing in the shelf's column");
      assert.equal(Math.round(r.left), 0);
      assert.equal(Math.round(r.width), 0, "the shelf column's full width");
      assert.equal(Math.round(r.bottom), 0, "at its foot");
      assert.equal(r.under, true, "under the album's name and buttons");
      assert.equal(r.zone, "Kitchen");
      assert.equal(r.title, "Nothing playing");
      assert.equal(r.oldLine, false);
    });

    await t.test("Play now plays the album in front; the bar shows it, and pauses it", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const out = {};
        // Dance: one album on the shelf, so the one in front is known.
        [...document.querySelectorAll('.tile[data-cat="genre"]')].find(t => t.textContent.includes("Dance")).click();
        out.front = window.__shelfState().title;
        $('.act[data-act="play_now"]').click();
        await until(() => posts("/api/play").length);
        out.play = posts("/api/play")[0];
        out.toast = await until(() => /^Playing /.test($("#toast").textContent), 4000) && $("#toast").textContent;
        out.showing = await until(() => $("#mt-title").textContent === out.front + " one", 10000);
        out.label = $("#mt-pp").getAttribute("aria-label");
        out.artist = $("#mt-artist").textContent;
        $("#mt-pp").click();
        out.flipped = $("#mt-pp").getAttribute("aria-label");
        await until(() => posts("/api/control").length);
        out.control = posts("/api/control")[0];
        return out; })()`);
      assert.equal(r.front, "Myth Takes");
      assert.equal(r.play.kind, "play_now");
      assert.equal(r.play.zone_or_output_id, "RINCON_KITCHEN01400");
      assert.ok(Number.isInteger(r.play.offset), "the album's id");
      assert.equal(r.toast, "Playing " + r.front + " in Kitchen");
      assert.equal(r.showing, true, "the bar shows the track");
      assert.equal(r.label, "Pause", "Pause while it plays");
      assert.equal(r.flipped, "Play", "flipped at once");
      assert.deepEqual(r.control, { zone_or_output_id: "RINCON_KITCHEN01400", command: "playpause" });
      for (let i = 0; i < 40 && house.room("Kitchen").state !== "PAUSED_PLAYBACK"; i++) await sleep(100);
      assert.equal(house.room("Kitchen").state, "PAUSED_PLAYBACK", "the room paused");
      assert.deepEqual(page.errors, []);
    });

    await t.test("chosen tracks: Play now plays the first alone and queues the rest; previous and next move between them; the queue shows them and plays from one", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
        const out = {};
        // Rock by an artist under A: Album One alone, three tracks.
        tile("genre", "Rock").click(); $('.tab[data-tab="artist"]').click(); tile("artist", "A").click();
        await until(() => S().N === 1 && S().mode === "idle"); await sleep(300);
        out.front = S().title;
        await turnOver();
        out.rows = rows();
        await holdRow(0); await tapRow(2);
        out.picks = S().picks; out.count = $("#tsel-count").textContent; out.chosen = rows();
        document.querySelector('#tsel [data-tact="play_now"]').click();
        await until(() => posts("/api/play-track").length === 2);
        out.posts = posts("/api/play-track").map(b => [b.track, b.kind, b.title, b.only]);
        out.toast = await until(() => /^Playing /.test($("#toast").textContent)) && $("#toast").textContent;
        out.after = { picks: S().picks, popup: shown("#tsel") };
        out.playing = await until(() => $("#mt-title").textContent === "Song 1", 10000);
        out.prevOn = await until(() => !$("#mt-prev").disabled);
        out.nextOn = await until(() => !$("#mt-next").disabled);
        $("#mt-next").click();
        out.next = await until(() => $("#mt-title").textContent === "Song 3", 10000);
        out.nextOff = await until(() => $("#mt-next").disabled);
        // The queue, from the track playing on.
        $("#queue-tab").click();
        out.queueOpen = { state: S().queue, expanded: $("#queue-tab").getAttribute("aria-expanded") };
        await until(() => document.querySelectorAll("#q-list li.q-row").length >= 1, 6000);
        out.queue = [...document.querySelectorAll("#q-list li")].map(li => li.classList.contains("q-h") ? "# " + li.textContent : li.querySelector(".q-t").textContent);
        out.qzone = $("#q-zone").textContent;
        $("#mt-prev").click();
        out.prev = await until(() => $("#mt-title").textContent === "Song 1", 10000);
        out.queueAfter = await until(() => document.querySelectorAll("#q-list li.q-row").length === 2, 8000) &&
          [...document.querySelectorAll("#q-list li")].map(li => li.classList.contains("q-h") ? "# " + li.textContent : li.querySelector(".q-t").textContent);
        out.qsum = $("#q-sum").textContent;
        out.controls = posts("/api/control");
        // Play from here: a tap on a track to come offers it, its button plays from it.
        const up = [...document.querySelectorAll("#q-list li.q-row")].find(li => !li.classList.contains("now"));
        up.querySelector(".q-item").click();
        out.armed = up.classList.contains("armed");
        up.querySelector(".q-go").click();
        await until(() => posts("/api/play-from-here").length);
        out.fromHere = posts("/api/play-from-here");
        out.fromHereToast = await until(() => /^Playing from /.test($("#toast").textContent)) && $("#toast").textContent;
        out.jumped = await until(() => $("#mt-title").textContent === "Song 3", 10000);
        $("#queue-tab").click();
        out.queueClosed = { state: S().queue, expanded: $("#queue-tab").getAttribute("aria-expanded") };
        return out; })()`);
      assert.equal(r.front, "Album One");
      assert.deepEqual(r.rows, ["1 Song 1", "2 Song 2", "3 Song 3"], "one disc: no headings");
      assert.deepEqual(r.picks, [0, 2], "a long press chooses, a tap adds");
      assert.equal(r.count, "2 tracks chosen");
      assert.deepEqual(r.chosen, ["✓ Song 1", "2 Song 2", "✓ Song 3"]);
      assert.deepEqual(r.posts, [[0, "play_now", "Song 1", true], [2, "queue", "Song 3", true]], "the first alone, the rest queued behind it");
      assert.equal(r.toast, "Playing 2 tracks in Kitchen");
      assert.deepEqual(r.after, { picks: [], popup: false }, "then the choice is done");
      const titles = house.room("Kitchen").queue.map(q => (q.meta.match(/<dc:title>([^<]*)/) || [])[1]);
      assert.deepEqual(titles, ["Song 1", "Song 3"], "the room's queue: just the two chosen");
      assert.equal(r.playing, true);
      assert.equal(r.prevOn, true, "previous on while a queue plays");
      assert.equal(r.nextOn, true, "next on with a track to come");
      assert.equal(r.next, true, "next moved to the second chosen track");
      assert.equal(r.nextOff, true, "next off at the end of the queue");
      assert.deepEqual(r.queueOpen, { state: true, expanded: "true" });
      assert.deepEqual(r.queue, ["# Now playing", "Song 3"]);
      assert.equal(r.qzone, "Kitchen");
      assert.equal(r.prev, true, "previous moved back to the first");
      assert.deepEqual(r.queueAfter, ["# Now playing", "Song 1", "# Up next", "Song 3"], "the queue follows");
      assert.match(r.qsum, /^2 tracks/);
      assert.deepEqual(r.controls, [{ zone_or_output_id: "RINCON_KITCHEN01400", command: "next" }, { zone_or_output_id: "RINCON_KITCHEN01400", command: "previous" }]);
      assert.equal(r.armed, true, "a tap offers Play from here");
      assert.deepEqual(r.fromHere, [{ zone_or_output_id: "RINCON_KITCHEN01400", queue_item_id: 2 }]);
      assert.equal(r.fromHereToast, "Playing from Song 3");
      assert.equal(r.jumped, true, "the zone plays from there");
      assert.deepEqual(r.queueClosed, { state: false, expanded: "false" });
      assert.deepEqual(page.errors, []);
    });

    await t.test("a set: each disc under its own heading, numbered from 1", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
        $('.tab[data-tab="artist"]').click(); tile("artist", "V").click();
        await until(() => S().N === 1 && S().mode === "idle"); await sleep(300);
        const out = { front: S().title };
        await turnOver();
        out.rows = rows();
        return out; })()`);
      assert.equal(r.front, "Best Of");
      assert.deepEqual(r.rows, ["# Disc 1", "1 C1", "# Disc 2", "1 C2"]);
      assert.deepEqual(page.errors, []);
    });

    // From here the zone's state is a stand-in, so each case is exactly what it says.
    const zone = (np, volume, state = "playing") => JSON.stringify({ zone: { zone_id: "RINCON_KITCHEN01400", display_name: "Kitchen", state,
      outputs: [volume === undefined ? { volume: { type: "number", min: 0, max: 100, step: 2, value: 30, soft_limit: 60 } } : volume === null ? {} : { volume }],
      now_playing: np } });
    const np = (extra) => Object.assign({ line1: "So What", line2: "Miles Davis", line3: "Kind of Blue", image_key: null, length: 300, seek_position: 60 }, extra);

    await t.test("the progress line, a refused play/pause put back, and what a tap on the record does", async () => {
      const ids = (await (await fetch(B + "/api/shelf/albums", { headers: H })).json()).albums;
      const kob = ids.find(a => a.t === "Kind of Blue").o;
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const out = {};
        window.__fake["/api/zone-state"] = ${zone(np({}), undefined, "paused")}; poll();
        await until(() => $("#mt-title").textContent === "So What");
        const fill = () => parseFloat($("#mt-fill").style.width);
        out.progress = fill();
        out.label = $("#mt-pp").getAttribute("aria-label");
        window.__fail["/api/control"] = 503;
        $("#mt-pp").click();
        out.flipped = $("#mt-pp").getAttribute("aria-label");
        await until(() => /Refused/.test($("#toast").textContent));
        out.reverted = $("#mt-pp").getAttribute("aria-label");
        out.failToast = $("#toast").textContent;
        delete window.__fail["/api/control"];
        // Radio, or a stream: no album to find.
        window.__fake["/api/zone-state"] = ${zone(np({ line3: "" }))}; poll(); await sleep(300);
        $("#mt-info").click(); out.radio = $("#toast").textContent;
        // Nothing playing.
        window.__fake["/api/zone-state"] = ${zone(null)}; poll(); await until(() => $("#mt-title").textContent === "Nothing playing");
        $("#mt-info").click(); out.nothing = $("#toast").textContent;
        // An album on the shelf, by its id: brought to the front.
        window.__fake["/api/zone-state"] = ${zone(np({ album_offset: kob, line3: "A title the shelf doesn't have" }))}; poll(); await sleep(300);
        $("#mt-info").click();
        await until(() => window.__shelfState().mode === "idle" && window.__shelfState().title === "Kind of Blue", 4000);
        out.front = window.__shelfState().title;
        // One that isn't on this shelf.
        window.__fake["/api/zone-state"] = ${zone(np({ line3: "Not Here", line2: "Nobody" }))}; poll(); await sleep(300);
        $("#mt-info").click(); out.missing = $("#toast").textContent;
        return out; })()`);
      assert.ok(Math.abs(r.progress - 20) < 0.5, "60 s of 300: a fifth of the way (" + r.progress + ")");
      assert.equal(r.label, "Play", "paused: Play");
      assert.equal(r.flipped, "Pause", "flipped at once");
      assert.equal(r.reverted, "Play", "refused: put back");
      assert.equal(r.failToast, "Refused: /api/control", "and the reason said");
      assert.equal(r.radio, "What’s playing isn’t an album on this shelf");
      assert.equal(r.nothing, "Nothing is playing");
      assert.equal(r.front, "Kind of Blue");
      assert.equal(r.missing, "The playing record isn’t on this shelf");
      assert.deepEqual(page.errors, []);
    });

    await t.test("volume: from the value on screen, held under the soft limit; steps only where it has no level; off where fixed", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const out = {};
        const vols = () => posts("/api/volume");
        window.__fake["/api/zone-state"] = ${zone(np({}))}; poll();
        await until(() => $("#mt-title").textContent === "So What");
        $("#mt-vol-btn").click();
        out.open = shown("#vol");
        out.max = $("#vol-slider").max; out.value = $("#vol-slider").value;
        $("#vol-plus").click();
        await until(() => vols().length >= 1);
        out.plus = vols()[0];
        // A drag the poll hasn't caught up with: + steps from it.
        $("#vol-slider").value = "40"; $("#vol-slider").dispatchEvent(new Event("input", { bubbles: true }));
        await until(() => vols().some(v => v.value === 40));
        $("#vol-plus").click();
        await until(() => vols().some(v => v.value === 42));
        out.fromDrag = vols().slice(-1)[0];
        // At the soft limit: no further.
        $("#vol-slider").value = "58"; $("#vol-slider").dispatchEvent(new Event("input", { bubbles: true }));
        await until(() => vols().some(v => v.value === 58));
        $("#vol-plus").click(); await sleep(300); $("#vol-plus").click(); await sleep(300);
        out.capped = vols().slice(-2).map(v => v.value);
        // A press on the shelf closes the sheet.
        $("#stage").dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, button: 0, clientX: 10, clientY: 10, bubbles: true }));
        $("#stage").dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, button: 0, clientX: 10, clientY: 10, bubbles: true }));
        out.closedByShelf = !shown("#vol");
        // Steps only.
        window.__fake["/api/zone-state"] = ${zone(np({}), { type: "incremental", step: 1 })}; poll(); await sleep(300);
        $("#mt-vol-btn").click(); await sleep(50);
        out.incSlider = shown("#vol-slider");
        const before = vols().length;
        $("#vol-plus").click(); await until(() => vols().length > before);
        out.inc = vols().slice(-1)[0];
        // Fixed.
        window.__fake["/api/zone-state"] = ${zone(np({}), null)}; poll(); await sleep(300);
        out.fixed = $("#mt-vol-btn").disabled; out.fixedClosed = !shown("#vol");
        return out; })()`);
      assert.equal(r.open, true);
      assert.equal(r.max, "60", "the range ends at the soft limit");
      assert.equal(r.value, "30");
      assert.deepEqual(r.plus, { zone_or_output_id: "RINCON_KITCHEN01400", value: 32 }, "the shown value and a step");
      assert.deepEqual(r.fromDrag, { zone_or_output_id: "RINCON_KITCHEN01400", value: 42 }, "from the dragged value");
      assert.deepEqual(r.capped, [60, 60], "+ stops at the soft limit");
      assert.equal(r.closedByShelf, true);
      assert.equal(r.incSlider, false, "no slider without a level");
      assert.deepEqual(r.inc, { zone_or_output_id: "RINCON_KITCHEN01400", value: 1, how: "relative" });
      assert.equal(r.fixed, true, "a fixed volume: the button off");
      assert.equal(r.fixedClosed, true);
      assert.deepEqual(page.errors, []);
    });

    await t.test("previous and next: beside play/pause, on only where the zone allows, and a refusal said", async () => {
      const allowed = (prev, next) => zone(np({})).replace('"state":"playing"', `"state":"playing","is_previous_allowed":${prev},"is_next_allowed":${next}`);
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const out = {};
        const box = (s) => $(s).getBoundingClientRect();
        out.order = [...$(".mt-transport").children].map(b => b.id);
        out.row = Math.abs(box("#mt-prev").top - box("#mt-pp").top) < 1 && Math.abs(box("#mt-next").top - box("#mt-pp").top) < 1
          && box("#mt-prev").right <= box("#mt-pp").left && box("#mt-pp").right <= box("#mt-next").left && box("#mt-next").right <= box("#mt-info").left;
        out.labels = [$("#mt-prev").getAttribute("aria-label"), $("#mt-next").getAttribute("aria-label")];
        window.__fake["/api/zone-state"] = ${allowed(false, false)}; poll();
        await until(() => $("#mt-title").textContent === "So What");
        out.off = [$("#mt-prev").disabled, $("#mt-next").disabled];
        window.__fake["/api/zone-state"] = ${allowed(true, false)}; poll();
        await until(() => !$("#mt-prev").disabled);
        out.prevOnly = [$("#mt-prev").disabled, $("#mt-next").disabled];
        window.__fake["/api/zone-state"] = ${allowed(true, true)}; poll();
        await until(() => !$("#mt-next").disabled);
        out.both = [$("#mt-prev").disabled, $("#mt-next").disabled];
        window.__fail["/api/control"] = 409;
        $("#mt-next").click();
        await until(() => /Refused/.test($("#toast").textContent));
        out.toast = $("#toast").textContent;
        out.title = $("#mt-title").textContent;
        out.sent = posts("/api/control");
        window.__fake["/api/zone-state"] = { zone: null }; poll();
        await until(() => $("#mt-title").textContent === "");
        out.gone = [$("#mt-prev").disabled, $("#mt-next").disabled];
        return out; })()`);
      assert.deepEqual(r.order, ["mt-prev", "mt-pp", "mt-next"]);
      assert.equal(r.row, true, "in a row, left of what is playing");
      assert.deepEqual(r.labels, ["Previous track", "Next track"]);
      assert.deepEqual(r.off, [true, true], "neither, where the zone allows neither");
      assert.deepEqual(r.prevOnly, [false, true]);
      assert.deepEqual(r.both, [false, false]);
      assert.equal(r.toast, "Refused: /api/control", "the reason said");
      assert.equal(r.title, "So What", "nothing guessed at on screen");
      assert.deepEqual(r.sent, [{ zone_or_output_id: "RINCON_KITCHEN01400", command: "next" }]);
      assert.deepEqual(r.gone, [true, true], "no zone: both off");
      assert.deepEqual(page.errors, []);
    });

    await t.test("the lane folds away to the left by its tab, and is remembered", async () => {
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready}
        const out = { open: window.__shelfState().pick, expanded: $("#pick-tab").getAttribute("aria-expanded") };
        const w = $("#stage").getBoundingClientRect().width;
        $("#pick-tab").click();
        const wider = await until(() => $("#stage").getBoundingClientRect().width > w + 100, 4000);
        out.folded = { pick: window.__shelfState().pick, expanded: $("#pick-tab").getAttribute("aria-expanded"), wider };
        return out; })()`);
      assert.deepEqual(r, { open: true, expanded: "true", folded: { pick: false, expanded: "false", wider: true } });
      const again = await open();
      assert.equal(await again.eval(`(async () => { ${HELPERS} ${ready} return window.__shelfState().pick; })()`), false, "still folded");
      await again.eval(`(async () => { ${HELPERS} ${ready} $("#pick-tab").click(); await until(() => window.__shelfState().pick); await sleep(300); return true; })()`);
      assert.equal(await (await open()).eval(`(async () => { ${HELPERS} ${ready} return window.__shelfState().pick; })()`), true, "and open again");
    });

    // v0.8.28: through the C# server, the page asks the Node server for playback and nothing else.
    // Playback (the rooms, their queues, the transport) is the Node server's until stage 6.
    await t.test("through the C# server: only playback is asked of the Node server", { skip: process.env.MANDARIN_FRONT !== "1" && "the suite isn't going through the C# server" }, async () => {
      const PLAYBACK = ["/api/zones", "/api/zone-state", "/api/queue", "/api/control", "/api/play", "/api/play-track", "/api/play-from-here", "/api/volume"];
      const page = await open();
      const r = await page.eval(`(async () => { ${HELPERS} ${ready} ${DRIVE}
        $('.tab[data-tab="year"]').click(); tile("year", "1990s").click();
        await until(() => S().N === 2 && S().mode === "idle"); await sleep(300);
        await turnOver();
        $("#queue-tab").click(); await until(() => document.querySelectorAll("#q-list li").length, 6000);
        $("#queue-tab").click();
        $("#mt-pp").click(); await until(() => posts("/api/control").length); await sleep(500);
        return [...new Set(window.__by)].sort(); })()`);
      const node = r.filter(x => x.endsWith(" Node")).map(x => x.slice(0, -5));
      const csharp = r.filter(x => x.endsWith(" C#")).map(x => x.slice(0, -3));
      assert.deepEqual(node.filter(p => !PLAYBACK.includes(p)), [], "nothing but playback from the Node server: " + JSON.stringify(r));
      for (const p of ["/api/shelf/albums", "/api/album", "/api/settings/display"]) assert.ok(csharp.includes(p), p + " answered by C#: " + JSON.stringify(r));
      for (const p of ["/api/zones", "/api/zone-state", "/api/queue", "/api/control"]) assert.ok(node.includes(p), p + " asked, and still the Node server's: " + JSON.stringify(r));
      const shelfPage = await fetch(B + "/shelf", { headers: H });
      assert.equal(shelfPage.headers.get("x-mandarin-answered"), "C#", "the page itself");
      assert.deepEqual(page.errors, []);
    });

    await t.test("the wall display offers Shelf, and Shelf the wall display while it is on", async () => {
      const wall = async (enabled) => assert.equal((await fetch(B + "/api/settings/display", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled }) })).status, 200);
      await wall(false);
      const off = await open();
      assert.equal(await off.eval(`(async () => { ${HELPERS} ${ready} await sleep(300); return shown("#to-wall"); })()`), false, "the wall display is off");
      await wall(true);
      const on = await open("/shelf?zone=Kitchen");
      assert.equal(await on.eval(`(async () => { ${HELPERS} ${ready} await until(() => shown("#to-wall")); $("#to-wall").click(); return true; })()`), true);
      const at = async (where) => { for (let i = 0; i < 80; i++) { await sleep(100); try { if (await on.eval("location.pathname + ':' + document.readyState") === where + ":complete") return; } catch (e) { /* navigating */ } } };
      await at("/display");
      assert.equal(await on.eval("location.pathname + location.search"), "/display?zone=Kitchen", "the zone goes along");
      assert.equal(await on.eval(`!!document.getElementById("to-shelf")`), true);
      await on.eval(`document.getElementById("to-shelf").click()`).catch(() => {});
      await at("/shelf");
      assert.equal(await on.eval("location.pathname + location.search"), "/shelf?zone=Kitchen");
    });
  } finally {
    await b.close();
    await srv.stop();
    await house.stop();
  }
});
