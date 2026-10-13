"use strict";
/*
 * Album identification: the distance between an album and a MusicBrainz
 * release, the verdicts, and the scan end to end against a fake MusicBrainz on
 * loopback — applied names laid over the album and its tracks, a near miss
 * (85 % or more, v0.8.41) applied as an exact one is, a poor match left alone, undo.
 *
 * The C# server's (Identify/Score.cs, Identifier.cs, ITunes.cs; lib/identify/
 * until v0.8.50): its rules asked by name through `mandarin-server score`
 * (Identify/ScoreCalls.cs), a test's worth at once; the rest through the server running.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { FakeITunes } = require("./fake-itunes");
const { createServer, built } = require("./server");
const { score, scoreAsync } = require("./score");

const rules = built();
const skip = rules || (!haveFfmpeg() && "ffmpeg is not installed");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

/* The rules asked, { name: [rule, …args] } → { name: its answer }. */
function ask(calls) {
  const names = Object.keys(calls);
  const { results } = score({ fn: "scorecall", calls: names.map(k => calls[k]) });
  return Object.fromEntries(names.map((k, i) => [k, results[i]]));
}

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

test("score: an identical release is distance 0; names fold; noise is nearly free", { skip: rules }, () => {
  const r = ask({ same: ["distance", album(), cand()], caps: ["titleDist", "Kid A", "KID A"], remaster: ["titleDist", "Kid A (Remastered 2009)", "Kid A"],
    number: ["titleDist", "03 Kid A", "Kid A"], feat: ["titleDist", "Song (feat. Someone)", "Song"], other: ["titleDist", "Kid A", "OK Computer"],
    near: ["lengthDist", 251, 260], far: ["lengthDist", 251, 251 + 45], half: ["lengthDist", 251, 251 + 30] });
  assert.equal(r.same.distance, 0);
  assert.equal(r.caps, 0);
  assert.equal(r.remaster, 0.05);
  assert.equal(r.number, 0.05);
  assert.equal(r.feat, 0.05);
  assert.ok(r.other > 0.5);
  assert.equal(r.near, 0);
  assert.equal(r.far, 1);
  assert.equal(r.half, 0.5);
});

test("score: editions are set aside — the album is the album whatever the pressing", { skip: rules }, () => {
  // A tag from a 2015 pressing of a 1988 record: the year is right either way.
  const a = album({ title: "Kid A (2015 Remaster)", year: 2015 });
  const c = cand({ title: "Kid A", year: 2000, release_title: "Kid A", release_year: 2015 });
  const bare = [["Kid A (2015 Remaster)", "Kid A"], ["Kid A [Remastered]", "Kid A"], ["Kid A - 2009 Remastered Version", "Kid A"],
    ["Kid A (Deluxe Edition) (2015 Remaster)", "Kid A"], ["(What's the Story) Morning Glory?", "(What's the Story) Morning Glory?"], ["Song (feat. Someone) (Live)", "Song"]];
  // Written back: only the remaster tail goes.
  const clean = [["Kid A (2015 Remaster)", "Kid A"], ["Everything in Its Right Place - 2015 Remaster", "Everything in Its Right Place"],
    ["Kid A (Deluxe Edition)", "Kid A (Deluxe Edition)"], ["Song (Live)", "Song (Live)"], ["( )", "( )"]];
  const r = ask(Object.assign({ y2015: ["editionYear", "Kid A (2015 Remaster)"], y1999: ["editionYear", "1999"],
    d: ["distance", a, c], d2015: ["distance", album({ year: 2015 }), c], d1997: ["distance", album({ year: 1997 }), c] },
  Object.fromEntries(bare.map(([x], i) => ["bare" + i, ["bare", x]])), Object.fromEntries(clean.map(([x], i) => ["clean" + i, ["clean", x]]))));
  bare.forEach(([x, want], i) => assert.equal(r["bare" + i], want, x));
  clean.forEach(([x, want], i) => assert.equal(r["clean" + i], want, x));
  assert.equal(r.y2015, 2015);
  assert.equal(r.y1999, null);
  assert.equal(r.d.parts.year, 0);
  assert.ok(r.d.parts.album <= 0.05, String(r.d.parts.album));
  assert.equal(r.d2015.parts.year, 0);
  assert.equal(r.d1997.parts.year, 1);
});

test("score: a suspect artist tag is not counted, so lengths and titles decide", { skip: rules }, () => {
  const r = ask({ va: ["artistSuspect", "Various Artists", "Best Of"], none: ["artistSuspect", "", "Best Of"], title: ["artistSuspect", "Best Of", "Best Of"],
    real: ["artistSuspect", "Radiohead", "Kid A"], d: ["distance", album({ artist: "Various Artists" }), cand()],
    wrong: ["distance", album({ artist: "Coldplay" }), cand()], verdict: ["decide", album({ artist: "Coldplay" }), [cand()]], APPLY: ["APPLY"] });
  assert.ok(r.va);
  assert.ok(r.none);
  assert.ok(r.title);
  assert.ok(!r.real);
  assert.equal(r.d.distance, 0);
  assert.equal(r.d.parts.artist, null);
  // With a trusted, wrong artist the same release costs the artist's weight:
  // 93 %, which was proposed at best (95 %) and is applied since v0.8.41 (85 %),
  // the names and lengths agreeing to the second.
  assert.ok(r.wrong.distance > 0.05 && r.wrong.distance <= r.APPLY, String(r.wrong.distance));
  assert.equal(r.verdict.status, "applied");
});

