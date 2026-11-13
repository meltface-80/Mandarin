"use strict";
/*
 * The notification's loop pauses after a miss (item 400). In the owner's log of 12 November, while the server started
 * again after a backup was restored (12 s), the phone asked it for its rooms some 500 times in 4 s: a wake asked for
 * before the miss (the app opened, a room chosen) was left set, and the pause after each miss ends at once while one is.
 * The wake is spent on the try that missed; one asked for during the pause still ends it.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const svc = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/NowPlayingService.kt"), "utf8");

test("a miss spends the wake before its pause, so the pause holds", () => {
  // From the miss counted to its pause: the wake is spent between them.
  const miss = /failures\+\+\n([\s\S]*?)sleep\(minOf\(30_000L, 2_000L \* failures\)\)/.exec(svc);
  assert.ok(miss, "it pauses longer after each miss");
  assert.match(miss[1], /\bwake = false\b/, "the wake is spent before the pause");
});

test("the pause still ends when the app wakes it", () => {
  assert.match(svc, /while \(running && !wake && SystemClock\.elapsedRealtime\(\) < until\)/);
});
