"use strict";
/*
 * Tidal (v0.6.24), against a fake on loopback (test/fake-tidal.js): signing
 * in on "tidal.com" with a link and a code, the favourites and playlists
 * into the library, a CD album played to a Sonos room from one address, a
 * hi-res album from MPEG-DASH through the server (24/48 to the room, the
 * rows corrected to what Tidal streams), a token refreshed when it stops
 * working, the browser, and signing out.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary, probe } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeTidal } = require("./fake-tidal");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3636, B = "http://127.0.0.1:" + PORT;
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

test("Tidal: the device sign-in, the library, CD and hi-res (DASH) to a room, a refreshed token, signed out", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const cdFiles = [1, 2, 3].map(i => path.join(lib.music, "Artist A", "Album One", `0${i} Song ${i}.flac`));
  const hiFiles = [1, 2].map(i => path.join(lib.music, "Artist B", "Hi Res", `0${i} Hi ${i}.flac`));
  const tidal = new FakeTidal({ art: path.join(lib.music, "Artist A", "Album One", "cover.jpg"), albums: [
    { id: 2001, title: "T Album", artist: "T Artist", year: 2021, hires: false, tracks: cdFiles.map((f, i) => ({ id: 8001 + i, title: "T Song " + (i + 1), file: f, duration: 3 })) },
    { id: 2002, title: "T Hi-Res", artist: "T Artist", year: 2022, hires: true, tracks: hiFiles.map((f, i) => ({ id: 9001 + i, title: "T Hi " + (i + 1), file: f, duration: 4, rate: 96000 })) },
    { id: 2003, title: "T Other", artist: "Somebody Else", year: 2020, hires: false, tracks: [{ id: 9501, title: "T Other 1", file: cdFiles[0], duration: 3 }] }
  ], playlists: [{ uuid: "aaaa-bbbb", name: "Long drive", tracks: [8002, 9501] }] });
  await tidal.start();
  tidal.favourites.add("2001");
  tidal.favourites.add("2002");
  tidal.favouriteTracks.add("9002");
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"],
    upnpMulticast: false, identify: false, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/", qobuzSyncDelayMs: 100000 });
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

    await t.test("signing in with a link and a code", async () => {
      assert.equal((await api("settings/tidal")).connected, false);
      assert.equal((await api("tidal/search?q=t")).status, 401, "nothing to browse with before signing in");
      const p = await api("settings/tidal/signin", {});
      assert.equal(p.status, 200, JSON.stringify(p));
      assert.equal(p.connected, false);
      assert.equal(p.pending.url, "https://link.tidal.com/ABCDE");
      assert.equal(p.pending.code, "ABCDE");
      await sleep(1500);
      assert.equal((await api("settings/tidal")).connected, false, "still waiting for the person");
      assert.ok(tidal.polls >= 1, "asked Tidal whether it has happened");
      // The person signs in on tidal.com.
      tidal.approve();
      const ok = await until(async () => { const s = await api("settings/tidal"); return s.connected && s; });
      assert.equal(ok.user.login, "tester@example.com");
      assert.equal(ok.user.name, "Tess");
      assert.equal(ok.subscription, "HIFI_PLUS");
      assert.equal(ok.hires, true);
      assert.equal(ok.pending, undefined);
      const kept = ctx.db.setting("tidal");
      assert.equal(kept.token.access, tidal.access);
      assert.equal(kept.token.refresh, tidal.refreshToken);
      assert.equal(kept.user.countryCode, "GB");
    });

    await t.test("favourites, playlists and favourite tracks into the library", async () => {
      // The sign-in started the import by itself (the import switch is on).
      const r = await until(async () => { const s = await api("settings/tidal"); return !s.importing && s.last_import && s; });
      assert.equal(r.last_import.albums, 2);
      assert.equal(r.last_import.playlists, 2);
      const albums = (await api("library/albums?sort=album")).albums;
      const t1 = albums.find(a => a.title === "T Album"), t2 = albums.find(a => a.title === "T Hi-Res");
      assert.ok(t1 && t2, "both on the walls: " + albums.map(a => a.title).join(", "));
      assert.equal(t1.source, "tidal");
      assert.equal(t1.quality, "16/44.1");
      assert.equal(t2.hires, true);
      assert.equal(albums.length, 5, "beside the three of your own (a playlist's album stays off the walls)");
      const pls = (await api("user-playlists")).playlists;
      const drive = pls.find(x => x.name === "Long drive"), favt = pls.find(x => x.name === "Tidal favourite tracks");
      assert.ok(drive && favt, pls.map(x => x.name).join(", "));
      assert.equal(drive.service, "tidal");
      assert.deepEqual((await api("user-playlist?id=" + drive.id)).tracks.map(x => x.title), ["T Song 2", "T Other 1"]);
      assert.deepEqual((await api("user-playlist?id=" + favt.id)).tracks.map(x => x.title), ["T Hi 2"]);
      const cu = await api("library/cleanup");
      assert.deepEqual(cu.tidal, { albums: 0, signed_in: true });
      const page = await api("album?offset=" + t1.offset);
      assert.deepEqual(page.tracks.map(x => x.title), ["T Song 1", "T Song 2", "T Song 3"]);
      assert.equal(page.album.source, "tidal");
      assert.equal(page.album.tidal_id, "2001");
      assert.equal(page.album.service_favourite, true, "the page knows it is a favourite, for the ⋯ menu");
      const art = ctx.db.raw.prepare("SELECT art_path FROM albums WHERE key = 'tidal:2001'").get().art_path;
      assert.ok(art && fs.existsSync(art), "its cover came from Tidal: " + art);
      const img = await fetch(B + "/api/image/" + encodeURIComponent(t1.image_key) + "?size=100", { headers: H });
      assert.equal(img.status, 200);
      await api("scan", {}, "POST");
      await until(async () => !(await api("status")).library_importing);
      assert.equal((await api("library/albums?sort=album")).albums.filter(a => a.source === "tidal").length, 2, "a scan leaves them alone");
    });

    await t.test("the page: signed in shows the Tidal browser, an album grid, a tap opens the album's page", { skip: !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)" }, async () => {
      const b = await Browser.launch({ width: 390, height: 844 });
      let r;
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        r = await page.eval(`(async () => {
          const sleep = ms => new Promise(r => setTimeout(r, ms));
          const $ = id => document.getElementById(id);
          const until = async (f, ms = 8000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(50); } };
          const out = {};
          out.shown = !!(await until(() => !$("tidal-toggle").classList.contains("hidden")));
          out.menu_item = !$("menu-item-tidal").classList.contains("hidden");
          $("tidal-toggle").click();
          await until(() => !$("tidal-overlay").classList.contains("hidden"));
          await until(() => document.querySelector('#tidal-tabs [data-qtab="top"]'));
          document.querySelector('#tidal-tabs [data-qtab="top"]').click();
          const list = $("tidal-nr-list");
          await until(() => list.querySelectorAll(".album.qobuz-tile").length >= 3);
          out.grid = list.classList.contains("album-grid");
          out.tiles = [...list.querySelectorAll(".album.qobuz-tile")].map(t => t.querySelector(".album-title").textContent + " | " + t.querySelector(".qobuz-tile-fav").textContent).sort();
          const other = [...list.querySelectorAll(".album.qobuz-tile")].find(t => t.querySelector(".album-title").textContent === "T Other");
          other.click();
          const modal = $("album-modal");
          await until(() => !modal.classList.contains("hidden") && $("modal-title").textContent === "T Other");
          await until(() => modal.querySelectorAll(".overflow-menu .sel-menu-item").length);
          out.page_menu = [...modal.querySelectorAll(".overflow-menu .sel-menu-item")].map(x => x.textContent);
          out.source = $("modal-source").className;
          modal.querySelector("[data-close]").click();
          await until(() => modal.classList.contains("hidden"));
          await sleep(200);
          out.back_on_top = !$("tidal-overlay").classList.contains("is-under") && !$("tidal-overlay").classList.contains("hidden");
          return out;
        })()`);
        assert.deepEqual(page.errors, []);
      } finally { await b.close(); }
      assert.equal(r.shown, true, "☰ → Tidal once signed in");
      assert.equal(r.menu_item, true);
      assert.equal(r.grid, true);
      assert.deepEqual(r.tiles, ["T Album | ✓", "T Hi-Res | ✓", "T Other | +"]);
      assert.ok(r.page_menu.includes("Add to Tidal favourites"), r.page_menu.join(", "));
      assert.ok(/tidal/.test(r.source), "the Tidal mark on the page's cover: " + r.source);
      assert.equal(r.back_on_top, true);
    });

    await t.test("a CD album to a room: one address, FLAC as it comes", async () => {
      const t1 = (await api("library/albums?sort=album")).albums.find(a => a.title === "T Album");
      const r = await api("play", { offset: t1.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      assert.equal(r.ok, true, JSON.stringify(r));
      await until(() => room.queue.length === 3);
      const f = await until(() => room.fetches.find(x => x.done));
      assert.equal(f.status, 200);
      assert.equal(f.type, "audio/flac");
      assert.deepEqual(probe(f.body), { rate: 44100, channels: 2, bits: 16 });
      assert.equal(tidal.playbackCalls[0].quality, "LOSSLESS", "CD quality asked for a CD track");
      assert.ok(tidal.fetches.length >= 1);
      const st = await until(async () => { const z = (await api("zone-state?zone=" + kitchen.zone_id)).zone; return z && z.state === "playing" && z.now_playing && z; });
      assert.equal(st.now_playing.line1, "T Song 1");
      assert.equal(st.now_playing.line3, "T Album");
      await until(() => tidal.fetches.length >= 2, 20000);   // the next made ready behind it
    });

    await t.test("a hi-res album to a Sonos room: DASH through the server, 24/48 sent, the rows corrected", async () => {
      const t2 = (await api("library/albums?sort=album")).albums.find(a => a.title === "T Hi-Res");
      tidal.playbackCalls.length = 0;
      room.fetches.length = 0;
      await api("play", { offset: t2.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      const f = await until(() => room.fetches.find(x => x.done && probe(x.body)), 30000);
      assert.deepEqual(probe(f.body), { rate: 48000, channels: 2, bits: 24 });
      assert.equal(tidal.playbackCalls[0].quality, "HI_RES_LOSSLESS");
      assert.ok(tidal.dashFetches.some(x => x.piece === "init.mp4") && tidal.dashFetches.some(x => x.piece === "1.m4s"), "the pieces fetched: " + JSON.stringify(tidal.dashFetches));
      const row = ctx.db.raw.prepare("SELECT sample_rate, bits FROM tracks WHERE path = 'tidal://track/9001'").get();
      assert.deepEqual(row, { sample_rate: 96000, bits: 24 }, "what Tidal streams it at, learnt");
      // The loopback-only route: nothing for anyone else.
      const d = await fetch(B + "/internal/dash/nope");
      assert.equal(d.status, 404);
    });

    await t.test("an account Tidal gives CD to: asked once, then CD straight away, never upsampled", async () => {
      tidal.denyHires = true;
      tidal.playbackCalls.length = 0;
      const t2 = ctx.library.album(ctx.db.raw.prepare("SELECT id FROM albums WHERE key = 'tidal:2002'").get().id);
      const [a, b] = ctx.library.tracks(t2.id);
      const ra = await ctx.tidal.resolve(a, { rate: 96000, bits: 24 });
      const rb = await ctx.tidal.resolve(b, { rate: 96000, bits: 24 });
      assert.deepEqual(tidal.playbackCalls.map(c => c.quality), ["HI_RES_LOSSLESS", "LOSSLESS"], "hi-res asked for once; CD from then on");
      assert.deepEqual([ra.rate, ra.bits, rb.rate, rb.bits], [44100, 16, 44100, 16]);
      assert.equal(ctx.tidal.hiresDenied, true);
      // The transcoder copies such a stream as it is rather than upsampling it to the plan.
      const plan = await ctx.transcoder.resolve.get(a, { transcode: true, rate: 96000, bits: 24, mime: "audio/flac", ext: "flac" });
      assert.deepEqual([plan.plan.copy, plan.plan.rate, plan.plan.bits], [true, 44100, 16]);
      // The setting touched: asked again, in case the account changed.
      await api("settings/tidal", { quality: "hires" });
      assert.equal(ctx.tidal.hiresDenied, false);
      tidal.denyHires = false;
    });

    await t.test("a token that stops working is refreshed, unasked", async () => {
      tidal.expireAccess();
      const s = await api("tidal/search?q=other");
      assert.equal(s.status, 200, JSON.stringify(s));
      assert.deepEqual(s.albums.map(a => a.title), ["T Other"]);
      assert.equal(tidal.refreshes, 1);
      assert.equal(ctx.db.setting("tidal").token.access, tidal.access, "the new token kept");
    });

    await t.test("the browser: search, the album's page, the favourite, Clean up", async () => {
      const s = await api("tidal/search?q=other");
      assert.equal(s.albums[0].favourited, false);
      assert.deepEqual((await api("tidal/lists")).lists.map(l => l.id), ["recommended", "top", "rising"], "the tabs come from Tidal (New Releases is its own)");
      assert.equal((await api("tidal/featured?type=recommended")).albums.length, 3);
      // An album a list gave is not asked for again when opened: its tracks only.
      const before = tidal.albumCalls;
      await api("tidal/open", { album_id: "2001" });
      assert.equal(tidal.albumCalls, before, "albums/<id> not asked again");
      assert.equal((await api("tidal/featured?type=nothing")).status, 404);
      const o = await api("tidal/open", { album_id: "2003" });
      assert.equal(o.ok, true, JSON.stringify(o));
      assert.equal((await api("album?offset=" + o.offset)).album.title, "T Other");
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "T Other"), false, "transient: not on the walls");
      assert.equal((await api("library/cleanup")).tidal.albums, 0, "a playlist's album is wanted, not stale");
      assert.equal((await api("tidal/state?album_id=2003")).favourite, false);
      await api("tidal/favorite", { album_id: "2003" });
      assert.ok(tidal.favourites.has("2003"), "on Tidal itself");
      assert.equal((await api("tidal/state?album_id=2003")).favourite, true);
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "T Other"), true);
      await api("tidal/unfavorite", { album_id: "2003" });
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "T Other"), false);
      assert.equal((await api("search/external?q=T+Album")).tidal.length, 1, "beside the library's search");
    });

    await t.test("signed out: nothing streams, the walls keep nothing of Tidal", async () => {
      const r = await api("settings/tidal/signout", {});
      assert.equal(r.connected, false);
      assert.equal(ctx.db.setting("tidal"), null);
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.source === "tidal"), false);
      assert.equal((await api("user-playlists")).playlists.some(x => x.service === "tidal"), false);
      const t1 = ctx.library.album(ctx.db.raw.prepare("SELECT id FROM albums WHERE key = 'tidal:2001'").get().id);
      assert.ok(t1, "the rows stay");
      const s = await fetch(B + "/stream/t" + ctx.library.tracks(t1.id)[0].id + ".flac", { headers: H });
      assert.notEqual(s.status, 200, "no stream without the account");
      const cu = await api("library/cleanup");
      assert.deepEqual(cu.tidal, { albums: 3, signed_in: false });
      const r2 = await api("library/cleanup", { kind: "tidal" });
      assert.equal(r2.removed, 3);
      assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM albums WHERE key LIKE 'tidal:%'").get().n, 0);
      assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM cache WHERE ns LIKE 'tidal-%'").get().n, 0);
      assert.ok(fs.existsSync(path.join(lib.data, "tidal", "art")), "covers kept beside the database");
    });
  } finally {
    await srv.stop().catch(() => {});
    await house.stop();
    await tidal.stop();
  }
});
