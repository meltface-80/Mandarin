"use strict";
/*
 * Album identification (lib/identify): the distance between an album and a
 * MusicBrainz release, the verdicts, and the scan end to end against a fake
 * MusicBrainz on loopback — applied names laid over the album and its tracks,
 * a near miss proposed then accepted, a poor match left alone, undo.
 */
const test = require("node:test");
const assert = require("node:assert");
const SCORE = require("../lib/identify/score");
const { minutes, Identifier } = require("../lib/identify/identifier");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeMusicBrainz } = require("./fake-musicbrainz");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3611;
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 50));
  }
}

const album = (over = {}) => Object.assign({
  title: "Kid A", artist: "Radiohead", year: 2000,
  tracks: [["Everything in Its Right Place", 251], ["Kid A", 284], ["The National Anthem", 351], ["How to Disappear Completely", 356]].map(([title, length]) => ({ title, length }))
}, over);
const cand = (over = {}) => Object.assign({ mbid: "x" }, album(), over);

test("score: an identical release is distance 0; names fold; noise is nearly free", () => {
  assert.equal(SCORE.distance(album(), cand()).distance, 0);
  assert.equal(SCORE.titleDist("Kid A", "KID A"), 0);
  assert.equal(SCORE.titleDist("Kid A (Remastered 2009)", "Kid A"), 0.05);
  assert.equal(SCORE.titleDist("03 Kid A", "Kid A"), 0.05);
  assert.equal(SCORE.titleDist("Song (feat. Someone)", "Song"), 0.05);
  assert.ok(SCORE.titleDist("Kid A", "OK Computer") > 0.5);
  assert.equal(SCORE.lengthDist(251, 260), 0);
  assert.equal(SCORE.lengthDist(251, 251 + 45), 1);
  assert.equal(SCORE.lengthDist(251, 251 + 30), 0.5);
});

test("score: a suspect artist tag is not counted, so lengths and titles decide", () => {
  assert.ok(SCORE.artistSuspect("Various Artists", "Best Of"));
  assert.ok(SCORE.artistSuspect("", "Best Of"));
  assert.ok(SCORE.artistSuspect("Best Of", "Best Of"));
  assert.ok(!SCORE.artistSuspect("Radiohead", "Kid A"));
  const va = album({ artist: "Various Artists" });
  const d = SCORE.distance(va, cand());
  assert.equal(d.distance, 0);
  assert.equal(d.parts.artist, null);
  // With a trusted, wrong artist the same release is proposed at best, never applied.
  const wrong = SCORE.distance(album({ artist: "Coldplay" }), cand()).distance;
  assert.ok(wrong > SCORE.APPLY, String(wrong));
  assert.equal(SCORE.decide(album({ artist: "Coldplay" }), [cand()]).status, "proposed");
});

test("score: the verdicts — applied, proposed, unidentified, ambiguous", () => {
  assert.equal(SCORE.decide(album(), [cand()]).status, "applied");
  // One track 40 s off on a four-track album: proposed, not applied.
  const off = cand({ tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + 40 } : t) });
  const p = SCORE.decide(album(), [off]);
  assert.equal(p.status, "proposed");
  assert.ok(p.best.distance > SCORE.APPLY && p.best.distance <= SCORE.PROPOSE, String(p.best.distance));
  // Another record altogether.
  const other = cand({ title: "OK Computer", artist: "Radiohead", tracks: [["Airbag", 284], ["Paranoid Android", 383], ["Subterranean Homesick Alien", 267], ["Exit Music", 264]].map(([title, length]) => ({ title, length })) });
  assert.equal(SCORE.decide(album(), [other]).status, "unidentified");
  // Two perfect candidates saying different names: never applied.
  const twin = cand({ mbid: "y", title: "Kid A", artist: "Radio Head" });
  const amb = SCORE.decide(album({ artist: "Various Artists" }), [cand(), twin]);
  assert.equal(amb.status, "proposed");
  assert.ok(amb.ambiguous);
  // Two perfect candidates that are the same record (two countries): applied.
  assert.equal(SCORE.decide(album(), [cand(), cand({ mbid: "y" })]).status, "applied");
  assert.equal(SCORE.decide(album(), []).status, "unidentified");
});

test("the night window, including one over midnight", () => {
  const db = { setting: () => ({ start: "22:00", end: "04:00" }), raw: { prepare: () => ({}) } };
  const at = (h, m) => new Identifier({ db, library: {}, now: () => new Date(2026, 0, 1, h, m), mb: {} });
  assert.equal(at(23, 0).inWindow(), true);
  assert.equal(at(3, 59).inWindow(), true);
  assert.equal(at(4, 0).inWindow(), false);
  assert.equal(at(12, 0).inWindow(), false);
  assert.equal(minutes("01:30", null), 90);
  assert.equal(minutes("25:00", null), null);
  assert.equal(minutes("junk", 7), 7);
});

