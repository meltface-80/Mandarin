"use strict";
/*
 * Settings → Library Scanner's MusicBrainz pack, its folder chosen without a toast (bug list item 103): the block itself
 * shows where the pack now is, on the page (settings-scanner.js) and in the app (ScannerPack.kt) alike.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const read = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const PAGE = read("public/app/settings-scanner.js");
const APP = read("android/app/src/main/java/com/musicd/server/android/ScannerPack.kt");

test("the page sets the pack's folder without a toast", () => {
  const set = PAGE.slice(PAGE.indexOf("async function packFolder("), PAGE.indexOf("const folderSvg"));
  assert.ok(set.includes("/api/identify/pack/folder"), "packFolder found");
  assert.doesNotMatch(set, /Toast\(/);
});

test("the app sets the pack's folder without a toast", () => {
  const set = APP.slice(APP.indexOf("private fun packFolder("));
  assert.ok(set.includes("/api/identify/pack/folder"), "packFolder found");
  assert.doesNotMatch(APP, /folder is set/);
  assert.doesNotMatch(set.slice(0, set.indexOf("\n}\n")), /done\(\)|Toast/);
});
