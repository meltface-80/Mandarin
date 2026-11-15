"use strict";
/*
 * Two copies merged into one album, taken apart on the page (bug list item 424), at a phone's size. Settings → Library
 * Scanner → Library clean-up says how many albums look like two copies merged, with Show; shown, each with why and
 * Split…, which opens its Edit album at Folders and copies, Split…'s ways open: the owner's Moanin' (the 2013 remaster
 * and the SACD version, one folder, one album tag) split by the version words in its titles. An album over two folders
 * (as a library merged them before item 424) offers Split by folder with its folders and their tracks; split, Join back
 * puts it together again. Nothing wider than the phone. SPLIT_SHOTS=<folder> writes what it shows there as pictures.
 * Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;
const ACT = "Art Blakey & The Jazz Messengers";
const TITLES = ["Moanin'", "Are You Real", "Along Came Betty", "The Drum Thunder Suite", "Blues March", "Come Rain or Come Shine"];

/* The page's steps, each a promise of what it shows; [step] names what is checked next. */
const UNTIL = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
  const shown = e => !!e && e.getClientRects().length > 0;
  const text = sel => { const e = document.querySelector(sel); return e && shown(e) ? e.textContent.trim().replace(/\\s+/g, " ") : null; };
  const wide = sel => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll(sel + " *")].every(e => !shown(e) || e.getBoundingClientRect().right <= innerWidth + 1);
