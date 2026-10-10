"use strict";
/*
 * An album's booklets (v0.8.33; server/Mandarin.Server/Booklets.cs and
 * BookletRoutes.cs): the PDFs that came with it, found in its folder and one
 * level down, and their pages drawn by the C# server (poppler's pdftoppm) for
 * the album page's book button.
 *
 *   - which albums have one, and only those (a single loose in an artist's
 *     folder hasn't the booklets of the artist's albums); named, with their
 *     page counts;
 *   - a page drawn at a kept width, its colour the PDF's, kept once drawn;
 *   - nothing outside an album's own booklets: another album's, a page past
 *     the end, an id made up, all 404; signed in only;
 *   - in a browser at a phone's size: the book bottom right of the cover,
 *     only on the album with one; the source badge bottom left above the
 *     rate; two booklets chosen from a sheet; the pages shown; Escape and the
 *     phone's Back close the booklet, not the album.
 *
 * Through the C# server only (MANDARIN_FRONT=1): the Node server has no booklets.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const havePoppler = () => spawnSync("pdftoppm", ["-v"]).status === 0;
const skip = (process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1")
  || (!haveFfmpeg() && "ffmpeg is not installed") || (!havePoppler() && !process.env.CI && "poppler (pdftoppm) is not installed");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  const shown = el => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
  const box = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const out = {};
  await until(() => document.querySelector("#home-view .album"));
  const albums = (await (await fetch("/api/library/albums?sort=album")).json()).albums;
  window.__openAlbum(albums.find(a => a.title === "Hi Res"), {});
  await until(() => document.querySelector("#modal-actions .overflow-wrap .overflow-btn"));
  await sleep(800);
  out.hires_book = shown($("modal-booklet"));
  window.__openAlbum(albums.find(a => a.title === "Album One"), {});
  out.book_shown = !!(await until(() => shown($("modal-booklet"))));
  out.art = box(document.querySelector("#album-modal .modal-art"));
  out.book = box($("modal-booklet"));
  // The source badge shows only with a streaming service connected, and the rate only for some
  // files: both shown here to see where the source badge sits, with the rate and without it.
  const src = $("modal-source"), q = $("modal-quality"), qWas = [q.className, q.textContent];
  src.className = "album-source local";
  q.className = "album-quality"; q.textContent = "24/96";
  out.source = box(src);
  out.quality = box(q);
  q.className = "album-quality hidden";
  out.source_alone = box(src);
  [q.className, q.textContent] = qWas;
  out.book_label = $("modal-booklet").getAttribute("aria-label");
  $("modal-booklet").click();
  await until(() => document.querySelectorAll(".sheet-row").length >= 2);
  out.rows = [...document.querySelectorAll(".sheet-row")].map(b => b.textContent);
  [...document.querySelectorAll(".sheet-row")].find(b => b.textContent.startsWith("Booklet ·")).click();
  const viewer = await until(() => shown($("booklet-viewer")) && $("booklet-viewer"));
  const first = await until(() => { const i = viewer && viewer.querySelector(".booklet-page"); return i && i.complete && i.naturalWidth > 0 && i; });
  out.viewer = viewer ? {
    title: viewer.querySelector(".booklet-title").textContent,
    count: viewer.querySelector(".booklet-count").textContent,
    pages: viewer.querySelectorAll(".booklet-page").length,
    first_drawn: first ? first.naturalWidth : 0,
    asks_width: first ? /[?&]w=\\d+/.test(first.src) : false,
    covers_album: box(viewer).t <= out.art.t && box(viewer).b >= out.art.b
  } : null;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(200);
  out.after_escape = { viewer: shown($("booklet-viewer")), album: !$("album-modal").classList.contains("hidden") };
  // The phone's Back (the Android app calls window.__musicdBack): the booklet first.
  out.back_before = typeof window.__musicdBack;
  $("modal-booklet").click();
  await until(() => document.querySelectorAll(".sheet-row").length >= 2);
  [...document.querySelectorAll(".sheet-row")].find(b => b.textContent.startsWith("Inlay ·")).click();
  await until(() => shown($("booklet-viewer")));
  out.back_open = typeof window.__musicdBack;
  out.back_answer = window.__musicdBack ? window.__musicdBack() : null;
  await sleep(100);
  out.after_back = { viewer: shown($("booklet-viewer")), album: !$("album-modal").classList.contains("hidden"), back: typeof window.__musicdBack };
  return out;
})()`;

/* A PDF of square pages, each filled with one colour ("r g b", 0–1), with a proper cross-reference table. */
function pdf(colours) {
  const objs = [];
  const n = colours.length;
  objs.push("<</Type/Catalog/Pages 2 0 R>>");
  objs.push(`<</Type/Pages/Kids[${colours.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}]/Count ${n}>>`);
  colours.forEach((c, i) => {
    const draw = `${c} rg 0 0 400 400 re f`;
    objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 400]/Contents ${4 + i * 2} 0 R>>`);
    objs.push(`<</Length ${draw.length}>>\nstream\n${draw}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/* A JPEG's width and height, and its average colour in the middle. */
function look(jpg) {
  const probe = spawnSync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", "-i", "pipe:0"], { input: jpg });
  const mid = spawnSync(FFMPEG, ["-v", "error", "-i", "pipe:0", "-vf", "crop=iw/4:ih/4:iw*3/8:ih*3/8,scale=1:1:flags=area,format=rgb24", "-f", "rawvideo", "pipe:1"], { input: jpg });
  return { size: String(probe.stdout).trim(), rgb: [...mid.stdout.subarray(0, 3)] };
}

test("an album's booklets: found, their pages drawn by the C# server, nothing else reachable", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  // Album One: a booklet beside its tracks (blue, then red) and an inlay in Scans/ (green). Hi Res: none.
  const one = path.join(lib.music, "Artist A", "Album One");
  fs.writeFileSync(path.join(one, "Booklet.pdf"), pdf(["0 0 1", "1 0 0"]));
  fs.mkdirSync(path.join(one, "Scans"));
  fs.writeFileSync(path.join(one, "Scans", "Inlay.pdf"), pdf(["0 1 0"]));
  // Not booklets: a macOS resource fork, and a file that only claims to be a PDF.
  fs.writeFileSync(path.join(one, "._Booklet.pdf"), "resource fork");
  fs.writeFileSync(path.join(lib.music, "Artist B", "Hi Res", "Broken.pdf"), "not a pdf at all");
  // A single loose in the artist's folder, beside Album One's: its folder is the artist's, and
  // Album One's booklets one level down are Album One's, not the single's.
  gen(path.join(lib.music, "Artist A", "Single.flac"), { tags: { title: "Single", artist: "Artist A", album: "Single", track: 1, date: "2001" } });

  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { headers: { Authorization: "Bearer " + token } };
  for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", H)).json(); if (st.index_count >= 4) break; await new Promise(r => setTimeout(r, 100)); }
  const albums = (await (await fetch(B + "/api/library/albums?sort=album", H)).json()).albums;
  const albumOne = albums.find(a => a.title === "Album One"), hiRes = albums.find(a => a.title === "Hi Res"), single = albums.find(a => a.title === "Single");
  assert.ok(albumOne && hiRes && single, "the albums: " + JSON.stringify(albums.map(a => a.title)));

  const list = async (offset) => {
    const r = await fetch(`${B}/api/album/booklets?offset=${offset}`, H);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-mandarin-answered"), "C#");
    return (await r.json()).booklets;
  };
  let booklet, inlay;

  await t.test("which albums have one: Album One's two, by name, with their pages; Hi Res none", async () => {
    const found = await list(albumOne.offset);
    assert.deepEqual(found.map(b => [b.name, b.pages]), [["Booklet", 2], ["Inlay", 1]]);
    [booklet, inlay] = found;
    assert.match(booklet.id, /^[0-9a-f]{16}$/);
    assert.deepEqual(await list(hiRes.offset), [], "a broken PDF isn't a booklet");
    assert.deepEqual(await list(single.offset), [], "a single loose in the artist's folder: not Album One's booklets");
    assert.deepEqual(await list(999999), [], "no such album: none");
    assert.equal((await fetch(`${B}/api/album/booklets?offset=${albumOne.offset}`)).status, 401, "signed in only");
  });

  const page = (offset, id, p, w) => fetch(`${B}/api/booklet/page?offset=${offset}&id=${id}&page=${p}&w=${w}`, H);

  await t.test("a page drawn at a kept width, in its own colour, and kept", async () => {
    const r = await page(albumOne.offset, booklet.id, 1, 300);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-mandarin-answered"), "C#");
    assert.equal(r.headers.get("content-type"), "image/jpeg");
    const first = look(Buffer.from(await r.arrayBuffer()));
    assert.equal(first.size, "480,480", "300 asked for: drawn at the next kept width");
    assert.ok(first.rgb[2] > 200 && first.rgb[0] < 40 && first.rgb[1] < 40, "page 1 is blue: " + first.rgb);
    const second = look(Buffer.from(await (await page(albumOne.offset, booklet.id, 2, 1000)).arrayBuffer()));
    assert.equal(second.size, "1280,1280");
    assert.ok(second.rgb[0] > 200 && second.rgb[1] < 40 && second.rgb[2] < 40, "page 2 is red: " + second.rgb);
    const green = look(Buffer.from(await (await page(albumOne.offset, inlay.id, 1, 480)).arrayBuffer()));
    assert.ok(green.rgb[1] > 200 && green.rgb[0] < 40, "the inlay is green: " + green.rgb);
    const kept = fs.readdirSync(path.join(lib.data, "booklets")).sort();
    assert.deepEqual(kept, [`${booklet.id}-1@480.jpg`, `${booklet.id}-2@1280.jpg`, `${inlay.id}-1@480.jpg`].sort());
  });

  await t.test("nothing else: another album's booklet, a page past the end, an id made up, not signed in", async () => {
    assert.equal((await page(hiRes.offset, booklet.id, 1, 480)).status, 404, "Album One's booklet asked for as Hi Res's");
    assert.equal((await page(albumOne.offset, booklet.id, 3, 480)).status, 404, "a page past the end");
    assert.equal((await page(albumOne.offset, booklet.id, 0, 480)).status, 404, "page 0");
    assert.equal((await page(albumOne.offset, "0123456789abcdef", 1, 480)).status, 404, "an id made up");
    assert.equal((await page(albumOne.offset, "../../etc/passwd", 1, 480)).status, 404, "a path for an id");
    assert.equal((await fetch(`${B}/api/booklet/page?offset=${albumOne.offset}&id=${booklet.id}&page=1&w=480`)).status, 401, "signed in only");
  });

  await t.test("in a browser at a phone's size: the book on the cover, its pages, Escape and Back", { skip: !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)" }, async () => {
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const pg = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      r = await pg.eval(DRIVER);
      assert.deepEqual(pg.errors, []);
    } finally { await b.close(); }
    assert.equal(r.hires_book, false, "no booklet, no book");
    assert.equal(r.book_shown, true, "Album One's book");
    assert.equal(r.book_label, "2 booklets");
    assert.ok(Math.abs(r.book.r - (r.art.r - 8)) <= 2 && Math.abs(r.book.b - (r.art.b - 8)) <= 2, "bottom right of the cover: " + JSON.stringify(r));
    assert.ok(Math.abs(r.source.l - (r.art.l + 8)) <= 2, "the source badge bottom left: " + JSON.stringify(r));
    assert.ok(Math.abs(r.quality.l - (r.art.l + 8)) <= 2 && Math.abs(r.quality.b - (r.art.b - 8)) <= 2, "the rate where it was: " + JSON.stringify(r));
    assert.ok(r.source.b <= r.quality.t && r.quality.t - r.source.b <= 10, "just above the rate: " + JSON.stringify(r));
    assert.ok(Math.abs(r.source_alone.b - (r.art.b - 8)) <= 2, "in the rate's place when there's none: " + JSON.stringify(r));
    assert.ok(r.source.r < r.book.l, "clear of the book: " + JSON.stringify(r));
    assert.deepEqual(r.rows, ["Booklet · 2 pages", "Inlay · 1 page"]);
    assert.deepEqual(r.viewer && { ...r.viewer, first_drawn: r.viewer.first_drawn > 0 },
      { title: "Booklet", count: "1 / 2", pages: 2, first_drawn: true, asks_width: true, covers_album: true });
    assert.deepEqual(r.after_escape, { viewer: false, album: true }, "Escape closes the booklet, not the album");
    assert.equal(r.back_open, "function");
    assert.equal(r.back_answer, true);
    assert.deepEqual(r.after_back, { viewer: false, album: true, back: r.back_before }, "Back closes the booklet, and is given back");
  });

  await t.test("a booklet changed on disk has a new id, so its pages are drawn afresh", async () => {
    fs.writeFileSync(path.join(one, "Booklet.pdf"), pdf(["1 1 0"]));
    const [again] = await list(albumOne.offset);
    assert.equal(again.pages, 1);
    assert.notEqual(again.id, booklet.id);
    assert.equal((await page(albumOne.offset, booklet.id, 1, 480)).status, 404, "the old id is gone");
    const yellow = look(Buffer.from(await (await page(albumOne.offset, again.id, 1, 480)).arrayBuffer()));
    assert.ok(yellow.rgb[0] > 200 && yellow.rgb[1] > 200 && yellow.rgb[2] < 60, "the new page: " + yellow.rgb);
  });
});
