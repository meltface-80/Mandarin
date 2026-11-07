"use strict";
/*
 * The native Library wall keeps its view while you look at an album (item 339). Its sort, direction, Focus and filter
 * were held in plain remember, which Android's navigation drops when the screen is left for an album or Now playing:
 * coming back built the wall again from the view it was opened with, so a sort chosen since ("Recently added") went
 * back to the one before ("Release date"), and a filter typed since came back or went. They are held in
 * rememberSaveable now, which the navigation keeps for the screen it will come back to.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SCREEN = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/LibraryScreen.kt"), "utf8");

test("the wall's view, its filter and its room outlast a visit to an album", () => {
  assert.match(SCREEN, /var view by rememberSaveable\(stateSaver = VIEW_SAVER\) \{ mutableStateOf\(LibraryView\.parse\(viewQuery\)\) \}/, "the view");
  assert.match(SCREEN, /private val VIEW_SAVER = Saver<LibraryView, String>\(save = \{ it\.query\(\) \}, restore = \{ LibraryView\.parse\(it\) \}\)/, "kept as its query string");
  assert.match(SCREEN, /var filtering by rememberSaveable \{ mutableStateOf\(view\.prefix\.isNotEmpty\(\)\) \}/, "the filter's field");
  assert.match(SCREEN, /var typed by rememberSaveable \{ mutableStateOf\(view\.prefix\) \}/, "what was typed");
  assert.match(SCREEN, /var zone by rememberSaveable \{ mutableStateOf\(zoneId\) \}/, "the room");
  assert.doesNotMatch(SCREEN, /var (view|filtering|typed|zone) by remember \{/, "none of them in plain remember");
});
