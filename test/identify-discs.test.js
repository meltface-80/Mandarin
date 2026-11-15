"use strict";
/*
 * Identification, item 414: the album tidied first (the discs of one set one album and looked up whole, a compilation
 * filed under one of its acts looked up as Various Artists), the tracks' exact lengths asked as a CD's table of
 * contents (a rip whose name finds nothing, found by its lengths; a hi-res or lossy album never asked), and the
 * pressing of the record that fits the copy chosen from its release group — the others near enough offered, one tap
 * switching to one, and undo putting the album back. Against a fake MusicBrainz on loopback (test/fake-musicbrainz.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { FakeITunes } = require("./fake-itunes");
const { createServer, built } = require("./server");
const { score } = require("./score");

const rules = built();
const skip = rules || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 50));
  }
}

test("a disc's table of contents from its tracks' lengths: 75 sectors a second from 150; only what a CD could hold", { skip: rules }, () => {
  const cd = (seconds, over = {}) => seconds.map((s, i) => Object.assign({ disc: 1, seconds: s, lossless: true, rate: 44100 }, over, { n: i }));
  const ask = tracks => score({ fn: "scorecall", calls: [["discToc", tracks]] }).results[0];
  // 5 s, 6 s, 7 s: 375, 450 and 525 sectors after the two-second lead-in.
  assert.deepEqual(ask(cd([5, 6, 7])), ["1 3 1500 150 525 975"]);
  // A set, disc by disc.
  assert.deepEqual(ask([...cd([4, 4]), ...cd([3], { disc: 2 })]), ["1 2 750 150 450", "1 1 375 150"]);
  // Not a CD: lossy, 96 kHz, a length unknown, over 80 minutes, a hundred tracks.
  assert.deepEqual(ask(cd([5, 6], { lossless: false })), []);
  assert.deepEqual(ask(cd([5, 6], { rate: 96000 })), []);
  assert.deepEqual(ask(cd([5, null])), []);
  assert.deepEqual(ask(cd([2500, 2500])), []);
  assert.deepEqual(ask(cd(Array(100).fill(10))), []);
  // One disc that couldn't be a CD: the set isn't asked.
  assert.deepEqual(ask([...cd([4, 4]), ...cd([3], { disc: 2, rate: 48000 })]), []);
});

test("item 414 end to end: a set's discs one album, a compilation, a rip found by its lengths, the edition chosen and switched", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const flac = (dir, i, tags, seconds) => gen(path.join(lib.music, dir, `0${i}.flac`), { freq: 200 + 40 * i, seconds, tags });
  // A set in disc folders, its album tags naming the disc and no disc tags: one album of six tracks, two discs, its
  // tracks' names a remaster's (the release's own written over them).
  const sides = [["Opening", "Second", "Third"], ["Fourth", "Fifth", "Closing"]];
  for (const d of [1, 2]) for (const i of [1, 2, 3]) flac(`Band E/Double Feature/Disc ${d}`, i, { title: sides[d - 1][i - 1] + " - 2005 Remaster", artist: "Band E", album: `Double Feature (Disc ${d})`, track: i }, 3 + d);
  // A compilation filed under its first act: each track's album artist its own.
  for (const i of [1, 2, 3, 4]) flac("Comps/Summer Hits", i, { title: `Hit ${i}`, artist: `Act ${i}`, album_artist: `Act ${i}`, album: "Summer Hits", track: i }, 3);
  // A CD rip under a name no search finds, its lengths exact.
  for (const i of [1, 2, 3]) flac("Artist F/Misnamed Rip", i, { title: `F${i}`, artist: "Artist F", album: "Misnamed Rip", track: i }, 4 + i);
  // Not CDs: 24/96, and lossy.
  for (const i of [1, 2]) gen(path.join(lib.music, "Artist G", "Studio Master", `0${i}.flac`), { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"], seconds: 3, tags: { title: `G${i}`, artist: "Artist G", album: "Studio Master", track: i } });
  for (const i of [1, 2]) gen(path.join(lib.music, "Artist H", "Lossy", `0${i}.mp3`), { fmt: null, codecArgs: ["-b:a", "192k"], seconds: 3, tags: { title: `H${i}`, artist: "Artist H", album: "Lossy", track: i } });
  // Three tracks carrying the barcode of the record's four-track deluxe edition: the three-track standard is the copy.
  for (const i of [1, 2, 3]) flac("Artist K/Pressed", i, { title: `K${i}`, artist: "Artist K", album: "Pressed", track: i, date: "2010", BARCODE: "0602537000023" }, 3);
  const g = { id: "g-k", title: "Pressed", date: "2010-01-01" };
  const mb = await new FakeMusicBrainz([
    { id: "dbl", title: "Double Feature", artist: "Band E", date: "2005-01-01",
      discs: sides.map((names, d) => names.map(n => [n, 4 + d])) },
    { id: "summer", title: "Summer Hits", artist: "Various Artists", date: "2015-06-01", tracks: [["Hit 1", 3], ["Hit 2", 3], ["Hit 3", 3], ["Hit 4", 3]] },
    { id: "real-f", title: "The Real Title", artist: "Artist F", date: "1999-01-01", toc: true, tracks: [["F1", 5], ["F2", 6], ["F3", 7]] },
    { id: "k-deluxe", title: "Pressed", artist: "Artist K", date: "2012-01-01", disambiguation: "deluxe", barcode: "0602537000023", group: g,
      tracks: [["K1 (Deluxe)", 3], ["K2 (Deluxe)", 3], ["K3 (Deluxe)", 3], ["Bonus", 3]] },
    { id: "k-std", title: "Pressed", artist: "Artist K", date: "2010-01-01", group: g, tracks: [["K1", 3], ["K2", 3], ["K3", 3]] }
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
  const asked = () => mb.requests.map(u => decodeURIComponent(u));
  const tocs = () => mb.requests.filter(u => u.startsWith("/ws/2/discid/-")).map(u => new URL(u, "http://x").searchParams.get("toc"));
  try {
    await until(async () => (await api("status")).index_count >= 6);
    await api("identify/settings", { schedule: false });
    let r = await until(async () => { const j = await api("identify"); return j.progress.eligible >= 6 && j.progress.checked === j.progress.eligible && j; });
    assert.equal(r.progress.eligible, 6, "the set's discs one album: " + JSON.stringify(r.applied.concat(r.unidentified).map(x => x.album.title)));
    const named = t => r.applied.find(x => x.album.title === t);

    // The set: one album, its six tracks on two discs, each named from its own disc of the release.
    const dbl = named("Double Feature");
    assert.ok(dbl, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.equal(dbl.candidate.mbid, "dbl");
    const dblPage = await api("album?offset=" + dbl.album.offset);
    assert.deepEqual(dblPage.tracks.map(t => [t.disc, t.title]), [[1, "Opening"], [1, "Second"], [1, "Third"], [2, "Fourth"], [2, "Fifth"], [2, "Closing"]]);
    assert.ok(!r.applied.concat(r.unidentified).some(x => /Disc/.test(x.album.title)), "no album for each disc");

    // The compilation: looked up without the act it is filed under, and given Various Artists.
    const summer = named("Summer Hits");
    assert.ok(summer, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.ok(asked().some(u => u.includes('release:"Summer Hits"')), JSON.stringify(asked()));
    assert.ok(!asked().some(u => u.includes('artist:"Act 1"')), "the act it is filed under is no search term");
    assert.equal((await api("album?offset=" + summer.album.offset)).album.subtitle, "Various Artists");

    // The rip under a wrong name: found by its lengths, as MusicBrainz's table of contents has them.
    const rip = named("The Real Title");
    assert.ok(rip, JSON.stringify([r.applied.map(x => x.album.title), r.unidentified.map(x => x.album.title)]));
    assert.equal(rip.candidate.mbid, "real-f");
    assert.equal(rip.candidate.matched_by, "disc-lengths");
    assert.ok(tocs().includes("1 3 1500 150 525 975"), JSON.stringify(tocs()));
    // Only what could be a CD is asked: never the 24/96 album nor the lossy one (the only two of two tracks).
    assert.ok(tocs().length >= 3, JSON.stringify(tocs()));
    assert.ok(tocs().every(t => t.split(" ")[1] !== "2"), JSON.stringify(tocs()));
    assert.deepEqual(r.unidentified.map(x => x.album.title).sort(), ["Lossy", "Studio Master"]);

    // The edition: the barcode found the deluxe, the copy's three tracks are the standard's; the deluxe kept to switch to.
    const k = named("Pressed");
    assert.ok(k, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.equal(k.candidate.mbid, "k-std");
    assert.equal(k.candidate.matched_by, "barcode");
    assert.equal(k.similarity, 100);
    assert.deepEqual(k.candidate.editions.map(e => [e.mbid, e.edition, e.track_count]), [["k-deluxe", "deluxe", 4]]);
    assert.ok(k.candidate.editions[0].similarity >= 85, JSON.stringify(k.candidate.editions));
    assert.deepEqual((await api("album?offset=" + k.album.offset)).tracks.map(t => t.title), ["K1", "K2", "K3"]);
    // Edit album says how each was found, and offers the other editions there (the scanner page lists no applied albums since 411).
    const ripEdit = await api("album/edit?offset=" + rip.album.offset);
    assert.equal(ripEdit.match && ripEdit.match.matched_by, "disc-lengths", JSON.stringify(ripEdit.match));
    assert.deepEqual(ripEdit.match.editions, []);
    const kEdit = await api("album/edit?offset=" + k.album.offset);
    assert.deepEqual([kEdit.match.title, kEdit.match.similarity, kEdit.match.matched_by], ["Pressed", 100, "barcode"]);
    assert.deepEqual(kEdit.match.editions.map(e => [e.mbid, e.edition, e.track_count]), [["k-deluxe", "deluxe", 4]]);

    // Switched in one tap: the deluxe's names written, the standard offered back.
    r = await api("identify/match", { offset: k.album.offset, query: "k-deluxe", how: "edition" });
    assert.equal(r.status, 200, JSON.stringify(r));
    const sw = r.applied.find(x => x.album.offset === k.album.offset);
    assert.equal(sw.candidate.mbid, "k-deluxe");
    assert.equal(sw.candidate.manual, "edition");
    assert.deepEqual(sw.candidate.editions.map(e => e.mbid), ["k-std"]);
    assert.deepEqual((await api("album?offset=" + k.album.offset)).tracks.map(t => t.title), ["K1 (Deluxe)", "K2 (Deluxe)", "K3 (Deluxe)"]);
    const swEdit = (await api("album/edit?offset=" + k.album.offset)).match;
    assert.deepEqual([swEdit.manual, swEdit.editions.map(e => e.mbid)], ["edition", ["k-std"]]);
    // And back, and undone: the tags' own names.
    r = await api("identify/match", { offset: k.album.offset, query: "k-std", how: "edition" });
    assert.equal(r.applied.find(x => x.album.offset === k.album.offset).candidate.mbid, "k-std");
    assert.deepEqual((await api("album?offset=" + k.album.offset)).tracks.map(t => t.title), ["K1", "K2", "K3"]);
    await api("identify/match", { offset: k.album.offset, query: "k-deluxe", how: "edition" });
    r = await api("identify/undo", { offset: k.album.offset });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.ok(r.rejected.some(x => x.album.offset === k.album.offset));
    assert.deepEqual((await api("album?offset=" + k.album.offset)).tracks.map(t => t.title), ["K1", "K2", "K3"]);
  } finally {
    await srv.stop();
    await mb.stop();
    await itunes.stop();
  }
});
