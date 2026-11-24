"use strict";
/*
 * A track iBroadcast has under another album than before, or lists more than once (item 489). From noon on
 * 19 November, when iBroadcast's upload servers began to fail, every reading of the owner's iBroadcast library ended
 * "SQLite Error 19: UNIQUE constraint failed: tracks.path": 58 times by the evening, each undone whole, and said only as
 * a task that failed with no one waiting on it. Mandarin stood at 3,732 albums while iBroadcast had 4,927.
 *
 * Each album's tracks were written as new unless that album had them already; a track is one row whichever album it is
 * under. So any of these ended the reading:
 *   - a track moved to another album;
 *   - a track listed under two albums;
 *   - a track listed twice in one;
 *   - an album of several discs whose first entry changed (it is kept under its first entry's id), all its tracks then
 *     "another album's".
 * Each is read now, the track's row and its id kept (a queue or a play still knows it); and a reading that does fail
 * says so in the log.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { until } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const T = (id, title, track, more = {}) => Object.assign({ id, title, track, type: "audio/flac" }, more);
const albums = () => [
  { id: 101, name: "Alpha", artist: { id: 1, name: "Ann" }, year: 2001, tracks: [T(1001, "A1", 1), T(1002, "A2", 2)] },
  { id: 201, name: "Beta", artist: { id: 2, name: "Bob" }, year: 2002, tracks: [T(2001, "B1", 1), T(2002, "B2", 2)] },
  { id: 301, name: "Gamma", artist: { id: 3, name: "Cy" }, disc: 1, year: 2003, tracks: [T(3001, "G1", 1)] },
  { id: 302, name: "Gamma", artist: { id: 3, name: "Cy" }, disc: 2, year: 2003, tracks: [T(3002, "G2", 1)] },
];

test("item 489: a track under another album, or listed more than once, is read: one row, its id kept", { skip, timeout: 240000 }, async (t) => {
  const lib = makeLibrary();
  const ib = await new FakeIBroadcast({ albums: albums() }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 600000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const state = async () => (await fetch(base + "/api/settings/ibroadcast", { headers: H })).json();
  const post = async (p, body = {}) => { const r = await fetch(base + "/api/settings/ibroadcast" + p, { method: "POST", headers: H, body: JSON.stringify(body) }); return Object.assign({ status: r.status }, await r.json().catch(() => ({}))); };
  const db = ctx.db.raw;
  /** The iBroadcast tracks here: "album key / path" → row id. */
  const rows = () => Object.fromEntries(db.prepare("SELECT a.key AS album, t.path, t.id FROM tracks t JOIN albums a ON a.id = t.album_id WHERE t.path LIKE 'ibroadcast://track/%' ORDER BY t.path").all()
    .map(r => [r.album.replace("ibroadcast:", "") + "/" + r.path.replace("ibroadcast://track/", ""), r.id]));
  const ids = () => Object.fromEntries(db.prepare("SELECT path, id FROM tracks WHERE path LIKE 'ibroadcast://track/%'").all().map(r => [r.path.replace("ibroadcast://track/", ""), r.id]));
  const crashes = () => ctx.logs.filter(l => /UNIQUE constraint|a task failed with no one waiting|couldn't be read/.test(l));
  /** Update library now, after iBroadcast's library changed: what the reading found. */
  const read = async () => {
    ib.changed();
    const r = await post("/library");
    assert.equal(r.status, 200, JSON.stringify(r) + " " + JSON.stringify(crashes().slice(-2)));
    return (await state()).library;
  };

  await until(async () => { const s = await (await fetch(base + "/api/status", { headers: H })).json(); return s.index_count >= 3 && !s.scanning; }, 60000, "the library");
  await post("/signin");
  ib.approve();
  await until(async () => { const s = await state(); return s.library && s.library.albums === 3; }, 30000, "the library read");
  const first = ids();
  assert.deepEqual(Object.keys(rows()).sort(), ["101/1001", "101/1002", "201/2001", "201/2002", "301/3001", "301/3002"]);

  await t.test("two tracks change albums, one to an album written before its own and one after: moved, their ids kept", async () => {
    const [alpha, beta] = ib.albums;
    const a2 = alpha.tracks.pop(), b2 = beta.tracks.pop();
    alpha.tracks.push(b2); beta.tracks.push(a2);
    const found = await read();
    assert.deepEqual([found.albums, found.tracks], [3, 6], JSON.stringify(found));
    assert.deepEqual(Object.keys(rows()).sort(), ["101/1001", "101/2002", "201/1002", "201/2001", "301/3001", "301/3002"]);
    assert.deepEqual(ids(), first, "every track the row it was");
    assert.ok(ctx.logs.some(l => /\[ibroadcast\] the library read: 2 track\(s\) now under another album, moved; 0 listed more than once/.test(l)), JSON.stringify(ctx.logs.filter(l => /ibroadcast/.test(l)).slice(-3)));
    assert.deepEqual(crashes(), []);
  });

  await t.test("a track listed under two albums is written once, under the album its own entry names", async () => {
    const [alpha, beta] = ib.albums;
    // Beta's B1, listed by Alpha too (written first); its own entry says Beta.
    alpha.tracks.push(Object.assign(beta.tracks.find(x => x.id === 2001), { album_id: 201 }));
    const found = await read();
    assert.deepEqual([found.albums, found.tracks], [3, 6], JSON.stringify(found));
    assert.deepEqual(Object.keys(rows()).sort(), ["101/1001", "101/2002", "201/1002", "201/2001", "301/3001", "301/3002"]);
    assert.deepEqual(ids(), first);
    assert.deepEqual(db.prepare("SELECT key, track_count FROM albums WHERE key IN ('ibroadcast:101', 'ibroadcast:201') ORDER BY key").all().map(r => [r.key, r.track_count]),
      [["ibroadcast:101", 2], ["ibroadcast:201", 2]], "each album counts the tracks written under it");
    assert.ok(ctx.logs.some(l => /0 track\(s\) now under another album, moved; 1 listed more than once/.test(l)));
    alpha.tracks.pop();
  });

  await t.test("a track listed twice in one album is one row", async () => {
    const beta = ib.albums[1];
    beta.tracks.push(beta.tracks[0]);
    const found = await read();
    assert.deepEqual([found.albums, found.tracks], [3, 6], JSON.stringify(found));
    assert.deepEqual(ids(), first);
    beta.tracks.pop();
  });

  await t.test("an album of discs under a new first entry: the same tracks, moved to it, the old row gone", async () => {
    // A disc entry whose id comes before the others': the album is kept under it now.
    ib.albums.splice(2, 0, { id: 299, name: "Gamma", artist: { id: 3, name: "Cy" }, disc: 1, year: 2003, tracks: [T(3003, "G0", 1)] });
    const found = await read();
    assert.deepEqual([found.albums, found.tracks], [3, 7], JSON.stringify(found));
    assert.deepEqual(Object.keys(rows()).sort(), ["101/1001", "101/2002", "201/1002", "201/2001", "299/3001", "299/3002", "299/3003"]);
    const now = ids();
    for (const k of Object.keys(first)) assert.equal(now[k], first[k], k + " kept its row");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM albums WHERE key = 'ibroadcast:301'").get().n, 0, "the old row gone");
    assert.deepEqual(crashes(), []);
  });

  await t.test("a track gone from iBroadcast is gone here, from an album that stays", async () => {
    ib.albums[0].tracks = ib.albums[0].tracks.filter(x => x.id !== 2002);
    const found = await read();
    assert.deepEqual([found.albums, found.tracks], [3, 6], JSON.stringify(found));
    assert.ok(!("2002" in ids()));
  });

  await t.test("a reading whose rows can't be written says so: to the page that asked, and in the log", async () => {
    // A library no reading can make sense of: a place in the map that is no number.
    const whole = ib.library.bind(ib);
    ib.library = () => { const l = whole(); l.albums.map.name = "nought"; return l; };
    t.after(() => { ib.library = whole; });
    ib.changed();
    const r = await post("/library");
    assert.notEqual(r.status, 200);
    assert.match(r.error || "", /its rows couldn't be written \(\w+Exception: /, JSON.stringify(r));
    // The reading after an upload, the look every ten minutes and a rescan each say what they are told, as this:
    assert.ok(!ctx.logs.some(l => /a task failed with no one waiting on it/.test(l)), "never an unwaited task's failure");
    // And the library stays as it last was read.
    assert.equal(Object.keys(ids()).length, 6);
    ib.library = whole;
    assert.equal((await read()).tracks, 6, "read again once iBroadcast's library is whole");
  });
});
