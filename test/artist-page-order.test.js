"use strict";
/*
 * An artist's page in the owner's order (bug list item 140), in a real browser at a phone's size against the real
 * server: their discography under the head, the foot (similar artists and albums) last in the grid; and the page
 * opened again drawn from what it last had, its albums not asked of the server again.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
  const $ = id => document.getElementById(id);
  const grid = $("album-grid");
  await until(() => document.querySelector("#home-view .album"));
  await sleep(400);
  const asked = [];
  const fetch0 = window.fetch;
  window.fetch = (u, o) => { asked.push(String(u)); return fetch0(u, o); };
  const albumsAsked = () => asked.filter(u => u.startsWith("/api/artist-albums?artist=Artist%20A")).length;
  const open = async () => { window.__showArtistAlbums("Artist A"); await until(() => /albums? · Artist A/.test($("album-count").textContent) && grid.querySelector(".artist-tail")); };
  await open();
  const out = {
    sections: [...grid.querySelectorAll(".artist-section-header")].map(h => h.textContent),
    headFirst: grid.firstElementChild.classList.contains("artist-bio-head"),
    footLast: grid.lastElementChild.classList.contains("artist-tail"),
    title: $("album-count").textContent,
    asked: albumsAsked(),
  };
  $("topbar-back").click();
  await until(() => !/Artist A/.test($("album-count").textContent));
  await open();
  out.again = { title: $("album-count").textContent, asked: albumsAsked() - out.asked, tiles: grid.querySelectorAll(".album").length };
  return out;
})()`;

test("an artist's page: the discography under the head, the foot last, and drawn again from what it had", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json();
      if (st.index_count >= 3 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.equal(r.sections[0], "Discography", "their own albums first, under Discography: " + r.sections.join(", "));
    assert.ok(r.headFirst, "who they are over everything");
    assert.ok(r.footLast, "similar artists and albums last in the grid");
    assert.equal(r.asked, 1);
    assert.equal(r.again.asked, 0, "opened again: drawn from what it had, its albums not asked for again");
    assert.equal(r.again.title, r.title);
    assert.ok(r.again.tiles >= 1, "its albums there again");
  } finally { await srv.stop(); }
});
