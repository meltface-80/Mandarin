"use strict";
/*
 * The head over a grid of albums in the Android app (WallGrid.kt's AlbumGrid; bug list item 135): what a screen puts
 * there (the heading, an artist's picture, their links and bio, a band's members) stands one under another. A lazy
 * grid's or list's item lays its children over each other, as a Box does; an artist's picture lay over the heading.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/WallGrid.kt"), "utf8");

test("the head over an album grid stands in a column, in the grid and in the list", () => {
  const grid = src.slice(src.indexOf("internal fun AlbumGrid("));
  const heads = grid.match(/item(\(span = \{ GridItemSpan\(maxLineSpan\) \}\))? \{[^\n]*head\(\)[^\n]*\}/g) || [];
  assert.equal(heads.length, 2, "the list's head and the grid's");
  for (const h of heads) assert.match(h, /\{ Column\(Modifier\.fillMaxWidth\(\)\) \{ head\(\) \} \}/, h);
});
