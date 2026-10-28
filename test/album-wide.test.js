"use strict";
/*
 * album-wide.test.js — the album view in three columns (item 214, the
 * owner's, after LMS's Material skin; public/app/album-wide.js and the
 * "three columns" section of style.css), in a browser:
 *   - a desktop and a tablet held sideways: the album over the whole screen,
 *     the cover, its head, its buttons and its credits and more on the left,
 *     About this album and about its artist in the middle, the tracks on the
 *     right; side by side, all ending above the mini player, the left and
 *     the right scrolling on their own; the middle fitted to the screen, the
 *     long words shortened under Read more, which opens the whole of both
 *     (Read less shortens them again);
 *   - a phone either way round and a tablet upright: as before, one column;
 *   - the album closed, or the window made narrow: every part back where it
 *     was, in its order.
 * Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

// The album's review and its artist's biography as their sources would give them (nothing leaves this machine in a test).
const REVIEW = "Album One is the first album by Artist A, recorded over a wet summer in a converted chapel. ".repeat(14);
const BIO = "Artist A is a singer and songwriter whose records mix soul, jazz and the odd drum machine. ".repeat(18);
const STUB = `(() => { const real = window.fetch.bind(window);
  const ok = (j) => Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } }));
  window.fetch = (u, o) => { const s = String(u);
    if (s.includes("/api/album/extras")) return ok({ album: { description: ${JSON.stringify(REVIEW)}, source: "Wikipedia", url: "https://en.wikipedia.org/wiki/Album_One" } });
    if (s.includes("/api/artist-bio")) return ok({ bio: { text: ${JSON.stringify(BIO)}, source: "Wikipedia" } });
    return real(u, o); }; })();`;

// Where each part is when the album is one column: its parent's id or class, and its place among the parent's children.
const HOMES = `(() => { const at = (sel) => { const el = document.querySelector(sel); const p = el && el.parentElement;
    return p ? (p.id || p.className) + "#" + [...p.children].indexOf(el) : null; };
  return [".modal-art", ".modal-head", "#modal-genres", "#modal-actions", "#album-credits", "#album-bio-section", "#album-artist-bio",
    "#album-more-by", "#album-lastfm-albums", ".track-list-wrap"].map(at); })()`;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, what, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("not in time: " + what); await sleep(30); } };
  const $ = s => document.querySelector(s);
  const box = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
  await until(() => document.querySelectorAll("#home-library .album").length > 1, "Home's albums");
  const before = ${HOMES};
  [...document.querySelectorAll("#home-library .album")].find(t => /Album One/.test(t.textContent)).click();
  await until(() => document.querySelectorAll("#modal-tracks li").length === 3, "the tracks");
  const m = $("#album-modal");
  const out = { wide: m.classList.contains("album-wide"), before, viewport: [innerWidth, innerHeight] };
  if (!out.wide) { out.cols = document.querySelectorAll(".aw-col").length; return out; }
  await until(() => !$("#album-artist-bio").classList.contains("hidden") && !$("#album-bio-section").classList.contains("hidden"), "the review and the biography");
  await until(() => box($("#album-modal .modal-panel")).t === 0, "the album slid into place");
  const col = (cls) => $(".aw-col." + cls);
  const has = (cls, sel) => !!col(cls).querySelector(sel);
  out.left = [".modal-art", ".modal-head", "#modal-genres", "#modal-actions", "#album-credits", "#album-more-by", "#album-more-appears", "#album-lastfm-artists", "#album-lastfm-albums"].every(s => has("aw-left", s));
  out.mid = has("aw-mid", "#album-bio-section") && has("aw-mid", "#album-artist-bio");
  out.right = has("aw-right", "#modal-tracks");
  out.order = [".modal-art", ".modal-head", "#modal-actions"].map(s => [...col("aw-left").children].indexOf($(s)));
  out.boxes = ["aw-left", "aw-mid", "aw-right"].map(c => box(col(c)));
  out.scroll = ["aw-left", "aw-right"].map(c => getComputedStyle(col(c)).overflowY);
  const mid = col("aw-mid");
  const reads = () => [...mid.querySelectorAll(".aw-read")].map(b => b.classList.contains("hidden") ? "" : b.textContent);
  await until(() => reads().join() === "Read more,Read more", "Read more under both");
  out.fits = mid.scrollHeight <= mid.clientHeight + 1;
  out.midOverflow = getComputedStyle(mid).overflowY;
  out.shortened = [...mid.querySelectorAll(".bio-text")].map(t => t.scrollHeight > t.clientHeight + 1);
  mid.querySelector(".aw-read").click();
  await until(() => reads().join() === "Read less,Read less", "Read less, reading");
  out.reading = { scrolls: mid.scrollHeight > mid.clientHeight, whole: [...mid.querySelectorAll(".bio-text")].every(t => t.scrollHeight <= t.clientHeight + 1) };
  mid.querySelector(".aw-read").click();
  await until(() => reads().join() === "Read more,Read more", "Read more again");
  out.fitsAgain = mid.scrollHeight <= mid.clientHeight + 1;
  out.panel = box($("#album-modal .modal-panel"));
  const bar = $("#mini-transport");
  out.miniTop = bar && !bar.classList.contains("hidden") ? Math.round(bar.getBoundingClientRect().top) : innerHeight;
  out.bioTitle = $("#album-artist-bio-title").textContent;
  out.bioText = $("#album-artist-bio-text").textContent.length;
  out.reviewWhole = getComputedStyle($("#album-bio-text")).maxHeight;
  out.reviewToggle = getComputedStyle($("#album-bio-toggle")).display;
  // Closed: every part back where it was.
  $("#modal-close-btn").click();
  await until(() => m.classList.contains("hidden"), "the album closed");
  await sleep(50);
  out.after = ${HOMES};
  out.colsAfter = document.querySelectorAll(".aw-col").length;
  out.wideAfter = m.classList.contains("album-wide");
  return out;
})()`;

test("the album view in three columns on a desktop and a tablet held sideways; one column on a phone and a tablet upright; its parts put back (item 214)", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json(); if (st.index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    for (const [w, h, touch, wide] of [[1440, 900, false, true], [1180, 820, true, true], [1024, 768, true, true], [820, 1180, true, false], [844, 390, true, false], [390, 844, true, false]]) {
      const size = `${w}x${h}${touch ? "" : " (a mouse)"}`;
      const b = await Browser.launch({ width: w, height: h, mouse: !touch });
      let r;
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch, init: STUB });
        r = await page.eval(DRIVER);
        assert.deepEqual(page.errors, [], size);
      } finally { await b.close(); }
      assert.equal(r.wide, wide, `${size}: ${wide ? "three columns" : "one column, as before"}`);
      if (!wide) { assert.equal(r.cols, 0, size + ": no columns"); continue; }
      assert.ok(r.left, size + ": the cover, the head, the buttons, the credits and more on the left");
      assert.deepEqual(r.order, [0, 1, 3], size + ": the cover, then the head, the genres, then the buttons");
      assert.ok(r.mid, size + ": About this album and about the artist in the middle");
      assert.ok(r.right, size + ": the tracks on the right");
      const [L, M, R] = r.boxes;
      assert.ok(L.r <= M.l + 1 && M.r <= R.l + 1 && L.l === 0 && R.r === w, `${size}: side by side across the screen (${JSON.stringify(r.boxes)})`);
      assert.ok(L.t === M.t && M.t === R.t && L.b === M.b && M.b === R.b, `${size}: the same height (${JSON.stringify(r.boxes)})`);
      assert.ok(M.b <= r.miniTop, `${size}: above the mini player (${M.b} over ${r.miniTop})`);
      assert.deepEqual(r.scroll, ["auto", "auto"], size + ": the left and the right scroll on their own");
      assert.ok(r.fits && r.midOverflow === "hidden", size + ": the middle fitted to the screen, not scrolling");
      assert.deepEqual(r.shortened, [true, true], size + ": the long review and biography shortened together");
      assert.ok(r.reading.scrolls && r.reading.whole, `${size}: Read more opens the whole of both, the middle scrolling (${JSON.stringify(r.reading)})`);
      assert.ok(r.fitsAgain, size + ": Read less fits them again");
      assert.ok(r.panel.l === 0 && r.panel.t === 0 && r.panel.w === w && r.panel.h === h, `${size}: over the whole screen (${JSON.stringify(r.panel)})`);
      assert.equal(r.bioTitle, "About Artist A");
      assert.equal(r.bioText, BIO.length, size + ": the biography whole");
      assert.equal(r.reviewWhole, "none", size + ": the review not cut at a phone's few lines");
      assert.equal(r.reviewToggle, "none", size + ": no Show more: Read more instead");
      assert.deepEqual(r.after, r.before, size + ": every part back where it was, closed");
      assert.equal(r.colsAfter, 0, size + ": the columns gone");
      assert.equal(r.wideAfter, false);
    }
  } finally { await srv.stop(); }
});