`;

const CLEANUP = `(async () => {${UNTIL}
  await until(() => document.querySelectorAll("#home-library .album").length > 0);
  document.getElementById("settings-toggle").click();
  await until(() => shown(document.querySelector('#settings-overlay .settings-view[data-view="home"]')));
  [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="identify"]')].find(shown).click();
  const show = await until(() => document.querySelector('[data-parity="settings-scanner.merged"]'));
  if (!show) return { error: "no merged line: " + document.getElementById("identify-pane-body").textContent.slice(0, 400) };
  show.scrollIntoView({ block: "center" });
  await sleep(300);
  return { line: show.parentElement.textContent.trim(), button: show.textContent, wide: wide("#identify-pane-body") };
})()`;

const LIST = `(async () => {${UNTIL}
  document.querySelector('[data-parity="settings-scanner.merged"]').click();
  await until(() => document.querySelector('[data-parity="settings-scanner.merged-close"]'));
  const rows = [...document.querySelectorAll("#identify-pane-body .id-row")];
  return { title: text('#identify-pane-body [data-parity="settings-scanner.title"]'), rows: rows.map(r => r.querySelector(".id-open").textContent.trim() + " | " + r.querySelector(".id-btn").textContent),
    wide: wide("#identify-pane-body") };
})()`;

const SPLIT_OPEN = `(async () => {${UNTIL}
  const row = [...document.querySelectorAll("#identify-pane-body .id-row")].find(r => /Moanin/.test(r.textContent));
  row.querySelector('[data-parity="settings-scanner.split"]').click();
  const way = await until(() => document.querySelector('#ae-split-ways [data-parity="album-edit.split-way"]'));
  await sleep(400);
  const cut = [...document.querySelectorAll("#ae-split button")].filter(b => shown(b) && b.scrollWidth > b.clientWidth + 1).map(b => b.textContent);
  return { way: way && way.textContent, go: text('#ae-split-ways [data-parity="album-edit.split-go"]'), folders: shown(document.getElementById("ae-split-folders")),
    buttons: [...document.querySelectorAll("#ae-split .ae-split-btns button")].filter(shown).map(b => b.textContent), wide: wide("#album-edit-overlay"), cut };
})()`;

const SPLIT_GO = `(async () => {${UNTIL}
  document.querySelector('#ae-split-ways [data-parity="album-edit.split-go"]').click();
  const said = await until(() => text("#ae-split-status"));
  return { said, join: shown(document.getElementById("ae-split-join")), ways: shown(document.getElementById("ae-split-ways")) };
})()`;

const BY_FOLDER = (album) => `(async () => {${UNTIL}
  document.querySelector("#album-edit-overlay [data-ae-close]").click();
  const back = document.querySelector('[data-parity="settings-scanner.merged-close"]');
  if (back) back.click();
  const closer = document.querySelector("#settings-overlay [data-settings-close]");
  if (closer) closer.click();
  await sleep(300);
  openAlbumEditor(${JSON.stringify(album)});
  const folders = await until(() => text("#ae-split-folders"));
  document.getElementById("ae-split").scrollIntoView({ block: "start" });
  await sleep(2600);   // the last toast gone
  // Each button whole: none cut short (an .action-btn shrinks and ellipses where its row has no room).
  const cut = [...document.querySelectorAll("#ae-split button")].filter(b => shown(b) && b.scrollWidth > b.clientWidth + 1).map(b => b.textContent);
  return { folders, buttons: [...document.querySelectorAll("#ae-split .ae-split-btns button")].filter(shown).map(b => b.textContent), wide: wide("#album-edit-overlay"), cut };
})()`;

const FOLDER_GO = `(async () => {${UNTIL}
  document.getElementById("ae-split-folder").click();
  const said = await until(() => text("#ae-split-status"));
  const after = { said, folders: shown(document.getElementById("ae-split-folders")), join: shown(document.getElementById("ae-split-join")) };
  document.getElementById("ae-split-join").click();
  const joined = await until(() => /Joined/.test(text("#ae-split-status") || "") && text("#ae-split-status"));
  return Object.assign(after, { joined, folders2: text("#ae-split-folders") });
})()`;

test("item 424 at a phone's size: Library clean-up's merged albums, Split… by version words from there, Split by folder and Join back", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  // The owner's folder: both copies in one, interleaved by name; their formats differ.
  const both = path.join(lib.music, ACT, "Moanin' (1959)");
  const copy = (words, rate, n) => (t, i) => i < n && gen(path.join(both, `${String(i + 1).padStart(2, "0")} - ${t} (${words}).flac`), { seconds: 1, freq: 300 + 40 * i, rate, fmt: "s32",
    codecArgs: ["-bits_per_raw_sample", "24"], tags: { title: `${t} (${words})`, artist: ACT, album: "Moanin'", track: i + 1, date: "1959" } });
  TITLES.forEach(copy("Remastered 2013", 192000, 6));
  TITLES.concat(["Moanin' (Alternate Take)"]).forEach(copy("SACD Version", 88200, 7));
  // Album One's other copy, in a folder of its own.
  for (const i of [1, 2]) gen(path.join(lib.music, "Artist A", "Album One (Mono)", `0${i} Song ${i}.flac`), { seconds: 1, freq: 640 + 30 * i,
    tags: { title: "Song " + i, artist: "Artist A", album: "Album One", track: i, date: "1997" } });
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  const shots = process.env.SPLIT_SHOTS;
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const get = async p => (await fetch(B + p, { headers: H })).json();
    // The first scan done (a scan after the merge below would take it apart, as item 424 has it).
    for (let i = 0; i < 600; i++) { const st = (await get("/api/status")).scan; if (st && st.last && !st.running) break; await new Promise(r => setTimeout(r, 100)); }
    let ones = [];
    for (let i = 0; i < 200 && ones.length < 2; i++) {
      ones = ctx.db.raw.prepare("SELECT a.id, COUNT(t.id) AS n FROM albums a JOIN tracks t ON t.album_id = a.id WHERE a.title = 'Album One' GROUP BY a.id ORDER BY n DESC").all();
      if (ones.length < 2) await new Promise(r => setTimeout(r, 100));
    }
    // As a library merged the two copies before item 424: one album over two folders.
    ctx.db.raw.prepare("UPDATE tracks SET album_id = ? WHERE album_id = ?").run(ones[0].id, ones[1].id);
    ctx.db.raw.prepare("DELETE FROM albums WHERE id = ?").run(ones[1].id);
    await ctx.library.reload();
    await fetch(B + "/api/album-scanner", { method: "POST", headers: H, body: JSON.stringify({ on: true }) });
    const one = (await get("/api/album?offset=" + ones[0].id)).album;
    const b = await Browser.launch({ width: 412, height: 800 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      const shot = async name => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await page.screenshot(path.join(shots, name + ".png")); } };
      const cleanup = await page.eval(CLEANUP);
      await shot("1-library-clean-up");
      assert.deepEqual(cleanup, { line: "2 albums look like two copies mergedShow", button: "Show", wide: true });
      const list = await page.eval(LIST);
      await shot("2-look-like-two-copies-merged");
      assert.deepEqual(list, { title: "Look like two copies merged (2)",
        rows: [`${ACT} — Moanin'a track number twice on a disc · 13 tracks | Split…`, "Artist A — Album One2 folders · a track number twice on a disc · 5 tracks | Split…"], wide: true });
      const open = await page.eval(SPLIT_OPEN);
      await shot("3-split-ways");
      assert.deepEqual(open, { way: "By the version words in the titles: SACD Version (7) · Remastered 2013 (6)", go: "Split", folders: false,
        buttons: ["Split…", "Look at this album again"], wide: true, cut: [] });
      const went = await page.eval(SPLIT_GO);
      assert.deepEqual(went, { said: "Split into 2 albums — each a version of the others. Join back puts them together again.", join: true, ways: false });
      const moanins = ctx.db.raw.prepare("SELECT COUNT(t.id) AS n FROM albums a JOIN tracks t ON t.album_id = a.id WHERE a.title = 'Moanin''' GROUP BY a.id ORDER BY n DESC").all();
      assert.deepEqual(moanins.map(r => r.n), [7, 6]);
      const folder = await page.eval(BY_FOLDER(one));
      await shot("4-split-by-folder");
      assert.deepEqual(folder, { folders: "Its tracks are in 2 folders: Album One (3) · Album One (Mono) (2)", buttons: ["Split by folder", "Split…", "Look at this album again"], wide: true, cut: [] });
      const split = await page.eval(FOLDER_GO);
      assert.deepEqual(split, { said: "Split into 2 albums — each a version of the others. Join back puts them together again.", folders: false, join: true,
        joined: "Joined back into one album.", folders2: "Its tracks are in 2 folders: Album One (3) · Album One (Mono) (2)" });
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
  } finally {
    await srv.stop();
  }
});
