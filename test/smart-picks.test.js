"use strict";
/*
 * Smart Picks: records you own and haven't been playing, by acts next to the
 * ones you play (Deezer's related lists — a fake on loopback), the rest from
 * the least-played corners; steady for the day, made again on asking, an
 * artist kept out. Made by the C# server from v0.8.20 (MANDARIN_FRONT=1
 * checks it answered).
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeDeezer } = require("./fake-deezer");

const FRONT = process.env.MANDARIN_FRONT === "1";
const PORT = 3648, B = "http://127.0.0.1:" + PORT;
const DAY = 86400000;

test("Smart Picks: by acts near what you play, then the least played; made again; an artist kept out", { skip: !haveFfmpeg() && "ffmpeg is not installed", timeout: 60000 }, async () => {
  const lib = makeLibrary();
  for (const [artist, album] of [["Artist C", "Third"], ["Artist D", "Fourth"], ["Artist E", "Fifth"]])
    gen(path.join(lib.music, artist, album, "01 One.flac"), { tags: { title: "One", artist, album, track: 1 } });
  const deezer = new FakeDeezer({
    "search/artist?limit=10&q=Seed%20Act": { data: [{ id: 300, name: "Seed Act", nb_fan: 9000 }] },
    "artist/300/related?limit=25": { data: [{ id: 301, name: "Artist C" }, { id: 302, name: "Nobody Here" }] }
  });
  await deezer.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, deezerBaseUrl: deezer.base });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    const call = async (p, body) => {
      const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(body) } : { headers: H });
      if (FRONT) assert.equal(r.headers.get("x-mandarin-answered"), "C#", p + ": made by the C# server");
      return Object.assign({ status: r.status }, await r.json());
    };
    const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise(r => setTimeout(r, 100)); } };
    await until(async () => (await (await fetch(B + "/api/status", { headers: H })).json()).index_count === 6);
    const albumOf = title => ctx.library.albums.find(a => a.title === title);
    // Seed Act played on three days this month (a stream: not in the library), and Album One yesterday.
    const now = Date.now();
    for (let d = 1; d <= 3; d++) ctx.features.insertPlay.run(null, null, "Song", "Seed Act", "Their Record", "z", now - d * DAY);
    ctx.features.insertPlay.run(albumOf("Album One").id, null, "Song 1", "Artist A", "Album One", "z", now - DAY);

    let r = await call("smart-picks/rebuild", {});
    assert.deepEqual([r.status, r.ok, r.building], [200, true, true]);
    // Made again: the day's first five (made after the scan, before any plays) give way.
    r = await until(async () => { const j = await call("smart-picks"); return j.picks.length && j.picks[0].reason.startsWith("Because") && j; });
    const p = new Date(), pad = n => (n < 10 ? "0" : "") + n;
    assert.deepEqual([r.day, r.enabled, r.hour, r.service_ready, r.auto_add, r.building], [p.getFullYear() + "-" + pad(p.getMonth() + 1) + "-" + pad(p.getDate()), true, 4, true, false, false]);
    assert.deepEqual([r.picks[0].album, r.picks[0].artist, r.picks[0].reason], ["Third", "Artist C", "Because you have been playing Seed Act"], "an act next to what you play, first");
    assert.deepEqual(r.picks.slice(1).map(x => x.album).sort(), ["Fifth", "Fourth", "Hi Res"], "then the least played; not Album One (played lately), not a compilation");
    assert.ok(r.picks.slice(1).every(x => x.reason === "Never played here"));
    const third = albumOf("Third");
    assert.deepEqual(r.picks[0], { artist: "Artist C", album: "Third", image: `/api/image/${encodeURIComponent(third.image_key)}?size=400`,
      reason: "Because you have been playing Seed Act", offset: third.id, library_title: "Third", library_subtitle: "Artist C", image_key: third.image_key });
    // Steady for the day.
    assert.deepEqual((await call("smart-picks")).picks, r.picks);

    // An artist kept out: off today's list at once, and not picked again.
    assert.deepEqual(await call("smart-picks/block", { artist: "Artist C" }), { status: 200, ok: true, artist: "Artist C" });
    assert.ok(!(await call("smart-picks")).picks.some(x => x.album === "Third"));
    ctx.features.insertPlay.run(albumOf("Fourth").id, null, "One", "Artist D", "Fourth", "z", Date.now());
    await call("smart-picks/rebuild", {});
    r = await until(async () => { const j = await call("smart-picks"); return !j.picks.some(x => x.album === "Fourth") && j; });
    assert.deepEqual(r.picks.map(x => x.album).sort(), ["Fifth", "Hi Res"], "Third kept out, Fourth just played");
    assert.deepEqual(await call("smart-picks/block", { artist: " " }), { status: 400, error: "artist required" });
    assert.deepEqual(await call("smart-picks/block", { artist: "!!!" }), { status: 400, error: "unrecognisable artist name" });

    // Seed Act's related acts came from Deezer once: kept a week.
    assert.equal(deezer.calls.filter(c => c === "artist/300/related?limit=25").length, 1, JSON.stringify(deezer.calls));
    if (FRONT) assert.equal(ctx.features.handedOver, true, "not made by the Node server");
  } finally { await srv.stop(); await deezer.stop(); }
});
