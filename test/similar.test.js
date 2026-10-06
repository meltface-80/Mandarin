"use strict";
/*
 * The share card's three suggestions (v0.7.6): weighted by what you play,
 * two of the three not heard of, a record each, and a reason. Pure
 * decisions over canned Deezer answers (lib/similar.js), then the route
 * end to end with Deezer stood in for.
 */
const test = require("node:test");
const assert = require("node:assert");
const similar = require("../lib/similar");

const act = (id, name, fans) => ({ id: String(id), name, nb_fan: fans });

test("the taste graph: acts near what you play, weighted by days played and recency, 0..1", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const seeds = [
    { name: "Steely Dan", days: 10, last: now - 2 * 86400000 },       // played a lot, lately
    { name: "Kraftwerk", days: 1, last: now - 150 * 86400000 }       // once, months ago
  ];
  const rel = {
    "Steely Dan": [{ id: "1", name: "Donald Fagen" }, { id: "2", name: "Prefab Sprout" }],
    "Kraftwerk": [{ id: "3", name: "Neu!" }, { id: "2", name: "Prefab Sprout" }]
  };
  const g = similar.tasteGraph(seeds, n => rel[n], now);
  assert.equal(g.get("donald fagen").score, 1, "the top act of the most-played seed is the ceiling");
  assert.ok(g.get("prefab sprout").score > g.get("neu").score, "near two seeds beats near one old one");
  assert.deepEqual(g.get("prefab sprout").via, ["Steely Dan", "Kraftwerk"]);
  assert.ok(g.get("neu").score < 0.05, "a seed played once months ago barely counts: " + g.get("neu").score);
});

test("ranking: Deezer's order, lifted by the taste graph, held back by obscurity and by having been shown", () => {
  const pool = similar.readDeezerPool({ data: [act(1, "Kids Choir", 50000), act(2, "Prefab Sprout", 40000), act(3, "Tribute Dan", 200), act(4, "Donald Fagen", 90000)] });
  assert.equal(pool.length, 4);
  assert.deepEqual(pool.map(a => a.rank), [0, 1, 2, 3]);
  const taste = new Map([["prefab sprout", { score: 1, via: ["Steely Dan"] }], ["donald fagen", { score: 0.8, via: ["Steely Dan", "Boz Scaggs"] }]]);
  const ranked = similar.rankActs(pool, { playing: "Steely Dan", taste, known: () => null, heavy: new Set(), shown: new Set() });
  assert.deepEqual(ranked.map(a => a.name), ["Prefab Sprout", "Donald Fagen", "Kids Choir", "Tribute Dan"], "near your listening first; Deezer's own first row, near nothing you play, falls behind it");
  assert.ok(ranked[3].score < ranked[2].score / 1.5, "two hundred followers: halved");
  const again = similar.rankActs(pool, { playing: "Steely Dan", taste, known: () => null, heavy: new Set(), shown: new Set(["2"]) });
  assert.equal(again[0].name, "Donald Fagen", "shown lately: Prefab Sprout gives way");
  const heavy = similar.rankActs(pool, { playing: "Steely Dan", taste, known: () => null, heavy: new Set(["donald fagen"]), shown: new Set() });
  assert.ok(!heavy.some(a => a.name === "Donald Fagen"), "an act you play heavily is never suggested");
  const self = similar.rankActs([{ id: "9", name: "Steely Dan", rank: 0 }], { playing: "Steely Dan" });
  assert.equal(self.length, 0, "never the playing act itself");
});

test("the draw: two acts not heard of and one you know, filled from the rest when a slot can't be met", () => {
  const ranked = [
    { id: "1", name: "A", score: 1, known: null }, { id: "2", name: "B", score: 0.9, known: "library" },
    { id: "3", name: "C", score: 0.8, known: null }, { id: "4", name: "D", score: 0.7, known: "played" },
    { id: "5", name: "E", score: 0.6, known: null }
  ];
  const rnd = () => 0;   // the first of the weighted candidates each time
  const picks = similar.choose(ranked, { rnd });
  assert.deepEqual(picks.map(p => p.name), ["A", "C", "B"], "two unknown, then the best-known act");
  const onlyNew = similar.choose(ranked.filter(a => !a.known), { rnd });
  assert.deepEqual(onlyNew.map(p => p.name), ["A", "C", "E"], "nobody known: three new");
  const onlyKnown = similar.choose(ranked.filter(a => a.known), { rnd });
  assert.deepEqual(onlyKnown.map(p => p.name), ["B", "D"], "no unknown acts at all: what there is");
  // A real draw is weighted, not fixed: over many draws the top act leads but is not alone.
  const first = new Set();
  for (let i = 0; i < 200; i++) first.add(similar.choose(ranked)[0].name);
  assert.ok(first.size > 1 && first.has("A"), "the draw varies: " + [...first].join(","));
});

