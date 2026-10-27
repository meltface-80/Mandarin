"use strict";
/*
 * Every regular expression in the Android app's Kotlin, read as Android reads
 * it. Android's java.util.regex is ICU's, stricter than the JVM's the core
 * tests run on: a brace that isn't a count ({2}, {1,3}) must be escaped, `}`
 * as well as `{`. The JVM takes `\{[^}]+}`; Android throws on it, and native
 * Now playing crashed on opening (bug list item 33). So each Regex("…")
 * literal under android/ is held to ICU's rule here. And ICU is slow to make
 * one: the Shelf's makes each of its patterns once, never on each call (item
 * 211: a pattern made for each title of a large library froze the screen).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "android");

function kotlinFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "build" && e.name !== "test") kotlinFiles(p, out); }
    else if (e.name.endsWith(".kt")) out.push(p);
  }
  return out;
}

/** The Regex("…") and "…".toRegex() literals in [src], their Kotlin escapes undone. */
function regexes(src) {
  const out = [];
  const lit = /(?:Regex\(\s*"((?:[^"\\]|\\.)*)"|"((?:[^"\\]|\\.)*)"\s*\.toRegex\()/g;
  for (let m; (m = lit.exec(src));) {
    const raw = m[1] !== undefined ? m[1] : m[2];
    out.push({ at: src.slice(0, m.index).split("\n").length, re: raw.replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c)) });
  }
  return out;
}

/** Where [re] has a brace ICU refuses (one that isn't a count, unescaped), or -1. */
function badBrace(re) {
  let inClass = false;
  for (let i = 0; i < re.length; i++) {
    const c = re[i];
    if (c === "\\") { i++; continue; }
    if (inClass) { if (c === "]") inClass = false; continue; }
    if (c === "[") { inClass = true; if (re[i + 1] === "^") i++; if (re[i + 1] === "]") i++; continue; }
    if (c === "{") {
      const q = /^\{\d+(,\d*)?\}/.exec(re.slice(i));
      if (!q || i === 0) return i;
      i += q[0].length - 1;
      continue;
    }
    if (c === "}") return i;
  }
  return -1;
}

test("ICU's rule: a brace not a count is refused unescaped", () => {
  assert.equal(badBrace("\\{[^}]+}"), 7, "Contract.label's, as it crashed");
  assert.equal(badBrace("\\{[^}]+\\}"), -1);
  assert.equal(badBrace("^\\d+:\\d{2}(:\\d{2})?$"), -1);
  assert.equal(badBrace("\\d{1,3}"), -1);
  assert.equal(badBrace("a{"), 1);
  assert.equal(badBrace("[{}]"), -1);
});

test("every regex in the Android app's Kotlin is one Android can compile", () => {
  const files = kotlinFiles(ROOT);
  assert.ok(files.length > 10, "the app's sources found");
  const bad = [];
  let n = 0;
  for (const f of files) {
    for (const { at, re } of regexes(fs.readFileSync(f, "utf8"))) {
      n++;
      const i = badBrace(re);
      if (i >= 0) bad.push(`${path.relative(ROOT, f)}:${at}: ${re} (index ${i})`);
    }
  }
  assert.ok(n > 5, "the app's regexes found");
  assert.deepEqual(bad, [], "escape each brace that isn't a count");
});

// Item 211: A → Z by album made three patterns for each title, twice over, on the screen's thread: a library of
// 13,874 albums held the screen past Android's limit. The Shelf's patterns are each made once, as a value of its own.
test("the Shelf's patterns are made once, not on each call", () => {
  const files = kotlinFiles(ROOT).filter(f => /[\\/]Shelf[A-Za-z]*\.kt$/.test(f));
  assert.ok(files.length >= 10, "the Shelf's sources found");
  const made = [];
  for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => { if (/Regex\(|\.toRegex\(/.test(l) && !/^\s*(private )?val [A-Z_]+ = Regex\(/.test(l)) made.push(path.relative(ROOT, f) + ":" + (i + 1) + ": " + l.trim()); });
  }
  assert.deepEqual(made, [], "made once, as a value");
});
