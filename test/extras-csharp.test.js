"use strict";
/*
 * v0.8.20's ports decide what the Node server's decide: the share card's links
 * (lib/share-links.js), the suggestions' reading of Deezer and their scoring
 * (lib/similar.js, lib/played-artists.js), the release days' matching
 * (lib/library/dates.js) and the labels' small rules (lib/labellookup.js,
 * lib/labellogos.js) — each asked of both, the C# server through
 * `mandarin-server score`, over awkward names and generated cases,
 * deepStrictEqual. The passes and routes themselves run against the C# server
 * in their own tests in MANDARIN_FRONT=1. Skipped where the C# server isn't built.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const share = require("../lib/share-links");
const similar = require("../lib/similar");
const { playedArtists } = require("../lib/played-artists");
const { matchDays, queryFor, baseTitle } = require("../lib/library/dates");
const { plainName } = require("../lib/labellookup");
const { typeOf } = require("../lib/labellogos");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = !fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)";

function csharp(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(job) + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}
const plain = v => JSON.parse(JSON.stringify(v));

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NAMES = [
  "The Beatles", "Beatles", "the beatles", "The", "the the", "Thé Band", "Prince", "Prince & The Revolution", "Sting", "Sting Tribute Band",
  "Hall & Oates", "Simon & Garfunkel", "AC/DC", "Guns N' Roses", "Sigur Rós", "Björk", "Bjork", "Motörhead", "ΣΩΣ", "Ὀδυσσεύς", "Straße", "İstanbul",
  "ﬁne", "ＡＢＣ", "Ⅻ", "½", "é", "ǅungla", "Ünïcode 😀", "日本語", "Привет", "Ёлка", "  spaced   out  ", "Tab\tname", "new\nline",
  "Zero​width", " nbsp ", "\ud800lone", "lone\udc00", "Artist A feat. Artist B", "A / B", "A;B", "A ; B", "A/B", "Featuring X",
  "X ft. Y", "X Ft Y", "X FEAT Y", "X featuring Y", "X vs. Y", "Various Artists", "Various", "VA", "", " ", "-", "!!!", "123", "4AD"
];
const VALUES = [null, undefined, 0, 5, true];

test("the share card's links: the first act, the query, the storefront, the language, each service and review", { skip }, () => {
  // Not a lone surrogate: encodeURIComponent throws on one (the C# server writes U+FFFD).
  const artists = NAMES.filter(n => !/[\ud800-\udfff]/.test(n.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))).concat(VALUES);
  const albums = ["Kid A", "Kid A / Amnesiac", "Back\\Slash", "OK Computer: OKNOTOK", "  ", "", "Ünïcode 😀", "Rock & Roll!", "100% (Live)", null, undefined, 7];
  const locales = ["en-GB", "en-gb", "EN-us", "fr", "de_CH", "pt-BR", "es-419", "zh-Hant-TW", "xx", "ja", "nb-NO", "", "  ", "-", "_gb", null, undefined, 5];
  const accepts = ["fr-CH, fr;q=0.9, en;q=0.8, de;q=0.7, *;q=0.5", "da, en-gb;q=0.8, en;q=0.7", "en;q=abc", "*", "en-US;q=1.0;foo=bar", ";q=0.5",
    "de;q=0.5, fr;q=0.5", "es;Q = 0.9 , it", "en;q=1.5", "nl;q=0", "  ", "", null, undefined, "en;q=1e3", "en;q=.5, de;q=0.6", "x;q=0.1.2"];
  const enabled = [null, undefined, [], ["qobuz", "apple"], ["nope", "bandcamp", 5], ["deezer"]];
  const reviews = [null, undefined, [], ["wikipedia-artist", "allmusic-artist"], ["pitchfork", "nope"], ["wikipedia", "allmusic", "wikipedia-artist"]];
  const ids = [null, undefined, [], "qobuz", ["qobuz", 5, "wikipedia", "allmusic-artist", "qobuz"], ["bandcamp", "spotify", "pitchfork"]];
  const r = rng(7);
  const pick = list => list[Math.floor(r() * list.length)];
  const cases = [];
  for (let i = 0; i < 1500; i++) {
    cases.push({ artist: pick(artists), album: pick(albums), locale: pick(locales), accept: pick(accepts), enabled: pick(enabled), reviews: pick(reviews),
      wikipedia: pick([null, "", "https://en.wikipedia.org/wiki/Kid_A"]), pitchfork: pick([null, "https://pitchfork.com/reviews/albums/x"]),
      wikipedia_artist: pick([null, "https://en.wikipedia.org/wiki/Radiohead"]), ids: pick(ids) });
  }
  const node = cases.map(c => ({
    primary: share.primaryArtist(c.artist), query: share.searchQuery(c.artist, c.album), storefront: share.qobuzStorefront(c.locale),
    locale: share.localeFromAcceptLanguage(c.accept),
    services: share.serviceLinks(c.artist, c.album, { locale: c.locale, enabled: c.enabled }),
    reviews: share.reviewLinks(c.artist, c.album, { enabled: c.reviews, wikipediaUrl: c.wikipedia, pitchforkUrl: c.pitchfork, wikipediaArtistUrl: c.wikipedia_artist }),
    services_kept: share.sanitiseIds(c.ids, share.knownServiceIds()), reviews_kept: share.sanitiseIds(c.ids, share.knownReviewIds())
  }));
  const got = csharp({ fn: "share", cases }).share;
  for (let i = 0; i < cases.length; i++) assert.deepStrictEqual(got[i], plain(node[i]), JSON.stringify(cases[i]));
});

/* Deezer's answers, generated: rows of every shape the readers must take. */
function deezerRows(r, n) {
  const names = NAMES.concat(["Artist A", "Artist A Tribute", "The Artist A", "Artist B"]);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.04) { rows.push(null); continue; }
    if (x < 0.06) { rows.push("not a row"); continue; }
    const row = {};
    const id = r();
    row.id = id < 0.05 ? undefined : id < 0.1 ? 0 : id < 0.15 ? "" : id < 0.5 ? Math.floor(r() * 30) : String(Math.floor(r() * 30));
    const nm = r();
    row.name = nm < 0.05 ? 7 : nm < 0.1 ? undefined : names[Math.floor(r() * names.length)];
    const f = r();
    row.nb_fan = f < 0.2 ? undefined : f < 0.3 ? null : f < 0.4 ? String(Math.floor(r() * 5000)) : f < 0.45 ? "lots" : Math.floor(r() * 200000);
    if (r() < 0.6) row.picture_medium = r() < 0.2 ? "" : "pm" + i;
    if (r() < 0.6) row.picture = "p" + i;
    rows.push(row);
  }
  return rows;
}

