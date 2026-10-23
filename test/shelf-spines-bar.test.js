"use strict";
/*
 * Shelf (bug list item 149, as Rouen's v1.9.66-t2): in the Spines look, a case turning as the shelf moves is whole over
 * the spines beside it, never cut through by them (the cases are drawn one over another, nearest the front on top,
 * not cut by one another in a shared depth); and tracks chosen on the back of a case are played from the bar, where
 * the album's own Play now and Queue were, the bar's parts all on screen, none over another, and the bar no taller.
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

function library() {
  const lib = makeLibrary();
  const more = [["The Beatles", "Abbey Road", 1969], ["Björk", "Homogenic", 1997], ["Miles Davis", "Kind of Blue", 1959],
    ["10cc", "The Original Soundtrack", 1975], ["!!!", "Myth Takes", 2007], ["Daft Punk", "Discovery", 2001], ["Nina Simone", "Pastel Blues", 1965]];
  for (const [artist, album, year] of more) {
    gen(path.join(lib.music, artist, album, "01 x.flac"), { seconds: 1, tags: { title: album + " one", artist, album, track: 1, genre: "Rock", date: String(year) } });
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

test("Shelf: spines never through a turning case; chosen tracks played from the bar", { skip, timeout: 240000 }, async (t) => {
  const lib = library();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    await fetch(B + "/api/settings/shelf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled: true }) });
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

    for (const [name, size] of [["a wide screen", { width: 1440, height: 900 }], ["a tablet", { width: 1024, height: 768 }], ["a phone", { width: 390, height: 844 }]]) {
      await t.test(`the bar, on ${name}: tracks chosen are played from it, its parts on screen and apart, its height the same`, async () => {
        const r = await at(size, "covers", (page) => page.eval(`(async () => { ${READY}
          const box = (el) => el.getBoundingClientRect();
          const parts = () => [".mt-transport", "#mt-info", "#actions", "#tsel", ".mt-controls"].map(s => [s, $(s)])
            .filter(([, e]) => e && !e.classList.contains("hidden") && getComputedStyle(e).display !== "none").map(([s, e]) => [s, box(e)]);
          const before = { h: box($("#mt")).height, stage: box(stage).bottom, bar: box($("#mt")).top };
          const front = () => [...document.querySelectorAll('.it[data-v="' + Math.round(S().p) + '"]')].find(e => e.getBoundingClientRect().width > 0);
          await until(() => front());
          const m = box(front()), id = ++pid;
          pe("pointerdown", m.left + m.width / 2, m.top + m.height / 2, id); pe("pointerup", m.left + m.width / 2, m.top + m.height / 2, id);
          await until(() => document.querySelector(".it.flipped .bk-tracks li[data-i]"));
          await sleep(900);
          const li = document.querySelector('.it.flipped li[data-i="0"]').getBoundingClientRect(), id2 = ++pid;
          pe("pointerdown", li.left + li.width / 2, li.top + li.height / 2, id2); await sleep(650); pe("pointerup", li.left + li.width / 2, li.top + li.height / 2, id2);
          await until(() => S().picks.length === 1);
          await frame();
          const now = parts(), over = [], off = [];
          for (let i = 0; i < now.length; i++) {
            const [s, a] = now[i];
            if (a.left < -0.5 || a.right > innerWidth + 0.5 || a.top < -0.5 || a.bottom > innerHeight + 0.5) off.push(s);
            for (let j = i + 1; j < now.length; j++) {
              const [s2, b2] = now[j];
              if (a.left < b2.right - 0.5 && b2.left < a.right - 0.5 && a.top < b2.bottom - 0.5 && b2.top < a.bottom - 0.5) over.push(s + " over " + s2);
            }
          }
          const dbg = { width: innerWidth, parts: now.map(([s, b]) => s + " " + Math.round(b.left) + "–" + Math.round(b.right)).join(", ") };
          return { dbg, shown: now.map(([s]) => s), in: $("#tsel").parentElement.id, over, off, count: $("#tsel-count").textContent,
            h: box($("#mt")).height, before, stageToBar: Math.round(box($("#mt")).top - box(stage).bottom),
            buttons: [...document.querySelectorAll("#tsel [data-tact]")].map(b => b.dataset.tact) };
        })()`));
        assert.equal(r.in, "mt", "in the bar");
        assert.deepEqual(r.buttons, ["play_now", "play_next", "queue"]);
        assert.ok(r.shown.includes("#tsel") && !r.shown.includes("#actions"), "the chosen tracks' buttons in the album's place: " + r.shown);
        assert.deepEqual(r.over, [], "none over another");
        assert.deepEqual(r.off, [], "none off screen: " + JSON.stringify(r.dbg));
        assert.equal(Math.round(r.h), Math.round(r.before.h), "the bar no taller as tracks are chosen");
        assert.equal(r.stageToBar, 0, "nothing between the shelf and the bar");
        if (size.width > 440) assert.equal(r.count, "1 track chosen");
      });
    }
  } finally { await srv.stop(); }
});
