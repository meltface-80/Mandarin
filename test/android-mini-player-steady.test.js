"use strict";
/*
 * The docked mini player still while moving between screens (bug list item 113). Each native screen draws its own mini
 * player; one just opened started from nothing (no track known yet, no cover fetched), so for a moment the bar had no
 * cover and no room line, a little shorter, then grew back: moving from Home to the Library or a row's wall, its buttons
 * and cover moved down and back up. Now each room's state is kept while the app runs and a screen starts from it, and a
 * cover fetched is kept, so a new screen draws the bar as the last one left it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/RoomFollow.kt"), "utf8");

test("a screen starts from the room's state as the last screen left it", () => {
  assert.match(SRC, /private val kept = HashMap<String, RoomState>\(\)/);
  assert.match(SRC, /val room = remember\(zoneId\) \{ kept\.getOrPut\(zoneId\) \{ RoomState\(\) \} \}/);
});

test("a cover already fetched is drawn at once", () => {
  const img = SRC.slice(SRC.indexOf("internal fun rememberImage("));
  assert.match(img, /remember\(url\) \{ mutableStateOf\(url\?\.let \{ Covers\.get\(it\) \}\) \}/);
  assert.match(img, /Covers\.put\(url, got\)/);
});
