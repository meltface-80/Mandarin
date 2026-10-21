"use strict";
/*
 * The Android app's side menu opens as it was last seen (bug list item 122). It opened as the page's markup has it,
 * Labels and Shelf drawn, then took them away as the server answered they were switched off, and the rescan line
 * came in under them, moving Settings down: at each opening, a moment after it slid in (the owner's screenshots and
 * log, 21 October 11:58). Now the rows and the server's status are kept (core Menu.keep, on the phone), the menu opens
 * with them, and only a change at the server changes it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const menu = fs.readFileSync(path.join(APP, "MenuDrawer.kt"), "utf8");

test("the menu opens with the rows and the rescan line it was last seen with", () => {
  assert.match(menu, /val kept = remember \{ Store\.menuKept\(context\) \}/);
  assert.match(menu, /var sub by remember \{ mutableStateOf\(Menu\.rescanSub\(Menu\.keptStatus\(kept\), System\.currentTimeMillis\(\)\)\) \}/);
  assert.match(menu, /var items by remember \{ mutableStateOf\(Menu\.keptItems\(kept\) \?: Menu\.UNKNOWN\) \}/);
  assert.doesNotMatch(menu, /mutableStateOf\(Menu\.Items\(\)\)/, "never the markup's rows to start with");
});

test("the server's answer changes it only where it differs, and is kept for the next opening", () => {
  assert.match(menu, /Menu\.items\(l\.await\(\), q\.await\(\), t\.await\(\), sh\.await\(\), items\)/, "an answer missing leaves its row as seen");
  assert.match(menu, /Store\.setMenuKept\(context, Menu\.keep\(shown, status \?: Menu\.keptStatus\(kept\)\)\)/);
  assert.match(menu, /if \(shown != items\) AppLog\.line\("MENU", "its rows changed as the server answered: \$items, then \$shown", anomaly = kept != null\)/, "a change logged");
});

test("Settings' foot opens with the version last read", () => {
  const s = fs.readFileSync(path.join(APP, "SettingsScreen.kt"), "utf8");
  assert.match(s, /var version by rememberSaveable \{ mutableStateOf\(lastVersion\) \}/);
  assert.match(s, /\?\.let \{ version = it; lastVersion = it \}/);
});
