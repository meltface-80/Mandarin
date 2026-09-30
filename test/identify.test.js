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
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
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

test("score: editions are set aside — the album is the album whatever the pressing", () => {
  assert.equal(SCORE.bare("Kid A (2015 Remaster)"), "Kid A");
  assert.equal(SCORE.bare("Kid A [Remastered]"), "Kid A");
  assert.equal(SCORE.bare("Kid A - 2009 Remastered Version"), "Kid A");
  assert.equal(SCORE.bare("Kid A (Deluxe Edition) (2015 Remaster)"), "Kid A");
  assert.equal(SCORE.bare("(What's the Story) Morning Glory?"), "(What's the Story) Morning Glory?");
  assert.equal(SCORE.bare("Song (feat. Someone) (Live)"), "Song");
  // Written back: only the remaster tail goes.
  assert.equal(SCORE.clean("Kid A (2015 Remaster)"), "Kid A");
  assert.equal(SCORE.clean("Everything in Its Right Place - 2015 Remaster"), "Everything in Its Right Place");
  assert.equal(SCORE.clean("Kid A (Deluxe Edition)"), "Kid A (Deluxe Edition)");
  assert.equal(SCORE.clean("Song (Live)"), "Song (Live)");
  assert.equal(SCORE.clean("( )"), "( )");
  assert.equal(SCORE.editionYear("Kid A (2015 Remaster)"), 2015);
  assert.equal(SCORE.editionYear("1999"), null);
  // A tag from a 2015 pressing of a 1988 record: the year is right either way.
  const a = album({ title: "Kid A (2015 Remaster)", year: 2015 });
  const c = cand({ title: "Kid A", year: 2000, release_title: "Kid A", release_year: 2015 });
  const d = SCORE.distance(a, c);
  assert.equal(d.parts.year, 0);
  assert.ok(d.parts.album <= 0.05, String(d.parts.album));
  assert.equal(SCORE.distance(album({ year: 2015 }), c).parts.year, 0);
  assert.equal(SCORE.distance(album({ year: 1997 }), c).parts.year, 1);
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

test("score: a copy missing a track is still the record — tracks pair by likeness, not by number", () => {
  // Ten of the release's eleven, the third gone: every remaining track pairs with its own.
  const full = album();
  full.tracks = [["She Runs Away", 224], ["In the Absence of Sun", 305], ["Reasons for Living", 258], ["Barely Breathing", 255], ["Days Go By", 289],
    ["Serena", 284], ["Out of Order", 271], ["November", 296], ["Home", 288], ["The End of Outside", 285], ["Little Hands", 364]].map(([title, length]) => ({ title, length }));
  const copy = album({ title: "Duncan Sheik", artist: "Duncan Sheik", year: 1996, tracks: full.tracks.filter((t, i) => i !== 2) });
  const rel = cand({ title: "Duncan Sheik", artist: "Duncan Sheik", year: 1996, tracks: full.tracks });
  const d = SCORE.distance(copy, rel);
  assert.deepEqual(d.pairs, [0, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(d.parts.missing_tracks, 1);
  assert.equal(d.parts.extra_tracks, 0);
  assert.ok(d.distance <= SCORE.APPLY, String(d.distance));
  assert.equal(SCORE.decide(copy, [rel]).status, "applied");
  // A copy with a track the release hasn't: that one pairs with nothing and keeps its tag.
  const extra = album({ tracks: album().tracks.concat([{ title: "Hidden Jam", length: 600 }]) });
  const e = SCORE.distance(extra, cand());
  assert.deepEqual(e.pairs, [0, 1, 2, 3, null]);
  assert.equal(e.parts.extra_tracks, 1);
  // Two "Untitled"s of the same length pair in order.
  const twins = { tracks: [{ title: "Untitled", length: 100 }, { title: "Untitled", length: 100 }] };
  assert.deepEqual(SCORE.pairTracks(twins.tracks, twins.tracks).pairs, [0, 1]);
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
  // A fourth album: a 2015 pressing of a 1988 record, tagged as pressings are.
  const path = require("path");
  for (let i = 1; i <= 2; i++) {
    gen(path.join(lib.music, "Artist C", "Old Record (2015 Remaster)", `0${i}.flac`), { freq: 300 * i, seconds: 5,
      tags: { title: `Tune ${i} (2015 Remaster)`, artist: "Artist C", album: "Old Record (2015 Remaster)", track: i, date: "2015" } });
  }
  // Best Of (Various Artists, two 3 s tracks C1/C2) → a release with those two and a bonus track
  //   between them: too much missing on a two-track record to apply unasked → proposed; accepted,
  //   each track takes the name of the one it paired with.
  // Hi Res (Artist B, two 4 s tracks) → the right names but one length 40 s off: proposed.
  // Album One (Artist A, three 3 s tracks, 1997) → a release that shares nothing: unidentified.
  // Old Record → the 2015 remaster release of a 1988 release group: applied with the group's name and year.
  const mb = await new FakeMusicBrainz([
    { id: "best-of-1", title: "Best Of", artist: "Various Artists", date: "2001-05-01", tracks: [["C1", 3], ["Bonus Thing", 9], ["C2 (Live)", 3]] },
    { id: "hi-res-1", title: "Hi Res", artist: "Artist B", date: "2020", tracks: [["Hi 1", 4], ["Hi 2", 44]] },
    { id: "album-one-1", title: "Album One", artist: "Somebody Else", date: "1975", tracks: [["Alpha", 200], ["Beta", 300], ["Gamma", 400]] },
    // The real Album One, filed under another name: only a barcode or a link reaches it.
    { id: "12345678-1234-1234-1234-123456789abc", title: "The First Album", artist: "Artist A", date: "1997-04-01", barcode: "5012345678900",
      group: { id: "aaaaaaaa-1234-1234-1234-123456789abc" },
      tracks: [["Song 1", 3], ["Song 2", 3], ["Song 3", 3]] },
    { id: "old-record-2015", title: "Old Record", artist: "Artist C", date: "2015-06-01", disambiguation: "2015 remaster", group: { title: "Old Record", date: "1988-03-01" },
      tracks: [["Tune 1 (2015 Remaster)", 5], ["Tune 2 - 2015 Remaster", 5]] }
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
    await until(async () => (await api("status")).index_count === 4);
    // Scheduling off: it scans now, whatever the clock says.
    let r = await api("identify/settings", { schedule: false });
    assert.equal(r.settings.schedule, false);
    assert.equal(r.settings.enabled, true);
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 4 && j; });
    assert.deepEqual([r.progress.applied, r.progress.proposed, r.progress.unidentified], [1, 2, 1]);

    // Old Record: the search went out without the edition and without a track
    // count, and what's written is the album's name and original year, with
    // clean track names.
    assert.ok(mb.requests.some(u => u.includes(encodeURIComponent('release:"Old Record"')) && !u.includes("Remaster") && !u.includes("tracks")));
    const old = r.applied.find(x => x.album.title === "Old Record");
    assert.ok(old, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.equal(old.candidate.year, 1988);
    assert.equal(old.candidate.release_year, 2015);
    assert.equal(old.candidate.edition, "2015 remaster");
    const oldPage = await api("album?offset=" + old.album.offset);
    assert.equal(oldPage.album.title, "Old Record");
    assert.equal(oldPage.album.year, 1988);
    assert.deepEqual(oldPage.tracks.map(t => t.title), ["Tune 1", "Tune 2"]);

    // Best Of: proposed (a track of three missing) — accepted, the artist stays
    // Various Artists (correctly), the year and the paired track titles are the release's.
    const applied = r.proposed.find(x => x.album.title === "Best Of");
    assert.equal(applied.candidate.mbid, "best-of-1");
    assert.ok(applied.similarity < 96 && applied.similarity >= 85, String(applied.similarity));
    r = await api("identify/accept", { offset: applied.album.offset });
    assert.equal(r.status, 200);
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
    const prop = r.proposed.find(x => x.album.title === "Hi Res");
    assert.ok(prop);
    assert.ok(prop.similarity < 96 && prop.similarity >= 85, String(prop.similarity));
    assert.deepEqual((await api("album?offset=" + prop.album.offset)).tracks.map(t => t.title), ["Hi 1", "Hi 2"]);
    r = await api("identify/accept", { offset: prop.album.offset });
    assert.equal(r.status, 200);
    assert.equal(r.progress.applied, 3);
    assert.equal(r.progress.proposed, 0);

    // Album One: unidentified, with the best guess named so you can judge it.
    const un = r.unidentified[0];
    assert.equal(un.album.title, "Album One");
    assert.equal(un.candidate.artist, "Somebody Else");
    assert.deepEqual((await api("album?offset=" + un.album.offset)).tracks.map(t => t.title), ["Song 1", "Song 2", "Song 3"]);

    // Undo puts Best Of back exactly: year from the files (none), tagged track titles.
    r = await api("identify/undo", { offset: applied.album.offset });
    assert.equal(r.status, 200);
    assert.equal(r.progress.applied, 2);
    assert.equal(r.progress.rejected, 1);
    const back = await api("album?offset=" + applied.album.offset);
    assert.equal(back.album.year, undefined);
    assert.deepEqual(back.tracks.map(t => t.title), ["C1", "C2"]);
    assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM track_edits WHERE key = ?").get(ctx.library.album(applied.album.offset).key).n, 0);
    assert.equal(ctx.library.album(applied.album.offset).edited, false);

    // A rejected album is not looked at again; the request count stays put.
    const n = mb.requests.length;
    await new Promise(res => setTimeout(res, 400));
    assert.equal(mb.requests.length, n);

    // Everything survives a library reload (rows keyed by album identity).
    ctx.library.reload();
    assert.deepEqual((await api("album?offset=" + prop.album.offset)).tracks.map(t => t.title), ["Hi 1", "Hi 2"]);
    assert.equal((await api("identify")).progress.applied, 2);

    // A match you name: Album One by its barcode → applied, however it scored.
    r = await api("identify/match", { offset: un.album.offset, query: "5012345678900" });
    assert.equal(r.status, 200, JSON.stringify(r));
    let m = r.applied.find(x => x.album.offset === un.album.offset);
    assert.ok(m, "matched by barcode");
    assert.equal(m.candidate.manual, "barcode");
    assert.equal(m.candidate.title, "The First Album");
    assert.equal((await api("album?offset=" + un.album.offset)).album.title, "The First Album");
    // Or by a pasted MusicBrainz link, release or release group; undo first so it's a fresh match.
    await api("identify/undo", { offset: un.album.offset });
    r = await api("identify/match", { offset: un.album.offset, query: "https://musicbrainz.org/release-group/aaaaaaaa-1234-1234-1234-123456789abc" });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.applied.find(x => x.album.offset === un.album.offset).candidate.manual, "link");
    r = await api("identify/match", { offset: un.album.offset, query: "https://musicbrainz.org/release/12345678-1234-1234-1234-123456789abc" });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal((await api("identify/match", { offset: un.album.offset, query: "0000000000000" })).status, 404);
    assert.equal((await api("identify/match", { offset: un.album.offset, query: "hello" })).status, 400);
    // Back to unidentified for the rest of the test.
    await api("identify/undo", { offset: un.album.offset });
    await api("identify/recheck", { offset: un.album.offset });
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 4 && j.progress.unidentified === 1 && j; });

    // "Check everything again" forgets the unidentified verdict (not the declined one, not the applied).
    r = await api("identify/recheck-all", {});
    assert.equal(r.progress.unidentified, 0);
    assert.equal(r.progress.rejected, 1);
    assert.equal(r.progress.applied, 2);
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 4 && j; });
    assert.equal(r.progress.unidentified, 1);

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
