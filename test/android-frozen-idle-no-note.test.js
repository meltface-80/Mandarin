"use strict";
/*
 * Frozen while idle: no note at the next start, only a line in the log (bug list item 125). On 21 October at 18:49,
 * six minutes after the phone's player had stopped itself (item 124), Android ended the idle app again for "Sync
 * transaction while frozen": another app called on it and had to wait. The app loses nothing it doesn't bring back,
 * so it is Android's clean-up, like being short of memory, which never had a note. Which endings get one is core's
 * ExitReport, with its own test.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const note = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/ExitNote.kt"), "utf8");

test("the endings with no note go to the log, then the one worth a note is kept", () => {
  assert.match(note, /for \(q in ExitReport\.quiet\(exits, since\)\) AppLog\.line\("APP", "no note: " \+ ExitReport\.text\(q, time\(q\.at\)\)\)\s+val e = ExitReport\.pick\(exits, since\) \?: return\s+CrashLog\.keepNote/);
});