test("the record for an act: best-known from the top tracks; for an act you know, the newest you don't own", () => {
  const top = similar.readDeezerTop({ data: [
    { album: { id: 10, title: "Steve McQueen", cover_medium: "c10" } }, { album: { id: 11, title: "Swoon" } },
    { album: { id: 10, title: "Steve McQueen" } }, { album: { id: 12, title: "Jordan: The Comeback" } }
  ] });
  assert.deepEqual(top, { id: "10", title: "Steve McQueen", cover: "c10", n: 2 });
  const albums = similar.readDeezerAlbumList({ data: [
    { id: 11, title: "Swoon", record_type: "album", release_date: "1984-03-01" },
    { id: 10, title: "Steve McQueen", record_type: "album", release_date: "1985-06-01" },
    { id: 13, title: "Crimson/Red", record_type: "album", release_date: "2013-10-07", cover_medium: "c13" },
    { id: 14, title: "A Single", record_type: "single", release_date: "2014-01-01" },
    { id: 15, title: "Undated", record_type: "album", release_date: "0000-00-00" }
  ] });
  assert.deepEqual(albums.map(a => a.title), ["Crimson/Red", "Steve McQueen", "Swoon", "Undated"], "full albums only, newest first");
  const unknown = similar.recordFor({ known: null }, top, albums, []);
  assert.deepEqual(unknown, { title: "Steve McQueen", year: 1985, cover: "c10" }, "not heard of: their best-known, with its year from the listing");
  const known = similar.recordFor({ known: "library" }, top, albums, ["Steve McQueen", "Swoon"]);
  assert.deepEqual(known, { title: "Crimson/Red", year: 2013, cover: "c13" }, "known: the newest full album you don't own");
  assert.equal(similar.recordFor({ known: "library" }, top, albums.slice(1), ["Steve McQueen", "Swoon"]), null, "own them all: nothing to name");
  assert.deepEqual(similar.recordFor({ known: null }, null, albums, []).title, "Crimson/Red", "no top tracks: the newest full album");
});

test("the reason under each act", () => {
  assert.equal(similar.reasonFor({ known: null, via: ["Steely Dan", "Boz Scaggs"] }, "Donald Fagen"), "Near Steely Dan and Boz Scaggs, which you play");
  assert.equal(similar.reasonFor({ known: null, via: ["Donald Fagen", "Boz Scaggs"] }, "Donald Fagen"), "Near Boz Scaggs, which you play");
  assert.equal(similar.reasonFor({ known: null, via: [] }, "Donald Fagen"), "Near Donald Fagen");
  assert.equal(similar.reasonFor({ known: "library", via: [] }, "X"), "In your library — a record you don't have");
  assert.equal(similar.reasonFor({ known: "played", via: [] }, "X"), "Something you've played — a record you don't have");
});

const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const PORT = 3643, B = "http://127.0.0.1:" + PORT;