test("the scan end to end", { skip, timeout: 90000 }, async () => {
  const lib = makeLibrary();
  // Best Of (Various Artists, two 3 s tracks C1/C2) → a release whose titles and lengths match: applied.
  // Hi Res (Artist B, two 4 s tracks) → the right names but one length 40 s off: proposed.
  // Album One (Artist A, three 3 s tracks, 1997) → a release that shares nothing: unidentified.
  const mb = await new FakeMusicBrainz([
    { id: "best-of-1", title: "Best Of", artist: "Various Artists", date: "2001-05-01", tracks: [["C1", 3], ["C2 (Live)", 3]] },
    { id: "hi-res-1", title: "Hi Res", artist: "Artist B", date: "2020", tracks: [["Hi 1", 4], ["Hi 2", 44]] },
    { id: "album-one-1", title: "Album One", artist: "Somebody Else", date: "1975", tracks: [["Alpha", 200], ["Beta", 300], ["Gamma", 400]] }
  ]).start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl });
  const ctx = await srv.start();
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  try {
    await until(async () => (await api("status")).index_count === 3);
    // Scheduling off: it scans now, whatever the clock says.
    let r = await api("identify/settings", { schedule: false });
    assert.equal(r.settings.schedule, false);
    assert.equal(r.settings.enabled, true);
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 3 && j; });
    assert.deepEqual([r.progress.applied, r.progress.proposed, r.progress.unidentified], [1, 1, 1]);

    // Best Of: applied — the artist stays Various Artists (correctly), the year and the track titles are the release's.
    const applied = r.applied[0];
    assert.equal(applied.album.title, "Best Of");
    assert.equal(applied.candidate.mbid, "best-of-1");
    assert.ok(applied.similarity >= 96, String(applied.similarity));
    const bestOf = await api("album?offset=" + applied.album.offset);
    assert.equal(bestOf.album.year, 2001);
    assert.equal(bestOf.album.subtitle, "Various Artists");
    assert.deepEqual(bestOf.tracks.map(t => t.title), ["C1", "C2 (Live)"]);
    // The overlay is on the track itself too (what a queue shows); a title
    // that only repeats the tag is not written.
    assert.equal(ctx.library.track(bestOf.tracks[1].track_id).title, "C2 (Live)");
    assert.equal(ctx.library.track(bestOf.tracks[1].track_id).scanned_title, "C2");
    assert.equal(ctx.library.track(bestOf.tracks[0].track_id).scanned_title, undefined);

    // Hi Res: proposed with the distance shown; the album is untouched until accepted.
    const prop = r.proposed[0];
    assert.equal(prop.album.title, "Hi Res");
    assert.ok(prop.similarity < 96 && prop.similarity >= 85, String(prop.similarity));
    assert.deepEqual((await api("album?offset=" + prop.album.offset)).tracks.map(t => t.title), ["Hi 1", "Hi 2"]);
    r = await api("identify/accept", { offset: prop.album.offset });
    assert.equal(r.status, 200);
    assert.equal(r.progress.applied, 2);
    assert.equal(r.progress.proposed, 0);

    // Album One: unidentified, with the best guess named so you can judge it.
    const un = r.unidentified[0];
    assert.equal(un.album.title, "Album One");
    assert.equal(un.candidate.artist, "Somebody Else");
    assert.deepEqual((await api("album?offset=" + un.album.offset)).tracks.map(t => t.title), ["Song 1", "Song 2", "Song 3"]);

    // Undo puts Best Of back exactly: year from the files (none), tagged track titles.
    r = await api("identify/undo", { offset: applied.album.offset });
    assert.equal(r.status, 200);
    assert.equal(r.progress.applied, 1);
    assert.equal(r.progress.rejected, 1);
    const back = await api("album?offset=" + applied.album.offset);
    assert.equal(back.album.year, undefined);
    assert.deepEqual(back.tracks.map(t => t.title), ["C1", "C2"]);
    assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM track_edits").get().n, 0);
    assert.equal(ctx.library.album(applied.album.offset).edited, false);

    // A rejected album is not looked at again; the request count stays put.
    const n = mb.requests.length;
    await new Promise(res => setTimeout(res, 400));
    assert.equal(mb.requests.length, n);

    // Everything survives a library reload (rows keyed by album identity).
    ctx.library.reload();
    assert.deepEqual((await api("album?offset=" + prop.album.offset)).tracks.map(t => t.title), ["Hi 1", "Hi 2"]);
    assert.equal((await api("identify")).progress.applied, 1);

    // The switch off stops it: state says so.
    r = await api("identify/settings", { enabled: false });
    assert.equal(r.reason, "off");
    assert.equal(r.active, false);
    r = await api("identify/settings", { enabled: true, schedule: true, start: "01:00", end: "01:00" });
    assert.equal(r.reason, "waiting");
    assert.equal((await api("identify/settings", { start: "nope" })).status, 400);
  } finally {
    await srv.stop();
    await mb.stop();
  }
});
