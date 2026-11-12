// @ts-check
"use strict";
/*
 * The Android app's changes are made on one lane, in order (ServerWrites, bug list items 83 and 85); a long call there
 * held back every change after it (item 390). The OptiPlex's phone: Qobuz's Update library now (a 600-second timeout)
 * ran from 17:45:16 to 17:55:16, and a Mandarin Bridge's switch, tapped at 17:45:50, was made only then, with the six
 * taps after it, one after the other: on, off, on… "it doesn't stay on". A call that may take longer than the lane's
 * most (ServerWrites.LANE_MOST, 20 s) is made aside (ServerLane.aside, core ServerLaneTest's).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..", "android", "app", "src", "main", "java", "com", "musicd", "server", "android");

test("no call on the app's lane of changes may take longer than its most; longer ones are made aside", () => {
  const most = Number(/const val LANE_MOST = ([\d_]+)/.exec(fs.readFileSync(path.join(APP, "ServerWrites.kt"), "utf8"))[1].replace(/_/g, ""));
  assert.equal(most, 20000);
  for (const f of fs.readdirSync(APP).filter(n => n.endsWith(".kt"))) {
    const src = fs.readFileSync(path.join(APP, f), "utf8");
    for (const m of src.matchAll(/ServerWrites\.write \{([^\n]*)/g)) {
      for (const t of m[1].matchAll(/\b(\d[\d_]*_000)\b/g)) {
        assert.ok(Number(t[1].replace(/_/g, "")) <= most, `${f}: a call on the lane with a timeout of ${t[1]} ms: ${m[0].trim()}`);
      }
    }
  }
  const services = fs.readFileSync(path.join(APP, "SettingsServices.kt"), "utf8");
  assert.match(services, /change\("\/import", timeout = 600_000\)/, "Update library now, ten minutes at most");
  assert.match(services, /val made = if \(timeout > ServerWrites\.LANE_MOST\) ServerWrites\.aside\(call\) else ServerWrites\.write\(call\)/, "made aside where it may be long");
  for (const [f, call] of [["SettingsAudio.kt", 'c.post("/api/audio-devices/rescan"'], ["SettingsScanner.kt", "c.post(path, body, 120_000)"],
    ["SettingsFolders.kt", 'c.post("/api/library/folders"'], ["SettingsBackup.kt", "runCatching(made)"]]) {
    assert.ok(fs.readFileSync(path.join(APP, f), "utf8").includes("ServerWrites.aside { " + call), `${f}: ${call} made aside`);
  }
});
