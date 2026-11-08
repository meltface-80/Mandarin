"use strict";
/*
 * Versions of one album (item 345): the original Metallic 'KO and its 2015 remaster are one album with two versions, not
 * two tiles with nothing to tell them apart. The lists (the wall, an artist's page, search) show the main version alone,
 * saying how many there are: the highest resolution, until another is chosen on the album's page, which is kept. The
 * album's page lists every version, each saying what tells it apart ("2015 Remaster · 24/96", "Original · 16/44.1").
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
  // The lists elsewhere: one album on the artist's page and in search.
  assert.deepEqual(titles((await get("/api/artist-albums?artist=" + encodeURIComponent("Iggy and The Stooges"))).primary), ["Metallic 'KO (2015 Remaster)"]);
  assert.deepEqual(titles((await get("/api/search?q=metallic")).results), ["Metallic 'KO (2015 Remaster)"]);

  // On the page: the tile says how many versions; the album's page lists them, the one open ringed, Make main on the other.
  if (!noBrowser) {
    const b = await Browser.launch({ width: 390, height: 844 });
    try {
      const token = H.Authorization.replace("Bearer ", "");
      const tab = await b.page(srv.base + "/", { cookies: [{ name: "musicd_session", value: token, url: srv.base }] });
      const seen = await tab.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
        await until(() => window.__openAlbum && document.querySelector("#home-view .album"));
        const tile = await until(() => [...document.querySelectorAll(".album")].find(t => /Metallic/.test(t.textContent) && t.querySelector(".album-versions")), 10000);
        const mark = tile ? tile.querySelector(".album-versions").textContent : null;
        const pills = async (a) => { window.__openAlbum(a, { source: "home" }); const want = a.label || a.version;
          await until(() => [...document.querySelectorAll("#modal-versions .modal-version")].some(p => p.textContent.startsWith(want) && p.getAttribute("aria-pressed") === "true"));
          return { pills: [...document.querySelectorAll("#modal-versions .modal-version")].map(p => [p.textContent, p.getAttribute("aria-pressed")]), main: !!document.querySelector("#modal-versions .modal-version-main") }; };
        return { mark, main: await pills(${JSON.stringify(ko)}), other: await pills(${JSON.stringify(page.versions[1])}) };
      })()`);
      assert.deepEqual(tab.errors, []);
      assert.deepEqual(seen, {
        mark: "2 versions",
        main: { pills: [["2015 Remaster · 24/96 · Main", "true"], ["Original · 16/44.1", "false"]], main: false },
        other: { pills: [["2015 Remaster · 24/96 · Main", "false"], ["Original · 16/44.1", "true"]], main: true }
      });
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
