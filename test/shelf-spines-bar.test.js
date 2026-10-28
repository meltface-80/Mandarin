"use strict";
/*
 * Shelf (bug list item 149, as Rouen's v1.9.66-t2): a case turning as the shelf moves is whole over the spines beside
 * it, never cut through by them (the cases are drawn one over another, nearest the front on top, not cut by one
 * another in a shared depth). Item 206 (Rouen v1.9.67 to v1.9.69-t1): the spines the one look, each in one line —
 * the artist, the album and its version down from the top, the format, the year and the catalogue number up from the
 * foot, on a phone too; a phone held upright shows the case in front as a tall card; the album view's chosen tracks
 * played from under its cover, its parts on screen and apart; the Labels and Types tiles and the label and catalogue
 * orders; and on a phone the choices full screen, Show N albums taking them away.
 *
 * The spines are proved in the picture itself: the fronts painted green and the spines red, the shelf held halfway
 * between two albums on a tablet and on a phone, a screenshot taken, and the row across the covers found in it. No
 * red may show between the two turning covers. The browser half is skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const zlib = require("zlib");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A PNG (8-bit RGB or RGBA, not interlaced, as Chrome takes them) → { w, h, at(x, y) → [r, g, b] }.
function png(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20), type = buf[25];
  const bpp = type === 6 ? 4 : 3;
  const parts = [];
  for (let at = 8; at < buf.length;) {
    const len = buf.readUInt32BE(at), kind = buf.toString("ascii", at + 4, at + 8);
    if (kind === "IDAT") parts.push(buf.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(parts)), stride = w * bpp, px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[y * stride + i - bpp] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = y && i >= bpp ? px[(y - 1) * stride + i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + i] = (row[i] + pred) & 255;
    }
  }
  return { w, h, at: (x, y) => [px[y * stride + x * bpp], px[y * stride + x * bpp + 1], px[y * stride + x * bpp + 2]] };
}
const green = ([r, g, b]) => g > 200 && r < 60 && b < 60;
const red = ([r, g, b]) => r > 200 && g < 60 && b < 60;

// makeLibrary's three albums and seven more, four with a label and a catalogue number, one with a version in its title.
function library() {
  const lib = makeLibrary();
  const more = [["The Beatles", "Abbey Road", 1969, "Apple", "PCS 7088"], ["Björk", "Homogenic", 1997, "One Little Indian", "TPLP71"],
    ["Miles Davis", "Kind of Blue", 1959, "Columbia", "CL 1355"], ["10cc", "The Original Soundtrack", 1975], ["!!!", "Myth Takes", 2007],
    ["Daft Punk", "Discovery (Deluxe Edition)", 2001, "Virgin", "V2940"], ["Nina Simone", "Pastel Blues", 1965]];
  for (const [artist, album, year, label, catalognumber] of more) {
    const tags = Object.assign({ title: album + " one", artist, album, track: 1, genre: "Rock", date: String(year) }, label ? { label, catalognumber } : {});
    gen(path.join(lib.music, artist, album, "01 x.flac"), { seconds: 1, tags });
  }
  return lib;
}

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

// In the page: the shelf ready, its help put away, at rest on an album.
const READY = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out: " + fn); await sleep(50); } };
  const $ = s => document.querySelector(s);
  const S = () => window.__shelfState();
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await until(() => window.__shelfState && S().N === 10);
  await sleep(300);
  if ($("#help") && !$("#help").classList.contains("hidden")) $("#help-ok").click();
  await until(() => S().mode === "idle");
  const stage = $("#stage");
  let pid = 40;
  const pe = (type, x, y, id) => stage.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch", isPrimary: true }));
`;

test("Shelf: spines never through a turning case; one line along each spine; the album view's chosen tracks; labels, types and the phone", { skip, timeout: 300000 }, async (t) => {
  const lib = library();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    await fetch(B + "/api/settings/shelf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled: true }) });
    await fetch(B + "/api/settings/labels", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled: true }) });
    for (let i = 0; i < 150; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 10 && !st.scan.running) break;
      await sleep(100);
    }
    const at = async (size, look, fn) => {
      const b = await Browser.launch(Object.assign({ mouse: true }, size));
      try {
        const page = await b.page(B + "/shelf", { cookies: [{ name: "musicd_session", value: token, url: B }], init: `localStorage.setItem("rra-shelf-look", "${look}"); localStorage.setItem("rra-shelf-help", JSON.stringify({ seen: "0", never: true }));` });
        return await fn(page);
      } finally { await b.close(); }
    };

    for (const [name, size] of [["a tablet", { width: 1180, height: 820 }], ["a phone", { width: 390, height: 844 }]]) {
      await t.test(`spines, on ${name}: the shelf held halfway between two albums shows no spine through the turning covers`, async () => {
        const shot = await at(size, "spines", async (page) => {
          const r = await page.eval(`(async () => { ${READY}
            const style = document.createElement("style");
            style.textContent = ".it .front { background: #00ff00 !important; box-shadow: none !important; } .it .front > * { visibility: hidden !important; }" +
              ".it .side { background: #ff0000 !important; box-shadow: none !important; } .it .side > * { visibility: hidden !important; }";
            document.head.appendChild(style);
            const b = stage.getBoundingClientRect(), x = b.left + b.width / 2, y = b.top + b.height / 2, id = ++pid;
            // Half an album's swipe and held there, the finger still down.
            pe("pointerdown", x, y, id); await frame();
            for (let i = 1; i <= 5; i++) { pe("pointermove", x - S().swipe / 2 * i / 5, y, id); await frame(); }
            await sleep(300); await frame();
            return { look: S().look, p: S().p, mode: S().mode };
          })()`);
          const cap = await page.send("Page.captureScreenshot", { format: "png" });
          return Object.assign(r, { img: png(Buffer.from(cap.data, "base64")), errors: page.errors });
        });
        assert.equal(shot.look, "spines");
        assert.ok(Math.abs(shot.p - Math.round(shot.p) - 0.5) < 0.05 || Math.abs(shot.p - Math.round(shot.p) + 0.5) < 0.05, "held halfway: " + shot.p);
        // The row across the covers, found in the picture: the one with the most green.
        const { img } = shot;
        let best = -1, most = 0;
        for (let y = 0; y < img.h; y++) {
          let n = 0;
          for (let x = 0; x < img.w; x++) if (green(img.at(x, y))) n++;
          if (n > most) { most = n; best = y; }
        }
        assert.ok(most > img.w * 0.1, "the two covers are in the picture: " + most + " green on row " + best);
        let first = -1, last = -1;
        for (let x = 0; x < img.w; x++) if (green(img.at(x, best))) { if (first < 0) first = x; last = x; }
        const through = [];
        for (let x = first; x <= last; x++) if (red(img.at(x, best))) through.push(x);
        assert.deepEqual(through.length, 0, `no spine through the turning covers (${first}–${last} on row ${best}): red at ${through.slice(0, 8).join(", ")}`);
        assert.deepEqual(shot.errors, []);
      });
    }

    const TURN = `
      const box = (el) => (typeof el === "string" ? $(el) : el).getBoundingClientRect();
      const front = () => [...document.querySelectorAll('.it[data-v="' + Math.round(S().p) + '"]')].find(e => e.getBoundingClientRect().width > 0);
      const viewOpen = () => !$("#open").classList.contains("hidden") && $("#open").classList.contains("on");
      const turnOver = async () => { await until(() => front()); const m = box(front()), id = ++pid;
        pe("pointerdown", m.left + m.width / 2, m.top + m.height / 2, id); pe("pointerup", m.left + m.width / 2, m.top + m.height / 2, id);
        // the library's album view in its frame (item 218), its album up with its tracks
        const fd = () => { const f = document.querySelector("#open iframe"); return f && f.contentDocument; };
        await until(() => viewOpen() && fd() && fd().querySelector("#album-modal:not(.hidden) #modal-tracks li.t-row"), 20000); await sleep(600); };
      const goTo = async (title) => { for (let k = 0; k < 12 && S().title !== title; k++) { stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); await until(() => S().mode === "idle"); } };
    `;

    for (const [name, size] of [["a wide screen", { width: 1440, height: 900 }], ["a tablet", { width: 1024, height: 768 }], ["a phone", { width: 390, height: 844 }]]) {
      await t.test(`the album view, on ${name}: the library's (item 218), over the whole screen down to the bar; the bar no taller`, async () => {
        const r = await at(size, "covers", (page) => page.eval(`(async () => { ${READY} ${TURN}
          const before = { h: box("#mt").height };
          await turnOver();
          await frame();
          const f = box("#open iframe"), o = box("#open");
          return { h: box("#mt").height, before, stageToBar: Math.round(box("#mt").top - box(stage).bottom),
            viewToBar: box("#mt").top - o.bottom, fills: Math.round(f.width - o.width) + Math.round(f.height - o.height), left: Math.round(o.left), width: Math.round(o.width - innerWidth) };
        })()`));
        assert.equal(Math.round(r.h), Math.round(r.before.h), "the bar no taller with the album open");
        assert.equal(r.stageToBar, 0, "nothing between the shelf and the bar");
        // the view ends where the bar's height, as offsetHeight rounds it, says: within the pixel
        assert.ok(Math.abs(r.viewToBar) < 1, "the view ends at the bar: " + r.viewToBar);
        assert.deepEqual([r.fills, r.left, r.width], [0, 0, 0], "the library's album view filling it, across the whole screen");
      });
    }

    for (const [name, size] of [["a tablet", { width: 1180, height: 820 }], ["a phone", { width: 390, height: 844 }]]) {
      await t.test(`the spines, on ${name}: one line each, the artist, the album and its version down from the top; the format, the year and the catalogue № up from the foot`, async () => {
        const r = await at(size, "spines", (page) => page.eval(`(async () => { ${READY} ${TURN}
          await goTo("Abbey Road");
          // Discovery's spine: beside the front, drawn whole
          const sp = [...document.querySelectorAll(".it .side.r .sp")].find(e => e.querySelector(".sp-ar") && e.querySelector(".sp-ar").textContent === "Daft Punk");
          const txt = (c) => { const e = sp.querySelector(c); return e ? e.textContent : null; };
          const sb = sp.getBoundingClientRect(), cat = sp.querySelector(".sp-cat").getBoundingClientRect(), ar = sp.querySelector(".sp-ar").getBoundingClientRect();
          const tall = stage.classList.contains("tall"), card = front().querySelector(".card");
          return { ar: txt(".sp-ar"), ti: txt(".sp-ti"), vr: txt(".sp-vr"), fm: txt(".sp-fm"), yr: txt(".sp-yr"), cat: txt(".sp-cat"),
            catShown: getComputedStyle(sp.querySelector(".sp-cat")).display !== "none",
            ends: { top: ar.top - sb.top < sb.height * 0.2 || ar.left - sb.left < sb.width * 0.2, foot: Math.max(sb.bottom - cat.bottom, sb.right - cat.right) < sb.height * 0.12 },
            tall, card: tall ? { a: card.querySelector(".card-a").textContent, t: card.querySelector(".card-t").textContent, foot: [...card.querySelectorAll(".card-f span")].map(e => e.textContent),
              shown: getComputedStyle(card).display !== "none" } : null };
        })()`));
        assert.deepEqual([r.ar, r.ti, r.vr], ["Daft Punk", "Discovery", "Deluxe Edition"], "the artist, the album, its version");
        assert.deepEqual([r.fm, r.yr, r.cat], ["FLAC 16/44.1", "2001", "V2940"], "the format, the year, the catalogue №");
        assert.equal(r.catShown, true, "the catalogue № on every spine, a phone's too (Rouen v1.9.69-t1)");
        assert.equal(r.ends.foot, true, "the catalogue № pinned to the foot");
        // a stage taller than the cover is wide (a phone held upright; a tablet with the choices' lane open): a tall card
        assert.equal(r.tall, true, "the case in front a tall card");
        assert.deepEqual(r.card, { a: "The Beatles", t: "Abbey Road", foot: ["FLAC 16/44.1", "1969", "PCS 7088"], shown: true }, "its names in the spine's order");
      });
    }

    await t.test("Labels and Types: tiles that narrow the shelf; by label and catalogue №, and by catalogue № alone", async () => {
      const r = await at({ width: 1440, height: 900 }, "spines", (page) => page.eval(`(async () => { ${READY}
        const tiles = () => [...document.querySelectorAll("#tiles .tile")].map(t => (t.querySelector(".t-name, .ch") || t).textContent.trim() + " " + (t.querySelector(".t-count") || { textContent: "" }).textContent);
        const out = {};
        document.querySelector('.tab[data-tab="label"]').click(); out.labels = tiles();
        [...document.querySelectorAll('.tile[data-cat="label"]')].find(t => t.textContent.includes("Columbia")).click();
        out.columbia = window.__shelfOrder();
        [...document.querySelectorAll('.tile[data-cat="label"]')].find(t => t.textContent.includes("Columbia")).click();
        document.querySelector('.tab[data-tab="type"]').click(); out.types = tiles();
        [...document.querySelectorAll('.tile[data-cat="type"]')].find(t => t.textContent.includes("Compilation")).click();
        out.comps = window.__shelfOrder();
        [...document.querySelectorAll('.tile[data-cat="type"]')].find(t => t.textContent.includes("Compilation")).click();
        document.querySelector('.tab[data-tab="order"]').click();
        document.querySelector('.tile[data-cat="order"][data-id="label"]').click();
        out.byLabel = window.__shelfOrder().slice(0, 6);
        document.querySelector('.tile[data-cat="order"][data-id="catno"]').click();
        out.byCat = window.__shelfOrder();
        return out; })()`));
      assert.deepEqual(r.labels, ["Apple 1", "Blue Note 1", "Columbia 1", "One Little Indian 1", "Parlophone 1", "Virgin 1"], "a tile for each label, with its count");
      assert.deepEqual(r.columbia, ["Kind of Blue"]);
      assert.deepEqual(r.types, ["Compilations 1", "Unknown 9"], "the kinds the library has, then Unknown");
      assert.deepEqual(r.comps, ["Best Of"]);
      assert.deepEqual(r.byLabel, ["Abbey Road", "Hi Res", "Kind of Blue", "Homogenic", "Album One", "Discovery (Deluxe Edition)"],
        "each label together, in a shop's order; the unlabelled last");
      assert.deepEqual(r.byCat, ["Kind of Blue", "Abbey Road", "Homogenic", "Discovery (Deluxe Edition)",
        "Album One", "Best Of", "Hi Res", "Myth Takes", "Pastel Blues", "The Original Soundtrack"], "the numbers in order across every label, then the unnumbered (by title, as Rouen sorts them)");
    });

    await t.test("a phone: the choices full screen, Show N albums takes them away; a tablet keeps its side pull-out (Rouen v1.9.69-t1)", async () => {
      const phone = await at({ width: 390, height: 844 }, "spines", (page) => page.eval(`(async () => { ${READY}
        const box = (s) => $(s).getBoundingClientRect();
        const out = { start: S().pick };
        $("#pick-tab").click(); await until(() => S().pick); await sleep(450);
        const p = box("#pick");
        out.full = Math.round(p.left) <= 0 && Math.round(p.right) >= innerWidth && Math.round(p.top) <= 0 && Math.round(p.bottom) >= innerHeight - 1;
        [...document.querySelectorAll('.tile[data-cat="genre"]')].find(t => t.textContent.includes("Jazz")).click();
        out.done = $("#pick-done").textContent;
        $("#pick-done").click(); await until(() => !S().pick); await sleep(450);
        out.after = { pick: S().pick, N: S().N, kept: localStorage.getItem("rra-shelf-pick") };
        return out; })()`));
      assert.equal(phone.start, false, "a phone opens on the shelf");
      assert.equal(phone.full, true, "the choices over the whole screen");
      assert.equal(phone.done, "Show 1 album", "and say how many albums they leave");
      assert.deepEqual(phone.after, { pick: false, N: 1, kept: null }, "taken away; a phone keeps nothing of it");
      const tablet = await at({ width: 1180, height: 820 }, "spines", (page) => page.eval(`(async () => { ${READY}
        return { pick: S().pick, done: getComputedStyle($("#pick-done").closest(".pick-done-bar")).display, w: Math.round($("#pick").getBoundingClientRect().width) < innerWidth / 2 }; })()`));
      assert.deepEqual(tablet, { pick: true, done: "none", w: true }, "a tablet: the side pull-out, open, and no Show button");
    });
  } finally { await srv.stop(); }
});
