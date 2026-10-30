"use strict";
/*
 * The Android app's share card copies the card as a picture (item 224, as Rouen's app does since its 1.9.72-t22): Copy
 * image in place of Share…, so the card is pasted where it is wanted (a forum's post) rather than sent to an app chosen
 * from Android's share sheet. Android's clipboard holds a content:// address to the card's PNG, through the app's
 * FileProvider, which the app it is pasted into reads; Download stays. The clipboard and the paste are a device's alone,
 * so this reads the app's source, as the other android-*.test.js do. The browser's card is as it was (its Copy image
 * where the browser copies pictures, and Share…).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");
const contract = require("../docs/specs/screens.json").screens["share-card"].items;

test("the card's buttons in the app: Copy image and Download, no Share…", () => {
  const sheet = read("ShareSheet.kt");
  const actions = sheet.slice(sheet.indexOf("private fun ShareActions("), sheet.indexOf("private fun ShareButton("));
  assert.match(actions, /parity\("share-card\.copy"[\s\S]*clickable \{ s\.copy\(\) \}/);
  assert.match(actions, /parity\("share-card\.download"[\s\S]*clickable \{ s\.download\(\) \}/);
  assert.doesNotMatch(actions, /share-card\.share|s\.share\(\)/);
  // Copied! for a moment, or what went wrong under the card.
  assert.match(sheet, /br\.copyImage\(b, ShareCard\.fileName\(title, artist\)\)/);
  assert.match(sheet, /copied = "Copied!"/);
  assert.match(sheet, /err = "Couldn’t copy the card"/);
});

test("copied as a picture: the PNG through the app's FileProvider, its address on Android's clipboard", () => {
  const bridge = read("ShareBridge.kt");
  const copy = bridge.slice(bridge.indexOf("fun copyImage("), bridge.indexOf("private fun write("));
  assert.match(copy, /FileProvider\.getUriForFile\(activity, "\$\{activity\.packageName\}\.shares", write\(bytes, fileName\)\)/);
  assert.match(copy, /setPrimaryClip\(ClipData\.newUri\(activity\.contentResolver, "Album card", uri\)\)/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/res/xml/file_paths.xml"), "utf8"), /<cache-path name="shares" path="shared\/" \/>/);
});

test("the contract: Copy image the app's too, Share… the page's alone", () => {
  assert.ok(!contract.copy.only, "Copy image is no longer the page's alone");
  assert.equal(contract.share.only, "page");
  assert.ok(contract.share.why);
});
