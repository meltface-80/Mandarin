"use strict";
/*
 * The quality gates (docs/quality-plan.md): the file-length ratchet (an
 * allowance that only comes down, a cap, exemptions from the cap alone, the
 * stale audit, the edit-time hook) and the lint baseline's arithmetic. Each
 * run is on a synthetic tree under a real `git init`, as the gate measures
 * what git tracks.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const GATE = path.resolve(__dirname, "..", "tools", "quality", "file-length.js");
const { countLines, globToRegExp, lengthAfter } = require("../tools/quality/file-length");
const lint = require("../tools/quality/lint");

/* A repository with the gate's policy: [files] written and committed, the caps small enough to test. */
function repo(files, policy) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-gates-"));
  const git = (...a) => spawnSync("git", a, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  fs.mkdirSync(path.join(root, "tools", "quality"), { recursive: true });
  fs.writeFileSync(path.join(root, "tools", "quality", "policy.json"), JSON.stringify(Object.assign({
    include: ["src/**/*.js", "test/**/*.js"], exclude: [], tests: ["test/**"],
    length: { cap: 20, capTests: 30, watch: 10 }, exempt: {}
  }, policy)));
  for (const [p, lines] of Object.entries(files)) write(root, p, lines);
  git("add", "-A");
  git("commit", "-q", "-m", "tree");
  return root;
}
const write = (root, p, lines) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), typeof lines === "number" ? "x\n".repeat(lines) : lines); };
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { cwd: root, env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root }), encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim().split("\n").filter(Boolean), err: r.stderr.trim() };
};
const allowance = (root) => JSON.parse(fs.readFileSync(path.join(root, "tools", "quality", "allowance.json"), "utf8")).allowance;

test("lines and globs are counted as the gate counts them", () => {
  assert.deepEqual([countLines(""), countLines("a"), countLines("a\n"), countLines("a\nb"), countLines("a\nb\n")], [0, 1, 1, 2, 2]);
  const m = (g, p) => globToRegExp(g).test(p);
  assert.deepEqual([m("src/**/*.js", "src/a.js"), m("src/**/*.js", "src/x/y/a.js"), m("src/*.js", "src/x/a.js"), m("**/bin/**", "a/bin/b.js"), m("index.js", "index.js"), m("index.js", "lib/index.js")], [true, true, false, true, true, false]);
});

test("the ratchet: a file over the watch line needs an entry, grows past it never, shrinks with it", () => {
  const root = repo({ "src/small.js": 5, "src/big.js": 15 });
  let r = run(root);
  assert.deepEqual([r.code, r.out], [1, ["src/big.js: over watch line 10 (15 lines); run `node tools/quality/file-length.js accept src/big.js`", "node tools/quality/file-length.js accept"]]);
  assert.equal(run(root, "accept").code, 0);
  assert.deepEqual(allowance(root), { "src/big.js": { lines: 15 } });
  assert.deepEqual(run(root), { code: 0, out: [], err: "" }, "clean once accepted");
  // Grown: refused, and accept never raises the entry.
  write(root, "src/big.js", 17);
  r = run(root);
  assert.deepEqual([r.code, r.out], [1, ["src/big.js: grew past allowance (17 > 15); split it"]]);
  run(root, "accept");
  assert.deepEqual(allowance(root), { "src/big.js": { lines: 15 } }, "never raised");
  assert.equal(run(root).code, 1, "still refused");
  // Shrunk: the entry has to come down, and accept brings it down.
  write(root, "src/big.js", 12);
  r = run(root);
  assert.deepEqual([r.code, r.out[0]], [1, "src/big.js: shrank (12 < 15); run `node tools/quality/file-length.js accept src/big.js`"]);
  run(root, "accept", "src/big.js", "--reason", "the parser and its tables");
  assert.deepEqual(allowance(root), { "src/big.js": { lines: 12, reason: "the parser and its tables" } });
  assert.equal(run(root).code, 0);
  // Back under the watch line: the entry is stale and dropped.
  write(root, "src/big.js", 8);
  r = run(root);
  assert.deepEqual([r.code, r.out[0]], [1, "src/big.js: back under the watch line 10; drop it"]);
  run(root, "accept");
  assert.deepEqual(allowance(root), {});
});

test("the cap: refused unless exempt, and an exempt file is still ratcheted; tests have their own cap", () => {
  const root = repo({ "src/huge.js": 25, "test/long.test.js": 25, "test/longer.test.js": 35 }, { exempt: { "src/huge.js": "grandfathered" } });
  let r = run(root);
  assert.deepEqual([r.code, r.out], [1, [
    "src/huge.js: over watch line 10 (25 lines); run `node tools/quality/file-length.js accept src/huge.js`",
    "test/longer.test.js: test over cap 30 (35 lines)",
    "node tools/quality/file-length.js accept"
  ]], "exempt from the cap, in the ratchet; a test over its own cap, one under it fine");
  run(root, "accept");
  assert.deepEqual(allowance(root), { "src/huge.js": { lines: 25 } }, "a test path never gets an entry");
  write(root, "src/huge.js", 26);
  assert.deepEqual(run(root).out, ["src/huge.js: grew past allowance (26 > 25); split it", "test/longer.test.js: test over cap 30 (35 lines)"]);
  // Not exempt: the cap is said as well as the ratchet.
  const root2 = repo({ "src/huge.js": 25 });
  r = run(root2);
  assert.deepEqual(r.out.slice(0, 2), ["src/huge.js: over cap 20 (25 lines); split it", "src/huge.js: over watch line 10 (25 lines); run `node tools/quality/file-length.js accept src/huge.js`"]);
});

