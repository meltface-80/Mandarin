// @ts-check
"use strict";
/*
 * The phone's player dormant while idle (bug list item 203): stopSelf alone did nothing while Android kept the media
 * service bound, so its heartbeat and long poll ran on. Each site is held to the shape here.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android", "app", "src", "main", "java", "com", "musicd", "server", "android");
const read = (name) => fs.readFileSync(path.join(APP, name), "utf8");

test("idle for five minutes off screen, the player goes dormant rather than only asking to stop", () => {
  const svc = read("PhonePlayerService.kt");
  assert.match(svc, /if \(idle\.stop\(playing, NativeShell\.onScreen\.value\)\) dormant\(\)/);
  assert.doesNotMatch(svc, /not playing for five minutes"\); stopSelf\(\)/);
  const d = read("PlayerDormant.kt");
  assert.match(d, /internal fun PhonePlayerService\.dormant\(\) \{\s+if \(!running\) return[\s\S]*?running = false\s+connected = false\s+worker\?\.interrupt\(\); worker = null\s+stopSelf\(\)\s+\}/);
});

test("a start, a controller connecting or a player event wakes it; nothing once destroyed", () => {
  const svc = read("PhonePlayerService.kt");
  assert.match(svc, /onGetSession\(controllerInfo: MediaSession\.ControllerInfo\): MediaLibrarySession\? = session\.also \{ wake\(\) \}/);
  assert.match(svc, /return super\.onStartCommand\(intent, flags, startId\)\.also \{ wake\(\) \}/);
  assert.match(svc, /private fun reportSoon\(\) \{\s+wake\(\); if \(reportPending\) return/);
  const d = read("PlayerDormant.kt");
  assert.match(d, /internal fun PhonePlayerService\.wake\(\) \{\s+if \(running \|\| PhonePlayerService\.current !== this\) return\s+running = true\s+worker = Thread\(\{ loop\(\) \}, "phone-commands"\)[\s\S]*?main\.postDelayed\(heartbeat, 10_000\)/);
});
