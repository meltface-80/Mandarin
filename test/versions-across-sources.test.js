"use strict";
/*
 * Item 523: one album held in several sources shows once, its other copies its versions, against a fake Qobuz
 * (test/fake-qobuz.js). The library's own "Album One" by Artist A (1997, three tracks) and "Hi Res" by Artist B, and
 * Qobuz favourites:
 *   - "Album One", 1998, three tracks: the same album from another source, a year apart (a store's date): a version;
 *   - "Album One", 2005, two tracks: another album of the same name (as Peter Gabriel's), its own;
 *   - "Hi Res (Deluxe Edition)" by Artist B, 2021: a version of your "Hi Res" (its edition).
 * Each version says where it is from. The main is the best (here your files', the Qobuz copies being of a lower rate);
 * with Qobuz the default service (Settings → Services), Qobuz's copy is the main, the walls showing it. On the album's
 * Versions tab in a browser (where one is found), each row says where it is from.
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

test("item 523: one album from several sources shows once, the others its versions, the default service's the main", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const files = [1, 2, 3].map(i => path.join(lib.music, "Artist A", "Album One", `0${i} Song ${i}.flac`));
  const album = (id, title, year, n, artist = "Artist A") => ({ id, title, artist, year, rate: 22050, bits: 16,
    tracks: files.slice(0, n).map((file, i) => ({ id: id * 10 + i, title: "Song " + (i + 1), file, duration: 3 })) });
  const qobuz = new FakeQobuz({ albums: [album(3001, "Album One", 1998, 3), album(3002, "Hi Res (Deluxe Edition)", 2021, 2, "Artist B"), album(3003, "Album One", 2005, 2)] });
  await qobuz.start();
  for (const id of ["3001", "3002", "3003"]) qobuz.favourites.add(id);
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
  const all = async () => (await api("library/albums?count=200")).albums;
  const tiles = async () => (await all()).filter(a => /^Album One/.test(a.title) && a.subtitle === "Artist A");
  const hiRes = async () => (await all()).filter(a => /^Hi Res/.test(a.title));
  try {
    await until(async () => (await api("status")).index_count >= 3);
    assert.equal((await api("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
    await api("settings/qobuz", { import: true });
    await until(async () => (await tiles()).length === 2 && (await hiRes()).length === 1, 30000);

    const shown = await tiles();
    const one = shown.find(a => a.versions === 2);
    assert.ok(one, "your copy and Qobuz's one tile: " + JSON.stringify(shown.map(a => [a.title, a.source, a.versions])));
    const other = shown.find(a => a !== one);
    assert.ok(!other.versions, "the 2005 album of the same name its own");
    assert.equal(one.source || "local", "local", "your files' the main: the best of them");

    const page = await api("album?offset=" + one.offset);
    assert.deepEqual(page.versions.map(v => v.from).sort(), ["Qobuz", "Your files"]);
    assert.equal(page.versions.find(v => v.main).from, "Your files");
    const hi = (await hiRes())[0];
    assert.equal(hi.versions, 2, "your Hi Res and Qobuz's deluxe edition one tile");
    const hiPage = await api("album?offset=" + hi.offset);
    assert.ok(hiPage.versions.some(v => v.from === "Qobuz" && /Deluxe Edition/.test(v.edition || "")), JSON.stringify(hiPage.versions.map(v => [v.from, v.edition])));

    if (findBrowser()) {
      const b = await Browser.launch({ width: 390, height: 844 });
      try {
        const tab = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        const formats = await tab.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out"); await sleep(50); } };
          await until(() => window.__openAlbum && document.querySelector("#home-view .album"));
          window.__openAlbum(${JSON.stringify(one)}, { source: "home" });
          const rows = () => [...document.querySelectorAll("#album-versions-pane .album-version-row")];
          await until(() => rows().length === 2);
          return rows().map(r => r.querySelector(".album-version-format").textContent);
        })()`);
        assert.deepEqual(tab.errors, []);
        assert.deepEqual(formats.map(f => f.split(" · ")[0]).sort(), ["Qobuz", "Your files"], JSON.stringify(formats));
      } finally { await b.close(); }
    }

    assert.equal((await api("settings/default-service", { service: "qobuz" })).service, "qobuz");
    const main = await until(async () => { const t = (await tiles()).find(a => a.versions === 2); return t && t.source === "qobuz" && t; });
    assert.equal((await api("album?offset=" + main.offset)).versions.find(v => v.main).from, "Qobuz");
  } finally {
    await srv.stop();
    await qobuz.stop();
  }
});
