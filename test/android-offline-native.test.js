"use strict";
/*
 * Offline, the Android app's native screens are the app (bug list item 109, O1 in old/plan-android-native.md; the
 * reachability ServerReach's since the web view went, item 111): the screens ask the phone the same questions they ask the server (a client
 * whose answers are the phone's, core PhoneAnswers through a LocalTransport); the row along the foot is the app's own; and
 * Home comes in front whether the app starts online or offline.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");
const body = (src, from) => { const i = src.indexOf(from); assert.ok(i >= 0, from); const j = src.indexOf("\n    }\n", i); return src.slice(i, j); };

test("offline, the native screens take over; back online, the server's again", () => {
  const reach = read("ServerReach.kt");
  assert.match(body(reach, "private fun goOffline()"), /OfflineNow\.goOffline\(/);
  assert.match(body(reach, "fun go()"), /if \(Store\.offlineMode\(a\) \|\| !Away\.hasNetwork\(a\)\) (return goOffline\(\)|\{ DevLog\.line\([^\n]*; return goOffline\(\) \})/);
  assert.match(reach, /offline = false\s+reached = false\s+liveFailures = 0\s+OfflineNow\.goOnline\(/);
});

test("the native screens ask the phone offline, the services the server", () => {
  const store = read("Store.kt");
  assert.match(body(store, "fun screenClient("), /if \(!OfflineNow\.on\) return client\(context\)[\s\S]*LocalTransport[\s\S]*OfflineApi\.answers/);
  assert.match(read("NativeShell.kt"), /Shell\(client = \{ Store\.screenClient\(activity\) \}/);
});

test("the row along the foot and Home are the app's own offline", () => {
  const files = fs.readdirSync(APP).filter(f => f.endsWith(".kt"));
  const calls = files.flatMap(f => (read(f).match(/TouchNav\([^)]*offline = [^,]+,/g) || []).map(c => [f, c]));
  assert.ok(calls.length >= 12, "every screen's row found");
  for (const [f, c] of calls) assert.match(c, /offline = OfflineNow\.on,/, f);
  assert.match(read("TouchNav.kt"), /\.clickable \{ NativeShell\.menuOpen\.value = true \}/);
  assert.match(read("NativeShell.kt"), /startDestination = ShellRoute\.HOME/);
  const nav = read("ShellRoutes.kt");
  for (const b of ["home", "library", "menu", "search"]) assert.match(body(nav, "internal fun navTap("), new RegExp(`"${b}" ->`), b);
});
