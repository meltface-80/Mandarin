"use strict";
/*
 * A cover put right in the editor shows in the lists kept from before (bug list item 123). Two albums given their covers
 * on 21 October (13:25) still showed the drawn placeholders on the Library wall, after leaving it and after the app's
 * screen was made again: the wall is kept while the app runs (the music playing kept it running), and nothing told it the
 * album's cover had a new key. Now the album's page, each time it reads the album, puts the cover right wherever a kept
 * list (the Library wall, the other walls, the search) shows an older one (core AlbumCovers).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("the album's page, reading the album, puts its cover right in the kept lists", () => {
  assert.match(read("AlbumScreen.kt"), /\.onSuccess \{ album = it;[^\n]*LibraryWall\.coverIs\(offset, it\.album\.imageKey\) \}/);
  const wall = read("LibraryWall.kt");
  const fn = wall.slice(wall.indexOf("fun coverIs("));
  assert.match(fn, /AlbumCovers\.fixes\(l\.albums, offset, imageKey\)\) l\.albums\[i\] = a/, "the Library wall");
  assert.match(fn, /Walls\.coverIs\(offset, imageKey\)/, "the other walls");
  assert.match(fn, /SearchKept\.lib\?\.let/, "the search");
  assert.match(read("WallScreen.kt"), /for \(w in kept\.values\) for \(\(i, a\) in com\.musicd\.server\.client\.AlbumCovers\.fixes\(w\.albums, offset, imageKey\)\) w\.albums\[i\] = a/);
});
