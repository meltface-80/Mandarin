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
const { FakeITunes } = require("./fake-itunes");
const { ITunes } = require("../lib/identify/itunes");

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
  // Two perfect candidates saying different names: applied all the same at
  // 95 % or more (v0.6.3), the doubt kept with it.
  const twin = cand({ mbid: "y", title: "Kid A", artist: "Radio Head" });
  const amb = SCORE.decide(album({ artist: "Various Artists" }), [cand(), twin]);
  assert.equal(amb.status, "applied");
  assert.ok(amb.ambiguous);
  // Two perfect candidates that are the same record (two countries): applied.
  assert.equal(SCORE.decide(album(), [cand(), cand({ mbid: "y" })]).status, "applied");
  assert.equal(SCORE.decide(album(), []).status, "unidentified");
});

test("score: another pressing of the same record is not a rival", () => {
  const g = { group_mbid: "g1" };
  // The same release group, one pressing with a bonus track: the record, applied.
  const bonus = cand(Object.assign({ mbid: "y", tracks: album().tracks.concat([{ title: "Bonus", length: 180 }]) }, g));
  let v = SCORE.decide(album(), [cand(g), bonus]);
  assert.equal(v.status, "applied");
  assert.equal(v.ambiguous, false);
  // Two groups that would write the same names over these four tracks: not a rival either.
  v = SCORE.decide(album(), [cand({ group_mbid: "g1" }), cand({ mbid: "y", group_mbid: "g2", tracks: album().tracks.concat([{ title: "Bonus", length: 180 }]) })]);
  assert.equal(v.status, "applied");
  // Another artist's name at the same distance still is (and, at 95 % or
  // more, is applied all the same, v0.6.3).
  v = SCORE.decide(album({ artist: "Various Artists" }), [cand(g), cand({ mbid: "y", group_mbid: "g2", artist: "Radio Head" })]);
  assert.ok(v.ambiguous);
  // Between equals, the one with lengths known comes first, then the earlier.
  const blank = cand({ mbid: "b", tracks: album().tracks.map(t => ({ title: t.title, length: null })) });
  assert.equal(SCORE.decide(album(), [blank, cand({ mbid: "late", release_date: "2015-01-01" }), cand({ mbid: "early", release_date: "2000-10-02" })]).best.candidate.mbid, "early");
});

test("score: a release MusicBrainz has without lengths is judged by its names", () => {
  const blank = tracks => cand({ tracks: tracks.map(t => ({ title: t.title, length: null })) });
  // Every title and the count agree: applied, as Roon would.
  let v = SCORE.decide(album(), [blank(album().tracks)]);
  assert.equal(v.status, "applied");
  assert.equal(v.best.parts.no_lengths, true);
  assert.equal(v.best.parts.track_lengths, null);
  // Short of exact: by the same 95 % as any other (v0.6.3).
  for (const r of [blank(album().tracks.map((t, i) => i === 2 ? { title: "The National Anthem (Live)" } : t)), blank(album().tracks.slice(0, 3))]) {
    v = SCORE.decide(album(), [r]);
    assert.equal(v.status, SCORE.similarity(v.best.distance) >= 95 ? "applied" : "proposed", String(v.best.distance));
  }
});

