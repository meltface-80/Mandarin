"use strict";
/*
 * The native Home's rows of tiles (HomeTiles.kt's Carousel), held to drawing a list as it was when Home was drawn (bug
 * list item 84). A carousel given a count, its tiles looked up in the live row by index, crashed the app: an album taken
 * out of Listen later emptied the row between two frames, and the tile at 0 of the stale count was asked for of a row
 * that had none ("IndexOutOfBoundsException: index: 0, size: 0").
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");

test("a carousel is handed its tiles' list, never a count to look them up by", () => {
  const tiles = fs.readFileSync(path.join(DIR, "HomeTiles.kt"), "utf8");
  const sig = tiles.match(/internal fun (<[^>]+> )?Carousel\(([^)]*)\)/);
  assert.ok(sig, "Carousel in HomeTiles.kt");
  assert.doesNotMatch(sig[2], /count: Int/, "Carousel takes a list, not a count");
  const calls = [];
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith(".kt"))) {
    const src = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const m of src.matchAll(/\bCarousel\(([^,)]*)/g)) if (!/^(count|items)\b/.test(m[1].trim()) && /\.size\s*$/.test(m[1].trim())) calls.push(f + ": Carousel(" + m[1] + ", …)");
  }
  assert.deepEqual(calls, []);
});
