"use strict";
/*
 * The Android app asks the server for less while nobody is looking (bug list item 120). In the owner's log of
 * 20 October, with the app off screen and nothing playing, it asked 11 to 14 times a minute until Android froze it:
 * the room followed twice (the screen's mini player and the notification), the rooms before every wait on the room,
 * the server's status and today's album every minute. Offline, the phone's own answer about its room came back after
 * 1.5 s, so the screen asked again 40 times a minute; and Settings → Away from home read the Tailscale status every
 * three seconds behind the Tailscale app.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("the app knows when it is on screen", () => {
  assert.match(read("NativeShell.kt"), /val onScreen = mutableStateOf\(false\)/);
  const main = read("MainActivity.kt");
  assert.match(main, /override fun onResume\(\) \{\s+super\.onResume\(\)\s+NativeShell\.onScreen\.value = true/);
  assert.match(main, /override fun onPause\(\) \{\s+NativeShell\.onScreen\.value = false/);
});

test("what the screens ask again and again is asked only while the app is on screen", () => {
  assert.match(read("RoomFollow.kt"), /val onScreen by NativeShell\.onScreen\s+LaunchedEffect\(zoneId, onScreen\) \{\s+if \(zoneId\.isEmpty\(\) \|\| !onScreen\) return@LaunchedEffect/, "the room followed");
  assert.match(read("HomeScreen.kt"), /LaunchedEffect\(offline, onScreen\) \{\s+if \(!onScreen\) return@LaunchedEffect\s+while \(true\) \{ delay\(60_000\); client\(\)\?\.let \{ HomeKept\.refreshAotd\(it\) \} \}/, "today's album");
  const notices = read("NoticeBanners.kt");
  assert.match(notices, /LaunchedEffect\(again, onScreen\) \{ if \(onScreen\) Notices\.watch\(client\) \}/, "the server's status");
  assert.match(notices, /LaunchedEffect\(onScreen\) \{ if \(onScreen\) UpdateNow\.watch\(\) \}/, "the update offer");
  // One read not answered keeps the page as it was; two in a row say the server can't be reached (item 198).
  assert.match(read("SettingsShareAway.kt"), /LaunchedEffect\(onScreen\) \{\s+if \(!onScreen\) return@LaunchedEffect\s+while \(true\) \{\s+\/\/[^\n]*\n\s+if \(!busy\) client\(\)\?\.let \{ c -> val got = withContext\(Dispatchers\.IO\) \{ runCatching \{ c\.tailscale\(\) \}\.getOrNull\(\) \}\s+missed = if \(got == null\) missed \+ 1 else 0; if \(got != null \|\| missed > 1\) st = got; read = true \}/, "the Tailscale status");
});

test("the notification looks at the rooms now and then, not before every wait on the room", () => {
  const svc = read("NowPlayingService.kt");
  assert.match(svc, /if \(zoneId == null \|\| wake \|\| failures > 0 \|\| SystemClock\.elapsedRealtime\(\) - zonesAt > ZONES_MS\) \{\s+val zones = client\.zones\(\)/);
  assert.match(svc, /private const val ZONES_MS = 5 \* 60 \* 1000L/);
  // A room chosen in the app wakes it, so the lock screen follows at once.
  assert.match(read("NativeShell.kt"), /store\?\.let \{ Store\.setZone\(it, id\); NowPlayingService\.start\(it\) \}/);
});
