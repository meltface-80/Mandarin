"use strict";
/*
 * Item 522: the default service (Settings → Services) and an artist's albums on it, for their page's Discography,
 * against a fake Qobuz (test/fake-qobuz.js):
 *   - no default service at first: the choices are the streaming services, Qobuz signed in; none is answered empty;
 *   - Qobuz chosen: the artist's Qobuz albums the library doesn't have, newest first. Left out: the one a favourite
 *     brought into the library, another edition of the album of your own files ("Album One (2015 Remaster)"), and all
 *     but the plain edition of one ("Second Wind (Deluxe Edition)"); kept: a live album of the same name, which is
 *     another album, and "Third Way - Remastered 2011", the only edition of it;
 *   - asked again, Qobuz isn't (kept for a day); none chosen again: empty;
 *   - on the artist's page in a browser (where one is found): "More on Qobuz" right after the library's Albums, the
 *     Qobuz browser's tiles in that order, Discography's.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeQobuz } = require("./fake-qobuz");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

test("item 522: the default service's albums of an artist, after the library's", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const file = path.join(lib.music, "Artist A", "Album One", "01 Song 1.flac");
  const album = (id, title, year) => ({ id, title, artist: "Artist A", year, rate: 44100, bits: 16, tracks: [{ id: id * 10, title: title + " 1", file, duration: 3 }] });
  const qobuz = new FakeQobuz({ albums: [
    album(2001, "Album One (2015 Remaster)", 2015),
    album(2002, "Second Wind", 2018),
    album(2003, "Second Wind (Deluxe Edition)", 2019),
    album(2004, "Third Way - Remastered 2011", 2011),
    album(2005, "Fourth", 2020),
    album(2006, "Album One (Live)", 2016)
  ] });
  await qobuz.start();
  qobuz.favourites.add("2005");
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000 });
  await srv.start();
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const discography = () => api("artist-discography?artist=" + encodeURIComponent("Artist A"));
  try {
    await until(async () => (await api("status")).index_count >= 3);
    assert.equal((await api("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
    await api("settings/qobuz", { import: true });
    await until(async () => (await api("library/albums?count=200")).albums.some(a => a.title === "Fourth"), 30000);

    const first = await api("settings/default-service");
    assert.equal(first.service, "", "none chosen at first");
    assert.deepEqual(first.choices.map(c => c.id + ":" + c.connected), ["qobuz:true", "tidal:false"]);
    assert.deepEqual((await discography()).albums, [], "no default service: nothing but the library's");

    assert.equal((await api("settings/default-service", { service: "napster" })).status, 400);
    assert.equal((await api("settings/default-service", { service: "qobuz" })).service, "qobuz");
    assert.equal((await api("settings/default-service")).service, "qobuz", "kept");

    const d = await discography();
    assert.equal(d.service, "qobuz");
    assert.equal(d.name, "Qobuz");
    assert.deepEqual(d.albums.map(a => a.title), ["Second Wind", "Album One (Live)", "Third Way - Remastered 2011"], JSON.stringify(d.albums.map(a => a.title)));
    assert.ok(d.albums.every(a => a.id && a.image), "each with its id and cover, as the Qobuz browser's tiles");

    const asked = qobuz.calls["artist/get"];
    assert.ok(asked >= 1);
    assert.equal((await discography()).albums.length, 3);
    assert.equal(qobuz.calls["artist/get"], asked, "kept: Qobuz not asked again");

    if (findBrowser()) {
      const b = await Browser.launch({ width: 390, height: 844 });
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
        const seen = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => document.querySelector("#home-view .album"));
          const grid = document.getElementById("album-grid");
          window.__showArtistAlbums("Artist A");
          const heads = () => [...grid.querySelectorAll(":scope > .artist-section-header")];
          await until(() => heads().some(h => h.textContent === "More on Qobuz"));
          const more = heads().find(h => h.textContent === "More on Qobuz");
          const tiles = [];
          for (let el = more.nextElementSibling; el && !el.classList.contains("artist-section-header") && !el.classList.contains("artist-tail"); el = el.nextElementSibling) tiles.push(el.textContent);
          return { heads: heads().map(h => h.textContent), tiles, disc: more.classList.contains("artist-disc") };
        })()`);
        assert.deepEqual(page.errors, []);
        assert.deepEqual(seen.heads.slice(0, 2), ["Albums", "More on Qobuz"], JSON.stringify(seen.heads));
        assert.equal(seen.tiles.length, 3);
        ["Second Wind", "Album One (Live)", "Third Way"].forEach((t, i) => assert.ok(seen.tiles[i].includes(t), seen.tiles[i]));
        assert.ok(seen.disc, "on the Discography tab");
      } finally { await b.close(); }
    }

    assert.equal((await api("settings/default-service", { service: "" })).service, "");
    assert.deepEqual((await discography()).albums, []);
  } finally {
    await srv.stop();
    await qobuz.stop();
  }
});
