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
