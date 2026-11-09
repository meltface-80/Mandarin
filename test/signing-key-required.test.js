"use strict";
/*
 * A build that may be published is never signed with the debug key committed to the repository (item 364, the security
 * audit's tenth finding). Anyone can sign an APK with that key, and a phone with a build signed by it would take such an
 * APK as an update. The app's and Mandarin Bridge's workflows signed with it whenever MUSICD_KEYSTORE_BASE64 was missing;
 * now that fails the build, but for a pull request's, which is never published (a fork's or Dependabot's are given no
 * secrets). Each workflow's own step is run here as GitHub runs it, for each kind of run.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");

// The step's script, as written under its "run: |", its indentation taken off.
function step(workflow, name) {
  const lines = fs.readFileSync(path.join(ROOT, ".github", "workflows", workflow), "utf8").split("\n");
  const at = lines.findIndex(l => l.trim() === "- name: " + name);
  assert.ok(at >= 0, `${workflow} has the step "${name}"`);
  const run = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  const body = [];
  const indent = (lines[run + 1].match(/^\s*/) || [""])[0].length;
  for (let i = run + 1; i < lines.length && (lines[i].trim() === "" || (lines[i].match(/^\s*/) || [""])[0].length >= indent); i++) body.push(lines[i].slice(indent));
  return body.join("\n");
}

function run(script, event, key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signing-"));
  const out = path.join(dir, "out");
  fs.writeFileSync(out, "");
  const r = spawnSync("bash", ["-e", "-c", script], { env: { PATH: process.env.PATH, KEYSTORE_BASE64: key, GITHUB_EVENT_NAME: event, GITHUB_OUTPUT: out, RUNNER_TEMP: dir }, encoding: "utf8" });
  return { code: r.status, said: r.stdout + r.stderr, out: fs.readFileSync(out, "utf8") };
}

for (const workflow of ["android.yml", "bridge.yml"]) {
  test(`${workflow}: no signing key fails a build that may be published; a pull request's alone uses the debug key`, () => {
    const script = step(workflow, "Restore the signing key");
    for (const event of ["push", "workflow_dispatch", "workflow_call", "release"]) {
      const r = run(script, event, "");
      assert.equal(r.code, 1, `${event}, no key: fails (${r.said.trim()})`);
      assert.match(r.said, /::error::MUSICD_KEYSTORE_BASE64 is not set/);
      assert.doesNotMatch(r.out, /have_key=false/, "never told to sign with the debug key");
    }
    const pr = run(script, "pull_request", "");
    assert.equal(pr.code, 0, "a pull request's build, never published");
    assert.match(pr.out, /have_key=false/);
    const keyed = run(script, "push", Buffer.from("a keystore").toString("base64"));
    assert.equal(keyed.code, 0, "with the key: signed with it");
    assert.match(keyed.out, /have_key=true/);
    assert.match(keyed.out, /path=.*\.jks/);
  });
}

// Dependabot's branches (item 376): a push of one is given no secrets and isn't a pull request, so it would fail for the
// missing key (red on every update it proposes); its pull request builds the same commit with the debug key instead.
for (const workflow of ["android.yml", "bridge.yml"]) {
  test(`${workflow}: Dependabot's pushes left to its pull request`, () => {
    const yml = fs.readFileSync(path.join(ROOT, ".github", "workflows", workflow), "utf8");
    const push = /\n {2}push:\n(?: {4}#.*\n)* {4}branches: \[([^\]]*)\]/.exec(yml);
    assert.ok(push, "a push trigger with branches");
    assert.ok(push[1].includes('"!dependabot/**"'), "Dependabot's branches left out of the push trigger: " + push[1]);
    assert.ok(push[1].includes('"**"'), "every other branch still built on push");
    assert.match(yml, /\n {2}pull_request:\n/, "pull requests, Dependabot's among them, still built");
  });
}
