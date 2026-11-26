"use strict";
/*
 * Random albums is one set (item 537; the server's half in random-albums-one-set.test.js): the page and the app read
 * the set the server keeps, Home's row as many as a phone's wall shows so it is the wall's head, and only the wall's
 * Refresh (and Android Auto's own reading again, every ten minutes while in use) asks for a new one.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const APP = "android/app/src/main/java/com/musicd/server/android/";

test("the page: Refresh alone asks for a new set, shown on Home's row; Home's row is a phone wall's length", () => {
  const sheet = read("public/app/filter-sheet.js"), home = read("public/app/home-render.js"), grid = read("public/app/album-grid.js");
  assert.match(sheet, /refreshBtn\.addEventListener\("click", \(\) => loadRandom\(\{ refresh: true \}\)\)/, "the bar's Refresh");
  assert.match(home, /topbarRefresh\.addEventListener\("click", \(\) => loadRandom\(\{ refresh: true \}\)\)/, "the top bar's Refresh");
  assert.match(grid, /\$\{refresh \? "&refresh=1" : ""\}/, "the wall asks for a new set only when told");
  assert.match(grid, /const refresh = !!\(opts && opts\.refresh === true\)/, "not on a click's event, nor any other load");
  assert.match(grid, /if \(refresh && !j\.filtered[^\n]*loadHomeRandom\(\)/, "the new set on Home's row");
  assert.match(home, /fetch\("\/api\/random-albums\?count=" \+ PHONE_WALL_COUNT\)/, "Home's row the phone wall's length");
  assert.doesNotMatch(read("public/app/menu-drawer.js") + sheet.replace(/refreshBtn\.addEventListener[^\n]*/, ""), /refresh: true/,
    "opening the wall from the menu or a filter reads the kept set");
});

test("the app: Refresh alone asks for a new set, and Home's row has it at once; the wall read on every visit", () => {
  const wall = read(APP + "WallScreen.kt"), rows = read(APP + "HomeRows.kt"), grid = read(APP + "WallGrid.kt");
  assert.match(wall, /FilledIconButton\(onClick = \{ wall\.loaded = false; load\(refresh = true\) \}/, "the reshuffle button");
  assert.match(wall, /lib\.randomAlbums\(randomCount, refresh\)/);
  assert.match(wall, /LaunchedEffect\(wall\) \{ if \(!wall\.loaded \|\| kind != "genre"\) load\(\) \}/, "Random albums read on every visit");
  assert.match(wall, /if \(refresh && kind == "random"[^\n]*\n?[^\n]*HomeKept\.RANDOM_ROW/, "a new set on Home's row at once");
  assert.match(rows, /randomAlbums\(RANDOM_ROW\)/);
  const n = Number(rows.match(/const val RANDOM_ROW = (\d+)/)[1]);
  assert.equal(n, Number(grid.match(/if \(min\(w, h\) < 768\) return (\d+)/)[1]), "Home's row a phone wall's length");
});

test("Android Auto: read again every ten minutes while in use, Random albums asked for a new set", () => {
  const auto = read(APP + "AutoShelves.kt");
  assert.match(auto, /pool\.execute \{ try \{ if \(read\(shelf, refresh = true\) != null\) changed\(shelf\) \}/, "read again behind the car: a new set");
  assert.match(auto, /AutoShelf\.path\(shelf, refresh\)/);
  assert.match(auto, /return read\(shelf\) \?: emptyList\(\)/, "nothing kept yet: the set as it is");
});