test("score: the verdicts — applied, unidentified, ambiguous (nothing proposed since v0.8.41)", { skip: rules }, () => {
  // One track 40 s off on a four-track album: proposed at 95 %, applied at 85 % (v0.8.41).
  const off = cand({ tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + 40 } : t) });
  // Another record altogether.
  const other = cand({ title: "OK Computer", artist: "Radiohead", tracks: [["Airbag", 284], ["Paranoid Android", 383], ["Subterranean Homesick Alien", 267], ["Exit Music", 264]].map(([title, length]) => ({ title, length })) });
  // Two perfect candidates saying different names: applied all the same at
  // 85 % or more (v0.6.3; 95 % until v0.8.41), the doubt kept with it.
  const twin = cand({ mbid: "y", title: "Kid A", artist: "Radio Head" });
  const r = ask({ same: ["decide", album(), [cand()]], off: ["decide", album(), [off]], other: ["decide", album(), [other]],
    amb: ["decide", album({ artist: "Various Artists" }), [cand(), twin]], countries: ["decide", album(), [cand(), cand({ mbid: "y" })]],
    none: ["decide", album(), []], APPLY: ["APPLY"] });
  assert.equal(r.same.status, "applied");
  assert.equal(r.off.status, "applied");
  assert.ok(r.off.best.distance > 0.05 && r.off.best.distance <= r.APPLY, String(r.off.best.distance));
  assert.equal(r.other.status, "unidentified");
  assert.equal(r.amb.status, "applied");
  assert.ok(r.amb.ambiguous);
  // Two perfect candidates that are the same record (two countries): applied.
  assert.equal(r.countries.status, "applied");
  assert.equal(r.none.status, "unidentified");
});

test("score: another pressing of the same record is not a rival", { skip: rules }, () => {
  const g = { group_mbid: "g1" };
  const bonus = cand(Object.assign({ mbid: "y", tracks: album().tracks.concat([{ title: "Bonus", length: 180 }]) }, g));
  const blank = cand({ mbid: "b", tracks: album().tracks.map(t => ({ title: t.title, length: null })) });
  const r = ask({
    // The same release group, one pressing with a bonus track: the record, applied.
    bonus: ["decide", album(), [cand(g), bonus]],
    // Two groups that would write the same names over these four tracks: not a rival either.
    groups: ["decide", album(), [cand({ group_mbid: "g1" }), cand({ mbid: "y", group_mbid: "g2", tracks: album().tracks.concat([{ title: "Bonus", length: 180 }]) })]],
    // Another artist's name at the same distance still is (and, at 85 % or
    // more, is applied all the same, v0.6.3; 95 % until v0.8.41).
    rival: ["decide", album({ artist: "Various Artists" }), [cand(g), cand({ mbid: "y", group_mbid: "g2", artist: "Radio Head" })]],
    // Between equals, the one with lengths known comes first, then the earlier.
    equals: ["decide", album(), [blank, cand({ mbid: "late", release_date: "2015-01-01" }), cand({ mbid: "early", release_date: "2000-10-02" })]]
  });
  assert.equal(r.bonus.status, "applied");
  assert.equal(r.bonus.ambiguous, false);
  assert.equal(r.groups.status, "applied");
  assert.ok(r.rival.ambiguous);
  assert.equal(r.equals.best.candidate.mbid, "early");
});

test("score: a release MusicBrainz has without lengths is judged by its names", { skip: rules }, () => {
  const blank = tracks => cand({ tracks: tracks.map(t => ({ title: t.title, length: null })) });
  // Every title and the count agree: applied, as Roon would. Short of exact:
  // by the same 85 % as any other (v0.6.3; 95 % until v0.8.41).
  const r = ask({ all: ["decide", album(), [blank(album().tracks)]],
    live: ["decide", album(), [blank(album().tracks.map((t, i) => i === 2 ? { title: "The National Anthem (Live)" } : t))]],
    short: ["decide", album(), [blank(album().tracks.slice(0, 3))]] });
  assert.equal(r.all.status, "applied");
  assert.equal(r.all.best.parts.no_lengths, true);
  assert.equal(r.all.best.parts.track_lengths, null);
  const pct = ask({ live: ["similarity", r.live.best.distance], short: ["similarity", r.short.best.distance] });
  for (const k of ["live", "short"]) assert.equal(r[k].status, pct[k] >= 85 ? "applied" : "unidentified", String(r[k].best.distance));
});

