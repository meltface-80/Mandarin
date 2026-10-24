"use strict";
/*
 * The Android app takes the way to the server as soon as it is decided, and keeps to MusicD's own Tailscale once the
 * phone is signed in to it (bug list item 118). In the owner's log of 21 October, the Wi-Fi gone at 07:53:10, the app
 * went on asking the home address for 22 s while it waited for the Tailscale app, every request waiting out its 5 s;
 * at 08:18 the same while MusicD's own engine came up. And at 08:00, the engine started afresh after a stall, the app
 * was moved to the Tailscale app's address (which nothing answered) and went offline until the engine was back.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const away = fs.readFileSync(path.join(APP, "Away.kt"), "utf8");
const check = away.slice(away.indexOf("    fun check(c: Context): Boolean {"), away.indexOf("\n    }\n", away.indexOf("    fun check(c: Context): Boolean {")));

test("the way is decided (core Route.way) with MusicD's own Tailscale whenever the phone is signed in to it", () => {
  // Signed in by the engine's state or the app's own note that it joined (item 157: TailscaleEngine.signedIn).
  assert.match(check, /val ownSignedIn = TailscaleEngine\.signedIn\(c\)/);
  assert.match(check, /Route\.way\(wifi, homeAnswers, vpn, awayAddress = awayAt != null, ownSignedIn = ownSignedIn\)/);
  assert.match(check, /Store\.setViaEngine\(c, way\.viaEngine\)/);
});

test("the way is taken before anything is connected", () => {
  const taken = check.indexOf("Store.setAway(c, away)");
  assert.ok(taken > 0, "the way stored");
  // The engine brought up by repair() on its own thread (item 157), after the way is stored as before.
  for (const later of ["repair(c, ", "tailscale(c, connect = true)"]) {
    const at = check.indexOf(later);
    assert.ok(at > taken, `${later} after the way is taken`);
  }
});

test("the Tailscale app is asked only on a phone not signed in to MusicD's own", () => {
  assert.match(check, /if \(away && way\.viaEngine && awayAt != null\) \{[\s\S]*?repair\(c, [\s\S]*?\} else if \(away && awayAt != null && !answers\(awayAt, 3000\)\) \{[\s\S]*?tailscale\(c, connect = true\)/);
  // repair() is what brings MusicD's own up.
  assert.match(away, /private fun repair\(c: Context, target: String, wasRunning: Boolean\) \{[\s\S]*?TailscaleEngine\.connectAway\(c, target\)/);
});
