"use strict";
/*
 * UI Settings drawn at once on the Android app's screens (bug list item 190). The screen settings were a plain value
 * (NativeShell.prefs), read once by the shell and handed to each screen as it was then: a setting changed in UI Settings
 * was kept, but the Library, the walls, an artist's page, the search and the rest went on drawing the old one until the
 * app started again (Home alone followed, through its own state). The settings are Compose state now, and each screen
 * reads them where it is drawn, so a change draws it again.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const shell = fs.readFileSync(path.join(APP, "NativeShell.kt"), "utf8");
const routes = fs.readFileSync(path.join(APP, "ShellRoutes.kt"), "utf8");

test("the screen settings are Compose state", () => {
  assert.match(shell, /private val prefsNow = mutableStateOf<String\?>\(null\)/);
  assert.match(shell, /var prefs: String\?\s+get\(\) = prefsNow\.value\s+set\(v\) \{ prefsNow\.value = v \}/);
  assert.doesNotMatch(shell, /@Volatile var prefs/, "never a plain value no screen can follow");
});

test("each screen reads them where it is drawn, not as the shell first saw them", () => {
  const body = shell.slice(shell.indexOf("private fun Shell("));
  assert.doesNotMatch(body, /val prefs = NativeShell\.prefs/, "no copy taken once for every screen");
  assert.match(routes, /fun NavGraphBuilder\.moreRoutes\(nav: NavHostController, client: \(\) -> ServerClient\?\) \{/, "no copy handed to the other routes");
  for (const src of [body, routes]) {
    const parsed = src.match(/WallPrefs\.parse\([^)]*\)/g) || [];
    assert.ok(parsed.length > 0);
    for (const p of parsed) assert.match(p, /WallPrefs\.parse\((NativeShell\.prefs|args\.first)/, p);
  }
  assert.match(body, /WallPrefs\.parse\(NativeShell\.prefs \?: entry\.arguments\?\.getString\(ShellRoute\.PREFS\)\)/, "the Library as the settings are now");
});