test("the suggestions: Deezer read, the taste graph, the ranking, the draw, the record and the reason", { skip }, () => {
  const r = rng(20261008);
  const overlaps = [];
  for (const a of NAMES) for (const b of ["Prince", "The Beatles", "Sting", "the", "Artist A", "", "Beatles"]) overlaps.push([a, b]);
  overlaps.push([null, "x"], [undefined, undefined], [0, "0"]);
  const artists = [], related = [], pools = [];
  for (let i = 0; i < 300; i++) {
    const json = r() < 0.05 ? (r() < 0.5 ? null : { data: "nope" }) : { data: deezerRows(r, Math.floor(r() * 30)) };
    artists.push({ json, artist: ["Artist A", "The Beatles", "Sting", "Beatles", "", null][Math.floor(r() * 6)] });
    related.push({ json, wanted: [undefined, 0, 1, 2, 3, 25][Math.floor(r() * 6)] });
    pools.push(json);
  }
  const years = ["2020-01-01", "0000-00-00", "1899-12-31", "1900", " 2001-05", "20201", "abcd", "", null, undefined, 2015, 1999.5,
    `${new Date().getFullYear() + 1}-01-01`, `${new Date().getFullYear() + 2}-01-01`, "２０２０", "1987-xx"];
  const tops = [], albumLists = [];
  for (let i = 0; i < 200; i++) {
    const tracks = [];
    for (let k = Math.floor(r() * 12); k > 0; k--) {
      const y = r();
      if (y < 0.05) { tracks.push(null); continue; }
      const al = y < 0.1 ? null : { id: r() < 0.1 ? undefined : r() < 0.5 ? Math.floor(r() * 5) : String(Math.floor(r() * 5)), title: r() < 0.1 ? 3 : r() < 0.15 ? "  " : ["Big One", " Big One ", "Other", "Debut"][Math.floor(r() * 4)] };
      if (al && r() < 0.5) al.cover_medium = r() < 0.2 ? "" : "cm" + k;
      if (al && r() < 0.5) al.cover = "c" + k;
      tracks.push({ album: al });
    }
    tops.push(r() < 0.05 ? null : { data: tracks });
    const list = [];
    for (let k = Math.floor(r() * 10); k > 0; k--) {
      list.push(r() < 0.05 ? null : { id: r() < 0.05 ? null : Math.floor(r() * 100), title: r() < 0.1 ? "" : "T" + Math.floor(r() * 6), record_type: ["album", "single", "ALBUM", "ep", undefined, "compile"][Math.floor(r() * 6)],
        release_date: years[Math.floor(r() * years.length)], cover_medium: r() < 0.5 ? "cm" + k : undefined, cover: r() < 0.5 ? "c" + k : undefined });
    }
    albumLists.push(r() < 0.05 ? {} : { data: list });
  }
  // The taste graph: seeds as playedArtists lists them, their related lists cached.
  const now = Date.parse("2026-10-08T12:00:00Z");
  const actNames = ["New Act", "Another Act", "The New Act", "Kids Choir", "Seed One", "Seed Two", "Artist B", ""];
  const tastes = [];
  for (let i = 0; i < 100; i++) {
    const seeds = [], rel = {};
    for (let k = Math.floor(r() * 8); k > 0; k--) {
      const name = ["Seed One", "Seed Two", "Seed Three", "Artist B", "Heavy Act"][Math.floor(r() * 5)] + (r() < 0.3 ? " " + k : "");
      seeds.push({ name, days: Math.floor(r() * 12), last: now - Math.floor(r() * 200) * 86400000 });
      if (r() < 0.9) rel[name] = Array.from({ length: Math.floor(r() * 6) }, () => r() < 0.05 ? null : { name: actNames[Math.floor(r() * actNames.length)], id: String(Math.floor(r() * 9)) });
    }
    tastes.push({ seeds, related: rel, now });
  }
  // The ranking and the draw over real pools.
  const ranks = [], chooses = [];
  for (let i = 0; i < 200; i++) {
    const pool = similar.readDeezerPool({ data: deezerRows(r, Math.floor(r() * 25)) });
    const g = tastes[i % tastes.length];
    const graph = similar.tasteGraph(g.seeds, n => g.related[n], g.now);
    const known = {};
    for (const a of pool) if (r() < 0.3) known[a.name] = r() < 0.5 ? "library" : "played";
    const heavy = pool.filter(() => r() < 0.1).map(a => similar.normalize(a.name));
    const shown = pool.filter(() => r() < 0.2).map(a => a.id);
    const playing = r() < 0.2 ? null : pool.length && r() < 0.3 ? pool[0].name : "Artist A";
    ranks.push({ pool, playing, taste: [...graph.entries()], known, heavy, shown });
    const ranked = similar.rankActs(pool, { playing, taste: graph, known: n => known[n] || null, heavy: new Set(heavy), shown: new Set(shown) });
    chooses.push({ ranked: plain(ranked), rnd: Array.from({ length: 5 }, () => r()) });
  }
  const reasons = [], records = [];
  for (let i = 0; i < 200; i++) {
    const act = { id: "1", name: "Act", known: [null, "library", "played"][Math.floor(r() * 3)], via: ["Seed One", "Artist A", "Seed Two", "artist a"].filter(() => r() < 0.5) };
    reasons.push({ act, playing: r() < 0.2 ? null : r() < 0.5 ? "" : "Artist A" });
    const albums = similar.readDeezerAlbumList(albumLists[i % albumLists.length]);
    const top = similar.readDeezerTop(tops[i % tops.length]);
    records.push({ act, top, albums, owned: albums.filter(() => r() < 0.4).map(a => a.title).concat(r() < 0.3 && top ? [top.title] : []) });
  }
  const played = [];
  for (let i = 0; i < 100; i++) {
    const rows = Array.from({ length: Math.floor(r() * 40) }, () => ({
      artist: [...NAMES.slice(0, 20), "Various Artists", "VA", "", null, "A feat. B", "A / B", "Hall & Oates"][Math.floor(r() * 27)],
      ts: r() < 0.05 ? null : r() < 0.1 ? String(now - Math.floor(r() * 50) * 86400000) : now - Math.floor(r() * 100 * 86400000)
    }));
    played.push({ rows, limit: [8, 40, 1, 0, 3][Math.floor(r() * 5)] });
  }

  const got = csharp({ fn: "similar", names: NAMES.concat(VALUES), overlaps, artists, related, pools, years, tops, album_lists: albumLists, tastes, ranks, chooses, reasons, records, played });
  assert.deepStrictEqual(got.normalize, NAMES.concat(VALUES).map(n => similar.normalize(n)));
  assert.deepStrictEqual(got.overlap, overlaps.map(([a, b]) => similar.namesOverlap(a, b)));
  artists.forEach((c, i) => assert.deepStrictEqual(got.artists[i], plain(similar.readDeezerArtists(c.json, c.artist)), JSON.stringify(c)));
  related.forEach((c, i) => assert.deepStrictEqual(got.related[i], plain(similar.readDeezerRelated(c.json, c.wanted)), JSON.stringify(c)));
  pools.forEach((j, i) => assert.deepStrictEqual(got.pools[i], plain(similar.readDeezerPool(j)), JSON.stringify(j)));
  assert.deepStrictEqual(got.years, plain(years.map(y => similar.yearOf(y))));
  tops.forEach((j, i) => assert.deepStrictEqual(got.tops[i], plain(similar.readDeezerTop(j)), JSON.stringify(j)));
  albumLists.forEach((j, i) => assert.deepStrictEqual(got.album_lists[i], plain(similar.readDeezerAlbumList(j)), JSON.stringify(j)));
  tastes.forEach((t, i) => assert.deepStrictEqual(got.tastes[i], plain([...similar.tasteGraph(t.seeds, n => t.related[n], t.now).entries()]), JSON.stringify(t)));
  ranks.forEach((c, i) => {
    const want = similar.rankActs(c.pool, { playing: c.playing, taste: new Map(c.taste), known: n => c.known[n] || null, heavy: new Set(c.heavy), shown: new Set(c.shown) });
    assert.deepStrictEqual(got.ranks[i], plain(want), JSON.stringify(c));
  });
  chooses.forEach((c, i) => {
    let k = 0;
    const want = similar.choose(plain(c.ranked), { rnd: () => c.rnd[k++ % c.rnd.length] }).map(a => a.id);
    assert.deepStrictEqual(got.chooses[i], want, JSON.stringify(c));
  });
  reasons.forEach((c, i) => assert.equal(got.reasons[i], similar.reasonFor(c.act, c.playing), JSON.stringify(c)));
  records.forEach((c, i) => assert.deepStrictEqual(got.records[i], plain(similar.recordFor(c.act, c.top, c.albums, c.owned)), JSON.stringify(c)));
  played.forEach((c, i) => assert.deepStrictEqual(got.played[i], plain(playedArtists(c.rows, { split: share.primaryArtist, limit: c.limit })), JSON.stringify(c)));
});

