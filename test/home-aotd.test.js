"use strict";
/*
 * Album of the Day on Home (bug list item 236): kept all day, and a switch of its own in Settings → Home Screen.
 * It was gone once played, until the next 00:01, and the space beside Random Album was left empty for the rest
 * of the day. The server keeps it, said played, when asked
 * with keep=1 (HomeRowsTests); the page and the Android app ask so (the app's: android/core LibraryClient, held to
 * the recorded path by LibraryTest).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const read = (/** @type {string} */ f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

test("the page asks for the day's album with keep=1, so it stays all day", () => {
  const page = read("public/app/home-render.js");
  assert.match(page, /fetch\("\/api\/home\/album-of-the-day\?keep=1"/);
  assert.doesNotMatch(page, /fetch\("\/api\/home\/album-of-the-day"/, "never the answer that drops it once played");
});

test("the Android app asks for it the same way", () => {
  assert.match(read("android/core/src/main/kotlin/com/musicd/server/client/LibraryClient.kt"), /get\("\/api\/home\/album-of-the-day\?keep=1"\)/);
});

test("the Android app's switch: Settings → Home Screen, kept as the page keeps it, and Home neither shows nor asks while it is off", () => {
  const settings = read("android/app/src/main/java/com/musicd/server/android/SettingsHome.kt");
  assert.match(settings, /SetupRow\("Album of the Day"[\s\S]*?Toggle\(prefs\.aotd, Modifier\.parity\("settings-homescreen\.aotd"[\s\S]*?setPagePref\(context, "aotd", if \(prefs\.aotd\) "off" else "on"\)/);
  const home = read("android/app/src/main/java/com/musicd/server/android/HomeScreen.kt");
  assert.match(home, /val aotd = HomeKept\.aotd\.takeIf \{ prefs\.aotd \}/);
  assert.match(home, /if \(!onScreen \|\| !prefs\.aotd\) return@LaunchedEffect/);
  // The page hands its setting to the app with the others.
  assert.match(read("public/app/device-power.js"), /aotd: p\.get\("aotd"\)/);
});
