"use strict";
/*
 * The release tests on a runner made ready as CI makes its own (item 295, .github/workflows/release.yml): the Release
 * of v1.2.0 failed its tests, and nothing was released, because release.yml had fallen behind ci.yml: SQ-tool's numpy
 * (item 288) and Mandarin Bridge for Linux's build (item 282) were added to CI's test job alone, so on the release's
 * runner SQ-tool's tests had no SQ-tool (503) and the Bridge's had no Bridge. Both workflows are read here as written.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const WF = path.join(__dirname, "..", ".github", "workflows");
const read = name => fs.readFileSync(path.join(WF, name), "utf8");

// Job [name]'s block in workflow [text], as written.
function job(text, name) {
  const at = text.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, `a job ${name}`);
  const lines = text.slice(at + 1).split("\n").slice(1);
  const end = lines.findIndex(l => /^ {2}\S/.test(l));
  return (end < 0 ? lines : lines.slice(0, end)).join("\n");
}

// A job's steps: each step's name and the commands of its `run:` (a block or one line), as written.
function steps(block) {
  const out = [];
  for (const line of block.split("\n")) {
    if (/^ {6}- /.test(line)) out.push({ name: "", run: [] });
    if (!out.length) continue;
    const s = out[out.length - 1];
    const l = line.replace(/^ {6}- /, "        ");
    const m = /^ {8}(name|run): ?(.*)$/.exec(l);
    if (m && m[1] === "name") s.name = m[2];
    else if (m && m[2] !== "|") s.run.push(m[2].trim());
    else if (/^ {10}\S/.test(l) && s.inRun) s.run.push(l.trim());
    if (m) s.inRun = m[1] === "run" && m[2] === "|";
    else if (/^ {8}\S/.test(l)) s.inRun = false;
  }
  return out;
}

// What CI's test job does before its tests that is only CI's own: the page's syntax, not something a test uses; and
// Mandarin OS's ffmpeg, built only when Mandarin OS's workflows run the suite with it (item 389), never for a release,
// which tests with the usual ffmpeg as CI does on every push.
const CI_ONLY = ["Syntax check of the page", "Mandarin OS's ffmpeg (os/ffmpeg/build.sh)"];

test("the release makes its runner ready for the tests as CI does, before it tests", () => {
  const ci = steps(job(read("ci.yml"), "test"));
  const before = ci.slice(0, ci.findIndex(s => s.run.some(c => /npm run test/.test(c))));
  assert.ok(before.length > 5, "CI's steps before its tests");
  const release = job(read("release.yml"), "release");
  const tests = release.indexOf("npm test");
  assert.ok(tests > 0, "the release runs the Node suite");
  const ready = release.slice(0, tests);
  for (const s of before.filter(s => s.run.length && !CI_ONLY.includes(s.name))) {
    for (const c of s.run) assert.ok(ready.includes(c), `the release does what CI's "${s.name || c}" does, before its tests: ${c}`);
  }
  // The two it lacked, by name.
  assert.match(ready, /python3 -m pip install --quiet numpy/);
  assert.match(ready, /\.\/bridge\/linux\/build\.sh/);
});
