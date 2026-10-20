"use strict";
/*
 * The Android app without its web view (bug list item 111, O2 in docs/specs/plan-android-native.md): it opens on its own
 * Home, nothing of the page under it; what its screens handed to the page is its own (the row's buttons, the screen
 * settings, the room, Now playing's album, the update offer, the Shelf); the server's gate shutting signs it in again; and
 * the page's machinery, its copy in the APK and the webkit library are gone. The page itself stays for browsers.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP = "android/app/src/main/java/com/musicd/server/android/";
const CORE = "android/core/src/main/kotlin/com/musicd/server/client/";
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const gone = f => assert.ok(!fs.existsSync(path.join(ROOT, f)), f + " is gone");

test("no web view: the activity holds the app's own screens, Home the first", () => {
  const main = read(APP + "MainActivity.kt");
  assert.doesNotMatch(main, /import android\.webkit|WebView\(|evaluateJavascript|addJavascriptInterface|loadUrl\(/);
  assert.match(main, /root\.addView\(NativeShell\.attach\(this\)/);
  assert.match(main, /private fun back\(\) \{\s+if \(!NativeShell\.back\(\)\) moveTaskToBack\(true\)\s+\}/);
  const shell = read(APP + "NativeShell.kt");
  assert.match(shell, /startDestination = ShellRoute\.HOME/);
  assert.doesNotMatch(shell, /toPage|overPage|OVERLAYS|pageFront|homeShown/);
  for (const f of ["PageFrame.kt", "PageGuard.kt", "PageCurtain.kt", "PageRelay.kt", "AppBridge.kt"]) gone(APP + f);
  gone(CORE + "PageWatch.kt");
  assert.doesNotMatch(read(APP + "AppBackup.kt"), /class BackupBridge/);
  assert.doesNotMatch(read(CORE + "Shell.kt"), /const val WEB|fun isWeb/);
});

test("the page's copy, its build step and the webkit library are gone; the server's last answers kept for offline", () => {
  const gradle = read("android/app/build.gradle.kts");
  assert.doesNotMatch(gradle, /bundleSite|generated\/site|androidx\.webkit/);
  const site = read(APP + "OfflineSite.kt");
  assert.doesNotMatch(site, /index\.html|fun file\(|fun has\(/);
  assert.match(site, /val CACHED_API = listOf\(/);
  gone("test/offline-bundle.test.js");
});

test("what the screens handed to the page is the app's own", () => {
  const hand = read(APP + "ShellHand.kt");
  assert.match(hand, /"nav" -> NativeShell\.nav\?\.let \{ navTap\(it, arg\.orEmpty\(\)\) \}/);
  assert.match(hand, /"library-view" -> NativeShell\.setLibraryView\(arg\.orEmpty\(\)\)/);
  assert.match(hand, /"share-service" -> NativeShell\.keep\("shareService", arg\)/);
  assert.match(hand, /"zone", "group-settled" -> NativeShell\.keepZone\(arg\)/);
  const shell = read(APP + "NativeShell.kt");
  assert.match(shell, /fun roomChosen\(id: String\) \{ RoomAsk\.chosen\(zone, id\); keepZone\(id\) \}/);
  assert.match(shell, /store\?\.let \{ Store\.setZone\(it, id\) \}/);
  assert.match(shell, /store\?\.let \{ Store\.setHomePrefs\(it, json\) \}/);
  assert.match(read(APP + "SetupActions.kt"), /NativeShell\.keep\(name, value\)/);
  const back = read(APP + "BackupParts.kt");
  assert.match(back, /fun ask\(\): JSONObject = ScreenPrefs\.backup\(NativeShell\.prefs, NativeShell\.zone\)/);
  assert.match(back, /ScreenPrefs\.restore\(page, NativeShell\.prefs\)/);
});

test("Now playing's album found as the page found it, the Shelf in the browser, the old update dialog gone", () => {
  assert.match(read(APP + "NowPlayingScreen.kt"), /findNowAlbum\(client, zoneId, v\.album, v\.artist\)\?\.let \{ onPage\("album", it\.toString\(\)\) \} \?: Toast\.makeText\(context, NowAlbum\.NOT_INDEXED/);
  assert.match(read(APP + "ShellHand.kt"), /NowAlbum\.playing\(c\.getJson\("\/api\/album\/now-playing\?zone="[\s\S]*NowAlbum\.match\(c\.getJson\(NowAlbum\.searchPath\(a\)\), a, artist\)/);
  assert.match(read(APP + "ShellRoutes.kt"), /what == "album" && arg != null && arg\.toLongOrNull\(\) != null -> \{ nav\.popBackStack\(\); nav\.navigate\(ShellRoute\.album\(arg\.toLong\(\)/);
  assert.match(read(APP + "MenuDrawer.kt"), /if \(what == "shelf"\) \{ openShelf\(context\); return \}/);
  assert.match(read(APP + "ShellHand.kt"), /Uri\.parse\("\$base\/shelf"\)/);
  const upd = read(APP + "AppUpdate.kt");
  assert.doesNotMatch(upd, /fun check\(|AlertDialog\.Builder\(activity\)\s+\.setTitle\("Update Mandarin"\)/);
});

test("the server's gate shutting on this phone signs it in again; a wrong password does not", () => {
  assert.match(read(APP + "Store.kt"), /transport = com\.musicd\.server\.client\.GateWatch\(com\.musicd\.server\.client\.HttpTransport\(address\.baseUrl, token\)\) \{ MainActivity\.gateShut\(\) \}/);
  assert.match(read(CORE + "ServerClient.kt"), /val gateShut get\(\) = status == 401 && message in GATE/);
  assert.match(read(APP + "MainActivity.kt"), /fun gateShut\(\) \{ shown\.get\(\)\?\.let \{ a -> a\.runOnUiThread \{ if \(!a\.isFinishing\) a\.signedOut\(\) \} \} \}/);
});
