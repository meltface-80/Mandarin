"use strict";
/*
 * A numbered Mandarin Bridge release has every Bridge's build (item 294, .github/workflows/bridge-release.yml): it
 * built and published the Android APK alone, so a numbered Mandarin, which offers its Bridges the newest
 * mandarin-bridge-v… release, had nothing for a Linux Bridge or a Pi. The workflow is read here as written: its jobs,
 * and its release step run as GitHub runs it (bash -e) with gh stood in for, on builds of the test's own.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const WF = path.join(ROOT, ".github", "workflows");
const read = name => fs.readFileSync(path.join(WF, name), "utf8");

// Job [job]'s block in workflow [text], as written.
function job(text, name) {
  const at = text.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, `a job ${name}`);
  const lines = text.slice(at + 1).split("\n").slice(1);
  const end = lines.findIndex(l => /^ {2}\S/.test(l));
  return (end < 0 ? lines : lines.slice(0, end)).join("\n");
}

// Step [name]'s `run: |` block in job [block].
function run(block, name) {
  const lines = block.split("\n");
  const at = lines.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `a step ${name}`);
  const start = lines.findIndex((l, i) => i > at && /^ {8}run: \|$/.test(l));
  const body = [];
  for (const l of lines.slice(start + 1)) { if (l.trim() && !/^ {10}/.test(l)) break; body.push(l.slice(10)); }
  return body.join("\n");
}

const V = "0.2.1";
const BUILDS = ["mandarin-bridge-linux-x64.tar.gz", "mandarin-bridge-linux-arm64.tar.gz", "mandarin-bridge-pi-arm64.img.xz"];

// The release step run with the builds in [out] (file → contents; a .json its sidecar's version): what gh was asked,
// and the install.sh it made.
function release(out) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-release-"));
  try {
    fs.mkdirSync(path.join(dir, "bridge", "linux"), { recursive: true });
    for (const f of ["bridge/sidecar.sh", "bridge/linux/install.sh", "bridge/CHANGELOG.md"]) fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    fs.chmodSync(path.join(dir, "bridge", "sidecar.sh"), 0o755);
    fs.mkdirSync(path.join(dir, "out", "Mandarin-Bridge-" + V + ".apk-artifact"), { recursive: true });
    fs.writeFileSync(path.join(dir, "out", "Mandarin-Bridge-" + V + ".apk-artifact", "Mandarin-Bridge-" + V + ".apk"), "apk");
    for (const [f, v] of Object.entries(out)) {
      fs.writeFileSync(path.join(dir, "out", f), f.endsWith(".json") ? JSON.stringify({ commit: "abc1234", version: v, sha256: "0".repeat(64) }) : v);
    }
    const log = path.join(dir, "gh-calls");
    fs.mkdirSync(path.join(dir, "bin"));
    fs.writeFileSync(path.join(dir, "bin", "gh"), `#!/usr/bin/env bash\nprintf '%s\\n' "$@" > "${log}"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "step.sh"), run(job(read("bridge-release.yml"), "release"), "Tag and release"));
    const r = spawnSync("bash", ["-e", "step.sh"], { cwd: dir, encoding: "utf8",
      env: Object.assign({}, process.env, { PATH: path.join(dir, "bin") + path.delimiter + process.env.PATH, VERSION: V, GITHUB_SHA: "abc1234def5678" }) });
    const gh = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : null;
    const install = fs.existsSync(path.join(dir, "install.sh")) ? fs.readFileSync(path.join(dir, "install.sh"), "utf8") : null;
    return { code: r.status, err: r.stdout + r.stderr, gh, install };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const every = () => Object.fromEntries(BUILDS.flatMap(f => f.endsWith(".tar.gz") ? [[f, "tar"], [f + ".json", V]] : [[f, "img"]]));

test("a numbered Bridge release builds every Bridge, and publishes each with what Mandarin reads", () => {
  // The Linux builds and the Pi image built with the APK, by their own workflows, before the release.
  const wf = read("bridge-release.yml");
  assert.match(job(wf, "linux"), /uses: \.\/\.github\/workflows\/bridge-linux\.yml/);
  assert.match(job(wf, "pi"), /uses: \.\/\.github\/workflows\/bridge-pi\.yml/);
  assert.match(job(wf, "release"), /needs: \[build, linux, pi\]/);
  for (const f of ["bridge-linux.yml", "bridge-pi.yml", "bridge.yml"]) assert.match(read(f), /\n {2}workflow_call:\n/, f + " can be called");

  const r = release(every());
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.gh.slice(0, 3), ["release", "create", "mandarin-bridge-v" + V]);
  const files = r.gh.slice(3, r.gh.indexOf("--title"));
  assert.deepEqual(files.map(f => path.basename(f)).sort(), ["Mandarin-Bridge-" + V + ".apk", "install.sh", "mandarin-bridge-linux-arm64.tar.gz",
    "mandarin-bridge-linux-arm64.tar.gz.json", "mandarin-bridge-linux-x64.tar.gz", "mandarin-bridge-linux-x64.tar.gz.json",
    "mandarin-bridge-pi-arm64.img.xz", "mandarin-bridge.apk", "mandarin-bridge.apk.json"]);
  assert.ok(r.gh.includes("--latest=false"), "never Mandarin's latest");
  // Its install line fetches from this release, not the rolling test build.
  assert.match(r.install, new RegExp(`releases/download/mandarin-bridge-v${V.replace(/\./g, "\\.")}\\b`));
  assert.doesNotMatch(r.install, /test-bridge/);
});

test("a numbered Bridge release that would lack a build, or hold another version's, isn't made", () => {
  const old = Object.assign(every(), { "mandarin-bridge-linux-arm64.tar.gz.json": "1.1.14" });
  let r = release(old);
  assert.notEqual(r.code, 0);
  assert.equal(r.gh, null, "nothing released");
  assert.match(r.err, /linux-arm64 was built as another version/);

  const noPi = every();
  delete noPi["mandarin-bridge-pi-arm64.img.xz"];
  r = release(noPi);
  assert.notEqual(r.code, 0);
  assert.equal(r.gh, null);
  assert.match(r.err, /mandarin-bridge-pi-arm64\.img\.xz was not built/);
});