test("/api/similar: two acts not heard of near what you play, one you know with a record you lack, each with a reason", { skip: !haveFfmpeg() && "ffmpeg is not installed", timeout: 60000 }, async () => {
  // Deezer, stood in for: Artist A (playing) is related to a children's
  // choir, two acts near Artist B (whom you play), Artist B (in the library)
  // and a tribute act; Artist B is related to the same two acts.
  const META = require("../lib/meta");
  const real = META.httpJson;
  const calls = [];
  const albums = (titles) => ({ data: titles.map(([id, title, date, type]) => ({ id, title, release_date: date, record_type: type || "album", cover_medium: "c" + id })) });
  const top = (id, title) => ({ data: [{ album: { id, title, cover_medium: "c" + id } }, { album: { id, title } }] });
  const answers = {
    "search/artist?limit=10&q=Artist%20A": { data: [{ id: 100, name: "Artist A", nb_fan: 5000 }] },
    "search/artist?limit=10&q=Artist%20B": { data: [{ id: 203, name: "Artist B", nb_fan: 6000 }] },
    "search/artist?limit=10&q=Heavy%20Act": { data: [{ id: 206, name: "Heavy Act", nb_fan: 6000 }] },
    "artist/206/related?limit=25": { data: [{ id: 202, name: "New Act" }] },
    "artist/100/related?limit=20": { data: [{ id: 206, name: "Heavy Act", nb_fan: 99000 }, { id: 201, name: "Kids Choir", nb_fan: 100 }, { id: 202, name: "New Act", nb_fan: 30000 }, { id: 203, name: "Artist B", nb_fan: 60000 }, { id: 204, name: "Tribute A", nb_fan: 90 }, { id: 205, name: "Another Act", nb_fan: 20000 }] },
    "artist/203/related?limit=25": { data: [{ id: 202, name: "New Act" }, { id: 205, name: "Another Act" }] },
    "artist/202/top?limit=10": top(1202, "Known For This"), "artist/202/albums?limit=50": albums([[1202, "Known For This", "2001-05-01"], [1203, "Debut", "1998-01-01"]]),
    "artist/205/top?limit=10": top(1205, "Their Big One"), "artist/205/albums?limit=50": albums([[1205, "Their Big One", "2010-05-01"]]),
    "artist/201/top?limit=10": top(1201, "Sing Along"), "artist/201/albums?limit=50": albums([[1201, "Sing Along", "2015-05-01"]]),
    "artist/204/top?limit=10": top(1204, "Covers"), "artist/204/albums?limit=50": albums([[1204, "Covers", "2012-05-01"]]),
    "artist/203/top?limit=10": top(1300, "Hi Res"), "artist/203/albums?limit=50": albums([[1300, "Hi Res", "2020-01-01"], [1301, "Newer One", "2022-01-01"], [1302, "A Single", "2023-01-01", "single"]])
  };
  META.httpJson = async (url) => {
    const p = url.replace("https://api.deezer.com/", "");
    calls.push(p);
    if (!(p in answers)) throw new Error("unexpected " + url);
    return answers[p];
  };
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const get = async p => (await fetch(B + p, { headers: { Authorization: "Bearer " + token } })).json();
    for (let i = 0; i < 100 && (await get("/api/status")).index_count !== 3; i++) await new Promise(r => setTimeout(r, 100));
    // Artist B, played on three days this month; Heavy Act (a stream, not in
    // the library) on ten — the act you play most needs no introduction.
    const hi = ctx.library.albums.find(a => a.title === "Hi Res");
    const t = ctx.library.tracks(hi.id)[0];
    for (let d = 1; d <= 3; d++) ctx.features.insertPlay.run(hi.id, t.id, t.title, "Artist B", "Hi Res", "z", Date.now() - d * 86400000);
    for (let d = 1; d <= 10; d++) ctx.features.insertPlay.run(null, null, "Song", "Heavy Act", "Big", "z", Date.now() - d * 86400000);
    await ctx.features.buildTaste();
    assert.equal(ctx.features.taste().graph.get("new act").score, 1, "the taste graph has your acts' neighbours");
    assert.deepEqual([...ctx.features.taste().heavy], ["heavy act"]);

    const seen = new Map();
    let known = null;
    for (let i = 0; i < 30; i++) {
      const r = await get("/api/similar?artist=Artist%20A");
      assert.equal(r.acts.length, 3, JSON.stringify(r));
      for (const a of r.acts) {
        assert.ok(a.reason, "a reason on every act: " + JSON.stringify(a));
        assert.ok(a.album && a.year, "a record for every act: " + JSON.stringify(a));
        assert.notEqual(a.name, "Artist A", "never the playing act");
        assert.notEqual(a.name, "Heavy Act", "never the act you play most");
        seen.set(a.name, (seen.get(a.name) || 0) + 1);
      }
      const k = r.acts.filter(a => a.known);
      assert.equal(k.length, 1, "one act you know: " + JSON.stringify(r.acts.map(a => [a.name, a.known])));
      known = k[0];
    }
    assert.equal(known.name, "Artist B");
    assert.equal(known.known, "library");
    assert.equal(known.album, "Newer One", "the newest full album of theirs you don't own (Hi Res is owned, A Single is a single)");
    assert.equal(known.reason, "In your library — a record you don't have");
    assert.equal(known.in_library, false);
    assert.ok(seen.get("New Act") > 20 && seen.get("Another Act") > 20, "the two acts near what you play lead: " + JSON.stringify([...seen]));
    assert.ok((seen.get("Kids Choir") || 0) < 10 && (seen.get("Tribute A") || 0) < 10, "an act near nothing you play, with few followers, seldom: " + JSON.stringify([...seen]));
    const r = await get("/api/similar?artist=Artist%20A");
    const fresh = r.acts.find(a => a.name === "New Act") || r.acts.find(a => a.name === "Another Act");
    assert.match(fresh.reason, /^Near (Heavy Act and Artist B|Artist B), which you play$/);
    assert.equal(fresh.cover, "c" + (fresh.name === "New Act" ? 1202 : 1205));
    // The pool and each act's records came from Deezer once; the rest was cache.
    assert.equal(calls.filter(c => c === "artist/100/related?limit=20").length, 1, "the pool is cached a day");
    assert.equal(calls.filter(c => c === "artist/202/top?limit=10").length, 1, "an act's records are cached a week");
  } finally { META.httpJson = real; await srv.stop(); }
});
