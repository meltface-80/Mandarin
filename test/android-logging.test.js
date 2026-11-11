"use strict";
/*
 * Logging in the Android app (bug list item 121): Settings → Setup → Logging, under API Keys. Always on (item 389;
 * before, item 334 made it on by default, but it could be switched off, which deleted it): the user is told what it
 * keeps and to save the log when something goes wrong; it holds the app's lines and the server's, without what is the
 * owner's alone (core LogRedact, the server's LogScrub, item 235), the user told so and to look through it before
 * sending it. (Its lines dated in UTC and sent to the server: android-log-always-on.test.js.)
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("Logging is under API Keys in Setup, with no switch (item 389)", () => {
  const screen = read("SettingsScreen.kt");
  const list = screen.indexOf("for (row in SettingsLists.SETUP)");
  assert.ok(list > 0 && screen.indexOf("LoggingBlock()", list) > list, "the Logging block after Setup's rows");
  const core = fs.readFileSync(path.join(__dirname, "..", "android/core/src/main/kotlin/com/musicd/server/client/Settings.kt"), "utf8");
  assert.match(core, /SettingsRow\("metadata", "API Keys"\)\)/, "API Keys the last of the rows");
  assert.doesNotMatch(read("Store.kt"), /"logging"/, "no choice kept");
});

test("the user is told it is kept always, what it leaves out, and that it is theirs to check", () => {
  const ui = read("SettingsLogging.kt");
  assert.match(ui, /Mandarin keeps a log always: this app's, the server's and every Mandarin Bridge's/);
  assert.match(ui, /tap Save log: it is saved to Downloads\/Mandarin on this phone/);
  assert.match(ui, /The log leaves out what is yours alone: no passwords, keys or tokens, no email addresses, no " \+\s+"account names or logins, no internet or Tailscale addresses/);
  assert.match(ui, /please look through it: what you send is your choice/);
  assert.match(ui, /SetupNote\(LOG_ON \+ "\\n\\n" \+ LOG_PRIVACY/);
  assert.doesNotMatch(ui, /AppLog\.switch|Toggle\(/, "no switch");
  assert.match(ui, /settings-setup\.log-save[\s\S]*AppLog\.save\(a\)[\s\S]*settings-setup\.log-clear/);
});

test("collected from the start, every line without personal data", () => {
  const log = read("AppLog.kt");
  assert.match(log, /fun line\(cat: String, msg: String, anomaly: Boolean = false\) \{\s+if \(!on\) return/, "nothing before it has started");
  assert.match(log, /\$\{LogRedact\.line\(msg\)\}/, "each line through LogRedact");
  assert.match(log, /fun start\(c: Context\) \{[^}]*begin\(\)\s*\}/, "started with the app, always");
  assert.doesNotMatch(log, /fun switch\(|tellServer|deleteFiles\(\) \}\s+tellServer/, "no switching off");
  // Android's log: only the app's own tags, and a crash's.
  assert.match(log, /val filter = TAGS\.map \{ "\$it:I" \} \+ listOf\("AndroidRuntime:E", "\*:S"\)/);
  assert.match(log, /val s = LogRedact\.line\(l\)/, "Android's lines through LogRedact");
  assert.match(log, /server\?\.lines\(\)\?\.joinToString\("\\n"\) \{ LogRedact\.line\(it\) \}/, "the server's lines through LogRedact too");
  const snap = log.slice(log.indexOf("fun snapshot(c: Context)"), log.indexOf("fun about()"));
  assert.ok(snap.length > 100, "the snapshot found");
  assert.doesNotMatch(snap, /baseUrl|lastZone \?:|h\.toString\(\)/, "no address, room id or raw answer written by the snapshots");
});

test("what helps is written as it is, AppLog taking out what is the owner's alone (item 235)", () => {
  assert.match(read("ShellHand.kt"), /fun logArg\(arg: String\?\): String = arg \?: ""/);
  for (const f of ["ShellHand.kt", "ShellRoutes.kt"]) assert.match(read(f), /AppLog\.line\("HAND", "\$what \$\{logArg\(arg\)\}/, f);
  assert.match(read("NativeShell.kt"), /AppLog\.line\("ROOM", .*" \(\$room\) now"\)/, "the room's id, to tell the players apart");
});
