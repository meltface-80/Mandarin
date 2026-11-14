"use strict";
/*
 * Edit album's Version on the page (bug list item 420), at a phone's size: an album matched to the nearest pressing of
 * its record shows that release's version name, label, catalogue number, barcode, country, this pressing's year and
 * format under the names; typed over, a field says what the match says, with Put back; another release picked from
 * Find match fills every field not typed in, and leaves the one typed as it is; saved, the Versions tab says the name
 * typed. Nothing wider than the phone. Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const GROUP = { id: "g-kob", title: "Kind of Blue", date: "1959-08-17" };
const TRACKS = [["So What", 3], ["Freddie Freeloader", 4]];

const DRIVER = (album) => `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(40); } };
  await until(() => window.__openAlbum && document.querySelector("#home-view .album"));
  window.__openAlbum(${JSON.stringify(album)}, { source: "home" });
  await until(() => document.querySelectorAll("#album-versions-pane .album-version-row").length === 2);
  openAlbumEditor(currentAlbum);
  const v = f => document.getElementById("ae-v-" + f);
  const was = f => document.querySelector('[data-ae-was="v-' + f + '"]');
  const shown = e => !!e && e.getClientRects().length > 0;
  const F = ["name", "label", "catno", "barcode", "country", "year", "format"];
  const out = {};
  await until(() => v("name").value === "blue disc label");
  const sec = document.getElementById("ae-version");
  out.section = { shown: shown(sec), head: sec.querySelector(".ae-vhead").textContent, parity: sec.querySelector(".ae-vintro").getAttribute("data-parity"),
    after: sec.compareDocumentPosition(document.getElementById("ae-year")) & Node.DOCUMENT_POSITION_PRECEDING ? true : false,
    labels: F.map(f => document.querySelector('label[for="ae-v-' + f + '"]').textContent), values: F.map(f => v(f).value), was: F.map(f => was(f).textContent) };
  const type = (f, s) => { v(f).value = s; v(f).dispatchEvent(new Event("input", { bubbles: true })); };
  type("name", "HDTT DSD256"); type("label", "HDTT");
  out.typed = { name: was("name").textContent, label: was("label").textContent, parity: was("name").querySelector("button").getAttribute("data-parity") };
  // Put back: the match's label again.
  was("label").querySelector("button").click();
  out.putBack = { label: v("label").value, was: was("label").textContent };
  out.wide = document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll("#ae-version *")].every(e => e.getBoundingClientRect().right <= innerWidth + 1);
  // Another release from Find match: the fields not typed in take its words; the name typed stays.
  document.getElementById("ae-match-find").click();
  const mono = await until(() => [...document.querySelectorAll("#ae-match-cands .ae-mcand")].find(b => /mono/.test(b.textContent)));
  mono.click();
  await until(() => v("country").value === "JP");
  out.picked = F.map(f => v(f).value);
  out.pickedWas = was("name").textContent;
  // Saved: the Versions tab says the name typed.
  document.getElementById("ae-save").click();
  await until(() => document.getElementById("album-edit-overlay").classList.contains("hidden"));
  document.querySelector('#album-tabs [data-album-tab="versions"]').click();
  const row = await until(() => [...document.querySelectorAll("#album-versions-pane .album-version-row")].find(r => r.querySelector(".album-version-name").textContent === "HDTT DSD256"), 20000);
  out.row = row ? { name: row.querySelector(".album-version-name").textContent, facts: row.querySelector(".album-version-facts").textContent } : null;
  out.rowsWide = document.documentElement.scrollWidth <= innerWidth;
  // Opened again: yours, with the match's under it.
  openAlbumEditor(currentAlbum);
  await until(() => v("name").value === "HDTT DSD256" && was("name").textContent);
  out.again = { name: v("name").value, was: was("name").textContent, reset: !document.getElementById("ae-reset").classList.contains("hidden") };
  return out;
})()`;

test("Edit album's Version at a phone's size: the match's details, typed over, Put back, another release, saved to the Versions tab", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const kob = (dir, date) => TRACKS.forEach(([title, seconds], i) => gen(path.join(lib.music, "Miles Davis", dir, `0${i + 1}.flac`), { seconds, freq: 300 + 60 * i,
    tags: { title, artist: "Miles Davis", album: "Kind of Blue", track: i + 1, date, MUSICBRAINZ_RELEASEGROUPID: GROUP.id } }));
  kob("Kind of Blue (HDTT)", "2015");
  kob("Kind of Blue (1959)", "1959");
  const mb = await new FakeMusicBrainz([
    { id: "kob-blue", title: "Kind of Blue", artist: "Miles Davis", date: "1959-08-17", country: "US", disambiguation: "blue disc label", label: "Columbia", catno: "CL 1355",
      barcode: "0074646693528", format: "12\" Vinyl", group: GROUP, tracks: TRACKS },
    { id: "kob-mono", title: "Kind of Blue", artist: "Miles Davis", date: "2019-03-01", country: "JP", disambiguation: "mono", label: "Sony Music", catno: "SICP-31257",
      format: "SACD", group: GROUP, tracks: TRACKS }
  ]).start();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, mbBaseUrl: mb.baseUrl });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const get = async p => (await fetch(B + p, { headers: H })).json();
    let albums = [];
    for (let i = 0; i < 200 && albums.length < 1; i++) {
      albums = ((await get("/api/library/albums?sort=album&count=100")).albums || []).filter(a => a.title === "Kind of Blue");
      if (!albums.length) await new Promise(r => setTimeout(r, 100));
    }
    const versions = (await get("/api/album?offset=" + albums[0].offset)).versions;
    const hdtt = versions.find(v => v.year === 2015);
    // The nearest pressing, as Find match chose it.
    const r = await fetch(B + "/api/identify/match", { method: "POST", headers: H, body: JSON.stringify({ offset: hdtt.offset, query: "kob-blue", how: "pick" }) });
    assert.equal(r.status, 200);
    const album = (await get("/api/album?offset=" + hdtt.offset)).album;
    const b = await Browser.launch({ width: 412, height: 800 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      const o = await page.eval(DRIVER(album));
      assert.deepEqual(page.errors, []);
      assert.deepEqual(o.section, { shown: true, head: "Version", parity: "album-edit.version", after: true,
        labels: ["Version name", "Label", "Catalogue number", "Barcode", "Country", "This pressing's year", "Format"],
        values: ["blue disc label", "Columbia", "CL 1355", "0074646693528", "US", "1959", "12\" Vinyl"], was: ["", "", "", "", "", "", ""] });
      assert.deepEqual(o.typed, { name: "From the match: blue disc label · Put back", label: "From the match: Columbia · Put back", parity: "album-edit.put-back" });
      assert.deepEqual(o.putBack, { label: "Columbia", was: "" });
      assert.equal(o.wide, true, "nothing wider than the phone");
      assert.deepEqual(o.picked, ["HDTT DSD256", "Sony Music", "SICP-31257", "", "JP", "2019", "SACD"], "the release's words, but the name typed");
      assert.equal(o.pickedWas, "From the match: mono · Put back");
      assert.deepEqual(o.row, { name: "HDTT DSD256", facts: "2 tracks · 0:07 · 2019" });
      assert.equal(o.rowsWide, true);
      assert.deepEqual(o.again, { name: "HDTT DSD256", was: "From the match: mono · Put back", reset: true });
    } finally { await b.close(); }
  } finally {
    await srv.stop();
    await mb.stop();
  }
});
