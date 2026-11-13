"use strict";
/*
 * Every dev build of the server has an Android test build of the same number (bug list item 170, the owner's rule).
 * The server's dev build was made on every push to dev (then an image, item 394: Mandarin OS's test image now, its
 * Mandarin built from source by os/mandarin-from-source.sh); the APK was built only when the app, the page
 * or android.yml changed, so after a push of server code (items 165 to 169) dev's server said 1.1.9-tN while the test
 * APK was still the build before. Now android-dev.yml builds the APK on every dev push, calling android.yml whole, and
 * android.yml leaves dev to it, so a push builds it once. Both stamp their number from tools/test-version.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const WF = path.join(__dirname, "..", ".github", "workflows");
const read = name => fs.readFileSync(path.join(WF, name), "utf8");
// The workflow's `on:` block, as written (up to the next top-level key).
const onBlock = text => { const m = /^on:\n((?:[ \t].*\n|\s*\n)*)/m.exec(text); assert.ok(m, "an on: block"); return m[1]; };
// The `push:` part of an on: block.
const pushOf = on => { const m = /^ {2}push:\n((?: {4}.*\n)*)/m.exec(on); return m ? m[1] : null; };

test("a push to dev builds the APK whatever it changed", () => {
  const on = onBlock(read("android-dev.yml"));
  const push = pushOf(on);
  assert.ok(push, "android-dev.yml runs on push");
  assert.match(push, /branches: \[dev\]/);
  assert.doesNotMatch(push, /paths/, "no paths filter: a push of server code alone builds the APK too");
  assert.match(read("android-dev.yml"), /uses: \.\/\.github\/workflows\/android\.yml\n\s+secrets: inherit/, "android.yml, called whole, with the signing key");
  assert.match(onBlock(read("android.yml")), /^ {2}workflow_call:/m, "android.yml can be called");
});

test("android.yml leaves dev to android-dev.yml, so a dev push builds the APK once", () => {
  const push = pushOf(onBlock(read("android.yml")));
  // Every branch but dev (and Dependabot's, item 376, built by its pull request).
  assert.match(push, /branches: \["\*\*", "!dev"(, "!dependabot\/\*\*")?\]/);
});

test("the APK and dev's Mandarin OS image take the same test number", () => {
  const stamp = wf => /v=\$\(node tools\/test-version\.js\)/.test(wf);
  assert.ok(stamp(read("android.yml")), "the APK takes its number from tools/test-version.js");
  assert.match(fs.readFileSync(path.join(__dirname, "..", "os", "mandarin-from-source.sh"), "utf8"), /V="\$\(node tools\/test-version\.js\)"/,
    "Mandarin OS's test image builds Mandarin at the same number");
  // The APK's stamp and its upload to test-android, for dev: still true when android.yml runs called from android-dev.yml
  // (a called workflow's github.event_name and github.ref are the caller's: push, refs/heads/dev).
  assert.match(read("android.yml"), /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/dev'/);
});