test("the release days: a group's day matched to an album only by its title, artist and year", { skip }, () => {
  const titles = ["Album (Deluxe Edition)", "Album [Remastered]", "Album (Live) (Deluxe)", "(Only Brackets)", "Album (unclosed", "Album ) odd (", "",
    null, undefined, "Ünïcode (2020 Remaster)", "Title [Disc 1] ", "A (B) C", "Kid A", "KID A!", "Kid A (2000)", "[Kid A]", "Blue Rev\t(Bonus) "];
  const r = rng(99);
  const words = ["Blue Rev", "Rumours", "Kid A", "Hail to the Thief", "OK Computer", "Ünïcode"];
  const acts = ["Alvvays", "Fleetwood Mac", "Radiohead", "The Radiohead", "Someone Else", "Mac"];
  const batches = [];
  for (let i = 0; i < 300; i++) {
    const albums = [];
    for (let k = 1 + Math.floor(r() * 20); k > 0; k--) {
      const year = 1970 + Math.floor(r() * 50);
      albums.push({ key: "k" + Math.floor(r() * 25), title: words[Math.floor(r() * words.length)] + (r() < 0.2 ? " (Deluxe)" : ""), artist: acts[Math.floor(r() * acts.length)],
        year, date: r() < 0.5 ? String(year) : r() < 0.5 ? `${year}-0${1 + Math.floor(r() * 9)}` : null });
    }
    const groups = [];
    for (let k = Math.floor(r() * 25); k > 0; k--) {
      const a = albums[Math.floor(r() * albums.length)];
      const year = r() < 0.7 ? a.year : a.year + 1;
      const d = r() < 0.2 ? String(year) : r() < 0.4 ? `${year}-0${1 + Math.floor(r() * 9)}` : `${year}-0${1 + Math.floor(r() * 9)}-${10 + Math.floor(r() * 18)}`;
      const credit = r() < 0.1 ? undefined : [{ name: r() < 0.1 ? undefined : acts[Math.floor(r() * acts.length)], artist: { name: "Fallback" }, joinphrase: r() < 0.3 ? " & " : "" }]
        .concat(r() < 0.3 ? [{ name: "Guest" }] : []);
      groups.push(r() < 0.03 ? {} : { title: r() < 0.8 ? a.title : a.title + " [Remastered]", "first-release-date": r() < 0.05 ? undefined : d, "artist-credit": credit });
    }
    batches.push({ albums, groups: r() < 0.03 ? undefined : groups });
  }
  const got = csharp({ fn: "days", titles, batches });
  assert.deepStrictEqual(got.base, titles.map(t => baseTitle(t)));
  batches.forEach((b, i) => {
    assert.equal(got.query[i], queryFor(b.albums));
    const days = matchDays(b.albums, b.groups);
    assert.deepStrictEqual(got.days[i], b.albums.map(a => [a.key, days.get(a.key)]), JSON.stringify(b));
  });
});

