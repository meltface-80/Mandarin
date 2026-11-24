"use strict";
/*
 * Now playing in a server's room after the app was offline for a moment (bug list item 485). In the owner's log of
 * 19 November the Wi-Fi dropped while the app was off screen; the app took itself to be away, its own Tailscale wasn't
 * up in ten seconds, and it went offline. Opened again five seconds later, Now playing (opened in the Bridge's room)
 * asked for that room's state; the phone answered with its own player's, a song of hours before, with no cover. The
 * server was found two seconds after, but the screen was still waiting on the phone's answer (held 20 s), and showed
 * the phone's song until it was left.
 *
 * What decides is tested where it can be run (android/core: RoomFollowedTest, PhoneRoomTest). Here, that the app is
 * wired to it: the app's own module is only built by CI, so its wiring is read.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("a screen follows the room RoomFollowed gives it, and asks afresh when the phone's answers and the server's change places", () => {
  const src = read("RoomFollow.kt");
  const follow = src.slice(src.indexOf("internal fun followRoom("), src.indexOf("internal fun rememberCover("));
  // Offline the phone's room is as the phone's own answers name it; away (item 487), as the server does.
  assert.match(follow, /val offline = OfflineNow\.kind\.value != null\s+val away = NativeShell\.away\.value\s+val context = LocalContext\.current\s+\/\/[^\n]*\n\s+val phone = if \(offline\) OfflineNow\.phone else if \(away\) Store\.awayRoom\(context\)\.orEmpty\(\) else ""\s+val followed = RoomFollowed\.of\(zoneId, offline, OfflineNow\.looking\.value, away, phone\)/);
  // Kept and asked for by the room followed, not the one the screen was opened in.
  assert.match(follow, /val id = followed\.id\s+val room = remember\(id\) \{ kept\.getOrPut\(id\) \{ RoomState\(id\) \} \}/);
  assert.match(follow, /c\.zoneState\(id, revision\)/);
  assert.doesNotMatch(follow, /zoneState\(zoneId/);
  // Online again (or offline), the loop starts again: the server is asked at once, not after the phone's held answer.
  assert.match(follow, /LaunchedEffect\(followed, offline, onScreen\) \{\s+if \(!followed\.ask \|\| !onScreen\) return@LaunchedEffect/);
});

test("offline, the phone's room is the one goOffline was told", () => {
  const now = read("OfflineNow.kt");
  assert.match(now, /val looking = mutableStateOf\(false\)/);
  assert.match(now, /this\.kind\.value = kind\s+phone = phoneZone\s+NativeShell\.zone = phoneZone/);
});

test("the wait begins as the app comes back on screen offline, and ends with the look's answer", () => {
  const reach = read("ServerReach.kt");
  const resumed = reach.slice(reach.indexOf("fun resumed()"), reach.indexOf("fun paused()"));
  assert.ok(resumed.length > 100);
  // Not in Offline mode, nor with no network: there is no look to wait for.
  assert.match(resumed, /if \(offline\) \{[\s\S]*?if \(!Store\.offlineMode\(a\) && Away\.hasNetwork\(a\)\) \{[\s\S]*?wait\.begin\(\); OfflineNow\.looking\.value = true\s+waitAtMost\(\)\s+\}\s+lookSoon\(500\); return/);
  // Each look asked for is numbered, and the watch answers for the one it made.
  assert.match(reach, /private fun lookSoon\(ms: Long\) \{ look = wait\.asked\(\); main\.removeCallbacks\(serverWatch\); main\.postDelayed\(serverWatch, ms\) \}/);
  const watch = reach.slice(reach.indexOf("private val serverWatch"), reach.indexOf("private val netWatch"));
  assert.match(watch, /val mine = look\s+watching\.execute \{/);
  assert.match(watch, /if \(!offline \|\| a\.isFinishing\) return@post[\s\S]*?val waited = wait\.waiting\s+wait\.answered\(mine, back\)\s+if \(waited && !wait\.waiting && !back\) phoneAnswers\("not found"\) else OfflineNow\.looking\.value = wait\.waiting[\s\S]*?if \(back\) \{/);
  assert.match(watch, /if \(Store\.offlineMode\(a\)\) \{ waitOver\(\); return \}\s+if \(!Away\.hasNetwork\(a\)\) \{ waitOver\(\); main\.postDelayed\(this, 10_000\); return \}/);
});

test("the wait never outlasts the screen, a start, or its few seconds", () => {
  const reach = read("ServerReach.kt");
  assert.match(reach, /private fun waitOver\(\) \{ wait\.end\(\); OfflineNow\.looking\.value = false; main\.removeCallbacks\(waitMost\) \}/);
  assert.match(reach, /fun paused\(\) \{ onScreen = false; live\.stop\(\); waitOver\(\); awayLook\(\) \}/);
  assert.match(reach, /fun go\(\) \{\s+waitOver\(\)/);
  assert.match(reach, /fun stop\(\) \{[\s\S]*?main\.removeCallbacksAndMessages\(null\)\s+waitOver\(\)/);
  assert.match(reach, /private fun goOffline\(\) \{[\s\S]*?\+\+seq\s+waitOver\(\)\s+OfflineNow\.goOffline\(/);
  assert.match(reach, /private val waitMost = Runnable \{ if \(wait\.waiting\) phoneAnswers\(/);
  // Three seconds away, six at home (item 487, LookWait.mostMs), counted again when the way changes while the screens wait.
  assert.match(reach, /private fun waitAtMost\(\) \{ main\.removeCallbacks\(waitMost\); main\.postDelayed\(waitMost, LookWait\.mostMs\(Store\.isAway\(a\)\)\) \}/);
  const moved = reach.slice(reach.indexOf("fun moved()"), reach.indexOf("fun modeChanged()"));
  assert.match(moved, /if \(offline\) \{\s+\/\/[^\n]*\n\s+if \(wait\.waiting\) waitAtMost\(\)\s+if \(Away\.hasNetwork\(a\)\) lookSoon\(500\); return\s+\}/);
});

test("while the server is looked for, the phone's player is told so", () => {
  assert.match(read("OfflineApi.kt"), /room = PhoneRoom\(Store\.phoneZone\(c\), PhoneDeck\(c\), held = \{ OfflineNow\.looking\.value \}\) \{ PhoneData\.shelf\(c\) \}/);
});
