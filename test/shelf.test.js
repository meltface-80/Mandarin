"use strict";
/*
 * Shelf (/shelf), ported from Rouen (MusicD Remote v1.9.3):
 *   - lib/shelf.js: the letter an artist is filed under, the list in artist
 *     order with each album's genres, the signature;
 *   - /api/shelf/albums: the whole library, and "the same" for a signature
 *     still current (the C# server's answer is held to this one in
 *     test/library-front.test.js);
 *   - the page in a real browser, against the real server and a fake Sonos
 *     household: no pinch zoom, the gesture legend gone and said once in a
 *     first-use popup instead, the remote's transport bar fixed and flat at
 *     the shelf's foot (play/pause, volume, the zone, the playing record
 *     brought to the front), and choosing what is on the shelf.
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
  const al = (id, title, artist, sortArtist, genres) => ({ id, title, artist, sortArtist, genres, image_key: "al-" + id + "-0" });
  const shelf = Shelf.buildShelf([
    al(1, "Abbey Road", "The Beatles", "beatles", ["Rock", "Pop"]),
    al(2, "Homogenic", "Björk", "bjork", ["Electronic"]),
    al(3, "Kind of Blue", "Miles Davis", "miles davis", ["Jazz"]),
    al(4, "Discovery", "Daft Punk", "daft punk", ["Electronic", "Electronic", ""]),
    al(5, "Untitled", "!!!", "", [])
  ]);
  assert.deepEqual(shelf.genres, [{ name: "Electronic", count: 2 }, { name: "Jazz", count: 1 }, { name: "Pop", count: 1 }, { name: "Rock", count: 1 }]);
  assert.deepEqual(shelf.albums[0], { o: 1, t: "Abbey Road", a: "The Beatles", k: "al-1-0", g: [2, 3], b: "B" });
  assert.deepEqual(shelf.albums.map(a => a.g), [[2, 3], [0], [1], [0], []], "a genre once per album, empty names left out");
  assert.deepEqual(shelf.albums.map(a => a.b), ["B", "B", "M", "D", "#"]);
  const sig = Shelf.shelfSignature(shelf);
  assert.match(sig, /^[0-9a-f]{16}$/);
  assert.equal(Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Rock", "Pop"])])),
    Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Pop", "Rock"])])), "the same shelf, the same signature");
  assert.notEqual(Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road", "The Beatles", "beatles", ["Rock"])])),
    Shelf.shelfSignature(Shelf.buildShelf([al(1, "Abbey Road (Remaster)", "The Beatles", "beatles", ["Rock"])])), "a new title, a new signature");
});

// The library: makeLibrary's three albums and seven more, across genres and letters.
function library() {
  const lib = makeLibrary();
  const more = [["The Beatles", "Abbey Road", "Rock"], ["Björk", "Homogenic", "Electronic"], ["Miles Davis", "Kind of Blue", "Jazz"],
    ["10cc", "The Original Soundtrack", "Rock"], ["!!!", "Myth Takes", "Dance"], ["Daft Punk", "Discovery", "Electronic"], ["Nina Simone", "Pastel Blues", "Jazz"]];
  for (const [artist, album, genre] of more) {
    gen(path.join(lib.music, artist, album, "01 x.flac"), { seconds: 1, tags: { title: album + " one", artist, album, track: 1, genre, date: "1990" } });
  }
  return lib;
}

// Before the page's own scripts: every POST written down, and any address
// answered with a stand-in (window.__fake) or refused (window.__fail).
const INIT = `(() => {
  window.__log = []; window.__fake = {}; window.__fail = {};
  const real = window.fetch.bind(window);
  const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (init && init.method === "POST") window.__log.push({ path: url.pathname, body: init.body ? JSON.parse(init.body) : null });
    if (window.__fail[url.pathname]) return json({ error: "Refused: " + url.pathname }, window.__fail[url.pathname]);
    if (window.__fake[url.pathname]) return json(window.__fake[url.pathname], 200);
    return real(input, init);
  };
})();`;

const HELPERS = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = s => document.querySelector(s);
  const shown = s => { const e = $(s); return !!e && !e.classList.contains("hidden") && getComputedStyle(e).display !== "none"; };
  const posts = p => window.__log.filter(x => x.path === p).map(x => x.body);
  const poll = () => document.dispatchEvent(new Event("visibilitychange"));   // the page asks for the zone again
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
        assert.equal(first.items.length, 4);
        assert.match(first.items[0], /^Swipe moves one album/);
        assert.match(first.items[3], /^Tap a cover at the side/);
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
        const tile = (cat, label) => [...document.querySelectorAll('.tile[data-cat="' + cat + '"]')].find(t => t.textContent.includes(label));
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
