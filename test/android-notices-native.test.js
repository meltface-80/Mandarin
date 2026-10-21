"use strict";
/*
 * The server's notice at the head of the app's Home is the app's own (bug list item 112): it asks the server for its status
 * (Notices.watch, core ServerNotices) and forgets a folder itself, its question asked first; and the update offer is the
 * app's own too since the web view went (item 111: UpdateNow, core UpdateBanner).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("the app works out the server's notice and forgets a folder itself", () => {
  const b = read("NoticeBanners.kt");
  assert.match(b, /c\.getJson\("\/api\/status"\)[\s\S]*ServerNotices\.from\(it\)/);
  assert.match(b, /c\.post\("\/api\/library\/forget-folder", JSONObject\(\)\.put\("dir", dir\)\)/);
  assert.match(b, /if \(yes\) scope\.launch \{ Notices\.forget\(context, client, i\) \}/);
  assert.doesNotMatch(b, /"notice-button"/);
  assert.match(read("HomeScreen.kt"), /NoticeBanners\(prefs\.menu, client\)/);
});

test("the update offer is the app's own: looked for while Home is on, its buttons the app's", () => {
  assert.ok(!fs.existsSync(path.join(APP, "AppBridge.kt")));
  // While the app is on screen as well (item 120).
  assert.match(read("NoticeBanners.kt"), /LaunchedEffect\(onScreen\) \{ if \(onScreen\) UpdateNow\.watch\(\) \}/);
  const u = read("UpdateNow.kt");
  assert.match(u, /offer = UpdateBanner\.offer\(s, a, dismissed\)\s+show\(offer\?\.banner\)/);
  assert.match(u, /c\.post\("\/api\/update\/apply", JSONObject\(\)\)/);
  assert.match(read("ShellHand.kt"), /"update" -> UpdateNow\.tap\(arg == "now"\)/);
  assert.match(read("SettingsUpdates.kt"), /UpdateNow\.apply\(o\.server, o\.app\)/);
});
