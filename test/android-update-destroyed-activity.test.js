"use strict";
/*
 * The update offer with its activity gone (bug list item 192). UpdateNow kept the activity it installs from as a weak
 * reference, and AppUpdate's callbacks asked only whether that activity was finishing: the phone turned (or the app
 * closed) while the server's update ran or the app's own downloaded, and the callback that came after showed a dialog
 * (the download's progress, "Allow Mandarin to install updates") on the destroyed activity, which brought the app down
 * (BadTokenException). Now each asks whether the activity is still there, finishing or destroyed, and does nothing
 * from one that is gone.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const now = fs.readFileSync(path.join(APP, "UpdateNow.kt"), "utf8");
const app = fs.readFileSync(path.join(APP, "AppUpdate.kt"), "utf8");

test("UpdateNow uses its activity only while it is still there", () => {
  assert.match(now, /private fun live\(\): Activity\? = activity\.get\(\)\?\.takeIf \{ !it\.isFinishing && !it\.isDestroyed \}/);
  assert.doesNotMatch(now.replace(/private fun live\(\)[^\n]*\n/, ""), /activity\.get\(\)/, "every use through live()");
  assert.match(now, /if \(appAfterServer\) live\(\)\?\.let \{ appAfterServer = false; AppUpdate\.installNow\(it\) \}/);
});

test("AppUpdate shows nothing on an activity that is finishing or destroyed", () => {
  assert.match(app, /private fun gone\(a: Activity\) = a\.isFinishing \|\| a\.isDestroyed/);
  assert.doesNotMatch(app, /if \(activity\.isFinishing\)/, "never finishing alone: a turned phone's activity is destroyed, not finishing");
  for (const [fn, next] of [["fun installNow(activity: Activity) {", "if (gone(activity)) return"],
    ["private fun install(activity: Activity, apk: File) {", "if (gone(activity)) return"]]) {
    const at = app.indexOf(fn);
    assert.ok(at >= 0, fn);
    assert.strictEqual(app.slice(at + fn.length).trimStart().split("\n")[0], next, fn);
  }
  const dl = app.slice(app.indexOf("private fun download("), app.indexOf("private fun install("));
  assert.ok(dl.indexOf("if (gone(activity)) return\n") < dl.indexOf("AlertDialog.Builder(activity)"), "the progress dialog only on an activity still there");
  assert.strictEqual((dl.match(/if \(gone\(activity\)\) return@post/g) || []).length, 2, "each callback asks again");
});
