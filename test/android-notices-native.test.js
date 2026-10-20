"use strict";
/*
 * The server's notice at the head of the app's Home is the app's own (bug list item 112): it asks the server for its status
 * (Notices.watch, core ServerNotices) and forgets a folder itself, its question asked first; the page tells it only the
 * update offer now.
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

test("the page's word is the update offer alone", () => {
  assert.match(read("AppBridge.kt"), /Notices\.now\.value = Notices\.now\.value\.copy\(update = n\.update\)/);
});