test("score: a ripper's 'null' is not part of a name", () => {
  assert.equal(SCORE.tidy("null: Line Up (null)"), "Line Up");
  assert.equal(SCORE.tidy("Line Up - undefined"), "Line Up");
  assert.equal(SCORE.tidy("(Unknown) Line Up"), "Line Up");
  assert.equal(SCORE.tidy("null"), "");
  assert.equal(SCORE.tidy("Annulment"), "Annulment");
  assert.equal(SCORE.titleDist("null: Line Up (null)", "Line Up"), 0);
  assert.ok(SCORE.artistSuspect("null", "Elastica"));
  const junk = album({ tracks: album().tracks.map(t => ({ title: "null: " + t.title + " (null)", length: t.length })) });
  const d = SCORE.distance(junk, cand());
  assert.equal(d.distance, 0);
  assert.deepEqual(d.pairs, [0, 1, 2, 3]);
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
  // A fifth: a three-track deluxe copy whose record the search lists only as the two-track standard.
  for (let i = 1; i <= 3; i++) {
    gen(path.join(lib.music, "Artist D", "Wide Record", `0${i}.flac`), { freq: 250 * i, seconds: 5,
      tags: { title: `W${i}`, artist: "Artist D", album: "Wide Record", track: i, date: "2010" } });
  }
  // Best Of (Various Artists, two 3 s tracks C1/C2) → a release with those two and a bonus track
  //   between them: too much missing on a two-track record to apply unasked → proposed; accepted,
  //   each track takes the name of the one it paired with.
  // Hi Res (Artist B, two 4 s tracks) → the right names but one length 40 s off: proposed.
  // Album One (Artist A, three 3 s tracks, 1997) → a release that shares nothing: unidentified.
  // Old Record → the 2015 remaster release of a 1988 release group: applied with the group's name and year.
  // Wide Record → the search finds the standard pressing (a track short); the release group lists
  //   the deluxe with the copy's count, fetched and applied at 100 %.
  const mb = await new FakeMusicBrainz([
    { id: "wide-std", title: "Wide Record", artist: "Artist D", date: "2010-03-01", group: { id: "g-wide", title: "Wide Record", date: "2010-03-01" },
      tracks: [["W1", 5], ["W2", 5]] },
    { id: "wide-deluxe", title: "Wide Record (Deluxe Edition)", artist: "Artist D", date: "2011-03-01", disambiguation: "deluxe edition", group: { id: "g-wide", title: "Wide Record", date: "2010-03-01" },
      tracks: [["W1", 5], ["W2", 5], ["W3", 5]] },
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
  // iTunes knows none of these: what MusicBrainz can't place stays unidentified.
  const itunes = await new FakeITunes([]).start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl });
  const ctx = await srv.start();
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  try {
    await until(async () => (await api("status")).index_count === 5);
    // Scheduling off: it scans now, whatever the clock says.
    let r = await api("identify/settings", { schedule: false });
    assert.equal(r.settings.schedule, false);
    assert.equal(r.settings.enabled, true);
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 5 && j; });
    assert.deepEqual([r.progress.applied, r.progress.proposed, r.progress.unidentified], [2, 2, 1]);

    // Wide Record: widened through the release group to the pressing with the copy's count.
    const wide = r.applied.find(x => x.album.title === "Wide Record");
    assert.ok(wide, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.equal(wide.candidate.mbid, "wide-deluxe");
    assert.equal(wide.similarity, 100);
    assert.ok(mb.requests.some(u => u.startsWith("/ws/2/release-group/g-wide")));
    assert.deepEqual((await api("album?offset=" + wide.album.offset)).tracks.map(t => t.title), ["W1", "W2", "W3"]);

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
    assert.ok(prop.similarity < 95 && prop.similarity >= 85, String(prop.similarity));
    assert.ok(prop.why.includes("track lengths differ"), JSON.stringify(prop.why));
    assert.deepEqual((await api("album?offset=" + prop.album.offset)).tracks.map(t => t.title), ["Hi 1", "Hi 2"]);
    r = await api("identify/accept", { offset: prop.album.offset });
    assert.equal(r.status, 200);
    assert.equal(r.progress.applied, 4);
    assert.equal(r.progress.proposed, 0);

    // Album One: unidentified, with the best guess named so you can judge it.
    const un = r.unidentified[0];
    assert.equal(un.album.title, "Album One");
    assert.equal(un.candidate.artist, "Somebody Else");
    assert.deepEqual((await api("album?offset=" + un.album.offset)).tracks.map(t => t.title), ["Song 1", "Song 2", "Song 3"]);

    // Undo puts Best Of back exactly: year from the files (none), tagged track titles.
    r = await api("identify/undo", { offset: applied.album.offset });
    assert.equal(r.status, 200);
    assert.equal(r.progress.applied, 3);
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
    assert.equal((await api("identify")).progress.applied, 3);

    // The album editor's Find match: the releases to choose from, scored, best first; nothing written.
    r = await api("identify/candidates?offset=" + un.album.offset);
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(r.verdict, "unidentified");
    assert.equal(r.candidates[0].artist, "Somebody Else");
    assert.ok(r.candidates[0].similarity < 50);
    assert.equal((await api("identify")).progress.unidentified, 1);
    // Choosing one applies it, and says so on the page.
    r = await api("identify/match", { offset: un.album.offset, query: r.candidates[0].mbid, how: "pick" });
    assert.equal(r.status, 200);
    assert.equal(r.applied.find(x => x.album.offset === un.album.offset).candidate.manual, "pick");
    assert.equal((await api("album?offset=" + un.album.offset)).album.subtitle, "Somebody Else");
    await api("identify/undo", { offset: un.album.offset });

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
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 5 && j.progress.unidentified === 1 && j; });

    // "Check everything again" forgets the unidentified verdict (not the declined one, not the applied).
    r = await api("identify/recheck-all", {});
    assert.equal(r.progress.unidentified, 0);
    assert.equal(r.progress.rejected, 1);
    assert.equal(r.progress.applied, 3);
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 5 && j; });
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
    await itunes.stop();
  }
});

