"use strict";
/*
 * The share card's three suggestions (v0.7.6): weighted by what you play,
 * two of the three not heard of, a record each, and a reason. Pure
 * decisions over canned Deezer answers, then the route end to end with
 * Deezer stood in for.
 *
 * The C# server's (Extras/Similar.cs; lib/similar.js until v0.8.50): its
 * rules asked through `mandarin-server score` { fn: "similar" }.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");

const rules = built();
const similar = job => score(Object.assign({ fn: "similar" }, job));
const act = (id, name, fans) => ({ id: String(id), name, nb_fan: fans });

test("the taste graph: acts near what you play, weighted by days played and recency, 0..1", { skip: rules }, () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const seeds = [
    { name: "Steely Dan", days: 10, last: now - 2 * 86400000 },       // played a lot, lately
    { name: "Kraftwerk", days: 1, last: now - 150 * 86400000 }       // once, months ago
  ];
  const related = {
    "Steely Dan": [{ id: "1", name: "Donald Fagen" }, { id: "2", name: "Prefab Sprout" }],
    "Kraftwerk": [{ id: "3", name: "Neu!" }, { id: "2", name: "Prefab Sprout" }]
  };
  const g = new Map(similar({ tastes: [{ seeds, related, now }] }).tastes[0]);
  assert.equal(g.get("donald fagen").score, 1, "the top act of the most-played seed is the ceiling");
  assert.ok(g.get("prefab sprout").score > g.get("neu").score, "near two seeds beats near one old one");
  assert.deepEqual(g.get("prefab sprout").via, ["Steely Dan", "Kraftwerk"]);
  assert.ok(g.get("neu").score < 0.05, "a seed played once months ago barely counts: " + g.get("neu").score);
});

test("ranking: Deezer's order, lifted by the taste graph, held back by obscurity and by having been shown", { skip: rules }, () => {
  const [pool] = similar({ pools: [{ data: [act(1, "Kids Choir", 50000), act(2, "Prefab Sprout", 40000), act(3, "Tribute Dan", 200), act(4, "Donald Fagen", 90000)] }] }).pools;
  assert.equal(pool.length, 4);
  assert.deepEqual(pool.map(a => a.rank), [0, 1, 2, 3]);
  const taste = [["prefab sprout", { score: 1, via: ["Steely Dan"] }], ["donald fagen", { score: 0.8, via: ["Steely Dan", "Boz Scaggs"] }]];
  const at = (heavy, shown) => ({ pool, playing: "Steely Dan", taste, known: {}, heavy, shown });
  const [ranked, again, heavy, self] = similar({ ranks: [at([], []), at([], ["2"]), at(["donald fagen"], []),
    { pool: [{ id: "9", name: "Steely Dan", rank: 0 }], playing: "Steely Dan" }] }).ranks;
  assert.deepEqual(ranked.map(a => a.name), ["Prefab Sprout", "Donald Fagen", "Kids Choir", "Tribute Dan"], "near your listening first; Deezer's own first row, near nothing you play, falls behind it");
  assert.ok(ranked[3].score < ranked[2].score / 1.5, "two hundred followers: halved");
  assert.equal(again[0].name, "Donald Fagen", "shown lately: Prefab Sprout gives way");
  assert.ok(!heavy.some(a => a.name === "Donald Fagen"), "an act you play heavily is never suggested");
  assert.equal(self.length, 0, "never the playing act itself");
});

test("the draw: two acts not heard of and one you know, filled from the rest when a slot can't be met", { skip: rules }, () => {
  const ranked = [
    { id: "A", name: "A", score: 1, known: null }, { id: "B", name: "B", score: 0.9, known: "library" },
    { id: "C", name: "C", score: 0.8, known: null }, { id: "D", name: "D", score: 0.7, known: "played" },
    { id: "E", name: "E", score: 0.6, known: null }
  ];
  const rnd = [0];   // the first of the weighted candidates each time
  // A real draw is weighted, not fixed: over many draws the top act leads but is not alone.
  const draws = Array.from({ length: 200 }, () => ({ ranked, rnd: Array.from({ length: 8 }, Math.random) }));
  const [picks, onlyNew, onlyKnown, ...real] = similar({ chooses: [{ ranked, rnd }, { ranked: ranked.filter(a => !a.known), rnd }, { ranked: ranked.filter(a => a.known), rnd }, ...draws] }).chooses;
  assert.deepEqual(picks, ["A", "C", "B"], "two unknown, then the best-known act");
  assert.deepEqual(onlyNew, ["A", "C", "E"], "nobody known: three new");
  assert.deepEqual(onlyKnown, ["B", "D"], "no unknown acts at all: what there is");
  const first = new Set(real.map(p => p[0]));
  assert.ok(first.size > 1 && first.has("A"), "the draw varies: " + [...first].join(","));
});

test("the record for an act: best-known from the top tracks; for an act you know, the newest you don't own", { skip: rules }, () => {
  const read = similar({ tops: [{ data: [
    { album: { id: 10, title: "Steve McQueen", cover_medium: "c10" } }, { album: { id: 11, title: "Swoon" } },
    { album: { id: 10, title: "Steve McQueen" } }, { album: { id: 12, title: "Jordan: The Comeback" } }
  ] }], album_lists: [{ data: [
    { id: 11, title: "Swoon", record_type: "album", release_date: "1984-03-01" },
    { id: 10, title: "Steve McQueen", record_type: "album", release_date: "1985-06-01" },
    { id: 13, title: "Crimson/Red", record_type: "album", release_date: "2013-10-07", cover_medium: "c13" },
    { id: 14, title: "A Single", record_type: "single", release_date: "2014-01-01" },
    { id: 15, title: "Undated", record_type: "album", release_date: "0000-00-00" }
  ] }] });
  const top = read.tops[0], albums = read.album_lists[0];
  assert.deepEqual(top, { id: "10", title: "Steve McQueen", cover: "c10", n: 2 });
  assert.deepEqual(albums.map(a => a.title), ["Crimson/Red", "Steve McQueen", "Swoon", "Undated"], "full albums only, newest first");
  const [unknown, known, ownAll, noTop] = similar({ records: [{ act: { known: null }, top, albums, owned: [] },
    { act: { known: "library" }, top, albums, owned: ["Steve McQueen", "Swoon"] }, { act: { known: "library" }, top, albums: albums.slice(1), owned: ["Steve McQueen", "Swoon"] },
    { act: { known: null }, top: null, albums, owned: [] }] }).records;
  assert.deepEqual(unknown, { title: "Steve McQueen", year: 1985, cover: "c10" }, "not heard of: their best-known, with its year from the listing");
  assert.deepEqual(known, { title: "Crimson/Red", year: 2013, cover: "c13" }, "known: the newest full album you don't own");
  assert.equal(ownAll, null, "own them all: nothing to name");
  assert.deepEqual(noTop.title, "Crimson/Red", "no top tracks: the newest full album");
});

test("the reason under each act", { skip: rules }, () => {
  const reason = (act, playing) => ({ act: Object.assign({ id: "x", name: "x" }, act), playing });
  assert.deepEqual(similar({ reasons: [reason({ known: null, via: ["Steely Dan", "Boz Scaggs"] }, "Donald Fagen"), reason({ known: null, via: ["Donald Fagen", "Boz Scaggs"] }, "Donald Fagen"),
    reason({ known: null, via: [] }, "Donald Fagen"), reason({ known: "library", via: [] }, "X"), reason({ known: "played", via: [] }, "X")] }).reasons, [
    "Near Steely Dan and Boz Scaggs, which you play", "Near Boz Scaggs, which you play", "Near Donald Fagen",
    "In your library — a record you don't have", "Something you've played — a record you don't have"]);
});

const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeDeezer } = require("./fake-deezer");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

test("/api/similar: two acts not heard of near what you play, one you know with a record you lack, each with a reason", { skip: !haveFfmpeg() && "ffmpeg is not installed", timeout: 60000 }, async () => {
  // Deezer, stood in for: Artist A (playing) is related to a children's
  // choir, two acts near Artist B (whom you play), Artist B (in the library)
  // and a tribute act; Artist B is related to the same two acts.
  const albums = (titles) => ({ data: titles.map(([id, title, date, type]) => ({ id, title, release_date: date, record_type: type || "album", cover_medium: "c" + id })) });
  const top = (id, title) => ({ data: [{ album: { id, title, cover_medium: "c" + id } }, { album: { id, title } }] });
  const deezer = new FakeDeezer({
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
    "artist/203/top?limit=10": top(1300, "Hi Res"), "artist/203/albums?limit=50": albums([[1300, "Hi Res", "2020-01-01"], [1301, "Newer One", "2022-01-01"], [1302, "A Single", "2023-01-01", "single"]]),
    // Artist B playing: two acts new to you, one with a record you have after all.
    "artist/203/related?limit=20": { data: [{ id: 208, name: "Someone New", nb_fan: 50000 }, { id: 209, name: "Other New", nb_fan: 50000 }] },
    "artist/208/top?limit=10": top(1208, "Album One"), "artist/208/albums?limit=50": albums([[1208, "Album One", "1999-01-01"]]),
    "artist/209/top?limit=10": top(1209, "Their Thing"), "artist/209/albums?limit=50": albums([[1209, "Their Thing", "2005-01-01"]])
  });
  await deezer.start();
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, deezerBaseUrl: deezer.base });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const ask = p => fetch(B + p, { headers: { Authorization: "Bearer " + token } });
    const get = async p => (await ask(p)).json();
    for (let i = 0; i < 100 && (await get("/api/status")).index_count !== 3; i++) await new Promise(r => setTimeout(r, 100));
    // Artist B, played on three days this month; Heavy Act (a stream, not in
    // the library) on ten — the act you play most needs no introduction.
    const albums = (await get("/api/library/albums?sort=album")).albums;
    const hi = albums.find(a => a.title === "Hi Res");
    const t = (await get("/api/album?offset=" + hi.offset)).tracks[0];
    for (let d = 1; d <= 3; d++) ctx.features.insertPlay.run(hi.offset, t.track_id, t.title, "Artist B", "Hi Res", "z", Date.now() - d * 86400000);
    for (let d = 1; d <= 10; d++) ctx.features.insertPlay.run(null, null, "Song", "Heavy Act", "Big", "z", Date.now() - d * 86400000);
    // The server's graph, built again from the plays now (it is otherwise built once a day).
    const g = await (await fetch(B + "/internal/jobs/taste", { method: "POST", headers: { "X-Mandarin-Front-Key": ctx.frontKey } })).json();
    assert.equal(g.near["new act"], 1, "the taste graph has your acts' neighbours: " + JSON.stringify(g));
    assert.deepEqual(g.heavy, ["heavy act"]);

    const seen = new Map();
    let known = null;
    for (let i = 0; i < 30; i++) {
      const res = await ask("/api/similar?artist=Artist%20A");
      assert.equal(res.headers.get("x-mandarin-answered"), "C#", "made by the C# server");
      assert.equal(res.headers.get("cache-control"), "no-store");
      const r = await res.json();
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
    assert.deepEqual(known.services.map(x => x.id), ["qobuz", "spotify", "apple", "amazon", "deezer", "bandcamp"], "where to hear it");
    assert.equal(known.services[0].url, "https://www.qobuz.com/us-en/search/?q=Artist%20B%20Newer%20One");
    assert.ok(seen.get("New Act") > 20 && seen.get("Another Act") > 20, "the two acts near what you play lead: " + JSON.stringify([...seen]));
    assert.equal(seen.get("Kids Choir") || 0, 0, "an act near nothing you play never takes a slot while acts near your listening can: " + JSON.stringify([...seen]));
    assert.equal(seen.get("Tribute A") || 0, 0, "nor a tribute act: " + JSON.stringify([...seen]));
    const r = await get("/api/similar?artist=Artist%20A");
    const fresh = r.acts.find(a => a.name === "New Act") || r.acts.find(a => a.name === "Another Act");
    assert.match(fresh.reason, /^Near (Heavy Act and Artist B|Artist B), which you play$/);
    assert.equal(fresh.cover, "c" + (fresh.name === "New Act" ? 1202 : 1205));
    // A record that is in the library after all: playable here, no links out;
    // the rest with links, to the storefront the browser's language says.
    const mine = await (await fetch(B + "/api/similar?artist=Artist%20B", { headers: { Authorization: "Bearer " + token, "Accept-Language": "fr-FR,fr;q=0.9" } })).json();
    assert.deepEqual(mine.acts.map(a => a.name).sort(), ["Other New", "Someone New"]);
    const have = mine.acts.find(a => a.name === "Someone New"), other = mine.acts.find(a => a.name === "Other New");
    assert.deepEqual([have.in_library, have.album, have.library_title, have.library_subtitle, have.services], [true, "Album One", "Album One", "Artist A", []]);
    assert.equal(have.offset, albums.find(a => a.title === "Album One").offset);
    assert.deepEqual(Object.keys(other), ["name", "id", "album", "year", "cover", "reason", "known", "in_library", "offset", "library_title", "library_subtitle", "services"]);
    assert.deepEqual([other.in_library, other.offset, other.year, other.known, other.reason], [false, null, 2005, null, "Near Artist B"]);
    assert.equal(other.services[0].url, "https://www.qobuz.com/fr-fr/search/?q=Other%20New%20Their%20Thing");
    // The pool and each act's records came from Deezer once; the rest was cache.
    const calls = deezer.calls;
    assert.equal(calls.filter(c => c === "artist/100/related?limit=20").length, 1, "the pool is cached a day");
    assert.equal(calls.filter(c => c === "artist/202/top?limit=10").length, 1, "an act's records are cached a week");
    assert.equal((await ask("/api/similar")).status, 400, "an artist is needed");
  } finally { await srv.stop(); await deezer.stop(); }
});
