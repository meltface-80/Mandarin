"use strict";
const crypto = require("crypto");
const N = require("./library/normalize");
/*
 * shelf.js — what the Shelf screen (/shelf) is given: the whole library, in
 * the order a shop would file it (the Library wall's own "artist" order), with
 * each album's genres and the letter its artist is filed under.
 *
 * The page does its own filtering. Every tile on its left shows how many
 * albums choosing it would leave, and those counts move with every tap, so a
 * round trip per tap would make the tiles lag the finger. One list, sent once,
 * costs a few hundred kilobytes (gzipped) for a large library and nothing per
 * tap after that.
 *
 * Pure: no database, no I/O. The route hands it the library already in artist
 * order. The C# server builds the same answer (server/Mandarin.Server/
 * ShelfRoutes.cs), held to this one by test/shelf.test.js.
 */

/**
 * The letter an artist is filed under on the Artists grid: A–Z, 1–9, or "#"
 * for everything else (a symbol, a 0, a name in another script).
 *
 * Read from the SAME sort name the artist order sorts by, folded (accents
 * gone, lower case), so the grid and the order can never disagree about where
 * an act lives: "The Beatles" is a B, "Ólafur Arnalds" an O, "!!!" a #.
 */
function shelfBucket(sortArtist) {
  const c = N.fold(sortArtist).charAt(0);
  if (c >= "a" && c <= "z") return c.toUpperCase();
  if (c >= "1" && c <= "9") return c;
  return "#";
}

/**
 * @param {Array} albums  the library's albums in artist order
 * @returns {{ genres: Array<{name: string, count: number}>, albums: Array }}
 *   Each album is { o: its id, t: title, a: artist credit, k: image key,
 *   g: indices into `genres`, b: bucket, y: year or null }. Keys are short
 *   because a library of thirteen thousand albums sends them thirteen
 *   thousand times.
 *   Genres are listed commonest first, then by name, which is the order the
 *   tiles are drawn in.
 */
function buildShelf(albums) {
  const counts = new Map();
  const perAlbum = [];
  for (const al of albums) {
    const names = [...new Set((al.genres || []).filter(Boolean))];
    perAlbum.push(names);
    for (const n of names) counts.set(n, (counts.get(n) || 0) + 1);
  }
  const genres = [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
  const index = new Map(genres.map((g, i) => [g.name, i]));
  const out = albums.map((al, i) => ({
    o: al.id,
    t: al.title || "",
    a: al.artist || "",
    k: al.image_key || null,
    g: perAlbum[i].map(n => index.get(n)).sort((x, y) => x - y),
    b: shelfBucket(al.sortArtist),
    y: al.year || null
  }));
  return { genres, albums: out };
}

/**
 * A short fingerprint of everything the shelf shows: two answers with the same
 * signature draw the same shelf, so the page keeps the one it has. Taken over
 * plain text rather than JSON, so the C# server, which writes JSON its own
 * way, comes to the same signature for the same shelf.
 */
function shelfSignature(shelf) {
  const h = crypto.createHash("sha1");
  for (const g of shelf.genres) h.update(g.name + "\u0001" + g.count + "\u0002");
  h.update("\u0003");
  for (const a of shelf.albums) h.update([a.o, a.t, a.a, a.k || "", a.g.join(","), a.b, a.y || ""].join("\u0001") + "\u0002");
  return h.digest("hex").slice(0, 16);
}

module.exports = { shelfBucket, buildShelf, shelfSignature };