test("the labels' rules: Discogs' numbered names, an image's kind from its bytes", { skip }, () => {
  const names = ["Blue Note (2)", "4AD", "Label (12) ", "Label(3)", "Label (2) (3)", " (5)", "Label (x)", "", null, undefined, 5, "Nonesuch (2) "];
  const bufs = [
    [Buffer.from("89504e470d0a1a0a0000000d", "hex"), null], [Buffer.from("ffd8ffe000104a46", "hex"), "image/jpeg"], [Buffer.from("GIF89a\x01\x00\x01\x00", "latin1"), null],
    [Buffer.from([0xc7, 0xc9, 0xc6, 0xb8, 0x39, 0x61, 1, 0]), null], [Buffer.from("RIFF\x10\x00\x00\x00WEBPVP8 ", "latin1"), null],
    [Buffer.from("﻿  <?xml version='1.0'?><svg/>"), null], [Buffer.from("<SVG xmlns='x'/>"), null], [Buffer.from("<html>no</html>"), "text/html"],
    [Buffer.from("<html>no</html>"), "image/svg+xml; charset=utf-8"], [Buffer.alloc(0), null], [Buffer.from("8950", "hex"), null], [Buffer.from(" <svg/>"), null],
    [Buffer.from("RIFF\x10\x00\x00\x00webp", "latin1"), null], [Buffer.from([0xff, 0xd8, 0xff]), null], [Buffer.from([0xff, 0xd8, 0xff, 0xdb]), null]
  ];
  const got = csharp({ fn: "labels", plain: names, images: bufs.map(([b, t]) => ({ b64: b.toString("base64"), type: t })) });
  assert.deepStrictEqual(got.plain, names.map(n => plainName(n)));
  assert.deepStrictEqual(got.types, bufs.map(([b, t]) => typeOf(b, t)));
});