test("the stale audit: entries for files gone, untracked, or moved into tests are dropped", () => {
  const root = repo({ "src/a.js": 15, "src/b.js": 15 });
  run(root, "accept");
  fs.unlinkSync(path.join(root, "src", "a.js"));
  fs.mkdirSync(path.join(root, "test"));
  fs.renameSync(path.join(root, "src", "b.js"), path.join(root, "test", "b.js")); // moved into tests, not yet tracked there
  const r = run(root);
  assert.deepEqual([r.code, r.out], [1, ["src/a.js: allowance names a path outside the tree; drop it", "src/b.js: allowance names a path outside the tree; drop it", "node tools/quality/file-length.js accept"]]);
  run(root, "accept");
  assert.deepEqual(allowance(root), {});
  // Tracked under tests: stale for that reason.
  fs.writeFileSync(path.join(root, "tools", "quality", "allowance.json"), JSON.stringify({ version: 1, allowance: { "test/b.js": { lines: 15 } } }));
  spawnSync("git", ["add", "-A"], { cwd: root });
  assert.deepEqual(run(root).out[0], "test/b.js: allowance names a test path; drop it");
});

test("the edit-time hook: silent under the watch line, a notice over it, an edit that grows a file over its cap turned down", () => {
  const root = repo({ "src/big.js": 15, "src/huge.js": 25 }, { exempt: { "src/huge.js": "grandfathered" } });
  run(root, "accept");
  const hook = (input) => {
    const r = spawnSync(process.execPath, [GATE, "hook"], { cwd: root, env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root }), input: JSON.stringify({ tool_name: "Edit", tool_input: input }), encoding: "utf8" });
    return { code: r.status, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
  };
  const at = (p) => path.join(root, p);
  assert.deepEqual(hook({ file_path: at("src/new.js"), content: "x\n".repeat(5) }), { code: 0, json: null }, "under the watch line: nothing said");
  assert.deepEqual(hook({ file_path: at("README.md"), content: "x\n".repeat(50) }), { code: 0, json: null }, "not a file the gate measures");
  // Over the allowance: a notice, not a block.
  let r = hook({ file_path: at("src/big.js"), old_string: "x\n", new_string: "x\nx\nx\n" });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow");
  assert.match(r.json.hookSpecificOutput.additionalContext, /src\/big\.js: in the length ratchet at 15 lines; this edit takes it 15 → 17\. 2 lines over the allowance/);
  // Over the cap, not exempt: the edit that grows it is turned down; one that doesn't goes through with a notice.
  write(root, "src/wide.js", 22);
  r = hook({ file_path: at("src/wide.js"), old_string: "x\n", new_string: "x\nx\n" });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  assert.match(r.json.hookSpecificOutput.permissionDecisionReason, /src\/wide\.js: over the cap 20 \(this edit takes it 22 → 23\)\. Split it/);
  r = hook({ file_path: at("src/wide.js"), old_string: "x\nx\n", new_string: "x\n", replace_all: false });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow");
  // Exempt: grown past its entry is a notice, as the ratchet says at commit.
  r = hook({ file_path: at("src/huge.js"), content: "x\n".repeat(26) });
  assert.deepEqual([r.json.hookSpecificOutput.permissionDecision, /1 lines over the allowance/.test(r.json.hookSpecificOutput.additionalContext)], ["allow", true]);
  // What an edit does to the length is read from the edit itself.
  assert.deepEqual([lengthAfter({ content: "a\nb\n" }, ""), lengthAfter({ old_string: "b", new_string: "b\nc" }, "a\nb\n"), lengthAfter({ edits: [{ old_string: "a", new_string: "a\na" }, { old_string: "b", new_string: "" }] }, "a\nb\n"), lengthAfter({ old_string: "x", new_string: "y", replace_all: true }, "x\nx\n"), lengthAfter({}, "a\n")], [2, 3, 3, 2, null]);
});

test("the lint baseline: more of a rule in a file fails, fewer must be accepted, accept never raises", () => {
  const base = { "a.js": { "no-empty": 2, "no-undef": 1 }, "b.js": { "no-empty": 1 } };
  const now = { "a.js": { "no-empty": 3 }, "c.js": { "no-unused-vars": 1 } };
  assert.deepEqual(lint.compare(now, base), {
    over: [{ file: "a.js", rule: "no-empty", n: 3, b: 2 }, { file: "c.js", rule: "no-unused-vars", n: 1, b: 0 }],
    lower: [{ file: "a.js", rule: "no-undef", n: 0, b: 1 }, { file: "b.js", rule: "no-empty", n: 0, b: 1 }]
  });
  assert.deepEqual(lint.accept(now, base), { "a.js": { "no-empty": 2 } }, "lowered to what is there, dropped where clean, nothing new let in");
  assert.deepEqual(lint.compare({}, {}), { over: [], lower: [] });
});
