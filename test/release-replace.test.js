"use strict";
/*
 * A version released already, made again (item 379): Run workflow on Release with "replace" makes the version's builds
 * from this commit and puts them, and its notes, in place of the ones it has, leaving which release is latest as it is,
 * so a fix can be folded into a version without a new number (1.2.3's in-app update in Docker, item 378). Without it a
 * version released already keeps the builds it has: the release step skips what is there. The version step, the Mac's
 * step and the notes' step are run here as GitHub runs them, with gh stood in for.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const yml = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");

// Job [name]'s block, and step [step]'s `run: |` script in it, its ${{ }} filled from [fill].
function job(name) {
  const at = yml.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, "a job " + name);
  const lines = yml.slice(at + 1).split("\n").slice(1);
  const end = lines.findIndex(l => /^ {2}\S/.test(l));
  return (end < 0 ? lines : lines.slice(0, end)).join("\n");
}
function step(block, name) {
  const lines = block.split("\n");
  const at = lines.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, "a step " + name);
  const head = lines.slice(at, lines.findIndex((l, i) => i > at && /^ {8}run: \|$/.test(l)) + 1).join("\n");
  const start = lines.findIndex((l, i) => i > at && /^ {8}run: \|$/.test(l));
  const body = [];
  for (const l of lines.slice(start + 1)) { if (l.trim() && !/^ {10}/.test(l)) break; body.push(l.slice(10)); }
  return { head, script: body.join("\n").replace(/\$\{\{ steps\.v\.outputs\.version \}\}/g, "1.2.3") };
}

// [script] run with gh answering as a release v1.2.3 that has [assets]; what gh was asked, and the step's outputs.
function runStep(script, env, assets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-replace-"));
  try {
    const log = path.join(dir, "gh-calls"), out = path.join(dir, "out");
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$*" in
  "release view v1.2.3 --json assets -q .assets[].name") printf '%s\\n' ${assets.map(a => `"${a}"`).join(" ")} ;;
  "release view v1.2.3") exit 0 ;;
  "release view "*) exit 1 ;;
esac
exit 0
`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
    fs.writeFileSync(path.join(dir, "step.sh"), script);
    const r = spawnSync("bash", ["-e", "step.sh"], { cwd: dir, encoding: "utf8",
      env: Object.assign({}, process.env, { PATH: path.join(dir, "bin") + path.delimiter + process.env.PATH, GITHUB_OUTPUT: out, GITHUB_REF_TYPE: "branch", GITHUB_REF_NAME: "main" }, env) });
    const outputs = fs.existsSync(out) ? Object.fromEntries(fs.readFileSync(out, "utf8").trim().split("\n").map(l => l.split("="))) : {};
    return { code: r.status, err: r.stderr, outputs, calls: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const ALL = ["musicd-server-1.2.3.tar.gz", "mandarin-server.sha256", "mandarin-server-linux-x64.gz", "mandarin-server-osx-arm64.gz", "mandarin-server-osx-x64.gz"];

test("Run workflow can replace a version released already; a tag pushed never does", () => {
  assert.match(yml, /workflow_dispatch:\n {4}inputs:\n(?: {6}#.*\n)* {6}replace:\n {8}description: "[^"]+"\n {8}type: boolean\n {8}default: false/);
  const v = step(job("release"), "Is this version released yet?");
  assert.match(v.head, /REPLACE: \$\{\{ github\.event\.inputs\.replace \}\}/, "the input given to the version step");
});

test("replaced: the builds made again and the notes too, latest left alone", () => {
  const v = step(job("release"), "Is this version released yet?");
  const r = runStep(v.script, { REPLACE: "true" }, ALL);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.outputs.exists, r.outputs.replace, r.outputs.bundle, r.outputs.csharp], ["true", "true", "false", "false"], "every build made again: " + JSON.stringify(r.outputs));
  const notes = step(job("release"), "Replace the notes of a release replaced");
  assert.match(notes.head, /if: steps\.v\.outputs\.replace == 'true'/);
  const n = runStep(notes.script, {}, ALL);
  assert.equal(n.code, 0, n.err);
  assert.equal(n.calls.trim(), "release edit v1.2.3 --notes-file notes.md", "its notes put in place, and nothing said of latest");
  // The builds go up over the ones there (--clobber), by the step that adds what a release lacks.
  assert.match(step(job("release"), "Add the C# server to a release without it").script, /gh release upload "v\$v" out\/csharp\/\* --clobber/);
  assert.doesNotMatch(yml.slice(yml.indexOf("Replace the notes")), /--latest/, "latest never set by a replace");
});

test("not replaced: a version released already keeps its builds, as before", () => {
  const v = step(job("release"), "Is this version released yet?");
  for (const replace of ["", "false"]) {
    const r = runStep(v.script, { REPLACE: replace }, ALL);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual([r.outputs.exists, r.outputs.replace, r.outputs.bundle, r.outputs.csharp], ["true", undefined, "true", "true"], `REPLACE="${replace}": ` + JSON.stringify(r.outputs));
  }
});

test("the Mac's builds made again when replacing, kept otherwise", () => {
  const mac = step(job("mac"), "Build and add the Mac's C# server");
  assert.match(mac.head, /REPLACE: \$\{\{ github\.event\.inputs\.replace \}\}/);
  // Only the check at its top: where it says the Mac's builds are there already and stops, or goes on to build them.
  const check = mac.script.split("\n").slice(0, mac.script.split("\n").findIndex(l => l.startsWith("mkdir -p out/mac"))).join("\n");
  assert.match(runStep(check + "\necho building", { REPLACE: "" }, ALL).calls, /release view v1\.2\.3 --json assets/);
  const kept = spawnLike(check, "", ALL), made = spawnLike(check, "true", ALL);
  assert.match(kept, /has the Mac's builds already/);
  assert.match(made, /building/);
});

function spawnLike(check, replace, assets) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-replace-mac-"));
  try {
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/usr/bin/env bash\nprintf '%s\\n' ${assets.map(a => `"${a}"`).join(" ")}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "bin", "node"), `#!/usr/bin/env bash\necho 1.2.3\n`, { mode: 0o755 });
    const r = spawnSync("bash", ["-c", check + "\necho building"], { cwd: dir, encoding: "utf8",
      env: Object.assign({}, process.env, { PATH: path.join(dir, "bin") + path.delimiter + process.env.PATH, REPLACE: replace }) });
    return r.stdout + r.stderr;
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
