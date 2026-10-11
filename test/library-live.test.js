"use strict";
/*
 * Albums added show up by themselves (v0.8.43), in the app and in a
 * browser alike. Every answer from the C# server carries which albums there
 * are (X-Mandarin-Library); when that moves, the page reads Home's Library
 * row again, and the Library wall when it is at its top. Before, the row was
 * read once (or painted from last time's copy) and kept until the sort was
 * changed: with the Library sorted by Recently added, a scan's new albums
 * stayed off it until the sort was changed and changed back.
 *   - the mark: on a signed-in device's answers, not to anyone else;
 *     /api/library/mark answers it; it moves when an album comes;
 *   - Home's Library row, sorted by Recently added, takes the new album
 *     first with nothing touched;
 *   - the Library wall, at its top, the same (not under an album open over it);
 *   - opened again after albums came while it was shut: the row painted
 *     from last time is read again, not kept.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { makeLibrary, gen, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const FRONT = process.env.MANDARIN_FRONT === "1";
const skip = (!FRONT && "the C# server's mark (MANDARIN_FRONT=1)") || (!haveFfmpeg() && "ffmpeg is not installed") ||
  (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The Library sorted by Recently added, newest first, as the page keeps it.
const SORTED = `localStorage.setItem("rra-library-view", JSON.stringify({ v: 2, sort: "added", dir: "desc" }));`;
const UNTIL = `const until = async (f, ms = 30000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 100)); } };`;
// The titles of the album tiles there (not the placeholders a wall shows while it loads).
const ROW = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].filter(t => t.__album).map(t => t.__album.title)`;

test("albums added show up by themselves: Home's Library row and the Library wall", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token };
  const status = async () => (await (await fetch(B + "/api/status", { headers: H })).json());
  for (let i = 0; i < 200 && (await status()).index_count < 3; i++) await sleep(100);
  // A new album copied in, and the library scan that finds it.
  let n = 0;
  const add = async (title) => {
    const before = (await status()).index_count;
    gen(path.join(lib.music, "New Artist " + (++n), title, "01 One.flac"), { tags: { title: "One", artist: "New Artist " + n, album: title, track: 1 } });
    await fetch(B + "/api/library/rescan", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: "{}" });
    for (let i = 0; i < 300 && (await status()).index_count <= before; i++) await sleep(100);
  };

  await t.test("the mark: on a signed-in device's answers only, and moved by an album added", async () => {
    let r = await fetch(B + "/api/library/mark", { headers: H });
    const j = await r.json();
    assert.equal(r.headers.get("x-mandarin-answered"), "C#");
    assert.match(j.albums, /^3-[0-9a-f]+$/);
    assert.equal(r.headers.get("x-mandarin-library"), j.albums);
    // On what the Node server answers too, passed through.
    r = await fetch(B + "/api/status", { headers: H });
    assert.equal(r.headers.get("x-mandarin-library"), j.albums);
    // Not to anyone who hasn't signed in, not even on what is open to them.
    for (const p of ["/api/library/mark", "/api/health", "/api/auth/status"]) {
      r = await fetch(B + p);
      assert.equal(r.headers.get("x-mandarin-library"), null, p);
    }
    await add("First New");
    let moved = null;
    for (let i = 0; i < 100 && !moved; i++) {
      const m = (await (await fetch(B + "/api/library/mark", { headers: H })).json()).albums;
      if (m !== j.albums) moved = m; else await sleep(100);
    }
    assert.match(moved || "", /^4-[0-9a-f]+$/, "moved once the scan's album is in");
  });

  const b = await Browser.launch({ width: 390, height: 844 });
  t.after(() => b.close());
  const open = () => b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true, init: SORTED });

  await t.test("Home's Library row, sorted by Recently added: the new album first, nothing touched", async () => {
    const page = await open();
    const first = await page.eval(`(async () => { ${UNTIL} return await until(() => { const r = ${ROW("#home-library .album")}; return r.length >= 4 && r; }); })()`);
    assert.equal(first && first[0], "First New", JSON.stringify(first));
    await add("Second New");
    const after = await page.eval(`(async () => { ${UNTIL} return await until(() => { const r = ${ROW("#home-library .album")}; return r[0] === "Second New" && r; }); })()`);
    assert.deepEqual(after && after.slice(0, 2), ["Second New", "First New"], "on the row by itself");
    assert.deepEqual(page.errors, []);
    await page.send("Page.close").catch(() => {});
  });

  await t.test("the Library wall at its top: the new album first, nothing touched", async () => {
    const page = await open();
    const wall = await page.eval(`(async () => {
      ${UNTIL}
      // Started (Home read afresh, not last time's copy), then the wall opened.
      await until(() => ${ROW("#home-library .album")}[0] === "Second New");
      await new Promise(r => setTimeout(r, 1500));
      document.getElementById("home-library-title").click();
      return await until(() => { const r = ${ROW("#album-grid .album")}; return r.length >= 5 && r; });
    })()`);
    assert.equal(wall && wall[0], "Second New", JSON.stringify(wall));
    assert.ok(await page.eval(`document.getElementById("home-view").classList.contains("hidden")`), "on the wall");
    await add("Third New");
    const after = await page.eval(`(async () => { ${UNTIL} return await until(() => { const r = ${ROW("#album-grid .album")}; return r[0] === "Third New" && r; }); })()`);
    assert.deepEqual(after && after.slice(0, 3), ["Third New", "Second New", "First New"], "on the wall by itself");
    // An album open over the wall: the wall isn't rebuilt under it.
    const under = await page.eval(`(async () => {
      ${UNTIL}
      const first = document.querySelector("#album-grid .album");
      window.__openAlbum(first.__album, {});
      await until(() => !document.getElementById("album-modal").classList.contains("hidden"));
      window.__libraryChanged({ live: true });
      await new Promise(r => setTimeout(r, 1500));
      return { same: document.querySelector("#album-grid .album") === first, open: !document.getElementById("album-modal").classList.contains("hidden") };
    })()`);
    assert.deepEqual(under, { same: true, open: true }, "left as it is while an album is open");
    assert.deepEqual(page.errors, []);
    await page.send("Page.close").catch(() => {});
  });

  await t.test("opened again after albums came while it was shut: the row from last time is read again", async () => {
    const page = await open();
    await page.eval(`(async () => { ${UNTIL} await until(() => { const r = ${ROW("#home-library .album")}; return r[0] === "Third New"; }); })()`);
    await page.send("Page.close").catch(() => {});
    await add("Fourth New");
    const again = await open();
    const row = await again.eval(`(async () => { ${UNTIL} return await until(() => { const r = ${ROW("#home-library .album")}; return r[0] === "Fourth New" && r; }, 20000); })()`);
    assert.equal(row && row[0], "Fourth New", "not last time's copy kept");
    assert.deepEqual(again.errors, []);
  });
});
