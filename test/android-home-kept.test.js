"use strict";
/*
 * Home is the Android app's first screen and stays under every other (bug list item 115): the side menu's items opened
 * from Home popped Home itself (its "every screen over Home closed" found none to close, and then closed the one on
 * screen, Home), so Settings, Playlists and the rest were opened with nothing under them and their ✕ and ‹ did
 * nothing. Every way back to Home now goes through one step that never pops it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");
const all = () => fs.readdirSync(APP).filter(f => f.endsWith(".kt")).map(f => [f, read(f)]);

test("nothing pops Home when it finds no screen over it", () => {
  for (const [f, src] of all()) {
    assert.doesNotMatch(src, /if \(!\s*\w+\??\.popBackStack\(ShellRoute\.HOME, false\)\)\s*\w+\??\.popBackStack\(\)/, f);
  }
});

test("the menu's items and the row's buttons go back to Home through the one step that keeps it", () => {
  const routes = read("ShellRoutes.kt");
  const step = routes.slice(routes.indexOf("internal fun toHome("), routes.indexOf("\n}\n", routes.indexOf("internal fun toHome(")));
  assert.match(step, /if \(nav\.popBackStack\(ShellRoute\.HOME, false\) \|\| nav\.currentDestination\?\.route == ShellRoute\.HOME\) return/);
  assert.match(step, /nav\.navigate\(ShellRoute\.home\(/, "a stack without Home gets it back");
  assert.doesNotMatch(step, /nav\.popBackStack\(\)/);
  // Since item 199 the menu's items and the row's Library, Artists and Search open their screen over Home in one
  // navigation (overHome): Home got back if the stack lost it, then popUpTo(HOME), never inclusive, so Home stays
  // under the screen opened; nothing in either taps popBackStack, and nothing navigates past that one step.
  const over = routes.slice(routes.indexOf("internal fun overHome("), routes.indexOf("\n}\n", routes.indexOf("internal fun overHome(")));
  assert.match(over, /if \(runCatching \{ nav\.getBackStackEntry\(ShellRoute\.HOME\) \}\.isFailure\) toHome\(nav\)/, "a stack without Home gets it back first");
  assert.match(over, /nav\.navigate\(route\) \{ popUpTo\(ShellRoute\.HOME\) \}/);
  assert.doesNotMatch(over, /inclusive = true|popBackStack\(/, "Home is never popped");
  const menu = read("MenuDrawer.kt");
  const tap = menu.slice(menu.indexOf("internal fun menuTap("), menu.indexOf("\n}\n", menu.indexOf("internal fun menuTap(")));
  // The Shelf too since item 207: its own screen over Home, no longer the phone's browser.
  assert.doesNotMatch(tap, /openShelf/);
  for (const item of ["playlists", "smart-playlists", "later", "pitchfork", "labels", "qobuz", "tidal", "settings", "shelf"])
    assert.match(tap, new RegExp('"' + item + '"[^\\n]*-> overHome\\(nav, '), item);
  assert.doesNotMatch(tap, /popBackStack\(|nav\.navigate\(/, "every item goes through overHome");
  const row = routes.slice(routes.indexOf("internal fun navTap("), routes.indexOf("\n}\n", routes.indexOf("internal fun navTap(")));
  assert.match(row, /"home" -> \{ toHome\(nav\); NativeShell\.landHome\(\) \}/);
  assert.match(row, /"library" -> overHome\(nav, ShellRoute\.library\(/);
  assert.match(row, /"artists" -> overHome\(nav, ShellRoute\.artists\(/);
  assert.match(row, /"search" -> \{ SearchKept\.reset\(""\); overHome\(nav, ShellRoute\.search\(/);
  assert.match(row, /"menu" -> \{ toHome\(nav\); NativeShell\.menuOpen\.value = true \}/);
  assert.doesNotMatch(row, /popBackStack\(|nav\.navigate\(/);
});
