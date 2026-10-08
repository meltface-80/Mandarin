"use strict";
/*
 * The album editor's cover search (v0.8.22): the C# server's (server/
 * Mandarin.Server/Extras/ArtFind.cs) held to lib/library/artfind.js — the
 * same names compared the same way, and whole searches over the same canned
 * catalogue answers (as test/artfind.test.js gives them) ending in the same
 * candidates, scored, ordered and cut alike; odd answers (a field missing, a
 * list that isn't one, a release group with no cover) doing the same there as
 * here. Through `mandarin-server score`; skipped where the C# server isn't
 * built. The route itself runs against the C# server in test/front.test.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ArtFind = require("../lib/library/artfind");
const N = require("../lib/library/normalize");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(Object.assign({ fn: "artfind" }, job)) + "\n", maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
const plain = v => JSON.parse(JSON.stringify(v));

// test/artfind.test.js's canned web: the first address prefix that fits.
function fakeWeb(routes) {
  return async (url) => {
    for (const [prefix, body] of routes) if (url.startsWith(prefix)) return body;
    throw new Error("HTTP 404");
  };
}

const SIGUR = ["Untitled #1 (Vaka)", "Untitled #2 (Fyrsta)", "Untitled #3 (Samskeyti)", "Untitled #4 (Njósnavélin)"];
const itunesAlbum = (id, name, artist, extra) => Object.assign({ collectionId: id, collectionName: name, artistName: artist, artworkUrl100: `https://is1.example/${id}/100x100bb.jpg` }, extra || {});
const CASES = [
  // test/artfind.test.js's three.
  { album: { title: "( )", artist: "Sigur Rós" }, tracks: SIGUR, routes: [
    ["https://itunes.apple.com/search", { results: [itunesAlbum(1, "( )", "Sigur Rós", { trackCount: 8 }), itunesAlbum(2, "Takk...", "Sigur Rós", { trackCount: 11 })] }],
    ["https://itunes.apple.com/lookup?id=1", { results: [{ wrapperType: "collection" }].concat(["Untitled 1", "Untitled 2", "Untitled 3", "Untitled 4"].map(t => ({ wrapperType: "track", trackName: t }))) }],
    ["https://itunes.apple.com/lookup?id=2", { results: [{ wrapperType: "track", trackName: "Glósóli" }] }]
  ] },
  { album: { title: "Kid A", artist: "Radiohead" }, tracks: ["Everything in Its Right Place"], routes: [
    ["https://api.deezer.com/search/album", { data: [{ id: 9, title: "Kid A", artist: { name: "Radiohead" }, cover_xl: "https://dz.example/9.jpg", nb_tracks: 10 }] }]
  ] },
  { album: { title: "Greatest Hits", artist: "Artist A" }, tracks: ["Song 1", "Song 2"], routes: [
    ["https://itunes.apple.com/search", { results: [itunesAlbum(5, "Greatest Hits", "Someone Else")] }],
    ["https://itunes.apple.com/lookup?id=5", { results: [{ wrapperType: "track", trackName: "Song 1" }, { wrapperType: "track", trackName: "Song 2" }] }]
  ] },
  // All three at once: songs found by a song's name too, MusicBrainz's groups
  // (one twice, one with no cover at the archive), Deezer's track lists, an
  // address offered twice, and more than twelve in all.
  { album: { title: "OK Computer (Remastered)", artist: "Radiohead" }, tracks: ["Airbag", "Paranoid Android", "Subterranean Homesick Alien", "Exit Music (For a Film)", null, "", "Let Down"], routes: [
    ["https://itunes.apple.com/search?media=music&entity=album", { results: [
      itunesAlbum(10, "OK Computer", "Radiohead", { releaseDate: "1997-05-21T07:00:00Z", trackCount: 12 }),
      itunesAlbum(11, "OK Computer OKNOTOK 1997 2017", "Radiohead", { releaseDate: "2017-06-23", trackCount: 23 }),
      itunesAlbum(10, "OK Computer (again)", "Radiohead"),
      itunesAlbum(12, "OK Computer [Deluxe Edition]", "Radiohead", { releaseDate: "abcd" }),
      { collectionId: 13, collectionName: "No art", artistName: "Radiohead" },
      null, 5, "x", { collectionId: 0, artworkUrl100: "https://is1.example/0/100x100bb.jpg" },
      itunesAlbum(14, "Kid A", "Radiohead", { releaseDate: "0x1F-01-01" }),
      itunesAlbum("10", "OK Computer as text", "Radiohead"),
      itunesAlbum(15, "OK Computer", "Radiohead", { artworkUrl100: "https://is1.example/same/600X600.PNG" })
    ] }],
    ["https://itunes.apple.com/search?media=music&entity=song", { results: [
      itunesAlbum(16, "The Bends", "Radiohead"), itunesAlbum(11, "dup", "Radiohead"), itunesAlbum(17, "Paranoid Android - EP", "Radiohead", { trackCount: 3 })
    ] }],
    ["https://itunes.apple.com/lookup?id=10", { results: ["Airbag", "Paranoid Android", "Subterranean Homesick Alien", "Exit Music (For a Film)", "Let Down", "Karma Police"].map(t => ({ wrapperType: "track", trackName: t })) }],
    ["https://itunes.apple.com/lookup?id=11", { results: [{ wrapperType: "track", trackName: "Airbag (Remastered)" }, { wrapperType: "track" }, { wrapperType: "track", trackName: 7 }] }],
    ["https://itunes.apple.com/lookup?id=12", { results: "not a list" }],
    ["https://itunes.apple.com/lookup?id=14", { results: [null] }],
    ["https://itunes.apple.com/lookup?id=15", null],
    ["https://api.deezer.com/search/album", { data: [
      { id: 20, title: "OK Computer", artist: { name: "Radiohead" }, cover_xl: "https://dz.example/20-xl.jpg", cover_big: "https://dz.example/20-big.jpg", nb_tracks: 12 },
      { id: 21, title: "OK Computer OKNOTOK", artist: "Radiohead", cover_xl: "https://dz.example/21-xl.jpg", cover_medium: "https://dz.example/21-m.jpg" },
      { id: 22, title: "", artist: { name: "" }, cover_xl: "https://is1.example/10/1200x1200bb.jpg" },
      { id: 23, title: "No cover", artist: { name: "Radiohead" } },
      3, "y"
    ] }],
    ["https://api.deezer.com/album/20/tracks", { data: [{ title: "Airbag" }, { title: "Paranoid Android" }, { title: "Let Down" }, "z", { title: null }] }],
    ["https://api.deezer.com/album/21/tracks", { data: [] }],
    ["https://musicbrainz.org/ws/2/release/", { releases: [
      { title: "OK Computer", date: "1997-06-16", "track-count": 12, "artist-credit": [{ name: "Radiohead" }], "release-group": { id: "rg-1" } },
      { title: "OK Computer", date: "1997", "release-group": { id: "rg-1" } },
      { title: "OK Computer", date: "0000", "artist-credit": "Radiohead", "release-group": { id: "rg-2" } },
      { title: "OK Computer", "artist-credit": { 0: { name: "Radiohead" } }, "release-group": { id: "rg-3" } },
      { title: "Fourth", "release-group": { id: "rg-4" } },
      { "release-group": {} }, 7
    ] }],
    ["https://coverartarchive.org/release-group/rg-1", { images: [{ front: true }] }],
    ["https://coverartarchive.org/release-group/rg-2", { images: [] }],
    ["https://coverartarchive.org/release-group/rg-3", { images: "yes" }]
  ] },
  // No title of its own (a symbol): no MusicBrainz, and Deezer asked by a song.
  { album: { title: "?!", artist: "Someone" }, tracks: ["Only Song Here"], routes: [
    ["https://api.deezer.com/search/album?limit=8&q=Someone%20Only", { data: [{ id: 30, title: "Untitled", artist: { name: "Someone" }, cover_xl: "https://dz.example/30.jpg" }] }],
    ["https://api.deezer.com/album/30/tracks", { data: [{ title: "Only Song Here" }] }]
  ] },
  // Answers that stop a catalogue's part: MusicBrainz's null, Deezer's data a
  // word (its second search not asked), iTunes's releases a string.
  { album: { title: "Odd", artist: "Odd Band" }, tracks: ["One", "Two"], routes: [
    ["https://musicbrainz.org/ws/2/release/", null],
    ["https://api.deezer.com/search/album", { data: "xy" }],
    ["https://itunes.apple.com/search", { results: { 0: itunesAlbum(40, "Odd", "Odd Band") } }]
  ] },
  { album: { title: "Odder", artist: "Odd Band" }, tracks: [], routes: [
    ["https://musicbrainz.org/ws/2/release/", { releases: "abc" }],
    ["https://api.deezer.com/search/album", { data: {} }],
    ["https://itunes.apple.com/search", { results: [itunesAlbum(41, 41, { name: "x" })] }]
  ] },
  // The first Deezer search empty, the second answering; MusicBrainz's groups cut at three.
  { album: { title: "Many", artist: "Band" }, tracks: ["A"], routes: [
    ["https://api.deezer.com/search/album?limit=8&q=artist", { data: [] }],
    ["https://api.deezer.com/search/album?limit=8&q=Band%20Many", { data: [{ id: 50, title: "Many", artist: { name: "Band" }, cover_xl: "https://dz.example/50.jpg", nb_tracks: 1 }] }],
    ["https://musicbrainz.org/ws/2/release/", { releases: [1, 2, 3, 4, 5].map(i => ({ title: "Many " + i, "release-group": { id: "g" + i }, "artist-credit": [{ name: "Band" }] })) }],
    ["https://coverartarchive.org/release-group/g", { images: [1] }]
  ] },
  // More than twelve, ties kept in the order found.
  { album: { title: "Same", artist: "Same" }, tracks: [], routes: [
    ["https://itunes.apple.com/search", { results: Array.from({ length: 16 }, (_, i) => itunesAlbum(100 + i, "Same", "Same")) }]
  ] },
  // A release group the archive has no cover for: not offered.
  { album: { title: "Groups", artist: "Band" }, tracks: [], routes: [
    ["https://musicbrainz.org/ws/2/release/", { releases: [{ title: "Groups", "release-group": { id: "has" } }, { title: "Groups", "release-group": { id: "none" } }] }],
    ["https://coverartarchive.org/release-group/has", { images: [{}] }],
    ["https://coverartarchive.org/release-group/none", { images: [] }]
  ] }
];

const NAMES = ["Untitled #1 (Vaka)", "Airbag (Remastered 2009)", "Kid A [Deluxe Edition]", "Song (Live) [Mono]", "OK Computer (OKNOTOK 1997 2017)",
  "Beyoncé & Jay-Z", "  spaced   out  ", "", null, undefined, 0, 5, "(", "a (b", "a ) b (c", "Ｆｕｌｌｗｉｄｔｈ", "Ǆemal", "STEREO (stereo version)", "X (REMASTER)", "ΣΊΣΥΦΟΣ (Expanded)"];
const PAIRS = [["( )", "( )"], ["Kid A", "KID A (Remastered)"], ["Untitled #1 (Vaka)", "Untitled 1"], ["", ""], ["", "x"], ["OK Computer", "OK Computer OKNOTOK 1997 2017"],
  ["Sigur Rós", "Sigur Ros"], ["The Beatles", "Beatles, The"], ["Jay-Z feat. Kanye West", "Kanye West"], ["Simon & Garfunkel", "Simon and Garfunkel"],
  ["Radiohead", "Thom Yorke"], ["a b c", "c b a"], ["a a b", "a b b"], [5, "5"], [null, "x"], ["x", 0], ["The The", "The"], ["AC/DC", "ACDC"], ["Daft Punk", "Daft Punk, The"]];
const MATCHES = [[["Untitled #1 (Vaka)", "Airbag (Remastered)"], ["Untitled #1", "Airbag"]], [["A"], []], [["A"], null], [[], ["A"]],
  [["One", "Two", "Three"], ["one", "TWO (Live)", "three four"]], [["(", "[]"], ["x"]], [["Exit Music (For a Film)", "Let Down"], ["Exit Music", "Let Down - Remastered", 7, null]]];

test("names compared as artfind.js compares them", { skip }, () => {
  const out = csharp({ bares: NAMES, looses: NAMES, texts: PAIRS, artists: PAIRS, matches: MATCHES, cases: [] });
  assert.deepStrictEqual(out.bare, NAMES.map(n => ArtFind.bare(n)));
  assert.deepStrictEqual(out.loose, NAMES.map(n => N.loose(n)));
  assert.deepStrictEqual(out.text, PAIRS.map(([a, b]) => ArtFind.sameText(a, b)));
  assert.deepStrictEqual(out.artist, PAIRS.map(([a, b]) => ArtFind.sameArtist(a, b)));
  assert.deepStrictEqual(out.tracks, MATCHES.map(([l, r]) => ArtFind.trackMatch(l, r)));
});

test("whole searches over the same answers end in the same candidates", { skip }, async () => {
  const out = csharp({ cases: plain(CASES) });
  for (const [i, c] of CASES.entries()) {
    const want = plain(await ArtFind.find(c.album, c.tracks, { get: fakeWeb(plain(c.routes)) }));
    assert.deepStrictEqual(out.found[i], want, `case ${i} (${c.album.title})`);
  }
  // The searches said something worth checking: sure picks, cut at twelve, dead groups gone.
  assert.equal(out.found[0].sure.url, "https://is1.example/1/1200x1200bb.jpg");
  assert.equal(out.found[3].candidates.length, 12);
  assert.equal(out.found[8].candidates.length, 12);
  assert.deepEqual(out.found[9].candidates.map(c => c.url), ["https://coverartarchive.org/release-group/has/front-1200"], "a release group with no cover isn't offered");
});
