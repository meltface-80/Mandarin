"use strict";
/*
 * Qobuz (v0.6.23), against a fake Qobuz on loopback (test/fake-qobuz.js)
 * and the fake Sonos household:
 *   - signing in keeps the token, never the password; a wrong one is refused;
 *   - favourites and purchases become albums in the library, every one;
 *     one no longer a favourite goes back to transient (off the walls);
 *   - playing a Qobuz album to a room: the stream is asked for with a signed
 *     request, fetched into the transcode cache (copied as it comes at CD
 *     quality; a hi-res one converted to 24/48 for Sonos), and the room gets
 *     FLAC; the next track is made ready behind it;
 *   - every play is reported: Start when the device fetches, End when the
 *     next track starts;
 *   - an album played from the browser without being kept is reachable by
 *     id but not on the walls; signed out, nothing streams.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary, probe } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeQobuz } = require("./fake-qobuz");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3634, B = "http://127.0.0.1:" + PORT;
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

test("Qobuz: sign in, the library, playing with reports, transient albums", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const cdFiles = [1, 2, 3].map(i => path.join(lib.music, "Artist A", "Album One", `0${i} Song ${i}.flac`));
  const hiFiles = [1, 2].map(i => path.join(lib.music, "Artist B", "Hi Res", `0${i} Hi ${i}.flac`));
  const qobuz = new FakeQobuz({ art: path.join(lib.music, "Artist A", "Album One", "cover.jpg"), albums: [
    { id: 1001, title: "Q Album", artist: "Q Artist", year: 2021, rate: 44100, bits: 16, tracks: cdFiles.map((f, i) => ({ id: 5001 + i, title: "Q Song " + (i + 1), file: f, duration: 3 })) },
    { id: 1002, title: "Q Hi-Res", artist: "Q Artist", year: 2022, rate: 96000, bits: 24, tracks: hiFiles.map((f, i) => ({ id: 6001 + i, title: "Q Hi " + (i + 1), file: f, duration: 4 })) },
    { id: 1003, title: "Q Other", artist: "Someone Else", year: 2020, rate: 44100, bits: 16, tracks: [{ id: 7001, title: "Q Other 1", file: cdFiles[0], duration: 3 }] }
  ], playlists: [{ id: 9001, name: "Road trip", tracks: [5002, 7001] }] });
  await qobuz.start();
  qobuz.favourites.add("1001");
  qobuz.purchases.add("1002");
  qobuz.favouriteTracks.add("6002");
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"],
    upnpMulticast: false, identify: false, qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000 });
  const ctx = await srv.start();
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body || method ? { method: method || "POST", headers: H, body: JSON.stringify(body || {}) } : { headers: H });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  try {
    await until(async () => (await api("status")).index_count === 3);
    const kitchen = await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"));
    const room = house.room("Kitchen");

    await t.test("signing in", async () => {
      const before = await api("settings/qobuz");
      assert.equal(before.connected, false);
      assert.equal((await api("qobuz/search?q=q")).status, 401, "nothing to browse with before signing in");
      const bad = await api("settings/qobuz/signin", { username: "tester@example.com", password: "wrong" });
      assert.equal(bad.status, 401);
      const ok = await api("settings/qobuz/signin", { username: "tester@example.com", password: "pw" });
      assert.equal(ok.status, 200, JSON.stringify(ok));
      assert.equal(ok.connected, true);
      assert.equal(ok.user.login, "tester@example.com");
      assert.equal(ok.subscription, "Studio");
      assert.equal(ok.hires, true);
      const kept = ctx.db.setting("qobuz");
      assert.equal(kept.token, qobuz.token);
      assert.equal(JSON.stringify(kept).includes("pw"), false, "the password is not kept");
    });

    await t.test("favourites and purchases into the library", async () => {
      const r = await api("settings/qobuz/import", {});
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.result.albums, 2);
      const albums = (await api("library/albums?sort=album")).albums;
      const q1 = albums.find(a => a.title === "Q Album"), q2 = albums.find(a => a.title === "Q Hi-Res");
      assert.ok(q1 && q2, "both on the walls: " + albums.map(a => a.title).join(", "));
      assert.equal(q1.source, "qobuz");
      assert.equal(q1.quality, "16/44.1");
      assert.equal(q2.quality, "24/96");
      assert.equal(q2.hires, true);
      assert.equal(albums.length, 5, "beside the three of your own (a playlist's albums stay off the walls)");
      // Playlists: the Qobuz one by its name, and the favourite tracks, as playlists here.
      assert.equal(r.result.playlists, 2);
      const pls = (await api("user-playlists")).playlists;
      const road = pls.find(x => x.name === "Road trip"), favt = pls.find(x => x.name === "Qobuz favourite tracks");
      assert.ok(road && favt, pls.map(x => x.name).join(", "));
      assert.equal(road.qobuz, true);
      const roadFull = await api("user-playlist?id=" + road.id);
      assert.deepEqual(roadFull.tracks.map(x => x.title), ["Q Song 2", "Q Other 1"]);
      assert.equal(roadFull.tracks[1].album_title, "Q Other");
      assert.deepEqual((await api("user-playlist?id=" + favt.id)).tracks.map(x => x.title), ["Q Hi 2"]);
      // Nothing stale while everything is wanted.
      const cu = await api("library/cleanup");
      assert.deepEqual(cu, { status: 200, files: { albums: 0, tracks: 0, folders: 0 }, qobuz: { albums: 0, signed_in: true }, tidal: { albums: 0, signed_in: false } });
      const page = await api("album?offset=" + q1.offset);
      assert.deepEqual(page.tracks.map(x => x.title), ["Q Song 1", "Q Song 2", "Q Song 3"]);
      assert.equal(page.album.source, "qobuz");
      // Its cover came from Qobuz.
      const img = await fetch(B + "/api/image/" + encodeURIComponent(q1.image_key) + "?size=100", { headers: H });
      assert.equal(img.status, 200);
      // A scan leaves them alone.
      await api("scan", {}, "POST");
      await until(async () => !(await api("status")).library_importing);
      assert.equal((await api("library/albums?sort=album")).albums.filter(a => a.source === "qobuz").length, 2);
      // The search page finds them, and the catalogue beside them.
      const s = await api("search?q=Q+Album");
      assert.ok(s.results.some(a => a.title === "Q Album"));
    });

    await t.test("playing to a room: signed asks, the cache, FLAC to the room, reports", async () => {
      const q1 = (await api("library/albums?sort=album")).albums.find(a => a.title === "Q Album");
      const r = await api("play", { offset: q1.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      assert.equal(r.ok, true, JSON.stringify(r));
      await until(() => room.queue.length === 3);
      const f = await until(() => room.fetches.find(x => x.done));
      assert.equal(f.status, 200);
      assert.equal(f.type, "audio/flac");
      assert.deepEqual(probe(f.body), { rate: 44100, channels: 2, bits: 16 }, "CD quality as it comes");
      assert.ok(qobuz.fileUrlCalls.length >= 1 && qobuz.fileUrlCalls.every(c => c.sig_ok), "every ask signed");
      assert.equal(qobuz.fileUrlCalls[0].format_id, 6, "CD quality asked for a CD track");
      assert.ok(fs.readdirSync(path.join(lib.data, "transcode")).some(n => n.endsWith(".flac")), "in the cache");
      const st = await until(async () => { const z = (await api("zone-state?zone=" + kitchen.zone_id)).zone; return z && z.state === "playing" && z.now_playing && z; });
      assert.equal(st.now_playing.line1, "Q Song 1");
      assert.equal(st.now_playing.line3, "Q Album");
      // Reported: Start for the first track; End for it once the second starts.
      await until(() => qobuz.reports.some(x => x.which === "start" && x.event.track_id === 5001));
      const start = qobuz.reports.find(x => x.which === "start");
      assert.equal(start.event.user_id, 4242);
      assert.equal(start.event.credential_id, 77);
      assert.equal(start.event.intent, "streaming");
      assert.equal(start.event.local, false);
      assert.equal(start.event.format_id, 6);
      // The next track was made ready behind it (the fake room fetches only when told to move on).
      await until(() => qobuz.fetches.length >= 2);
      await sleep(1200);
      await api("control", { zone_or_output_id: kitchen.zone_id, command: "next" });
      await until(() => qobuz.reports.some(x => x.which === "end" && x.event.track_id === 5001), 20000);
      const end = qobuz.reports.find(x => x.which === "end" && x.event.track_id === 5001);
      assert.ok(end.event.duration >= 1 && end.event.duration <= 3, "how long it was on: " + end.event.duration);
      await until(() => qobuz.reports.some(x => x.which === "start" && x.event.track_id === 5002));
    });

    await t.test("a hi-res album to a Sonos room: the 24/96 tier asked for, 24/48 sent", async () => {
      const q2 = (await api("library/albums?sort=album")).albums.find(a => a.title === "Q Hi-Res");
      qobuz.fileUrlCalls.length = 0;
      room.fetches.length = 0;
      await api("play", { offset: q2.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      const f = await until(() => room.fetches.find(x => x.done && probe(x.body)));
      assert.deepEqual(probe(f.body), { rate: 48000, channels: 2, bits: 24 });
      assert.equal(qobuz.fileUrlCalls[0].format_id, 7);
    });

    await t.test("the browser: search, an album's tracks, played without being kept", async () => {
      const s = await api("qobuz/search?q=other");
      assert.equal(s.connected, true);
      assert.deepEqual(s.albums.map(a => a.title), ["Q Other"]);
      assert.equal(s.albums[0].favourited, false);
      const d = await api("qobuz/album?id=1003");
      assert.deepEqual(d.tracks.map(x => x.title), ["Q Other 1"]);
      assert.equal(typeof d.offset, "number", "known already: a playlist holds one of its tracks");
      const p = await api("qobuz/play", { album_id: "1003", zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      assert.equal(p.ok, true, JSON.stringify(p));
      const st = await until(async () => { const z = (await api("zone-state?zone=" + kitchen.zone_id)).zone; return z && z.now_playing && z.now_playing.line3 === "Q Other" && z; });
      assert.equal(st.now_playing.line1, "Q Other 1");
      // Reachable by id (its page opens), off the walls.
      assert.equal((await api("album?offset=" + p.offset)).album.title, "Q Other");
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "Q Other"), false, "transient: not on the walls");
      assert.equal((await api("library/cleanup")).qobuz.albums, 0, "a playlist's album is wanted, not stale");
      // Favourited: kept, on the walls — and on Qobuz; the page's plus knows.
      assert.equal((await api("qobuz/state?album_id=1003")).favourite, false);
      await api("qobuz/favorite", { album_id: "1003" });
      assert.ok(qobuz.favourites.has("1003"));
      assert.equal((await api("qobuz/state?album_id=1003")).favourite, true);
      assert.equal((await api("album?offset=" + p.offset)).album.qobuz_id, "1003");
      assert.equal((await api("album?offset=" + p.offset)).album.qobuz_favourite, true, "the page knows it is a favourite");
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "Q Other"), true);
      await api("qobuz/unfavorite", { album_id: "1003" });
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "Q Other"), false);
    });

    await t.test("the browser on the page: an album grid, + / ✓ on the covers, a tap opens the album's page", { skip: !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)" }, async () => {
      const b = await Browser.launch({ width: 390, height: 844 });
      let r;
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        r = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const $ = id => document.getElementById(id);
          const until = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
          const out = {};
          await until(() => !$("qobuz-toggle").classList.contains("hidden"));
          $("qobuz-toggle").click();
          await until(() => !$("qobuz-overlay").classList.contains("hidden"));
          document.querySelector('#qobuz-tabs [data-qtab="best-sellers"]').click();
          const list = $("qobuz-nr-list");
          await until(() => list.querySelectorAll(".album.qobuz-tile").length >= 3);
          out.grid = list.classList.contains("album-grid");
          const tiles = [...list.querySelectorAll(".album.qobuz-tile")];
          out.tiles = tiles.map(t => t.querySelector(".album-title").textContent + " | " + t.querySelector(".album-artist").textContent + " | " + t.querySelector(".qobuz-tile-fav").textContent);
          out.art = tiles.every(t => t.querySelector(".album-art-wrap img"));
          out.columns = getComputedStyle(list).gridTemplateColumns.split(" ").length;
          const other = tiles.find(t => t.querySelector(".album-title").textContent === "Q Other");
          other.click();
          const modal = $("album-modal");
          await until(() => !modal.classList.contains("hidden") && $("modal-title").textContent === "Q Other");
          out.page_title = $("modal-title").textContent;
          out.under = $("qobuz-overlay").classList.contains("is-under");
          out.page_above = parseInt(getComputedStyle(modal).zIndex) > parseInt(getComputedStyle($("qobuz-overlay")).zIndex);
          await until(() => modal.querySelectorAll(".overflow-menu .sel-menu-item").length);
          out.page_menu = [...modal.querySelectorAll(".overflow-menu .sel-menu-item")].map(b => b.textContent);
          modal.querySelector("[data-close]").click();
          await until(() => modal.classList.contains("hidden"));
          await sleep(200);
          out.back_on_top = !$("qobuz-overlay").classList.contains("is-under") && !$("qobuz-overlay").classList.contains("hidden");
          out.tiles_kept = list.querySelectorAll(".album.qobuz-tile").length;
          return out;
        })()`);
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
      assert.equal(r.grid, true, "the album grid the rest of the UI draws");
      assert.equal(r.columns, 3, "three columns on a phone");
      assert.deepEqual(r.tiles.sort(), ["Q Album | Q Artist | ✓", "Q Hi-Res | Q Artist | +", "Q Other | Someone Else | +"]);
      assert.equal(r.art, true);
      assert.equal(r.page_title, "Q Other", "a tap opens the album's own page");
      assert.equal(r.under, true); assert.equal(r.page_above, true, "over the browser");
      assert.ok(r.page_menu.includes("Add to Qobuz favourites"), "the ⋯ menu offers the Qobuz favourite: " + r.page_menu.join(", "));
      assert.equal(r.back_on_top, true, "closed, the browser is back where it was");
      assert.equal(r.tiles_kept, 3);
    });

    // The search from Home (v0.6.24): Qobuz's albums as tiles of the results,
    // its artists as chips, an album's page from a tile, the artist's albums
    // in the Qobuz browser from a chip.
    await t.test("the search from Home asks Qobuz: tiles, artist chips, the album's page", { skip: !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)" }, async () => {
      const b = await Browser.launch({ width: 390, height: 844 });
      let r;
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        r = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const $ = id => document.getElementById(id);
          const until = async (f, ms = 10000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
          const out = {};
          await until(() => typeof window.__runSearch === "function" && window.__serviceBrowsers && window.__serviceBrowsers.qobuz);
          window.__runSearch("Someone Else");
          const wrap = await until(() => document.querySelector(".ext-search-wrap"));
          if (!wrap) return { no_wrap: true };
          out.headers = [...wrap.querySelectorAll(".search-section-header")].map(h => h.textContent);
          out.tiles = [...wrap.querySelectorAll(".album.qobuz-tile")].map(t => t.querySelector(".album-title").textContent + " | " + t.querySelector(".qobuz-tile-fav").textContent);
          out.chips = [...wrap.querySelectorAll(".ext-search-artists .qobuz-artist-chip")].map(c => c.textContent);
          wrap.querySelector(".album.qobuz-tile").click();
          const modal = $("album-modal");
          await until(() => !modal.classList.contains("hidden") && $("modal-title").textContent === "Q Other");
          out.page_title = $("modal-title").textContent;
          out.overlay_hidden = $("qobuz-overlay").classList.contains("hidden");
          modal.querySelector("[data-close]").click();
          await until(() => modal.classList.contains("hidden"));
          out.results_kept = !!document.querySelector(".ext-search-wrap .album.qobuz-tile");
          wrap.querySelector(".ext-search-artists .qobuz-artist-chip").click();
          await until(() => !$("qobuz-overlay").classList.contains("hidden") && !$("qobuz-artist-head").classList.contains("hidden"));
          out.artist_head = ($("qobuz-artist-head").textContent || "").includes("Artist A");   // the fake's artist page
          return out;
        })()`);
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
      assert.ok(!r.no_wrap, "Qobuz answered the search");
      assert.ok(r.headers.includes("Qobuz"), r.headers.join(", "));
      assert.deepEqual(r.tiles, ["Q Other | +"], "its album as a tile, the favourite as +");
      assert.deepEqual(r.chips, ["Someone Else"], "its artist as a chip");
      assert.equal(r.page_title, "Q Other", "a tap opens the album's own page");
      assert.equal(r.overlay_hidden, true, "over the results, not the Qobuz browser");
      assert.equal(r.results_kept, true, "closed, the results are still there");
      assert.equal(r.artist_head, true, "the chip opens the artist's albums in the Qobuz browser");
    });

    // Rescan library (v0.6.24): the folder, then the services signed in with
    // the import on — a favourite added on Qobuz is in the library afterwards.
    await t.test("Rescan library goes on to Qobuz once the folder is scanned", async () => {
      const before = (await api("settings/qobuz")).last_import;
      qobuz.favourites.add("1003");
      const r = await api("library/rescan", {});
      assert.ok(["rebuilt", "fresh"].includes(r.status), r.status);
      assert.deepEqual(r.services, ["Qobuz"], "the answer names what follows");
      await until(async () => { const li = (await api("settings/qobuz")).last_import; return li && li.at !== (before && before.at); });
      await until(async () => (await api("library/albums?sort=album")).albums.some(a => a.title === "Q Other"));
      assert.equal((await api("settings/qobuz")).kept, 3, "the new favourite is kept after the rescan");
      qobuz.favourites.delete("1003");
      await api("settings/qobuz/import", {});
    });

    await t.test("signed out: nothing streams, the walls keep nothing of Qobuz", async () => {
      const r = await api("settings/qobuz/signout", {});
      assert.equal(r.connected, false);
      assert.equal((await api("qobuz/search?q=q")).status, 401);
      // An End report for what was playing went out with the sign-out.
      assert.ok(qobuz.reports.filter(x => x.which === "end").length >= 2, JSON.stringify(qobuz.reports.map(x => x.which + ":" + x.event.track_id)));
      // Off the walls and off the Playlists screen, the rows kept for the sign-in that follows.
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.source === "qobuz"), false);
      assert.equal((await api("user-playlists")).playlists.some(x => x.qobuz), false);
      const q1 = ctx.library.album(ctx.db.raw.prepare("SELECT id FROM albums WHERE key = 'qobuz:1001'").get().id);
      assert.ok(q1, "the rows stay");
      const s = await fetch(B + "/stream/t" + ctx.library.tracks(q1.id)[0].id + ".flac", { headers: H });
      assert.notEqual(s.status, 200, "no stream without the account");
      // Clean up: signed out, every Qobuz album counts as stale; removed on request, plays kept.
      const cu = await api("library/cleanup");
      assert.equal(cu.qobuz.signed_in, false);
      assert.equal(cu.qobuz.albums, 3);
      const playsBefore = ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM plays").get().n;
      const r2 = await api("library/cleanup", { kind: "qobuz" });
      assert.equal(r2.removed, 3);
      assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM albums WHERE key LIKE 'qobuz:%'").get().n, 0);
      assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM plays").get().n, playsBefore, "plays stay");
      assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM cache WHERE ns LIKE 'qobuz-%'").get().n, 0);
    });
  } finally {
    await srv.stop().catch(() => {});
    await house.stop();
    await qobuz.stop();
  }
});
