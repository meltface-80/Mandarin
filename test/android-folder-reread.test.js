// @ts-check
"use strict";
/*
 * The phone's own music folder read again every few minutes only while the app is on screen (bug list item 204);
 * off screen, Android's change notices alone. Held to the shape here.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android", "app", "src", "main", "java", "com", "musicd", "server", "android");
const read = (name) => fs.readFileSync(path.join(APP, name), "utf8");

test("the periodic read re-arms, and is armed, only while the app is in front", () => {
  const src = read("LocalMusic.kt");
  assert.match(src, /watched\?\.let \{ c -> rescan\(c\); if \(front\) main\.postDelayed\(this, period\(\)\) \}/);
  assert.match(src, /front = on\s+if \(watched == null\) return\s+main\.removeCallbacks\(periodic\)\s+if \(on\) main\.postDelayed\(periodic, period\(\)\)[^\n]*\n\s+if \(on\) checkSoon\(c\)/);
  assert.match(src, /main\.removeCallbacks\(periodic\)\s+if \(front\) main\.postDelayed\(periodic, PERIOD_MS\)/);
  assert.doesNotMatch(src, /rescan\(c\) ; main\.postDelayed\(this, period\(\)\)/);
});

test("Android's change notices still reach it off screen, and coming back reads at once", () => {
  const src = read("LocalMusic.kt");
  assert.match(src, /override fun onChange\(selfChange: Boolean, uri: Uri\?\) \{ checkSoon\(c\) \}/);
  assert.match(src, /if \(on\) checkSoon\(c\)/);
});