test("iTunes: an album as Apple has it, with its lengths; Single and EP set aside; a 429 pauses it", async () => {
  const fake = await new FakeITunes([
    { id: 77, title: "Some Record - EP", artist: "Somebody", date: "2015-06-01", tracks: [["One", 200.4], ["Two", 181]] }
  ]).start();
  try {
    const it = new ITunes({ baseUrl: fake.baseUrl });
    const found = await it.search({ title: "Some Record", artist: "Somebody" });
    assert.deepEqual(found.map(f => [f.id, f.track_count]), [["77", 2]]);
    assert.ok(fake.requests[0].includes("country=US") && fake.requests[0].includes("entity=album"));
    const c = await it.album("77");
    assert.equal(c.mbid, "itunes:77");
    assert.equal(c.source, "itunes");
    assert.equal(c.title, "Some Record");
    assert.equal(c.type, "EP");
    // Apple's date is the edition's: never the album's year.
    assert.equal(c.year, null);
    assert.equal(c.release_date, "2015-06-01");
    assert.deepEqual(c.tracks.map(t => [t.title, t.length]), [["One", 200.4], ["Two", 181]]);
    fake.refuse = true;
    await assert.rejects(it.search({ title: "x" }), e => e.paused === true);
    assert.equal(it.paused, true);
    const n = fake.requests.length;
    await assert.rejects(it.search({ title: "x" }), e => e.paused === true);
    assert.equal(fake.requests.length, n);     // not asked while paused
  } finally { await fake.stop(); }
});

test("score: exact — what a second source needs before it's applied unasked", () => {
  const v = SCORE.decide(album(), [cand()]);
  assert.equal(SCORE.exact(v.best), true);
  const off = SCORE.decide(album(), [cand({ tracks: album().tracks.map((t, i) => i === 0 ? { title: t.title, length: t.length + 20 } : t) })]);
  assert.equal(SCORE.exact(off.best), false);    // a length 20 s off: applied from MusicBrainz, not from iTunes
  const short = SCORE.decide(album(), [cand({ tracks: album().tracks.slice(0, 3) })]);
  assert.equal(SCORE.exact(short.best), false);
});

