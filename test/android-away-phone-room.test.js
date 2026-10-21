"use strict";
/*
 * Away from home the Android app's screens play in this phone's room (bug list item 119). Away, the server offers only
 * this phone, yet the screens stayed in the Sonos room kept from home: in the owner's log of 21 October the mini player
 * asked for it every 2 s, and the server refused each time ("Away from home, only this phone plays"), 46 times in two
 * minutes. Now the room is the phone's while away (core Route.room), the one kept again at home, and a room that isn't
 * answered is asked for less and less often (core Retry).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("the room the screens play in is the phone's away, the one kept at home", () => {
  assert.match(read("Store.kt"), /fun playRoom\(context: Context\): String =\s+Route\.room\(isAway\(context\), zone\(context\), prefs\(context\)\.getString\("phone_zone", null\)\)/);
  const shell = read("NativeShell.kt");
  assert.match(shell, /zone = Store\.playRoom\(activity\)\s+homeArgs\.value = prefs\.orEmpty\(\) to zone/, "at the start");
  assert.match(shell, /fun wayChanged\(\) \{[\s\S]*?if \(OfflineNow\.on\) return[\s\S]*?val room = Store\.playRoom\(c\)[\s\S]*?homeArgs\.value = homeArgs\.value\.first to room/, "as home or away changes");
  assert.match(read("MainActivity.kt"), /private val onAway: \(Boolean\) -> Unit = \{ NativeShell\.wayChanged\(\);/);
  assert.match(read("ServerReach.kt"), /OfflineNow\.goOnline\(Store\.playRoom\(a\)\)/, "back online, in the room for the way");
});

test("a room not answered is asked for less and less often", () => {
  const follow = read("RoomFollow.kt");
  assert.match(follow, /if \(st == null\) \{ delay\(Retry\.ms\(\+\+missed\)\); continue \}\s+missed = 0/);
  assert.doesNotMatch(follow, /if \(st == null\) \{ delay\(2000\); continue \}/);
});
