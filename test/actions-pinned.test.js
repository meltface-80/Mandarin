"use strict";
/*
 * Every action a workflow uses is pinned to a commit, not a tag (item 365, the security audit's fourteenth finding). A
 * tag (actions/checkout@v7) can be moved by whoever holds the action's repository, and the release and image jobs hold
 * the signing key and the registry's login: a moved tag would run someone else's code with both. Each action is named
 * by its full commit SHA, its version in a comment beside it, and Dependabot keeps them up to date.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "..", ".github", "workflows");

test("every action a workflow uses: pinned to a full commit SHA, its version beside it", () => {
  const loose = [];
  let pinned = 0;
  for (const f of fs.readdirSync(DIR).filter(n => /\.ya?ml$/.test(n))) {
    for (const [i, line] of fs.readFileSync(path.join(DIR, f), "utf8").split("\n").entries()) {
      const m = /^\s*-?\s*uses:\s*(\S+)(.*)$/.exec(line);
      if (!m || m[1].startsWith("./")) continue;   // a workflow of this repository's own
      if (/@[0-9a-f]{40}$/.test(m[1]) && /#\s*v\d/.test(m[2])) pinned++;
      else loose.push(`${f}:${i + 1} ${m[1]}${m[2]}`);
    }
  }
  assert.deepEqual(loose, [], "pinned to a commit, with its version in a comment");
  assert.ok(pinned > 20, "the workflows' actions found: " + pinned);
});

test("Dependabot keeps the pinned actions up to date", () => {
  const conf = fs.readFileSync(path.join(__dirname, "..", ".github", "dependabot.yml"), "utf8");
  assert.match(conf, /package-ecosystem:\s*"?github-actions"?/);
  assert.match(conf, /directory:\s*"?\/"?/);
});