test("iTunes for what MusicBrainz can't place: exact applied, near proposed; skipped while it says wait, then asked", { skip, timeout: 90000 }, async () => {
  const lib = makeLibrary();
  const mb = await new FakeMusicBrainz([]).start();        // MusicBrainz knows none of them
  // Album One (Artist A): three 3 s tracks, exactly — applied, Apple's names written ("- EP" set aside).
  // Hi Res (Artist B): two 4 s tracks, Apple's second 40 s longer — proposed.
  // Best Of: not in Apple's catalogue — unidentified.
  const itunes = await new FakeITunes([
    { id: 101, title: "Album One - EP", artist: "Artist A", date: "2019-01-01", tracks: [["Song 1", 3], ["Song 2 (feat. Guest)", 3], ["Song 3", 3]] },
    { id: 102, title: "Hi Res", artist: "Artist B", date: "2020-01-01", tracks: [["Hi 1", 4], ["Hi 2", 44]] }
  ]).start();
  itunes.refuse = true;     // at first it asks us to wait
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const port = PORT + 1, base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl });
  const ctx = await srv.start();
  const token = await signIn(base);
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  try {
    await until(async () => (await api("status")).index_count === 3);
    let r = await api("identify/settings", { schedule: false });
    assert.equal(r.settings.itunes, true);
    // iTunes refusing: every album unidentified, and iTunes resting.
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 3 && j; });
    assert.equal(r.progress.unidentified, 3);
    assert.equal(ctx.identifier.itunes.paused, true);
    const asked = () => ctx.db.raw.prepare("SELECT itunes FROM album_matches").all().map(x => x.itunes);
    assert.ok(asked().includes("skipped"), JSON.stringify(asked()));

    // Answering again: the unidentified ones are asked of iTunes alone.
    const mbBefore = mb.requests.length;
    itunes.refuse = false;
    ctx.identifier.itunes.pausedUntil = 0;
    r = await until(async () => { const j = await api("identify"); return j.progress.applied === 1 && j.progress.proposed === 1 && asked().every(x => x === "asked") && j; });
    assert.equal(mb.requests.length, mbBefore, "MusicBrainz isn't asked again for an iTunes-only look");
    assert.equal(r.progress.unidentified, 1);

    const one = r.applied.find(x => x.album.title === "Album One");
    assert.ok(one, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.equal(one.candidate.source, "itunes");
    assert.equal(one.candidate.mbid, "itunes:101");
    const page = await api("album?offset=" + one.album.offset);
    assert.equal(page.album.title, "Album One");
    assert.equal(page.album.year, 1997);                     // the tags' year kept
    assert.deepEqual(page.tracks.map(t => t.title), ["Song 1", "Song 2 (feat. Guest)", "Song 3"]);

    const hi = r.proposed.find(x => x.album.title === "Hi Res");
    assert.ok(hi);
    assert.equal(hi.candidate.source, "itunes");
    assert.ok(hi.similarity < 96 && hi.similarity >= 85, String(hi.similarity));

    // Asked once: nothing more goes to iTunes for these.
    const n = itunes.requests.length;
    await new Promise(res => setTimeout(res, 500));
    assert.equal(itunes.requests.length, n);

    // Typed by hand it's neither a barcode nor a link…
    assert.equal((await api("identify/match", { offset: hi.album.offset, query: "itunes:102" })).status, 400);
    // …but picked from Find match's suggestions it's applied, as you chose.
    r = await api("identify/match", { offset: hi.album.offset, query: "itunes:102", how: "pick" });
    assert.equal(r.status, 200);
    const picked = r.applied.find(x => x.album.title === "Hi Res");
    assert.equal(picked.candidate.mbid, "itunes:102");
    assert.equal(picked.candidate.manual, "pick");
  } finally {
    await srv.stop();
    await mb.stop();
    await itunes.stop();
  }
});

