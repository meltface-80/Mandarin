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
  const menu = read("MenuDrawer.kt");
  assert.match(menu.slice(menu.indexOf("internal fun menuTap(")), /if \(what == "shelf"\) \{ openShelf\(context\); return \}\s+toHome\(nav\)/);
  assert.match(routes.slice(routes.indexOf("internal fun navTap(")), /^internal fun navTap\(nav: NavHostController, what: String\) \{\s+(DevLog\.line\("ROW", "button \$what"\)\s+)?toHome\(nav\)/);
});
