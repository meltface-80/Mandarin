"use strict";
/*
 * The "test-android" pre-release holds one APK (bug list item 128): mandarin-android-test.apk, the file the owner
 * installs from dev. Each build also uploaded a copy under its version's name, and with every version since 0.8.0
 * kept, 46 of them (13 to 20 MB each) had built up by 22 October. The version stays in the release's notes.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const wf = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/android.yml"), "utf8");

test("a test build replaces the one test APK and uploads nothing else", () => {
  const uploads = wf.split("\n").filter(l => /gh release upload test-android/.test(l));
  assert.deepStrictEqual(uploads.map(l => l.trim()), ["gh release upload test-android mandarin-android-test.apk --clobber"]);
  assert.match(wf, /gh release edit test-android --notes "The Android app from the \$branch branch at \$\{GITHUB_SHA::7\} \(\$APK\)\./, "the version said in the notes");
});
