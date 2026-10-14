"use strict";
/*
 * The Android app keeps the page for offline (v1.0.2): every script the page
 * loads is copied into the app (android/app/build.gradle.kts) and served from
 * there (OfflineSite.kt). A script left out of either is missing offline: the
 * page then runs without it. v0.9.6's touchnav.js, v1.0.1's nowdisc.js and
 * v1.0.2's features.js were each added by hand; this holds the lists to the page.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

test("every script the page loads is in the Android app's offline copy, both lists", () => {
  const scripts = [...read("public/index.html").matchAll(/<script src="\/([^"?]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.includes("app.js") && scripts.includes("features.js"), "the page's scripts read: " + scripts.join(", "));
  const gradle = read("android/app/build.gradle.kts");
  const include = /include\(([^)]*)\)/.exec(gradle.slice(gradle.indexOf('tasks.register<Copy>("bundleSite")')));
  assert.ok(include, "build.gradle.kts copies the page's files in bundleSite's include(...)");
  const copied = [...include[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const served = [...read("android/app/src/main/java/com/musicd/server/android/OfflineSite.kt").matchAll(/"\/([^"]+)" to "([^"]+)"/g)].map((m) => m[1]);
  for (const s of scripts) {
    // The page's own script is made from its parts (v1.0.5): joined into the app's copy, not copied (test/page-script.test.js).
    if (s === "app.js") assert.match(gradle, /File\(pageDir, "app\/parts\.txt"\)/, "app.js is joined from its parts into the app (build.gradle.kts)");
    else assert.ok(copied.includes(s), s + " is copied into the app (build.gradle.kts)");
    assert.ok(served.includes(s), s + " is served offline (OfflineSite.kt)");
  }
});
