"use strict";
/*
 * Albums merged into one from the library's selection menu (bug list item 512). The owner's iBroadcast library has
 * Ornette Coleman's At The "Golden Circle" Stockholm as two albums, Volume One and Volume Two, and Out Of/Into's Motion I
 * and Motion II; a merge, whichever is picked first, makes one album, the first volume its first disc, called by what
 * the titles share, kept in the database: a scan or a reading of iBroadcast after keeps to it, and Unmerge takes it
 * apart. The discs of one title an iBroadcast album names ("The Wall (Disc 1)", "The Wall (Disc 2)") are one album, as
 * a folder's are.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { until } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const noBrowser = !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)";

/* The page: [pick] albums picked on Home's Library row (in that order), the select menu opened, [act] tapped. What the menu offered, and what was said. */
const PICK = (pick, act, titles) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
  const shown = e => !!e && e.getClientRects().length > 0;
  const tile = o => document.querySelector('#home-library .album[data-offset="' + o + '"]');
  // Each tile as the library has it now (Home's row drawn again after a merge).
  if (!await until(() => ${JSON.stringify(pick)}.every((o, i) => tile(o) && tile(o).querySelector(".album-title") && tile(o).querySelector(".album-title").textContent.trim() === ${JSON.stringify(titles)}[i]))) return { error: "no tiles: " + [...document.querySelectorAll("#home-library .album")].map(e => e.dataset.offset) };
  const toast = document.getElementById("toast");
  toast.textContent = "";
  window.__enterAlbumSelectMode();
  for (const o of ${JSON.stringify(pick)}) tile(o).click();
  document.getElementById("select-menu-btn").click();
  const items = [...document.querySelectorAll("#select-menu [data-sel-act]")].map(e => e.textContent);
  document.querySelector('#select-menu [data-sel-act="${act}"]').click();
  const said = await until(() => toast.textContent);
  return { items, said };
})()`;
const T = (id, title, track) => ({ id, title, track, type: "audio/flac" });
const GC = 'At The "Golden Circle" Stockholm';
const albums = () => [
  { id: 101, name: GC + " Volume One", artist: { id: 1, name: "Ornette Coleman" }, year: 1965, tracks: [T(1001, "Faces and Places", 1), T(1002, "European Echoes", 2)] },
  { id: 102, name: GC + " Volume Two", artist: { id: 1, name: "Ornette Coleman" }, year: 1965, tracks: [T(1003, "Snowflakes and Sunshine", 1), T(1004, "Morning Song", 2)] },
  { id: 201, name: "The Wall (Disc 1)", artist: { id: 2, name: "Pink Floyd" }, year: 1979, tracks: [T(2001, "In the Flesh?", 1)] },
  { id: 202, name: "The Wall (Disc 2)", artist: { id: 2, name: "Pink Floyd" }, year: 1979, tracks: [T(2002, "Hey You", 1)] },
];

test("item 512: albums merged into one, the first volume first, kept through scans and readings, and unmerged", { skip, timeout: 300000 }, async (t) => {
  const lib = makeLibrary();
  // Motion I and Motion II, of your own files, a folder each.
  for (const [vol, folder] of [["I", "Motion I"], ["II", "Motion II"]])
    for (const i of [1, 2]) gen(path.join(lib.music, "Out Of Into", folder, `0${i} Track ${vol}-${i}.flac`), { seconds: 1, freq: 300 + 50 * i + (vol === "II" ? 25 : 0),
      tags: { title: `Track ${vol}-${i}`, artist: "Out Of/Into", album: "Motion " + vol, track: i, date: "2024" } });
  const ib = await new FakeIBroadcast({ albums: albums() }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 600000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const get = async p => (await fetch(base + p, { headers: H })).json();
  const post = async (p, body = {}) => { const r = await fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(body) }); return Object.assign({ status: r.status }, await r.json().catch(() => ({}))); };
  const db = ctx.db.raw;
  /** The library's albums by title: offset, discs, merged. */
  const shelf = async () => Object.fromEntries((await get("/api/library/albums?count=500")).albums.map(a => [a.title, { offset: a.offset, discs: a.discs || 1, merged: !!a.merged }]));
  /** An album's tracks: "disc-track title". */
  const tracks = offset => db.prepare("SELECT disc_no, track_no, title FROM tracks WHERE album_id = ? ORDER BY disc_no, track_no").all(offset).map(r => `${r.disc_no || 1}-${r.track_no} ${r.title}`);
  const scanned = async () => until(async () => { const s = await get("/api/status"); return s.scan && s.scan.last && !s.scan.running && !s.scanning; }, 60000, "the scan");

  await scanned();
  await post("/api/settings/ibroadcast/signin");
  ib.approve();
  await until(async () => { const s = await get("/api/settings/ibroadcast"); return s.library && s.library.albums === 3; }, 30000, "the library read");

  await t.test("an iBroadcast album's discs named in its title are one album", async () => {
    const s = await shelf();
    assert.ok(s["The Wall"], JSON.stringify(Object.keys(s)));
    assert.equal(s["The Wall"].discs, 2);
    assert.deepEqual(tracks(s["The Wall"].offset), ["1-1 In the Flesh?", "2-1 Hey You"]);
  });

  await t.test("iBroadcast: Volume Two picked first, Volume One still the first disc; the one called by what they share", async () => {
    let s = await shelf();
    const r = await post("/api/albums/merge", { offsets: [s[GC + " Volume Two"].offset, s[GC + " Volume One"].offset] });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.title, GC);
    assert.equal(r.offset, s[GC + " Volume One"].offset, "the first volume's album kept");
    s = await shelf();
    assert.ok(!s[GC + " Volume Two"] && !s[GC + " Volume One"], JSON.stringify(Object.keys(s)));
    assert.deepEqual(s[GC], { offset: r.offset, discs: 2, merged: true });
    assert.deepEqual(tracks(r.offset), ["1-1 Faces and Places", "1-2 European Echoes", "2-1 Snowflakes and Sunshine", "2-2 Morning Song"]);
  });

  await t.test("iBroadcast read again: still one album", async () => {
    ib.changed();
    assert.equal((await post("/api/settings/ibroadcast/library")).status, 200);
    const s = await shelf();
    assert.ok(!s[GC + " Volume Two"], JSON.stringify(Object.keys(s)));
    assert.equal(s[GC].discs, 2);
    assert.deepEqual(tracks(s[GC].offset), ["1-1 Faces and Places", "1-2 European Echoes", "2-1 Snowflakes and Sunshine", "2-2 Morning Song"]);
  });

  await t.test("your own files: Motion II picked first, Motion I its first disc", async () => {
    let s = await shelf();
    const r = await post("/api/albums/merge", { offsets: [s["Motion II"].offset, s["Motion I"].offset] });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.title, "Motion");
    s = await shelf();
    assert.ok(!s["Motion II"] && !s["Motion I"], JSON.stringify(Object.keys(s)));
    assert.deepEqual(s.Motion, { offset: r.offset, discs: 2, merged: true });
    assert.deepEqual(tracks(r.offset), ["1-1 Track I-1", "1-2 Track I-2", "2-1 Track II-1", "2-2 Track II-2"]);
  });

  await t.test("a file of Motion II changed and the library scanned: still one album, its track on disc 2", async () => {
    gen(path.join(lib.music, "Out Of Into", "Motion II", "02 Track II-2.flac"), { seconds: 2, freq: 777, tags: { title: "Track II-2", artist: "Out Of/Into", album: "Motion II", track: 2, date: "2024" } });
    // Rescanned (the folder watch may have begun it already): until the file is read again.
    await post("/api/library/rescan");
    await until(() => db.prepare("SELECT duration FROM tracks WHERE path LIKE ?").get("%Motion II%02 Track II-2.flac").duration > 1.5, 60000, "the file read again");
    await scanned();
    const s = await shelf();
    assert.ok(!s["Motion II"], JSON.stringify(Object.keys(s)));
    assert.deepEqual(tracks(s.Motion.offset), ["1-1 Track I-1", "1-2 Track I-2", "2-1 Track II-1", "2-2 Track II-2"]);
  });

  await t.test("mixing your files with iBroadcast's is refused", async () => {
    const s = await shelf();
    const r = await post("/api/albums/merge", { offsets: [s.Motion.offset, s["The Wall"].offset] });
    assert.equal(r.status, 400);
    assert.match(r.error, /can't be merged/);
  });

  await t.test("unmerged: each album its own again, its discs as its files say", async () => {
    let s = await shelf();
    let r = await post("/api/albums/unmerge", { offset: s.Motion.offset });
    assert.equal(r.status, 200, JSON.stringify(r));
    r = await post("/api/albums/unmerge", { offset: s[GC].offset });
    assert.equal(r.status, 200, JSON.stringify(r));
    s = await shelf();
    for (const title of ["Motion I", "Motion II", GC + " Volume One", GC + " Volume Two"]) assert.ok(s[title], title + " in " + JSON.stringify(Object.keys(s)));
    assert.deepEqual(tracks(s["Motion II"].offset), ["1-1 Track II-1", "1-2 Track II-2"]);
    assert.deepEqual(tracks(s[GC + " Volume Two"].offset), ["1-1 Snowflakes and Sunshine", "1-2 Morning Song"]);
    assert.equal(s["Motion I"].merged, false);
  });
  await t.test("the page: Motion I and II picked, Merge albums in the select menu; the merged one picked alone, Unmerge", { skip: noBrowser }, async () => {
    // A scan under way rightly refuses a merge ("A scan is running"), and the steps before can leave one going (item
    // 515: the page's merge refused so, now and then): each step waits for the library to be still, as the owner would.
    await scanned();
    let s = await shelf();
    const b = await Browser.launch({ width: 412, height: 800 });
    try {
      const page = await b.page(base + "/", { cookies: [{ name: "musicd_session", value: token, url: base }], touch: true });
      const merged = await page.eval(PICK([s["Motion II"].offset, s["Motion I"].offset], "merge", ["Motion II", "Motion I"]));
      assert.deepEqual(merged, { items: ["Play now", "Play next", "Add to end of queue", "Listen later", "Merge albums", "Clear selection"], said: "Merged 2 albums into “Motion”" });
      await scanned();
      s = await shelf();
      assert.deepEqual(s.Motion, { offset: s.Motion.offset, discs: 2, merged: true });
      const apart = await page.eval(PICK([s.Motion.offset], "unmerge", ["Motion"]));
      assert.deepEqual(apart, { items: ["Play now", "Play next", "Add to end of queue", "Listen later", "Unmerge", "Clear selection"], said: "“Motion” unmerged" });
      s = await shelf();
      assert.ok(s["Motion I"] && s["Motion II"] && !s.Motion, JSON.stringify(Object.keys(s)));
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  });
});