test("what the files carry decides first: MusicBrainz id, barcode, catalogue number, ISRCs; iTunes by UPC", { skip, timeout: 90000 }, async () => {
  const fs = require("fs");
  const path = require("path");
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const album = (dir, name, n, tags) => {
    for (let i = 1; i <= n; i++) {
      gen(path.join(lib.music, dir, `0${i}.flac`), { freq: 200 + 50 * i, seconds: 3,
        tags: Object.assign({ title: `${name} ${i}`, artist: "Tagger", album: name, track: i, date: "2001" },
          typeof tags === "function" ? tags(i) : tags) });
    }
  };
  // Filed under a name no search would find, but carrying its release id.
  album("Mbid", "Untitled Rip", 3, { MUSICBRAINZ_ALBUMID: "11111111-0000-0000-0000-000000000001" });
  album("Barcode", "Bar Album", 3, { BARCODE: "0602537000016" });
  album("Catno", "Cat Album", 3, { CATALOGNUMBER: "ABC-123", label: "Tag Records" });
  album("Isrc", "Isrc Album", 3, i => ({ ISRC: `GBAAA010000${i}` }));
  album("Upc", "Apple Album", 2, { BARCODE: "0886440000002" });
  const tr = name => [1, 2, 3].map(i => [`${name} ${i}`, 3]);
  const mb = await new FakeMusicBrainz([
    { id: "11111111-0000-0000-0000-000000000001", title: "The Real Name", artist: "Tagger", date: "2001-01-01", tracks: [["One", 3], ["Two", 3], ["Three", 3]] },
    // Two pressings with the barcode's title: only one carries the barcode.
    { id: "bar-other", title: "Bar Album", artist: "Tagger", date: "2005", tracks: tr("Bar Album") },
    { id: "bar-1", title: "Bar Album", artist: "Tagger", date: "2001", barcode: "0602537000016", tracks: tr("Bar Album") },
    { id: "cat-1", title: "Cat Album", artist: "Tagger", date: "2001", label: "Tag Records", catno: "ABC-123", tracks: tr("Cat Album") },
    { id: "isrc-1", title: "Isrc Album", artist: "Tagger", date: "2001", isrcs: ["GBAAA0100001", "GBAAA0100002", "GBAAA0100003"], tracks: tr("Isrc Album") }
  ]).start();
  const itunes = await new FakeITunes([
    { id: 301, upc: "0886440000002", title: "Apple Album", artist: "Tagger", date: "2001-01-01", tracks: [["Apple Album 1", 3], ["Apple Album 2", 3]] }
  ]).start();
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const port = 3618, base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl });
  const ctx = await srv.start();
  const token = await signIn(base);
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  try {
    await until(async () => (await api("status")).index_count === 5);
    // Every tag the files carry is kept, by name.
    const raw = ctx.db.raw;
    const t = raw.prepare("SELECT t.barcode, t.catno, tt.tags FROM tracks t JOIN track_tags tt ON tt.track_id = t.id WHERE t.catno IS NOT NULL").get();
    assert.equal(t.catno, "ABC-123");
    assert.deepEqual(JSON.parse(t.tags).CATALOGNUMBER, ["ABC-123"]);
    assert.equal(raw.prepare("SELECT barcode FROM albums WHERE barcode = '0602537000016'").get().barcode, "0602537000016");
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM tracks WHERE isrc LIKE 'GBAAA%'").get().n, 3);

    await api("identify/settings", { schedule: false });
    const r = await until(async () => { const j = await api("identify"); return j.progress.checked === 5 && j; });
    assert.equal(r.progress.applied, 5, JSON.stringify({ p: r.progress, u: r.unidentified.map(x => x.album.title), p2: r.proposed.map(x => x.album.title) }));
    const by = Object.fromEntries(r.applied.map(x => [x.candidate.mbid, x.candidate.matched_by]));
    assert.deepEqual(by, {
      "11111111-0000-0000-0000-000000000001": "musicbrainz-id", "bar-1": "barcode", "cat-1": "catalogue-number", "isrc-1": "isrc", "itunes:301": "barcode"
    });
    // The release id is taken as it is: its names written, whatever the tags said.
    const real = r.applied.find(x => x.candidate.mbid.startsWith("1111"));
    assert.deepEqual((await api("album?offset=" + real.album.offset)).tracks.map(x => x.title), ["One", "Two", "Three"]);
    // Nothing found by its identifiers was searched for by name.
    for (const name of ["Untitled Rip", "Bar Album", "Cat Album", "Isrc Album"]) {
      assert.ok(!mb.requests.some(u => u.includes(encodeURIComponent(`release:"${name}"`))), name);
    }
    assert.ok(itunes.requests.some(u => u.includes("upc=0886440000002")));
  } finally {
    await srv.stop();
    await mb.stop();
    await itunes.stop();
  }
});

