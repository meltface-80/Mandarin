"use strict";
/*
 * The app's native screens keep out from under the status bar once (item 534). The owner's Settings came up now and
 * then with its heading a status bar's height lower, until the app was force closed. The activity's root takes the
 * bars' room and consumes the insets (Insets.kt), so the screens' Compose sees none; but Android hands the insets'
 * animations (the keyboard coming and going, the bars sliding in) to every view inside whatever the root consumed,
 * and Compose took the whole bars from one and kept them, never told otherwise: Settings' own systemBarsPadding then
 * left the room a second time. The root now keeps those animations from its subtree (DISPATCH_MODE_STOP).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const insets = fs.readFileSync(path.join(APP, "Insets.kt"), "utf8");
const pad = insets.slice(insets.indexOf("    fun pad(view: View) {"));

test("the root consumes the bars' insets and keeps their animations from the screens inside it", () => {
  assert.match(pad, /WindowInsets\.CONSUMED/, "the insets consumed at the root");
  assert.match(pad, /view\.setWindowInsetsAnimationCallback\(object : WindowInsetsAnimation\.Callback\(DISPATCH_MODE_STOP\)/,
    "their animations stopped at the root: none reach Compose to give it the bars a second time");
  assert.ok(pad.indexOf("setWindowInsetsAnimationCallback") < pad.indexOf("view.requestApplyInsets()"), "set before the insets are asked for");
});

test("the main screen's root is the one that does it", () => {
  const main = fs.readFileSync(path.join(APP, "MainActivity.kt"), "utf8");
  assert.match(main, /root\.addView\(NativeShell\.attach\(this\)[\s\S]*?\)\s*\n\s*Insets\.pad\(root\)/);
});
