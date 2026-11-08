"use strict";
/*
 * Versions of one album (item 345): the original Metallic 'KO and its 2015 remaster are one album with two versions, not
 * two tiles with nothing to tell them apart. The lists (the wall, an artist's page, search) show the main version alone,
 * saying how many there are: the highest resolution, until another is chosen on the album's page, which is kept. The
 * album's page lists every version, each saying what tells it apart ("2015 Remaster · 24/96", "Original · 16/44.1"):
 * since item 349 on its Versions tab, a tap showing the other in the page's place, Make main in its ⋯.
 * Versions are one MusicBrainz release group, else one act's one title once its version words are off; never two
 * release groups, and never one title from two years with no edition between them (Peter Gabriel's "Peter Gabriel").
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { gen, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { start, built } = require("./server");
const { Browser, findBrowser } = require("./browser-harness");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const noBrowser = !findBrowser() && !process.env.CI;

async function until(fn, ms = 60000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await new Promise(r => setTimeout(r, 150));
  }
}

function album(music, { artist, title, year, group, hires }) {
  for (let i = 1; i <= 2; i++) {
    const tags = { title: `${title} ${i}`, artist, album_artist: artist, album: title, track: i, date: String(year) };
    if (group) tags.MUSICBRAINZ_RELEASEGROUPID = group;
    const how = hires ? { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"] } : {};
    gen(path.join(music, artist, `${title} (${year})${group ? " " + group.slice(0, 4) : ""}`, `0${i}.flac`), { seconds: 1, freq: 300 + i * 50, tags, ...how });
  }
}

test("an album's versions: one tile, the highest resolution its main, every version on its page, another chosen and kept", { skip, timeout: 150000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-versions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const music = path.join(root, "music");
  album(music, { artist: "Iggy and The Stooges", title: "Metallic 'KO", year: 1976 });
  album(music, { artist: "Iggy and The Stooges", title: "Metallic 'KO (2015 Remaster)", year: 1976, hires: true });
  album(music, { artist: "Peter Gabriel", title: "Peter Gabriel", year: 1977 });
  album(music, { artist: "Peter Gabriel", title: "Peter Gabriel", year: 1978 });
  album(music, { artist: "Weezer", title: "Weezer", year: 2001, group: "aaaaaaaa-0000-4000-8000-000000000001" });
  album(music, { artist: "Weezer", title: "Weezer", year: 2001, group: "bbbbbbbb-0000-4000-8000-000000000002" });
  album(music, { artist: "Solo", title: "Debut", year: 1999, group: "cccccccc-0000-4000-8000-000000000003" });
  album(music, { artist: "Solo", title: "Debut Plus", year: 1999, group: "cccccccc-0000-4000-8000-000000000003" });
  const srv = await start({ port: ports.port(), musicDir: music, dataDir: path.join(root, "data") });
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(srv.base), "Content-Type": "application/json" };
  const get = async p => (await fetch(srv.base + p, { headers: H })).json();
  await until(async () => { const s = await get("/api/status"); return s && s.index_count === 8 && !s.scanning; }, 60000, "the library");

  const wall = async () => (await get("/api/library/albums?sort=album&count=100")).albums;
  const titles = list => list.map(a => a.title).sort();
  let albums = await wall();
  assert.deepEqual(titles(albums).map(x => x.replace("Debut Plus", "Debut")), ["Debut", "Metallic 'KO (2015 Remaster)", "Peter Gabriel", "Peter Gabriel", "Weezer", "Weezer"],
    "one tile for each album's versions (Debut's two alike, the newest added its main); Peter Gabriel's two and Weezer's two releases each their own");
  const ko = albums.find(a => a.title.startsWith("Metallic"));
  assert.deepEqual([ko.versions, ko.version, ko.quality], [2, "2015 Remaster · 24/96", "24/96"], "the highest resolution the main, saying how many");
  assert.equal(albums.find(a => a.title.startsWith("Debut")).versions, 2, "one release group, whatever its titles");
  assert.equal(albums.filter(a => a.title === "Peter Gabriel").every(a => a.versions === undefined), true);

  // Its page: every version, the main first, each saying what tells it apart.
  const page = await get("/api/album?offset=" + ko.offset);
  assert.deepEqual(page.versions.map(v => [v.label, v.main, v.current]), [["2015 Remaster · 24/96", true, true], ["Original · 16/44.1", false, false]]);
  // Each its edition alone, its tracks and length, for its row on the Versions tab; the page's title without version words (item 349).
  assert.deepEqual(page.versions.map(v => [v.edition, v.tracks, v.seconds > 0]), [["2015 Remaster", 2, true], ["Original", 2, true]]);
  assert.equal(page.album.base_title, "Metallic 'KO");
  // The lists elsewhere: one album on the artist's page and in search.
  assert.deepEqual(titles((await get("/api/artist-albums?artist=" + encodeURIComponent("Iggy and The Stooges"))).primary), ["Metallic 'KO (2015 Remaster)"]);
  assert.deepEqual(titles((await get("/api/search?q=metallic")).results), ["Metallic 'KO (2015 Remaster)"]);

  // On the page (a phone held upright, item 349): the tile says how many versions; the album's page has a Versions tab
  // listing them, a row each; a tap shows the other in its place, the title as it was, nothing album-wide asked again;
  // Make this the main version in its ⋯.
  if (!noBrowser) {
    const b = await Browser.launch({ width: 390, height: 844 });
    try {
      const token = H.Authorization.replace("Bearer ", "");
      const tab = await b.page(srv.base + "/", { cookies: [{ name: "musicd_session", value: token, url: srv.base }] });
      const seen = await tab.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
        const asked = [];
        const f0 = window.fetch;
        window.fetch = (u, o) => { asked.push(String(u)); return f0(u, o); };
        await until(() => window.__openAlbum && document.querySelector("#home-view .album"));
        const tile = await until(() => [...document.querySelectorAll(".album")].find(t => /Metallic/.test(t.textContent) && t.querySelector(".album-versions")), 10000);
        const mark = tile ? tile.querySelector(".album-versions").textContent : null;
        window.__openAlbum(${JSON.stringify(ko)}, { source: "home" });
        const rows = () => [...document.querySelectorAll("#album-versions-pane .album-version-row")];
        await until(() => rows().length === 2 && document.querySelectorAll("#modal-tracks li").length === 2);
        const shown = (el) => !!el && getComputedStyle(el).display !== "none";
        const tabs = [...document.querySelectorAll("#album-tabs .album-tab")].filter(shown).map(t => t.textContent.trim().replace(/\\s+/g, " "));
        const title = document.getElementById("modal-title").textContent;
        document.querySelector('#album-tabs [data-album-tab="versions"]').click();
        const listed = rows().map(r => [r.querySelector(".album-version-name").textContent, r.querySelector(".album-version-format").textContent,
          [...r.querySelectorAll(".album-version-tag")].map(t => t.textContent).join(" "), r.querySelector(".album-version-facts").textContent]);
        const onVersions = { tracks: shown(document.querySelector(".track-list-wrap")), pane: shown(document.getElementById("album-versions-pane")) };
        const credits = () => asked.filter(u => u.includes("/api/album/credits")).length;
        const before = credits();
        rows()[1].click();
        await until(() => rows().length === 2 && rows()[1].classList.contains("is-current"));
        const after = { title: document.getElementById("modal-title").textContent, tab: document.getElementById("album-modal").dataset.albumTab,
          creditsAsked: credits() - before, tracks: shown(document.querySelector(".track-list-wrap")), quality: document.getElementById("modal-quality").textContent };
        const more = [...document.querySelectorAll("#modal-actions .overflow-menu .sel-menu-item")].map(m => m.textContent);
        return { mark, tabs, title, listed, onVersions, after, more };
      })()`);
      assert.deepEqual(tab.errors, []);
      assert.equal(seen.mark, "2 versions");
      assert.deepEqual(seen.tabs, ["Tracks", "Credits", "About", "Versions 2"]);
      assert.equal(seen.title, "Metallic 'KO", "its title without its version's words");
      assert.deepEqual(seen.listed.map(r => r.slice(0, 3)), [["2015 Remaster", "24-bit / 96 kHz", "Main Viewing"], ["Original", "16-bit / 44.1 kHz", ""]]);
      assert.match(seen.listed[0][3], /^2 tracks · 0:02 · 1976$/);
      assert.deepEqual(seen.onVersions, { tracks: false, pane: true });
      assert.deepEqual(seen.after, { title: "Metallic 'KO", tab: "tracks", creditsAsked: 0, tracks: true, quality: "16/44.1" },
        "the other shown in its place: its tracks and rate, the title as it was, nothing album-wide asked again");
      assert.ok(seen.more.includes("Make this the main version"), seen.more.join(", "));
    } finally { await b.close(); }
  }

  // The original chosen as the main: the lists show it from now, and across a scan.
  const original = page.versions.find(v => !v.main);
  const r = await fetch(srv.base + "/api/album/versions/main", { method: "POST", headers: H, body: JSON.stringify({ offset: original.offset }) });
  assert.equal(r.status, 200);
  const shown = async () => { const k = (await wall()).find(a => a.title.startsWith("Metallic")); return k && k.offset === original.offset && k; };
  const now = await until(shown, 30000, "the original as the main");
  assert.deepEqual([now.title, now.version, now.versions], ["Metallic 'KO", "Original · 16/44.1", 2]);
  await fetch(srv.base + "/api/library/rescan", { method: "POST", headers: H });
  await until(async () => { const s = await get("/api/status"); return s && !s.scanning; }, 60000, "the scan");
  assert.ok(await shown(), "kept across a scan");
  assert.equal((await fetch(srv.base + "/api/album/versions/main", { method: "POST", headers: H,
    body: JSON.stringify({ offset: albums.find(a => a.title === "Peter Gabriel").offset }) })).status, 400, "an album of one version has no main to choose");
});
