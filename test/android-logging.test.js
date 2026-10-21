"use strict";
/*
 * Logging in the Android app (bug list item 121): Settings → Setup → Logging, under API Keys. Off unless switched on,
 * and off nothing is collected; on, the user is told to use the app as usual for 24 hours and then save the log, which
 * holds the app's lines and the server's, and is made without personal data (core LogRedact, the server's Diagnostics),
 * the user told so and to look through it before sending it. Switched off, it is deleted, the server's part too.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("the switch is under API Keys in Setup, off unless switched on", () => {
  const screen = read("SettingsScreen.kt");
  const list = screen.indexOf("for (row in SettingsLists.SETUP)");
  assert.ok(list > 0 && screen.indexOf("LoggingBlock()", list) > list, "the Logging block after Setup's rows");
  const core = fs.readFileSync(path.join(__dirname, "..", "android/core/src/main/kotlin/com/musicd/server/client/Settings.kt"), "utf8");
  assert.match(core, /SettingsRow\("metadata", "API Keys"\)\)/, "API Keys the last of the rows");
  assert.match(read("Store.kt"), /fun logging\(context: Context\): Boolean = prefs\(context\)\.getBoolean\("logging", false\)/);
});

test("on, the user is told to use the app for 24 hours, and that the log holds no personal data but is theirs to check", () => {
  const ui = read("SettingsLogging.kt");
  assert.match(ui, /Use the app as you normally would for 24 hours, then tap Save log/);
  assert.match(ui, /made without personal data: no IP addresses \(home, Tailscale or internet\)/);
  assert.match(ui, /please look through it: what you send is your choice/);
  assert.match(ui, /SetupNote\(\(if \(on\) LOG_ON else LOG_OFF\) \+ "\\n\\n" \+ LOG_PRIVACY/);
  assert.match(ui, /AppLog\.switch\(context, on\)/);
  assert.match(ui, /if \(on\) \{[\s\S]*settings-setup\.log-save[\s\S]*AppLog\.save\(a\)[\s\S]*settings-setup\.log-clear/);
});

test("off, nothing is collected; on, every line without personal data", () => {
  const log = read("AppLog.kt");
  assert.match(log, /fun line\(cat: String, msg: String, anomaly: Boolean = false\) \{\s+if \(!on\) return/);
  assert.match(log, /\$\{LogRedact\.line\(msg\)\}/, "each line through LogRedact");
  assert.match(log, /if \(Store\.logging\(c\)\) begin\(\)/, "started only if switched on");
  assert.match(log, /if \(!on\) return ask\(\)/, "requests not timed while off");
  assert.match(log, /fun switch\(c: Context, to: Boolean\) \{[\s\S]*else \{ on = false; logcat\?\.destroy\(\); logcat = null; deleteFiles\(\) \}\s+tellServer\(c, to\)/, "off deletes it, the server told");
  // Android's log: only the app's own tags, and a crash's.
  assert.match(log, /val filter = TAGS\.map \{ "\$it:I" \} \+ listOf\("AndroidRuntime:E", "\*:S"\)/);
  assert.match(log, /server\?\.lines\(\)\?\.joinToString\("\\n"\) \{ LogRedact\.line\(it\) \}/, "the server's lines through LogRedact too");
  const snap = log.slice(log.indexOf("fun snapshot(c: Context)"), log.indexOf("fun about()"));
  assert.ok(snap.length > 100, "the snapshot found");
  assert.doesNotMatch(snap, /baseUrl|lastZone \?:|h\.toString\(\)/, "no address, room id or raw answer written by the snapshots");
});

test("what a line could carry of a person is left out where it is written", () => {
  assert.match(read("ShellHand.kt"), /fun logArg\(arg: String\?\): String = if \(arg\.isNullOrEmpty\(\)\) "" else if \(arg\.all \{ it\.isDigit\(\) \}\) arg else com\.musicd\.server\.client\.LogRedact\.HIDDEN/);
  for (const f of ["ShellHand.kt", "ShellRoutes.kt"]) assert.doesNotMatch(read(f), /AppLog\.line\("HAND", "\$what \$\{arg/, f);
  assert.doesNotMatch(read("NativeShell.kt"), /AppLog\.line\("ROOM", "[^"]*\$room/);
});