test("score: 95 % alike, as the page shows it, is applied unasked; 94 % is proposed (v0.6.2)", () => {
  // The year one off (a reissue's, say) and a track 19–24 s long.
  const near = off => cand({ year: 1999, tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + off } : t) });
  for (const off of [19, 22]) {
    const v = SCORE.decide(album(), [near(off)]);
    assert.equal(SCORE.similarity(v.best.distance), 95, String(v.best.distance));
    assert.equal(v.status, "applied", off + " s off");
  }
  const v = SCORE.decide(album(), [near(24)]);
  assert.equal(SCORE.similarity(v.best.distance), 94);
  assert.equal(v.status, "proposed");
  // Nothing else counts (v0.6.3): no lengths, missing tracks, a close rival.
  assert.equal(SCORE.appliesUnasked({ distance: 0.03, parts: { no_lengths: true, track_titles: 0.05, missing_tracks: 1 } }), true);
  assert.equal(SCORE.appliesUnasked({ distance: 0.06, parts: {} }), false);
});

test("proposals already waiting at 95 % or more are applied once, whatever else; the rest stay (v0.6.3)", () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const DB = require("../lib/library/db");
  const db = DB.open(fs.mkdtempSync(path.join(os.tmpdir(), "musicd-ident-")), { log: () => {} });
  try {
    const albums = ["a95", "a99", "a94", "amb", "gone"].filter(k => k !== "gone").map((key, i) => ({ id: i + 1, key, title: key, artist: "X", tracks: 4 }));
    const id = new Identifier({ db, library: { albums, count: albums.length }, itunes: null });
    const put = (key, distance, extra = {}) => id.q.put.run({ key, mbid: "m-" + key, distance, status: "proposed",
      candidate: JSON.stringify(Object.assign({ artist: "X", title: key, parts: {} }, extra)), before: null, checked_at: Date.now(), applied_at: null, itunes: null });
    put("a95", 0.05); put("a99", 0.01, { source: "itunes" }); put("a94", 0.06); put("amb", 0.01, { ambiguous: true }); put("gone", 0.01);
    const accepted = [];
    id.accept = key => { accepted.push(key); return {}; };
    assert.equal(id.applyWaiting(), 3);
    assert.deepEqual(accepted.sort(), ["a95", "a99", "amb"]);
  } finally { db.close(); }
});

test("names: '+', '&' and 'and', a dropped g, 'n' — the same word to the score (v0.6.3)", () => {
  for (const [a, b] of [["Siouxsie & The Banshees", "Siouxsie and the Banshees"], ["Simon + Garfunkel", "Simon & Garfunkel"],
    ["Kiddin", "Kiddin'"], ["Kickin'", "Kicking"], ["Kickin", "Kickin’"], ["Rock 'n' Roll", "Rock and Roll"], ["Rock n Roll", "Rock & Roll"]]) {
    assert.equal(SCORE.stringDist(a, b), 0, a + " / " + b);
    assert.equal(SCORE.titleDist(a, b), 0, a + " / " + b);
  }
  // Short words aren't stretched into others.
  assert.ok(SCORE.stringDist("King", "Kin") > 0);
  assert.ok(SCORE.stringDist("Sing", "Sin") > 0);
  // So an album tagged one way and released the other is a full match.
  const v = SCORE.decide(album({ artist: "Simon + Garfunkel", title: "Kickin' It" }), [cand({ artist: "Simon & Garfunkel", title: "Kicking It" })]);
  assert.equal(v.best.distance, 0);
});

test("why a match is short of 100 %, in words (v0.6.3)", () => {
  const near = cand({ year: 1999, tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + 30 } : t) });
  const v = SCORE.decide(album(), [near]);
  assert.deepEqual(SCORE.why(v.best.parts, { year: 2000 }), ["track lengths differ", "the year differs (2000 here)"]);
  assert.deepEqual(SCORE.why(SCORE.distance(album(), cand()).parts), []);
  assert.deepEqual(SCORE.why({ no_lengths: true, track_titles: 0.3 }), ["track names differ", "MusicBrainz has no track lengths"]);
  assert.deepEqual(SCORE.why({ album: 0.05 }), ["edition notes in the names"]);
});
