"use strict";
/*
 * tmp-run.js — loaded by test/setup.js before every test file (item 201):
 * this process's temp directory is a folder of its own, musicd-run-…, in the
 * system's, and the folder goes when the process ends, passing or failing.
 * The suite's fixtures, servers, update bundles and browser profiles all went
 * to the system's temp directory and stayed there: some 290 MB a run, over
 * 20 GB in a few days on a machine that runs it often. Every test file's
 * mkdtemp is now inside the folder, and whatever the file starts (the
 * server, ffmpeg, Chromium) inherits TMPDIR and writes there too.
 *
 * The system's temp directory is passed on as MANDARIN_TEST_TMP_ROOT, for
 * what has to be shared between test files: the ports registry
 * (test/ports.js). A test file started by another (the runner and its files)
 * makes its folder inside its parent's, which takes it on its own way out.
 * A process killed outright (SIGKILL) leaves its folder behind.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = "MANDARIN_TEST_TMP_ROOT";
if (!process.env[ROOT]) process.env[ROOT] = os.tmpdir();
const mine = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-run-"));
for (const k of ["TMPDIR", "TMP", "TEMP"]) process.env[k] = mine;

process.on("exit", () => {
  try { fs.rmSync(mine, { recursive: true, force: true, maxRetries: 3 }); } catch (e) {
    process.stderr.write(`test/tmp-run.js: couldn't remove ${mine}: ${e.message}\n`);
  }
});

module.exports = { root: () => process.env[ROOT] || os.tmpdir(), mine };
