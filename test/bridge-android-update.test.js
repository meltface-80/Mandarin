"use strict";
/*
 * The Android Bridge is updated by the browser, never by itself (item 297, bridge/android Updater.kt). From item 291
 * it held REQUEST_INSTALL_PACKAGES and installed its own update with the package installer, asking nothing on
 * Android 12 and later (USER_ACTION_NOT_REQUIRED): an app that can install apps without asking is what Google Play
 * Protect calls harmful, and it said so of Mandarin Bridge 0.2.1 on the owner's FiiO R7. Now an update from Mandarin
 * is a notification on the device, whose tap opens the release's build in the browser; the browser downloads it and
 * Android's installer asks. The Bridge's sources are read here as written.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "bridge", "android", "app", "src", "main");
const SRC = path.join(APP, "java", "com", "musicd", "server", "android");
const read = f => fs.readFileSync(f, "utf8");
const sources = () => fs.readdirSync(SRC).filter(f => f.endsWith(".kt")).map(f => [f, read(path.join(SRC, f))]);

test("the Android Bridge can't install apps: no permission to, no installer of its own", () => {
  const manifest = read(path.join(APP, "AndroidManifest.xml"));
  assert.doesNotMatch(manifest, /REQUEST_INSTALL_PACKAGES|INSTALL_PACKAGES|REQUEST_DELETE_PACKAGES/, "no permission to install apps");
  assert.doesNotMatch(manifest, /UpdateReceiver/, "no receiver of the installer's word");
  for (const [f, s] of sources()) {
    assert.doesNotMatch(s, /PackageInstaller|USER_ACTION_NOT_REQUIRED|canRequestPackageInstalls|ACTION_INSTALL_PACKAGE|application\/vnd\.android\.package-archive/, f + " installs nothing");
  }
});

test("an update from Mandarin is the release's build opened in the browser, from a notification on the device", () => {
  const u = read(path.join(SRC, "Updater.kt"));
  assert.match(u, /fun download\(tag: String\): String = "https:\/\/github\.com\/\$REPO\/releases\/download\/\$tag\/mandarin-bridge\.apk"/);
  assert.match(u, /private const val REPO = "meltface-80\/Mandarin"/);
  assert.match(u, /Intent\(Intent\.ACTION_VIEW, Uri\.parse\(download\(tag\)\)\)/, "the browser opens the build");
  assert.match(u, /state = "needs-you"/, "Mandarin says Finish on the device");
  // Only a release of the Bridge's: a tag, never an address (the Bridge's port has no sign-in).
  assert.match(u, /private val TAG = Regex\("\^\(test-bridge\|mandarin-bridge-v/);
  assert.match(u, /if \(!TAG\.matches\(tag\)\) return/);
  // Nothing downloaded by the Bridge itself.
  assert.doesNotMatch(u, /openConnection|HttpURLConnection/, "the Bridge downloads nothing of its own");
});
