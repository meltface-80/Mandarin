"use strict";
/*
 * The Android app keeps no log of its own (item 425; before, items 121 and 389, a log in its storage, Settings → Setup
 * → Logging with Save log and Clear log): its lines go to Mandarin's one log, read from its source (the app can't be
 * built here; CI builds it, and core's LogSendTest proves the sending):
 *   - AppLog writes no file: no FileWriter, no applog folder but the one an older app left, deleted; nothing saved to
 *     Downloads, nothing cleared, no "how much is logged";
 *   - each line through core LogSend (dated in UTC with its level, LogRedact first), sent to the server's
 *     POST /api/diagnostics/app within seconds, and that request not itself a line;
 *   - Setup has no Logging block, the Tailscale test no Copy log (its steps are lines of the one log);
 *   - the contract (docs/specs/screens.json) has no Logs page and no Logging items.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const APP = path.join(ROOT, "android/app/src/main/java/com/musicd/server/android");
const read = f => fs.readFileSync(path.join(APP, f), "utf8");

test("the app writes no log of its own: no file, no Save or Clear, no Logging in Setup", () => {
  const log = read("AppLog.kt");
  assert.doesNotMatch(log, /FileWriter|\.log"\)|previous\.log|current\.log/, "no file written");
  assert.doesNotMatch(log, /fun (save|clear|about)\(/, "nothing saved, cleared or measured");
  assert.doesNotMatch(log, /saveDownload|\/api\/diagnostics\/(log|bridges|clear)/, "nothing saved to Downloads, no server's log fetched");
  assert.match(log, /File\(c\.filesDir, "applog"\)\.deleteRecursively\(\)/, "an older app's files let go");
  assert.ok(!fs.existsSync(path.join(APP, "SettingsLogging.kt")), "no Logging block");
  assert.doesNotMatch(read("SettingsScreen.kt"), /LoggingBlock/);
  const ts = read("TailscaleTestActivity.kt");
  assert.doesNotMatch(ts, /Copy log|copyLog|ClipboardManager/, "no Copy log");
  assert.match(ts, /AppLog\.line\("TAILSCALE", s\)/, "its steps lines of the one log");
});

test("each line through LogSend, sent to the server for the one log within seconds", () => {
  const log = read("AppLog.kt");
  assert.match(log, /private val out = LogSend\(\)/);
  assert.match(log, /fun line\(cat: String, msg: String, anomaly: Boolean = false\) \{\s+if \(!on\) return\s+out\.line\(cat, msg, if \(anomaly\) "WARN" else "INFO"\)\s+soon\(\)/);
  assert.match(log, /out\.said\(l\); soon\(\)/, "Android's own lines too");
  assert.match(log, /private const val PATH = "\/api\/diagnostics\/app"/);
  assert.match(log, /client\.post\(PATH, JSONObject\(\)\.put\("text", it\)\)/);
  assert.match(log, /SEND_AFTER_MS = 3000L/, "within seconds");
  assert.match(log, /if \(!on \|\| what\.endsWith\(PATH\)\) return ask\(\)/, "the send not itself a line");
  const core = fs.readFileSync(path.join(ROOT, "android/core/src/main/kotlin/com/musicd/server/client/LogSend.kt"), "utf8");
  assert.match(core, /LogRedact\.line\(it\)/);
  assert.doesNotMatch(core, /java\.io\.File|FileWriter/, "core keeps nothing on disk");
});

test("the contract has no Logs page and no Logging items", () => {
  const screens = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/specs/screens.json"), "utf8")).screens || JSON.parse(fs.readFileSync(path.join(ROOT, "docs/specs/screens.json"), "utf8"));
  assert.ok(!("settings-logs" in screens), "no Settings → Logs");
  const setup = screens["settings-setup"].items;
  for (const k of ["logs", "logging", "logging-note", "log-about", "log-save", "log-clear"]) assert.ok(!(k in setup), k);
  const labels = fs.readFileSync(path.join(ROOT, "android/core/src/main/kotlin/com/musicd/server/client/ContractLabels1.kt"), "utf8");
  assert.doesNotMatch(labels, /settings-logs\.|settings-setup\.log-/);
});
