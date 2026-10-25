"use strict";
/*
 * .github/wait-for-ci.sh, which the release, the image and the APK wait on:
 * nothing is published before CI has passed on the commit. A commit that only
 * publishes the APK (dist/, android.yml's own) starts no CI of its own, so its
 * parent's stands for it (bug list item 166: the v1.1.8 release waited ten
 * minutes for a run that never came, and failed). Run here against a stand-in
 * `gh` that answers as GitHub does, its --jq filters through the real jq.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.join(__dirname, "..", ".github", "wait-for-ci.sh");
const haveJq = spawnSync("jq", ["--version"]).status === 0;

// The commits as GitHub's API has them, and the CI runs pushed for each.
const COMMITS = {
  apk: { files: [{ filename: "dist/latest.json" }, { filename: "dist/mandarin-android.apk" }], parents: [{ sha: "merge" }] },
  merge: { files: [{ filename: "package.json" }, { filename: "CHANGELOG.md" }], parents: [{ sha: "a" }, { sha: "b" }] },
  mixed: { files: [{ filename: "dist/latest.json" }, { filename: "tools/test-version.js" }], parents: [{ sha: "merge" }] },
  lonely: { files: [{ filename: "README.md" }], parents: [{ sha: "merge" }] }
};
const RUNS = { merge: "completed success https://ci/merge" };

function fakeGh(dir) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, "commits.json"), JSON.stringify(COMMITS));
  fs.writeFileSync(path.join(dir, "runs.json"), JSON.stringify(RUNS));
  // gh api repos/{owner}/{repo}/commits/<sha> --jq <filter>  |  gh run list ... --commit <sha> ...
  fs.writeFileSync(path.join(bin, "gh"), `#!/usr/bin/env bash
set -u
dir=${JSON.stringify(dir)}
if [ "$1" = api ]; then
  sha=\${2##*/}; shift 2
  [ "$1" = --jq ] || exit 2
  jq -e --arg s "$sha" '.[$s]' "$dir/commits.json" >/dev/null || { echo '{"message":"Not Found"}' >&2; exit 1; }
  jq -r --arg s "$sha" ".[\\$s] | $2" "$dir/commits.json"
  exit
fi
if [ "$1" = run ]; then
  while [ $# -gt 0 ]; do [ "$1" = --commit ] && sha=$2; shift; done
  jq -r --arg s "$sha" '.[$s] // empty' "$dir/runs.json"
  exit
fi
exit 2
`, { mode: 0o755 });
  return bin;
}

function wait(sha) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-waitci-"));
  const bin = fakeGh(dir);
  const r = spawnSync("bash", [SCRIPT, sha], { encoding: "utf8", timeout: 60000,
    env: Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH, WAIT_FOR_CI_PAUSE: "0" }) });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

test("the APK's own commit on main: its parent's CI stands for it", { skip: !haveJq && "jq is not installed" }, () => {
  const r = wait("apk");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /apk only publishes the APK \(dist\/\): CI on merge stands for it/);
  assert.match(r.out, /ci\.yml passed on merge/);
});

test("a commit with CI of its own is waited on as before", { skip: !haveJq && "jq is not installed" }, () => {
  const r = wait("merge");
  assert.equal(r.code, 0, r.out);
  assert.doesNotMatch(r.out, /stands for it/, "a merge commit is never passed over");
});

test("anything else in the commit, or no CI at all: not published", { skip: !haveJq && "jq is not installed" }, () => {
  const mixed = wait("mixed");
  assert.equal(mixed.code, 1, "dist/ and code together: its own CI, which never came");
  assert.match(mixed.out, /No ci\.yml run on mixed after 10 minutes/);
  const lonely = wait("lonely");
  assert.equal(lonely.code, 1);
  assert.match(lonely.out, /No ci\.yml run on lonely/);
});
