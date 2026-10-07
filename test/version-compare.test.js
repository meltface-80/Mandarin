"use strict";
// Release candidates (v0.6.0-RC1): the server's updater must move forward
// through them and on to the release, never sideways or back.
const test = require("node:test");
const assert = require("node:assert");
const { cmpVer } = require("../lib/updater");

test("release candidates order before their release, and by number", () => {
  assert.equal(cmpVer("0.6.0-RC1", "0.5.58"), 1);
  assert.equal(cmpVer("0.6.0", "0.6.0-RC1"), 1);
  assert.equal(cmpVer("0.6.0-RC1", "0.6.0"), -1);
  assert.equal(cmpVer("0.6.0-RC2", "0.6.0-RC1"), 1);
  assert.equal(cmpVer("0.6.0-RC10", "0.6.0-RC2"), 1);
  assert.equal(cmpVer("v0.6.0-RC1", "0.6.0-rc1"), 0);
  assert.equal(cmpVer("0.6.1", "0.6.0"), 1);
});

test("an update unpacks into a folder whose path has a space in it", () => {
  const fs = require("fs"), os = require("os"), path = require("path");
  const { execFileSync } = require("child_process");
  const { extract } = require("../lib/updater");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd update "));
  const src = path.join(root, "src dir", "mandarin-1.0.0");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, "index.js"), "// new");
  const tgz = path.join(root, "down load.tgz");
  execFileSync("tar", ["-czf", tgz, "-C", path.join(root, "src dir"), "mandarin-1.0.0"]);
  const out = path.join(root, "ex tract");
  fs.mkdirSync(out);
  assert.equal(extract(tgz, out), true, "tar was given the paths whole");
  assert.equal(fs.readFileSync(path.join(out, "mandarin-1.0.0", "index.js"), "utf8"), "// new");
  fs.rmSync(root, { recursive: true, force: true });
});