test("score: a ripper's 'null' is not part of a name", { skip: rules }, () => {
  const junk = album({ tracks: album().tracks.map(t => ({ title: "null: " + t.title + " (null)", length: t.length })) });
  const r = ask({ both: ["tidy", "null: Line Up (null)"], tail: ["tidy", "Line Up - undefined"], unknown: ["tidy", "(Unknown) Line Up"], alone: ["tidy", "null"],
    word: ["tidy", "Annulment"], dist: ["titleDist", "null: Line Up (null)", "Line Up"], artist: ["artistSuspect", "null", "Elastica"], d: ["distance", junk, cand()] });
  assert.deepEqual([r.both, r.tail, r.unknown, r.alone, r.word], ["Line Up", "Line Up", "Line Up", "", "Annulment"]);
  assert.equal(r.dist, 0);
  assert.ok(r.artist);
  assert.equal(r.d.distance, 0);
  assert.deepEqual(r.d.pairs, [0, 1, 2, 3]);
});

test("score: a copy missing a track is still the record — tracks pair by likeness, not by number", { skip: rules }, () => {
  // Ten of the release's eleven, the third gone: every remaining track pairs with its own.
  const full = album();
  full.tracks = [["She Runs Away", 224], ["In the Absence of Sun", 305], ["Reasons for Living", 258], ["Barely Breathing", 255], ["Days Go By", 289],
    ["Serena", 284], ["Out of Order", 271], ["November", 296], ["Home", 288], ["The End of Outside", 285], ["Little Hands", 364]].map(([title, length]) => ({ title, length }));
  const copy = album({ title: "Duncan Sheik", artist: "Duncan Sheik", year: 1996, tracks: full.tracks.filter((t, i) => i !== 2) });
  const rel = cand({ title: "Duncan Sheik", artist: "Duncan Sheik", year: 1996, tracks: full.tracks });
  // A copy with a track the release hasn't: that one pairs with nothing and keeps its tag.
  const extra = album({ tracks: album().tracks.concat([{ title: "Hidden Jam", length: 600 }]) });
  // Two "Untitled"s of the same length pair in order.
  const twins = [{ title: "Untitled", length: 100 }, { title: "Untitled", length: 100 }];
  const r = ask({ d: ["distance", copy, rel], v: ["decide", copy, [rel]], e: ["distance", extra, cand()], twins: ["pairTracks", twins, twins], APPLY: ["APPLY"] });
  assert.deepEqual(r.d.pairs, [0, 1, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(r.d.parts.missing_tracks, 1);
  assert.equal(r.d.parts.extra_tracks, 0);
  assert.ok(r.d.distance <= r.APPLY, String(r.d.distance));
  assert.equal(r.v.status, "applied");
  assert.deepEqual(r.e.pairs, [0, 1, 2, 3, null]);
  assert.equal(r.e.parts.extra_tracks, 1);
  assert.deepEqual(r.twins.pairs, [0, 1]);
});

test("the night window, including one over midnight", { skip: rules }, () => {
  const s = { start: "22:00", end: "04:00" };
  const r = ask({ h23: ["inWindow", s, "23:00"], h359: ["inWindow", s, "03:59"], h4: ["inWindow", s, "04:00"], h12: ["inWindow", s, "12:00"],
    m90: ["minutes", "01:30", null], m25: ["minutes", "25:00", null], junk: ["minutes", "junk", 7] });
  assert.deepEqual([r.h23, r.h359, r.h4, r.h12], [true, true, false, false]);
  assert.deepEqual([r.m90, r.m25, r.junk], [90, null, 7]);
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
  //   between them: a track missing, 85–95 % alike → applied (v0.8.41; it was proposed), each
  //   track taking the name of the one it paired with.
  // Hi Res (Artist B, two 4 s tracks) → the right names but one length 26 s off: applied (v0.8.41;
  //   it was proposed).
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
    { id: "hi-res-1", title: "Hi Res", artist: "Artist B", date: "2020", tracks: [["Hi 1", 4], ["Hi 2", 30]] },
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
    // The scan and its page are the C# server's (v0.8.19).
    const h = await fetch(B + "/api/identify?lists=0", { headers: { Authorization: "Bearer " + token } });
    assert.equal(h.headers.get("x-mandarin-answered"), "C#", "the identification scan's page is the C# server's");
    // Scheduling off: it scans now, whatever the clock says.
    let r = await api("identify/settings", { schedule: false });
    assert.equal(r.settings.schedule, false);
    assert.equal(r.settings.enabled, true);
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 5 && j; });
    assert.deepEqual([r.progress.applied, r.progress.proposed, r.progress.unidentified], [4, 0, 1]);

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

    // Best Of: a track of three missing, applied at 85–95 % (v0.8.41; it was proposed, then
    // accepted): the artist stays Various Artists (correctly), the year and the paired track
    // titles are the release's.
    const applied = r.applied.find(x => x.album.title === "Best Of");
    assert.ok(applied, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.equal(applied.candidate.mbid, "best-of-1");
    assert.ok(applied.similarity < 96 && applied.similarity >= 85, String(applied.similarity));
    const bestOf = await api("album?offset=" + applied.album.offset);
    assert.equal(bestOf.album.year, 2001);
    assert.equal(bestOf.album.subtitle, "Various Artists");
    assert.deepEqual(bestOf.tracks.map(t => t.title), ["C1", "C2 (Live)"]);
    // The overlay is on the track itself too (what a queue shows: the phone's, handed the album);
    // a title that only repeats the tag is not written, and the tag's own stays under it.
    const phone = await api("phone/hello", { name: "Pixel 8" });
    assert.equal((await api("play", { offset: applied.album.offset, zone_or_output_id: phone.zone_id, kind: "play_now" })).status, 200);
    const load = (await until(async () => (await api(`phone/commands?after=${phone.seq}`)).commands.find(c => c.op === "load")));
    assert.deepEqual(load.items.map(x => x.title), ["C1", "C2 (Live)"]);
    const bestKey = ctx.db.raw.prepare("SELECT key FROM albums WHERE title = 'Best Of'").get().key;
    assert.deepEqual(ctx.db.raw.prepare("SELECT title FROM track_edits WHERE key = ? AND title IS NOT NULL").all(bestKey).map(x => x.title), ["C2 (Live)"]);
    assert.deepEqual(bestOf.tracks.map(t => ctx.db.raw.prepare("SELECT title FROM tracks WHERE id = ?").get(t.track_id).title), ["C1", "C2"]);

    // Hi Res: one length 26 s off, applied at 85–95 % with why it isn't 100 % (v0.8.41; it was proposed).
    const prop = r.applied.find(x => x.album.title === "Hi Res");
    assert.ok(prop, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.ok(prop.similarity < 95 && prop.similarity >= 85, String(prop.similarity));
    assert.ok(prop.why.includes("track lengths differ"), JSON.stringify(prop.why));
    assert.deepEqual((await api("album?offset=" + prop.album.offset)).tracks.map(t => t.title), ["Hi 1", "Hi 2"]);

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
    assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM track_edits WHERE key = ?").get(bestKey).n, 0);
    assert.equal(ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM album_edits WHERE key = ?").get(bestKey).n, 0, "no longer edited");

    // A rejected album is not looked at again; the request count stays put.
    const n = mb.requests.length;
    await new Promise(res => setTimeout(res, 400));   // a window: it may not be asked about in it
    assert.equal(mb.requests.length, n);

    // Everything survives a library reload (rows keyed by album identity).
    await ctx.library.reload();
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

test("iTunes: an album as Apple has it, with its lengths; Single and EP set aside; a 429 pauses it", { skip: rules }, async () => {
  const fake = await new FakeITunes([
    { id: 77, title: "Some Record - EP", artist: "Somebody", date: "2015-06-01", tracks: [["One", 200.4], ["Two", 181]] }
  ]).start();
  try {
    const [found, c] = (await scoreAsync({ fn: "itunes", base: fake.baseUrl, steps: [{ search: { title: "Some Record", artist: "Somebody" } }, { album: "77" }] })).results;
    assert.deepEqual(found.map(f => [f.id, f.track_count]), [["77", 2]]);
    assert.ok(fake.requests[0].includes("country=US") && fake.requests[0].includes("entity=album"));
    assert.equal(c.mbid, "itunes:77");
    assert.equal(c.source, "itunes");
    assert.equal(c.title, "Some Record");
    assert.equal(c.type, "EP");
    // Apple's date is the edition's: never the album's year.
    assert.equal(c.year, null);
    assert.equal(c.release_date, "2015-06-01");
    assert.deepEqual(c.tracks.map(t => [t.title, t.length]), [["One", 200.4], ["Two", 181]]);
    // Refused: paused, and not asked again while it is.
    fake.refuse = true;
    const n = fake.requests.length;
    const [first, state, again] = (await scoreAsync({ fn: "itunes", base: fake.baseUrl, steps: [{ search: { title: "x" } }, { paused: true }, { search: { title: "x" } }] })).results;
    assert.equal(first.paused, true, JSON.stringify(first));
    assert.equal(state.paused, true);
    assert.equal(again.paused, true, JSON.stringify(again));
    assert.equal(fake.requests.length, n + 1, "asked once: not while paused");
  } finally { await fake.stop(); }
});

test("score: exact — what a second source needs before it's applied unasked", { skip: rules }, () => {
  const v = ask({ same: ["decide", album(), [cand()]],
    // a length 20 s off: applied from MusicBrainz, not from iTunes
    off: ["decide", album(), [cand({ tracks: album().tracks.map((t, i) => i === 0 ? { title: t.title, length: t.length + 20 } : t) })]],
    short: ["decide", album(), [cand({ tracks: album().tracks.slice(0, 3) })]] });
  const r = ask({ same: ["exact", v.same.best.parts], off: ["exact", v.off.best.parts], short: ["exact", v.short.best.parts] });
  assert.equal(r.same, true);
  assert.equal(r.off, false);
  assert.equal(r.short, false);
});

test("iTunes for what MusicBrainz can't place: exact and near applied (85 %, v0.8.41); skipped while it says wait, then asked", { skip, timeout: 90000 }, async () => {
  const lib = makeLibrary();
  const mb = await new FakeMusicBrainz([]).start();        // MusicBrainz knows none of them
  // Album One (Artist A): three 3 s tracks, exactly — applied, Apple's names written ("- EP" set aside).
  // Hi Res (Artist B): two 4 s tracks, Apple's second 26 s longer — applied at 85–95 % (v0.8.41; it was proposed).
  // Best Of: not in Apple's catalogue — unidentified.
  const itunes = await new FakeITunes([
    { id: 101, title: "Album One - EP", artist: "Artist A", date: "2019-01-01", tracks: [["Song 1", 3], ["Song 2 (feat. Guest)", 3], ["Song 3", 3]] },
    { id: 102, title: "Hi Res", artist: "Artist B", date: "2020-01-01", tracks: [["Hi 1", 4], ["Hi 2", 30]] }
  ]).start();
  itunes.refuse = true;     // at first it asks us to wait
  // Each refusal rests iTunes a second and a half here, not a quarter of an hour.
  process.env.ITUNES_PAUSE_MS = "1500";
  const port = ports.port(), base = "http://127.0.0.1:" + port;
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
    assert.ok(itunes.requests.length >= 1, "iTunes was asked, and refused");
    const asked = () => ctx.db.raw.prepare("SELECT itunes FROM album_matches").all().map(x => x.itunes);
    assert.ok(asked().includes("skipped"), JSON.stringify(asked()));

    // Answering again (its rest over): the unidentified ones are asked of iTunes alone.
    const mbBefore = mb.requests.length;
    itunes.refuse = false;
    r = await until(async () => { const j = await api("identify"); return j.progress.applied === 2 && j.progress.proposed === 0 && asked().every(x => x === "asked") && j; });
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

    const hi = r.applied.find(x => x.album.title === "Hi Res");
    assert.ok(hi, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.equal(hi.candidate.source, "itunes");
    assert.ok(hi.similarity < 96 && hi.similarity >= 85, String(hi.similarity));

    // Asked once: nothing more goes to iTunes for these.
    const n = itunes.requests.length;
    await new Promise(res => setTimeout(res, 500));   // a window: nothing may go to iTunes in it
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
    delete process.env.ITUNES_PAUSE_MS;
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
  const port = ports.port(), base = "http://127.0.0.1:" + port;
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

test("score: 85 % alike, as the page shows it, is applied unasked; 84 % is left unidentified, nothing proposed (v0.8.41)", { skip: rules }, () => {
  // The year one off (a reissue's, say) and one track long: the first
  // lengths that score 85 % and 84 %, found from the scoring itself.
  const near = off => cand({ year: 1999, tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + off } : t) });
  const tries = [];
  for (let off = 0; off < 400; off++) for (const k of [0, 1, 2]) {
    const c = near(off);
    for (let j = 0; j < k; j++) c.tracks[(j + 2) % c.tracks.length].length += 40;
    tries.push(["decide", album(), [c]]);
  }
  const { results: verdicts } = score({ fn: "scorecall", calls: tries });
  const { results: pcts } = score({ fn: "scorecall", calls: verdicts.map(v => ["similarity", v.best.distance]) });
  const at = pct => verdicts[pcts.indexOf(pct)] || null;
  const v85 = at(85), v84 = at(84), v94 = at(94);
  assert.ok(v85 && v84 && v94, "the percentages reachable");
  assert.equal(v85.status, "applied");
  assert.equal(v94.status, "applied", "what was proposed at 94 % is applied now");
  assert.equal(v84.status, "unidentified", "below 85 %: left to match by hand, not proposed");
  // Nothing else counts (v0.6.3): no lengths, missing tracks, a close rival — the distance is all that's asked.
  const r = ask({ APPLY: ["APPLY"], PROPOSE: ["PROPOSE"], at87: ["appliesUnasked", 0.13], at84: ["appliesUnasked", 0.16] });
  assert.equal(r.PROPOSE, r.APPLY, "nothing between applied and unidentified");
  assert.equal(r.at87, true);
  assert.equal(r.at84, false);
});

test("proposals already waiting at 85 % or more are applied once, whatever else; the rest stay (v0.6.3, v0.8.41)", { skip, timeout: 90000 }, async (t) => {
  const lib = makeLibrary();
  const mb = await new FakeMusicBrainz([]).start();        // MusicBrainz knows none of them
  const itunes = await new FakeITunes([]).start();
  t.after(async () => { await mb.stop(); await itunes.stop(); });
  const opts = { port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl };
  // First with the scan off: the albums found, and proposals left waiting as a version before v0.8.41 left them.
  let srv = createServer(Object.assign({ identify: false }, opts));
  const ctx = await srv.start();
  const keys = {};
  try {
    const token = await signIn(B);
    await until(async () => (await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json()).index_count === 3);
    for (const title of ["Album One", "Best Of", "Hi Res"]) keys[title] = ctx.db.raw.prepare("SELECT key FROM albums WHERE title = ?").get(title).key;
    keys.gone = "an album no longer in the library";
    const put = (key, distance, extra = {}) => ctx.db.raw.prepare("INSERT INTO album_matches(key, mbid, distance, status, candidate, before, checked_at, applied_at) VALUES(?, ?, ?, 'proposed', ?, NULL, ?, NULL)")
      .run(key, "m-" + distance, distance, JSON.stringify(Object.assign({ artist: "X", title: "Waiting " + distance, parts: {} }, extra)), Date.now());
    put(keys["Album One"], 0.15);                                               // 85 %
    put(keys["Best Of"], 0.01, { source: "itunes", ambiguous: true });          // 99 %, from iTunes, with a rival
    put(keys["Hi Res"], 0.16);                                                  // 84 %
    put(keys.gone, 0.01);
  } finally { ctx.db.close(); await srv.stop(); }
  // Then with it on, at any hour: those at 85 % or more applied as if accepted, once.
  srv = createServer(Object.assign({ identify: true, identifyTickMs: 100 }, opts));
  const ctx2 = await srv.start();
  t.after(() => srv.stop());
  const said = () => ctx2.logs.filter(l => /waiting, now applied/.test(l));
  await until(() => said().length === 2);
  const status = key => ctx2.db.raw.prepare("SELECT status FROM album_matches WHERE key = ?").get(key).status;
  assert.equal(status(keys["Album One"]), "applied");
  assert.equal(status(keys["Best Of"]), "applied");
  assert.equal(status(keys["Hi Res"]), "proposed", "84 %: left as it was");
  assert.equal(status(keys.gone), "proposed", "no album to apply it to");
  const edit = key => (ctx2.db.raw.prepare("SELECT title FROM album_edits WHERE key = ?").get(key) || {}).title;
  assert.equal(edit(keys["Album One"]), "Waiting 0.15");
  assert.equal(edit(keys["Hi Res"]), undefined);
  await new Promise(r => setTimeout(r, 500));   // a window: none may be applied a second time in it
  assert.equal(said().length, 2, "once: " + JSON.stringify(said()));
});

test("names: '+', '&' and 'and', a dropped g, 'n' — the same word to the score (v0.6.3)", { skip: rules }, () => {
  const same = [["Siouxsie & The Banshees", "Siouxsie and the Banshees"], ["Simon + Garfunkel", "Simon & Garfunkel"],
    ["Kiddin", "Kiddin'"], ["Kickin'", "Kicking"], ["Kickin", "Kickin’"], ["Rock 'n' Roll", "Rock and Roll"], ["Rock n Roll", "Rock & Roll"]];
  const r = ask(Object.assign({
    // Short words aren't stretched into others.
    king: ["stringDist", "King", "Kin"], sing: ["stringDist", "Sing", "Sin"],
    // So an album tagged one way and released the other is a full match.
    v: ["decide", album({ artist: "Simon + Garfunkel", title: "Kickin' It" }), [cand({ artist: "Simon & Garfunkel", title: "Kicking It" })]]
  }, Object.fromEntries(same.flatMap(([a, b], i) => [["s" + i, ["stringDist", a, b]], ["t" + i, ["titleDist", a, b]]]))));
  same.forEach(([a, b], i) => {
    assert.equal(r["s" + i], 0, a + " / " + b);
    assert.equal(r["t" + i], 0, a + " / " + b);
  });
  assert.ok(r.king > 0);
  assert.ok(r.sing > 0);
  assert.equal(r.v.best.distance, 0);
});

test("why a match is short of 100 %, in words (v0.6.3)", { skip: rules }, () => {
  const near = cand({ year: 1999, tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + 30 } : t) });
  const s = ask({ v: ["decide", album(), [near]], same: ["distance", album(), cand()] });
  const r = ask({ near: ["why", s.v.best.parts, 2000], same: ["why", s.same.parts], blank: ["why", { no_lengths: true, track_titles: 0.3 }], notes: ["why", { album: 0.05 }] });
  assert.deepEqual(r.near, ["track lengths differ", "the year differs (2000 here)"]);
  assert.deepEqual(r.same, []);
  assert.deepEqual(r.blank, ["track names differ", "MusicBrainz has no track lengths"]);
  assert.deepEqual(r.notes, ["edition notes in the names"]);
});

test("what a real library taught (v0.6.3): bracketed names, lengths first, Roman numerals, disambiguation", { skip: rules }, () => {
  // Names with something in brackets the release hasn't — or the other way — are the same track.
  const brackets = [["Live For (Album Version (Explicit))", "Live For"], ["Little Rio", "Little Rio (Un poco Rio)"],
    ["Bus To Baton Rouge (Album Version (New Mastering))", "Bus to Baton Rouge"], ["The Fish", "The Fish (Schindleria Praematurus)"]];
  // Two tracks the same length in the same place pair, however they're named ("Original Mix").
  const mine = { title: "Hard House", artist: "Various Artists", year: 2017, tracks: [{ title: "Better Watch Out (Original Mix)", length: 483 }, { title: "Something Like This (Original Mix)", length: 546 }] };
  const rel = cand({ title: "Hard House", artist: "Various Artists", year: 2017, tracks: [{ title: "Better Watch Out (Ben Stevens vs. Damage & Narkotique)", length: 483 }, { title: "Something Like This (Pickup & Rise vs. Adam M)", length: 546 }] });
  const tales = { title: "Tales From Topographic Oceans", artist: "Yes", year: 1973, context: "Disc 4 - Tales From Topographic Oceans (1973) · The Steven Wilson Remixes (2018)",
    tracks: [{ title: "The Revealing Science of God", length: 1200 }] };
  const orig = { mbid: "orig", title: "Tales From Topographic Oceans", artist: "Yes", year: 1973, tracks: [{ title: "The Revealing Science of God", length: 1200 }] };
  const sw = Object.assign({}, orig, { mbid: "sw", group_note: "Steven Wilson remix" });
  const live = Object.assign({}, orig, { mbid: "live", edition: "live" });
  const plain = Object.assign({}, tales, { context: "" });
  const r = ask(Object.assign({
    medley: ["titleDist", "Kill Time", "Pipeline/Kill Time"], other: ["titleDist", "Kid A", "OK Computer"],
    // Part II is Part 2, Vol. 3 is Volume III; "No More Tears" stays "No".
    part: ["titleDist", "Part II", "Part 2"], vol: ["titleDist", "Vol. 3", "Volume III"], no: ["titleDist", "No More Tears", "Number More Tears"],
    d: ["distance", mine, rel],
    // The year counts least: a 2006 collection of 1955 recordings stays a match.
    old: ["decide", album({ year: 1955 }), [cand({ year: 2006 })]],
    // Disambiguation: a folder that says "Remixes" prefers the release that says remix.
    remix: ["decide", tales, [orig, sw]],
    // And a release labelled live is charged when nothing of yours says live.
    live: ["decide", plain, [live, orig]], liveD: ["distance", plain, live]
  }, Object.fromEntries(brackets.map(([a, b], i) => ["b" + i, ["titleDist", a, b]]))));
  brackets.forEach(([a, b], i) => assert.ok(r["b" + i] <= 0.1, a + " / " + b));
  assert.equal(r.medley, 0.15, "one part of a medley's name");
  assert.ok(r.other > 0.5);
  assert.equal(r.part, 0);
  assert.equal(r.vol, 0);
  assert.ok(r.no > 0.2);
  assert.deepEqual([r.d.parts.missing_tracks, r.d.parts.extra_tracks], [0, 0]);
  assert.equal(r.old.status, "applied");
  assert.equal(r.remix.best.candidate.mbid, "sw");
  assert.equal(r.live.best.candidate.mbid, "orig");
  assert.ok(ask({ w: ["why", r.liveD.parts] }).w.includes("MusicBrainz marks it as another version"));
});

test("a fresh look at matching (v0.7.2): a bigger pressing, spaces, a disc of a set", { skip: rules }, () => {
  // The whole of a ten-track copy on a twenty-track anniversary pressing,
  // every track there to the name and the second: the same record, applied.
  const ten = [["Be All, End All", 361], ["Out of Sight, Out of Mind", 260], ["Make Me Laugh", 324], ["Antisocial", 266], ["Who Cares Wins", 445],
    ["Now It's Dark", 331], ["Schism", 324], ["Misery Loves Company", 325], ["13", 48], ["Finale", 350]].map(([title, length]) => ({ title, length }));
  const copy = { title: "State Of Euphoria", artist: "Anthrax", year: 1988, tracks: ten };
  const anniversary = { mbid: "b", group_mbid: "g", title: "State of Euphoria", artist: "Anthrax", year: 1988,
    release_title: "State of Euphoria (30th Anniversary Edition)", edition: "30th anniversary", tracks: ten.concat(Array.from({ length: 10 }, (_, i) => ({ title: "Bonus " + i, length: 200 }))) };
  // A folder that is disc 2 of a set is scored against disc 2 alone.
  const disc2 = [["A", 180], ["B", 240], ["C", 300], ["D", 360]].map(([title, length]) => ({ title, length }));
  const set = { mbid: "s", title: "Days of Future Passed", artist: "The Moody Blues", year: 1967,
    tracks: [{ title: "X", length: 100, disc: 1 }, { title: "Y", length: 120, disc: 1 }].concat(disc2.map(t => Object.assign({ disc: 2 }, t))) };
  const r = ask({
    d: ["distance", copy, anniversary],
    // Not when a track of the copy is another song: then the bonus tracks are missing tracks as before.
    other: ["distance", Object.assign({}, copy, { tracks: ten.slice(0, 9).concat([{ title: "Another Song", length: 350 }]) }), anniversary],
    // Nor when the copy has only a couple of the pressing's tracks: cautious, proposed at best.
    two: ["distance", Object.assign({}, copy, { tracks: ten.slice(0, 2) }), anniversary],
    // Spaces are not a difference.
    spaces: ["titleDist", "LateNightTales: Belle and Sebastian, Volume 2", "Late Night Tales: Belle and Sebastian, Volume 2"], joined: ["stringDist", "LateNightTales", "Late Night Tales"],
    e: ["distance", { title: "Days Of Future Passed CD2", artist: "The Moody Blues", year: 1967, tracks: disc2 }, set],
    cd2: ["discOf", "Days Of Future Passed CD2"], disc02: ["discOf", "Album (Disc 02)"], none: ["discOf", "Album"], bare: ["bare", "Days Of Future Passed CD2"],
    // The context names the disc when the title doesn't.
    f: ["distance", { title: "Days Of Future Passed", artist: "The Moody Blues", year: 1967, context: "CD2 · Days Of Future Passed", tracks: disc2 }, set]
  });
  const p = ask({ d: ["similarity", r.d.distance], other: ["similarity", r.other.distance], two: ["similarity", r.two.distance], e: ["similarity", r.e.distance], why: ["why", r.d.parts] });
  assert.ok(p.d >= 95, "applied: " + p.d + " %");
  assert.equal(r.d.parts.edition, true); assert.equal(r.d.parts.missing_tracks, 10);
  assert.ok(p.why.includes("a bigger pressing of the same record"));
  assert.equal(r.other.parts.edition, false);
  assert.ok(p.other < 95);
  assert.ok(r.two.parts.edition && p.two < 95, "two tracks of twenty: " + p.two + " %");
  assert.equal(r.spaces, 0);
  assert.equal(r.joined, 0);
  assert.equal(r.e.parts.disc, 2); assert.equal(r.e.parts.missing_tracks, 0);
  assert.equal(p.e, 100);
  assert.equal(r.cd2, 2); assert.equal(r.disc02, 2); assert.equal(r.none, null);
  assert.equal(r.bare, "Days Of Future Passed");
  assert.equal(r.f.parts.disc, 2);
});

test("applied unasked, a copy missing a track: each track named from the one it paired with (v0.8.19)", { skip, timeout: 90000 }, async () => {
  const fs = require("fs");
  const path = require("path");
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  // Tracks 1, 2, 4, 5 and 6 of six: the third is missing, the names are lower case.
  for (const [title, seconds, track] of [["one", 3, 1], ["two", 4, 2], ["four", 6, 4], ["five", 7, 5], ["six", 8, 6]]) {
    gen(path.join(lib.music, "Gapper", "Gap Record", `0${track}.flac`), { freq: 200 + 40 * track, seconds,
      tags: { title, artist: "Gapper", album: "Gap Record", track, date: "2001" } });
  }
  const mb = await new FakeMusicBrainz([
    { id: "gap-1", title: "Gap Record", artist: "Gapper", date: "2001-01-01", tracks: [["One", 3], ["Two", 4], ["Three", 5], ["Four", 6], ["Five", 7], ["Six", 8]] }
  ]).start();
  const itunes = await new FakeITunes([]).start();
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl });
  await srv.start();
  const token = await signIn(base);
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const titles = async offset => (await api("album?offset=" + offset)).tracks.map(t => t.title);
  try {
    await until(async () => (await api("status")).index_count === 1);
    await api("identify/settings", { schedule: false });
    const r = await until(async () => { const j = await api("identify"); return j.progress.checked === 1 && j; });
    assert.equal(r.progress.applied, 1, JSON.stringify(r.progress));
    const a = r.applied[0];
    assert.ok(a.similarity >= 95 && a.similarity < 100, String(a.similarity));
    // Not "One, Two, Three, Four, Five": the fourth track is Four, whatever its place.
    assert.deepEqual(await titles(a.album.offset), ["One", "Two", "Four", "Five", "Six"]);
    // Undo puts the tags back.
    await api("identify/undo", { offset: a.album.offset });
    assert.deepEqual(await titles(a.album.offset), ["one", "two", "four", "five", "six"]);
    // Chosen by hand (Find match), the same.
    const m = await api("identify/match", { offset: a.album.offset, query: "gap-1", how: "pick" });
    assert.equal(m.status, 200, JSON.stringify(m));
    assert.deepEqual(await titles(a.album.offset), ["One", "Two", "Four", "Five", "Six"]);
  } finally {
    await srv.stop();
    await mb.stop();
    await itunes.stop();
  }
});
