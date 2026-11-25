"use strict";
/*
 * The native Home's rows of tiles keep one height (item 536). A row is as tall as its tallest tile on screen, and a tile's
 * words run from two lines (a one-line title, the artist) to four (a two-line title, the artist, "2 versions"): scrolled
 * sideways onto a four-line tile, a row grew and pushed every row under it down, and back again. Every album tile on
 * Home now keeps room for four lines (AlbumTile's `fourLines`, an unseen, unspoken four lines behind its own), and the
 * rows, and the strip of Random Album and today's album, are one gap apart, closer than the 50 they were.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(DIR, f), "utf8");

test("an album tile can keep room for four lines of words, unseen and unspoken", () => {
  const tile = read("AlbumTile.kt");
  const sig = tile.match(/internal fun AlbumTile\(([\s\S]*?)\) \{\n/);
  assert.ok(sig, "AlbumTile in AlbumTile.kt");
  assert.match(sig[1], /fourLines: Boolean = false/, "AlbumTile takes fourLines, off by default (the walls and pages as they were)");
  const room = tile.match(/private fun FourLines\([^)]*\)[^{]*\{([\s\S]*?)\n\}/);
  assert.ok(room, "FourLines, the room kept");
  assert.match(room[1], /alpha\(0f\)/, "unseen");
  assert.match(room[1], /clearAndSetSemantics/, "unspoken");
  assert.doesNotMatch(room[1], /parity\(/, "never taken for a tile's own words");
  assert.equal((room[1].match(/Text\(/g) || []).length, 3, "a title of two lines, an artist, its versions");
  assert.match(room[1], /maxLines = 2/);
});

test("every album tile on Home keeps that room", () => {
  const home = read("HomeScreen.kt");
  const calls = [...home.matchAll(/\bAlbumTile\(([\s\S]*?)\) \{/g)].map(m => m[1]);
  assert.ok(calls.length >= 2, "Home's rows and today's album");
  for (const c of calls) assert.match(c, /fourLines = true/, "AlbumTile(" + c.trim() + " …)");
});

test("Home's rows and its strip are one gap apart, closer than they were", () => {
  const home = read("HomeScreen.kt");
  const gap = home.match(/private val ROW_GAP = (\d+)\.dp/);
  assert.ok(gap, "ROW_GAP in HomeScreen.kt");
  assert.ok(Number(gap[1]) <= 24, "a gap of " + gap[1] + " under a row");
  const spacers = [...home.matchAll(/Spacer\(Modifier\.height\(([^)]*)\)\)/g)].map(m => m[1]);
  assert.ok(spacers.length >= 4, "the strip's, Smart Picks', the genres' and the rows' gaps");
  assert.deepEqual(spacers.filter(s => s !== "ROW_GAP"), [], "each the one gap");
});
