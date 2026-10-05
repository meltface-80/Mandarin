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
  ] });
  await qobuz.start();
  qobuz.favourites.add("1001");
  qobuz.purchases.add("1002");
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
      assert.equal(albums.length, 5, "beside the three of your own");
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
      assert.equal(d.offset, null, "not in the library yet");
      const p = await api("qobuz/play", { album_id: "1003", zone_or_output_id: kitchen.zone_id, kind: "play_now" });
      assert.equal(p.ok, true, JSON.stringify(p));
      const st = await until(async () => { const z = (await api("zone-state?zone=" + kitchen.zone_id)).zone; return z && z.now_playing && z.now_playing.line3 === "Q Other" && z; });
      assert.equal(st.now_playing.line1, "Q Other 1");
      // Reachable by id (its page opens), off the walls.
      assert.equal((await api("album?offset=" + p.offset)).album.title, "Q Other");
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "Q Other"), false, "transient: not on the walls");
      // Favourited: kept, on the walls — and on Qobuz; the page's plus knows.
      assert.equal((await api("qobuz/state?album_id=1003")).favourite, false);
      await api("qobuz/favorite", { album_id: "1003" });
      assert.ok(qobuz.favourites.has("1003"));
      assert.equal((await api("qobuz/state?album_id=1003")).favourite, true);
      assert.equal((await api("album?offset=" + p.offset)).album.qobuz_id, "1003");
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "Q Other"), true);
      await api("qobuz/unfavorite", { album_id: "1003" });
      assert.equal((await api("library/albums?sort=album")).albums.some(a => a.title === "Q Other"), false);
    });

    await t.test("signed out: nothing streams, the walls keep nothing of Qobuz", async () => {
      const r = await api("settings/qobuz/signout", {});
      assert.equal(r.connected, false);
      assert.equal((await api("qobuz/search?q=q")).status, 401);
      // An End report for what was playing went out with the sign-out.
      assert.ok(qobuz.reports.filter(x => x.which === "end").length >= 2, JSON.stringify(qobuz.reports.map(x => x.which + ":" + x.event.track_id)));
      const q1 = ctx.library.albums.find(a => a.title === "Q Album");
      assert.ok(q1, "the kept albums stay in the library (the next import decides)");
      const s = await fetch(B + "/stream/t" + ctx.library.tracks(q1.id)[0].id + ".flac", { headers: H });
      assert.notEqual(s.status, 200, "no stream without the account");
    });
  } finally {
    await srv.stop().catch(() => {});
    await house.stop();
    await qobuz.stop();
  }
});
