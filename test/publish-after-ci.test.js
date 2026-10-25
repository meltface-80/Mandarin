"use strict";
/*
 * What reaches the owner from dev waits for CI, and a newer build is never overwritten by an older (bug list item 175).
 * dev's server image waited for CI on its commit (docker-publish.yml); dev's test APK did not: android.yml's wait ran
 * on main only, so a dev commit whose tests failed still reached the phone. Neither workflow had a concurrency group,
 * so an older run finishing late could put its :dev image or its test APK over a newer one's. And the release ran the
 * whole Node suite once, where CI runs a file that failed under load once more on its own (.github/retry-failed.sh).
 * The workflows are read here as written: each step's `if:` worked out the way GitHub does for the pushes that matter.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const WF = path.join(__dirname, "..", ".github", "workflows");
const read = name => fs.readFileSync(path.join(WF, name), "utf8");

// A job's steps, as written: each step's name, `if:` and `run:` (a block or one line).
function steps(text, job) {
  const at = text.indexOf(`\n  ${job}:\n`);
  assert.ok(at >= 0, `a job ${job}`);
  const lines = text.slice(at + 1).split("\n").slice(1);
  const end = lines.findIndex(l => /^ {2}\S/.test(l));
  const out = [];
  for (const line of end < 0 ? lines : lines.slice(0, end)) {
    if (/^ {6}- /.test(line)) out.push({ name: "", if: "", run: "", lines: [] });
    if (!out.length) continue;
    out[out.length - 1].lines.push(line.replace(/^ {6}- /, "        "));
  }
  for (const s of out) {
    for (const [i, l] of s.lines.entries()) {
      const m = /^ {8}(name|if|run): ?(.*)$/.exec(l);
      if (!m) continue;
      if (m[1] === "run" && m[2] === "|") {
        const body = [];
        for (const b of s.lines.slice(i + 1)) { if (b.trim() && !/^ {10}/.test(b)) break; body.push(b.slice(10)); }
        s.run = body.join("\n");
      } else s[m[1]] = m[2];
    }
  }
  return out;
}

// A GitHub expression, worked out for one push: github.event_name, github.ref, ==, !=, &&, ||, !, startsWith.
function holds(expr, ctx) {
  const js = expr.replace(/^\$\{\{\s*|\s*\}\}$/g, "").trim();
  if (!js) return true;
  assert.ok(/^(?:[\s()!&|=]|github\.(?:event_name|ref)\b|startsWith\b|true|false|,|'[^']*')*$/.test(js), `an expression read here: ${js}`);
  return vm.runInNewContext(js.replace(/github\.event_name/g, "event").replace(/github\.ref/g, "ref").replace(/([!=])=/g, "$1=="),
    { event: ctx.event, ref: ctx.ref, startsWith: (a, b) => String(a).startsWith(b) });
}

const PUSHES = {
  dev: { event: "push", ref: "refs/heads/dev" },
  main: { event: "push", ref: "refs/heads/main" },
  branch: { event: "push", ref: "refs/heads/175-dev-apk-after-ci" },
  oldTestBranch: { event: "push", ref: "refs/heads/claude/v0.8.1" },
  pr: { event: "pull_request", ref: "refs/pull/1/merge" },
  tag: { event: "push", ref: "refs/tags/v1.2.0" }
};
const WAIT = /^\.github\/wait-for-ci\.sh "\$GITHUB_SHA"$/;

test("an APK is published, to dev's test build or main's dist/, only after CI has passed on its commit", () => {
  const apk = steps(read("android.yml"), "apk");
  const publishes = apk.filter(s => /gh release upload|publish-apk\.sh/.test(s.run));
  assert.ok(publishes.length >= 2, "the test build's upload and main's dist/");
  // android.yml on dev, run by itself or called from android-dev.yml (item 170): either way GitHub gives it the
  // push's event and ref, which is all its `if:`s read.
  for (const [what, ctx] of Object.entries(PUSHES)) {
    for (const p of publishes.filter(s => holds(s.if, ctx))) {
      const before = apk.slice(0, apk.indexOf(p));
      assert.ok(before.some(s => WAIT.test(s.run.trim()) && holds(s.if, ctx)),
        `"${p.name}" runs on a ${what} push after a wait for CI on the same push`);
    }
  }
  assert.ok(publishes.some(p => holds(p.if, PUSHES.dev)), "dev's APK is still published");
});

test("a newer build's :dev image or test APK is never overwritten by an older run; main's are never cut short", () => {
  for (const [name, prefix] of [["android.yml", "android-"], ["docker-publish.yml", "image-"]]) {
    const m = /^concurrency:\n {2}group: (.*)\n {2}cancel-in-progress: (.*)\n/m.exec(read(name));
    assert.ok(m, `${name} has a concurrency group of its own`);
    // Per ref, with its own name: a called android.yml sees the caller's github.workflow, so not that.
    assert.equal(m[1], `${prefix}\${{ github.ref }}`, name);
    const cancels = what => holds(m[2], PUSHES[what]);
    for (const what of ["dev", "branch", "pr"]) assert.equal(cancels(what), true, `${name}: a newer ${what} run cancels the older`);
    for (const what of ["main", "tag"]) assert.equal(cancels(what), false, `${name}: a ${what} run is never cancelled mid-way`);
  }
});

// The release's test step, run as GitHub runs it (bash -e) with each command it calls stood in for.
function releaseTests(npmTest, retry) {
  const step = steps(read("release.yml"), "release").find(s => /npm test/.test(s.run));
  assert.ok(step, "the release runs the Node suite");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-reltest-"));
  const log = path.join(dir, "calls");
  const stub = (file, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), `#!/usr/bin/env bash\necho "${file} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
  };
  stub("bin/npm", `[ "$1" = test ] && { echo "not ok 1 - a race"; exit ${npmTest}; }; exit 0`);
  stub(".github/failed-tests.sh", "grep -q 'not ok 1 - a race' \"$1\" || exit 9");
  stub(".github/retry-failed.sh", `grep -q 'not ok 1 - a race' "$1" || exit 9; exit ${retry}`);
  stub(".github/csharp-tests.sh", "exit 0");
  fs.writeFileSync(path.join(dir, "step.sh"), step.run);
  const r = spawnSync("bash", ["-e", "step.sh"], { cwd: dir, encoding: "utf8",
    env: Object.assign({}, process.env, { PATH: path.join(dir, "bin") + path.delimiter + process.env.PATH, RUNNER_TEMP: dir }) });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n").map(l => l.split(" ")[0]) : [];
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, calls };
}

test("the release runs a test file that failed under load once more on its own, as CI does", () => {
  const green = releaseTests(0, 1);
  assert.equal(green.code, 0);
  assert.ok(!green.calls.includes(".github/retry-failed.sh"), "nothing run again when the suite passed");
  assert.ok(green.calls.includes(".github/csharp-tests.sh"));

  const race = releaseTests(1, 0);
  assert.equal(race.code, 0, "failed in the run, passed on its own: the release goes on");
  assert.deepStrictEqual(race.calls.filter(c => c.startsWith(".github/")),
    [".github/failed-tests.sh", ".github/retry-failed.sh", ".github/csharp-tests.sh"], "said again, run again, then the C# suite");

  const red = releaseTests(1, 1);
  assert.notEqual(red.code, 0, "failing again on its own: no release");
  assert.ok(!red.calls.includes(".github/csharp-tests.sh"), "stopped there");
});
