"use strict";
/*
 * The Android app's log always on, as the server's and the Bridges' are (item 389), read from its source (the app
 * can't be built here; CI builds it):
 *   - no switch: AppLog starts collecting with the app, there is no switch(), and Store keeps no "logging" choice;
 *     Setup's Logging block has no toggle, and tells no one that switching off deletes it;
 *   - each line dated in UTC with the year and its level, as the server writes them, and Android's own lines as logcat
 *     writes them in UTC with the year, so every device's lines sort together (npm run logs);
 *   - the three tags it logged under but never read (HomeWifi, RandomAlbumTile, NowPlayingWidget) read;
 *   - its new lines sent to the server (POST /api/diagnostics/app) with each snapshot and when saved, and no longer
 *     a request to switch the server's log on.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "android", "app", "src", "main", "java", "com", "musicd", "server", "android");
const read = f => fs.readFileSync(path.join(SRC, f), "utf8");

test("the Android app's log is always on, dated in UTC, and sent to the server", () => {
  const log = read("AppLog.kt"), block = read("SettingsLogging.kt"), store = read("Store.kt");
  assert.doesNotMatch(log, /fun switch\(/, "no switch");
  assert.doesNotMatch(store, /fun logging\(|fun setLogging\(/, "no choice kept");
  assert.match(log, /fun start\(c: Context\) \{[^}]*\n\s*begin\(\)\n\s*\}/, "collecting from the start");
  assert.doesNotMatch(block, /Toggle\(/, "no toggle");
  assert.doesNotMatch(block, /Switching logging off deletes it/);
  assert.match(log, /SimpleDateFormat\("yyyy-MM-dd HH:mm:ss\.SSS", Locale\.UK\)\.apply \{ timeZone = java\.util\.TimeZone\.getTimeZone\("UTC"\) \}/);
  assert.match(log, /UTC {2}\$\{if \(anomaly\) "WARN " else "INFO "\} {2}\[\$cat\]/);
  assert.match(log, /"logcat", "-v", "threadtime", "-v", "UTC", "-v", "year"/);
  for (const tag of ["HomeWifi", "RandomAlbumTile", "NowPlayingWidget"]) assert.match(log, new RegExp(`"${tag}"`), tag);
  assert.match(log, /client\.post\("\/api\/diagnostics\/app", JSONObject\(\)\.put\("text", /);
  assert.match(log, /send\(app\)/, "sent with each snapshot");
  assert.match(log, /fun save\([^)]*\)[^{]*\{[\s\S]{0,200}send\(a\)/, "sent when saved");
  assert.doesNotMatch(log, /put\("on", (true|to)\)/, "no longer switches the server's log on");
});
