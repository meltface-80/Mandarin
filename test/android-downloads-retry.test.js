"use strict";
/*
 * The app's old Downloads screen (DownloadsActivity, a View screen) gone, its two buttons kept where the app now shows the
 * same things (bug list item 110, the owner's call): Try again on a download that failed, in Settings → Downloads' albums,
 * the page's and the app's own; and Try the server again in the Offline dialog when the server can't be reached.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const APP = "android/app/src/main/java/com/musicd/server/android/";

test("a failed download has Try again, on the page and in the app, and the app tries it again", () => {
  const page = read("public/app/android-downloads.js");
  assert.match(page, /d\.state === "failed" \? '<button type="button" class="dl-btn" data-parity="settings-downloads-albums\.retry" data-dl-retry=/);
  assert.match(page, /closest\("\[data-dl-retry\]"\)[\s\S]{0,80}dl\.retry\(Number\(/);
  assert.match(read(APP + "SettingsDownloadsList.kt"), /if \(a\.state == "failed"\) RoundButton\(R\.drawable\.dl_retry, Modifier\.parity\("settings-downloads-albums\.retry"/);
  assert.match(read(APP + "DownloadsBridge.kt"), /fun retry\(albumId: Int\) \{[\s\S]*DownloadWorker\.enqueue\(activity, a\.id, a\.quality, a\.title, a\.artist, a\.auto\)/);
});

test("the server out of reach, the Offline dialog looks for it now, on the page and in the app", () => {
  assert.match(read("public/index.html"), /id="offline-retry" type="button" data-parity="offline\.retry">Try the server again</);
  assert.match(read("public/app/server-notice.js"), /offState\.kind === "app" && !!window\.MusicdApp && typeof window\.MusicdApp\.lookForServer === "function"/);
  assert.match(read(APP + "OfflineDialog.kt"), /if \(OfflineNote\.canRetry\(kind\)\) Box\(Modifier\.parity\("offline\.retry"/);
  assert.match(read(APP + "MainActivity.kt"), /fun lookForServer\(\) \{ if \(::reach\.isInitialized\) reach\.lookNow\(\) \}/);
  assert.match(read(APP + "ServerReach.kt"), /fun lookNow\(\) \{ if \(offline\) lookSoon\(0\) \}/);
});

test("the old Downloads screen is gone, and what opened it opens Settings → Downloads' albums", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, APP + "DownloadsActivity.kt")));
  assert.doesNotMatch(read("android/app/src/main/AndroidManifest.xml"), /DownloadsActivity/);
  assert.match(read(APP + "DownloadsBridge.kt"), /fun open\(\) \{\s+activity\.runOnUiThread \{ NativeShell\.nav\?\.navigate\(com\.musicd\.server\.client\.ShellRoute\.settings\("downloads-albums"\)\) \}/);
  assert.match(read(APP + "SettingsScreen.kt"), /"downloads-albums" -> SettingsDownloads\(client, onBack, albums = true\)/);
});
