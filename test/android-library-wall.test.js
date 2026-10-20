"use strict";
/*
 * The native Library wall's paging (LibraryWall.kt), held to letting go of its "a page is on its way" however the
 * request ends (bug list item 99). The wall is kept while the app runs; its flag was cleared only after the answer came,
 * so a request called off on the way (the Library left, or drawn again, before the first page arrived: seldom at home,
 * nearly always on mobile data or a VPN) left the wall waiting for good, its skeletons up on every visit after. And a
 * first page that failed was never asked for again on coming back.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/LibraryWall.kt"), "utf8");
const SCREEN = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/LibraryScreen.kt"), "utf8");

test("a kept wall lets go of its page in flight however the request ends", () => {
  const more = SRC.slice(SRC.indexOf("suspend fun more("), SRC.indexOf("companion object"));
  assert.match(more, /loading = true[\s\S]*try \{[\s\S]*\} finally \{[^}]*loading = false/, "loading = false in a finally");
});

test("a wall whose first page failed is asked again when the Library is opened again", () => {
  assert.match(SCREEN, /LaunchedEffect\(wall\) \{ if \(wall\.needsFirst\) more\(\) \}/);
  assert.match(SRC, /val needsFirst: Boolean get\(\) = !done && albums\.isEmpty\(\)/);
});
