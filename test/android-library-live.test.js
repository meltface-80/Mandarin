"use strict";
/*
 * Albums added show up by themselves in the Android app (item 232), as they have in the page since v0.8.43: the
 * app follows the server's mark of which albums there are (/api/library/mark, waited on) while it is on screen, and
 * when it moves the Library wall held is behind, read again at its top (the new albums first under Recently added),
 * and Home's Library row read again while Home is showing. Before, the wall the app held for a sort was kept for as
 * long as the app ran, and new albums only came by changing the sort and changing it back. The app's screens are a
 * device's, so this reads the app's source, as the other android-*.test.js do; the mark's decisions are core's
 * (AlbumsMarkTest), its wait the server's (LibraryMarkWaitTests).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const CORE = path.join(__dirname, "..", "android/core/src/main/kotlin/com/musicd/server/client");
const read = (dir, f) => fs.readFileSync(path.join(dir, f), "utf8");
const between = (s, from, to) => s.slice(s.indexOf(from), to ? s.indexOf(to, s.indexOf(from)) : undefined);

test("the mark waited on: the app asks with the mark it has, and the server holds the answer", () => {
  const client = between(read(CORE, "ServerClient.kt"), "fun libraryMark(", "fun control(");
  assert.match(client, /"\/api\/library\/mark\?wait_for=" \+ enc\(waitFor\) \+ "&timeout=20000", 30_000/);
  assert.match(client, /if \(waitFor == null\) AlbumsMark\.of\(getJson\("\/api\/library\/mark"\)\)/);
});

test("followed while the app is on screen and online, from the shell", () => {
  const live = read(APP, "LibraryLive.kt");
  const follow = between(live, "fun Follow(");
  assert.match(follow, /LaunchedEffect\(onScreen, offline\)/);
  assert.match(follow, /if \(!onScreen \|\| offline != null\) return@LaunchedEffect/);
  assert.match(follow, /c\.libraryMark\(had\)/);
  // A move gathers a moment (a scan adds folder after folder), then the screens are told.
  assert.match(follow, /if \(went\) \{ delay\(AlbumsMark\.GATHER_MS\); moved\(\) \}/);
  // Not answered: less and less often; a server that doesn't wait: not in a tight loop.
  assert.match(follow, /delay\(Retry\.ms\(\+\+missed\)\)/);
  assert.match(follow, /delay\(AlbumsMark\.pauseMs\(had != null, went, took\)\)/);
  assert.match(between(live, "fun moved()", "fun Follow("), /LibraryWall\.fallBehind\(\)[\s\S]*moves\+\+/);
  assert.match(read(APP, "NativeShell.kt"), /LibraryLive\.Follow\(client\)/);
});

test("the Library wall: behind once the albums move, read again in place at its top", () => {
  const wall = read(APP, "LibraryWall.kt");
  assert.match(wall, /@Synchronized fun fallBehind\(\) \{ last\?\.behind = true \}/);
  const again = between(wall, "suspend fun again(", "companion object");
  assert.match(again, /\.albums\(0, PAGE, view\)/);
  assert.match(again, /albums\.clear\(\)\s+albums\.addAll\(p\.albums\.distinctBy \{ it\.offset \}\)/);
  assert.match(again, /behind = false/);
  const screen = read(APP, "LibraryScreen.kt");
  const live = between(screen, "val atTop by", "fun pick(");
  assert.match(live, /LaunchedEffect\(wall, wall\.behind, atTop, selecting\)/);
  assert.match(live, /if \(!wall\.behind \|\| !atTop \|\| selecting \|\| !wall\.loaded \|\| offline\) return@LaunchedEffect/);
  assert.match(live, /wall\.again\(c\)/);
  // At the very top, the new albums are what shows (not kept above the first tile that was there).
  assert.match(live, /if \(head\) \{ if \(prefs\.list\) list\.scrollToItem\(0\) else grid\.scrollToItem\(0\) \}/);
});

test("Home's Library row read again while Home is showing", () => {
  const home = read(APP, "HomeScreen.kt");
  assert.match(home, /val movesSeen = remember \{ LibraryLive\.moves \}/);
  assert.match(home, /LaunchedEffect\(LibraryLive\.moves\) \{ if \(LibraryLive\.moves != movesSeen && offline == null\) HomeKept\.libraryRow\(scope, client\(\), NativeShell\.libraryView\) \}/);
  const row = between(read(APP, "HomeRows.kt"), "fun libraryRow(", "/** Today's album");
  assert.match(row, /plainRow\("library", LibraryClient \{ client\.getJson\(it\) \}\) \{ it\.albums\(0, 30, order\)\.albums \}/);
});
