"use strict";
/*
 * tmp-run.test.js — the suite leaves nothing in the system's temp directory
 * (item 201; test/tmp-run.js, loaded by test/setup.js): a test file, run as
 * the suite runs it, is given a folder of its own as its temp directory, which
 * whatever it starts (the server, ffmpeg, a browser) inherits, and the folder
 * goes when the file's process ends, passing or failing. The ports registry
 * (test/ports.js) stays in the shared temp directory, so test files side by
 * side still keep apart.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

/** A test file's process, as `npm test` starts one, its temp directory a fresh one of the test's own. */
function runFile(body) {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tmprun-"));
  const env = Object.assign({}, process.env, { TMPDIR: tmp, TMP: tmp, TEMP: tmp });
  delete env.MANDARIN_TEST_TMP_ROOT;
  const r = spawnSync(process.execPath, ["--require", "./test/setup.js", "-e", body], { cwd: ROOT, env, encoding: "utf8" });
  const left = fs.readdirSync(tmp).sort();
  fs.rmSync(tmp, { recursive: true, force: true });
  return { tmp, left, status: r.status, out: r.stdout.trim().split("\n"), err: r.stderr };
}

const WORK = `
  const fs = require("fs"), os = require("os"), path = require("path");
  const { spawnSync } = require("child_process");
  const mine = os.tmpdir();
  const lib = fs.mkdtempSync(path.join(mine, "musicd-test-"));
  fs.writeFileSync(path.join(lib, "big.bin"), Buffer.alloc(1 << 20));
  fs.mkdirSync(path.join(lib, "deep", "er"), { recursive: true });
  const child = spawnSync(process.execPath, ["-e", "console.log(require('os').tmpdir())"], { encoding: "utf8" }).stdout.trim();
  require("./test/ports").port();
  console.log(mine); console.log(child); console.log(process.env.MANDARIN_TEST_TMP_ROOT);
`;

test("a test file's temp folders go when it ends, its children's with them; the ports registry stays shared (item 201)", () => {
  const r = runFile(WORK);
  assert.equal(r.status, 0, r.err);
  const [mine, child, root] = r.out;
  assert.equal(root, r.tmp, "the machine's own temp directory passed on");
  assert.equal(path.dirname(mine), r.tmp, "its temp directory a folder of its own in it");
  assert.match(path.basename(mine), /^musicd-run-/);
  assert.equal(child, mine, "what it starts has the same temp directory");
  assert.deepEqual(r.left, ["mandarin-test-slots"], "nothing left but the shared ports registry");
});

test("a test file that fails leaves nothing either (item 201)", () => {
  const r = runFile(WORK + "\nthrow new Error('a failing test file');");
  assert.notEqual(r.status, 0);
  assert.match(r.err, /a failing test file/);
  assert.deepEqual(r.left, ["mandarin-test-slots"]);
});
