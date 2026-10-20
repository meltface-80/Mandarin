"use strict";
/*
 * Offline, the Android app's native screens are the app (bug list item 109, O1 in docs/specs/plan-android-native.md): the
 * page's copy in the APK is no longer loaded; the screens ask the phone the same questions they ask the server (a client
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

test("offline, the page is parked and the native screens take over", () => {
  const main = read("MainActivity.kt");
  const go = body(main, "private fun goOffline()");
  assert.doesNotMatch(go, /loadUrl\("\$\{loadedBase/, "the page's copy is not loaded");
  assert.match(go, /OfflineNow\.goOffline\(/);
  assert.match(body(main, "private fun loadOffline("), /goOffline\(\)/);
  assert.match(main, /offline = false\s+OfflineNow\.goOnline\(/);
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
  const shell = read("NativeShell.kt");
  assert.match(shell, /if \(OfflineNow\.on\) \{ OfflineNow\.toPage\(what, arg\); return \}/);
  assert.match(shell, /val startHome = Store\.token\(activity\) != null/);
  const nav = read("OfflineNow.kt");
  for (const b of ["home", "library", "menu", "search"]) assert.match(nav, new RegExp(`"${b}" ->`), b);
});
