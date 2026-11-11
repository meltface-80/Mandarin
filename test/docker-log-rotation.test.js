"use strict";
/*
 * Docker's own copy of what the server prints, kept to 30 MB (item 389): the json-file driver keeps it whole, without
 * end, unless told; the server's real log is its own rolling files in the data volume. The compose file says so, and
 * so do both commands the install page writes (docs/install.js): docker run's --log-opt and the compose file's logging.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

test("Docker's copy of the server's output is rotated, in the compose file and the install page's commands", () => {
  const compose = fs.readFileSync(path.join(ROOT, "docker-compose.yml"), "utf8");
  assert.match(compose, /\n {2}musicd-server:\n(?: {4}.*\n|\s*#.*\n)*? {4}logging:\n {6}driver: json-file\n {6}options:\n {8}max-size: "10m"\n {8}max-file: "3"\n/);
  const install = fs.readFileSync(path.join(ROOT, "docs", "install.js"), "utf8");
  assert.match(install, /K\("--log-opt"\) \+ " max-size=10m " \+ K\("--log-opt"\) \+ " max-file=3/);
  assert.ok(install.includes(String.raw`"    logging:\n      driver: json-file\n      options:\n        max-size: \"10m\"\n        max-file: \"3\"\n"`), "the compose file the page writes");
});
