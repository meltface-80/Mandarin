"use strict";
/*
 * Test builds' versions (bug list item 141; tools/test-version.js): the next release with -tN, N the commits since the
 * last release; and the page's updater orders them as the server's and the app's do (public/app/updater.js's
 * __verNewer): after the last release, counting up, and before their own release.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { testVersion, commitsSince } = require("../tools/test-version");

test("a test build is the next release with -tN", () => {
  assert.equal(testVersion("1.1.3", 7), "1.1.4-t7");
  assert.equal(testVersion("v1.1.3", 1), "1.1.4-t1");
  assert.equal(testVersion("1.9.9", 12), "1.9.10-t12");
  assert.equal(testVersion("1.2.0-rc1", 3), "1.2.0-t3", "a version before its release keeps its numbers");
  assert.equal(testVersion("1.1.3", 0), "1.1.3", "nothing since the release: the release");
  assert.throws(() => testVersion("dev", 3));
  // This checkout: a number, whatever its history.
  assert.ok(Number.isInteger(commitsSince("v0.0.0-none", path.join(__dirname, ".."))));
});

test("the page's updater: a test build after the last release, before its own", () => {
  // __verNewer as the page defines it, without the rest of the updater.
  const src = fs.readFileSync(path.join(__dirname, "../public/app/updater.js"), "utf8");
  const start = src.indexOf("window.__verNewer = ");
  const end = src.indexOf("\n  };\n", start) + 5;
  assert.ok(start > 0 && end > start, "__verNewer found in updater.js");
  const window = {};
  vm.runInNewContext(src.slice(start, end), { window });
  const newer = /** @type {(a: string, b: string) => boolean} */ (window.__verNewer);
  assert.equal(newer("1.1.4-t1", "1.1.3"), true);
  assert.equal(newer("1.1.4-t2", "1.1.4-t1"), true);
  assert.equal(newer("1.1.4-t10", "1.1.4-t9"), true);
  assert.equal(newer("1.1.4", "1.1.4-t7"), true, "the release is offered over its test build");
  assert.equal(newer("1.1.3", "1.1.4-t7"), false, "the last release isn't");
});
