"use strict";
/*
 * "This phone" stops itself before Android freezes it (bug list item 124). In the owner's log of 21 October the
 * player was paused at 16:58 and the app left at 17:02; Media3 let the service out of the foreground ten minutes after
 * the pause (17:08, Android's first "memory back"), Android cached and froze the app, and at 17:16 ended it: "[FREEZER
 * BINDER TRANSACTION] Sync transaction while frozen", someone having asked the still-open media session something. On
 * 1.1.0 the same idle player was ended for "too much CPU" (its long poll running on in a cached process). The timing
 * itself is core's PlayerIdle, with its own test.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "android");
const svc = fs.readFileSync(path.join(ROOT, "app/src/main/java/com/musicd/server/android/PhonePlayerService.kt"), "utf8");
const idle = fs.readFileSync(path.join(ROOT, "core/src/main/kotlin/com/musicd/server/client/PlayerIdle.kt"), "utf8");

test("the heartbeat stops the player when it has not played for a while and the app is off screen", () => {
  assert.match(svc, /private val idle = PlayerIdle \{ android\.os\.SystemClock\.elapsedRealtime\(\) \}/, "a clock that counts the phone's sleep");
  assert.match(svc, /val playing = player\.playWhenReady && player\.playbackState in Player\.STATE_BUFFERING\.\.Player\.STATE_READY\s+if \(idle\.stop\(playing, NativeShell\.onScreen\.value\)\) \{ AppLog\.line\("APP", "[^"]+"\); stopSelf\(\) \}\s+if \(running\) main\.postDelayed\(this, 10_000\)/);
});

test("before Media3 lets the paused service out of the foreground, ten minutes after the pause", () => {
  const ms = Number(idle.match(/const val STOP_MS = (\d+) \* 60_000L/)[1]) * 60_000;
  assert.ok(ms < 10 * 60_000, `stops after ${ms} ms`);
});

test("stopped, it is started again with the app, and the server's queue comes back paused", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "app/src/main/java/com/musicd/server/android/MainActivity.kt"), "utf8"), /override fun onResume\(\) \{[\s\S]*?PhonePlayerService\.start\(this\)\s+\}/);
  assert.match(svc, /val resume = h\.resume\s+if \(resume != null\) main\.post \{ if \(!localMode && player\.mediaItemCount == 0\) restore\(resume\) \}/);
});
