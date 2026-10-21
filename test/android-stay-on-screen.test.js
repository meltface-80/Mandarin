"use strict";
/*
 * The Android app keeps the screen you are on when the server goes or comes back (bug list item 117). Going offline and
 * coming back online both took the app back to Home: at 07:56 one morning, Wi-Fi back while Settings → Setup → Away from
 * home was open, the app jumped to Home and the way back in had to be tapped again; going offline did the same from an
 * album's page and from Now playing. Now only what is under the screen changes (Home's rows read afresh, the room).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");
const fn = (src, from) => { const i = src.indexOf(from); assert.ok(i >= 0, from); const j = src.indexOf("\n}\n", i); return src.slice(i, j); };

for (const step of ["internal fun OfflineNow.goOffline(", "internal fun OfflineNow.goOnline("]) {
  test(`${step.slice(13, -1)} leaves the screen on show where it is`, () => {
    const body = fn(read("OfflineNow.kt"), step);
    assert.doesNotMatch(body, /popBackStack|navigate\(|toHome\(/, "no screen closed or opened");
    assert.doesNotMatch(body, /menuOpen\.value = false/, "the side menu left open");
    assert.match(body, /HomeKept\.reset\(\)/, "Home's rows read afresh for when it is next shown");
    assert.match(body, /NativeShell\.homeArgs\.value = NativeShell\.homeArgs\.value\.first to /, "Home in the room that plays now");
  });
}
