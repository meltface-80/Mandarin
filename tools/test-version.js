#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * A test build's version (bug list item 141): what dev's builds call themselves, so Settings and the app say which
 * test build is installed, and the release after it is offered over it by the updaters (1.1.4-t7 < 1.1.4). The next
 * release's number (package.json's, its last number one up) with -tN, N the commits on this branch since that release
 * was tagged (first parent only: one each merged pull request; merge commits left out, so bringing the release back
 * from main counts for nothing and the first pull request after a release is -t1, item 161). Nothing is committed: the build stamps it as it builds
 * (.github/workflows/docker-publish.yml, android.yml). package.json's "nextVersion", when later than the release, names the
 * next release instead (the owner's word: dev's builds after v1.1.5 are 1.1.7-tN).
 *   node tools/test-version.js      the version for this checkout, e.g. 1.1.4-t7
 */
const { execFileSync } = require("child_process");
const path = require("path");

/**
 * [released]'s test build number [count]: "1.1.3", 7 → "1.1.4-t7". A version already before its release ("1.2.0-rc1")
 * keeps its numbers ("1.2.0-t7"); none counted yet, the version as it is. [next], a release later than [released], is
 * the one numbered ("1.1.5", 3, "1.1.7" → "1.1.7-t3"); one that isn't later is passed over.
 * @param {string} released @param {number} count @param {string} [next] @returns {string}
 */
function testVersion(released, count, next) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(-[^+]+)?/.exec(String(released).trim());
  if (!m) throw new Error("not a version: " + released);
  if (!(count > 0)) return m[0].replace(/^v/, "");
  const n = next ? /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(next).trim()) : null;
  if (next && !n) throw new Error("not a release: " + next);
  if (n && later(n.slice(1, 4).map(Number), m.slice(1, 4).map(Number))) return `${n[1]}.${n[2]}.${n[3]}-t${count}`;
  const patch = m[4] ? Number(m[3]) : Number(m[3]) + 1;
  return `${m[1]}.${m[2]}.${patch}-t${count}`;
}

/** [a] after [b], each [major, minor, patch]. @param {number[]} a @param {number[]} b */
function later(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The commits on HEAD since [tag] (all of HEAD's when the tag isn't here), merges not counted. @param {string} tag @param {string} cwd */
function commitsSince(tag, cwd) {
  const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let range = "HEAD";
  try { git("rev-parse", "--verify", "--quiet", tag + "^{commit}"); range = tag + "..HEAD"; } catch { /* no such tag: every commit */ }
  return Number(git("rev-list", "--count", "--first-parent", "--no-merges", range));
}

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const pkg = require(path.join(root, "package.json"));
  process.stdout.write(testVersion(pkg.version, commitsSince("v" + pkg.version, root), pkg.nextVersion) + "\n");
}

module.exports = { testVersion, commitsSince };
