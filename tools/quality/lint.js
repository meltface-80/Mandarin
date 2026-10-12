#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * ESLint behind a baseline that only goes down (docs/quality-plan.md): what the
 * rules found on the day the gate came is recorded per file and rule in
 * tools/quality/lint-baseline.json; a file may never have more of a rule's
 * findings than its entry says, and an entry only ever comes down. A new
 * finding anywhere fails; a file that got cleaner must have its entry lowered.
 *
 *   node tools/quality/lint.js [check]      findings over the baseline, exit 1 if any
 *   node tools/quality/lint.js accept       entries lowered or dropped, never raised
 *   node tools/quality/lint.js init         the baseline written once, from the tree as it is
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BASELINE = path.join(ROOT, "tools", "quality", "lint-baseline.json");

/** @typedef {Record<string, Record<string, number>>} Baseline */

/** ESLint's findings over the tree, counted per file (relative) and rule. */
async function counts() {
  const { ESLint } = require("eslint");
  const eslint = new ESLint({ cwd: ROOT });
  const results = await eslint.lintFiles(["."]);
  /** @type {Baseline} */
  const out = {};
  /** @type {Record<string, string[]>} */
  const lines = {};
  for (const r of results) {
    const rel = path.relative(ROOT, r.filePath).split(path.sep).join("/");
    for (const m of r.messages) {
      const rule = m.ruleId || (m.fatal ? "parse" : "other");
      out[rel] = out[rel] || {};
      out[rel][rule] = (out[rel][rule] || 0) + 1;
      (lines[rel] = lines[rel] || []).push(`${rel}:${m.line}:${m.column} ${rule}: ${m.message}`);
    }
  }
  return { counts: out, lines };
}

/** @returns {Baseline} */
function readBaseline() {
  if (!fs.existsSync(BASELINE)) return {};
  return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

/** @param {Baseline} b */
function writeBaseline(b) {
  /** @type {Baseline} */
  const sorted = {};
  for (const f of Object.keys(b).sort()) {
    const rules = Object.keys(b[f]).sort();
    if (rules.length) sorted[f] = Object.fromEntries(rules.map(r => [r, b[f][r]]));
  }
  fs.writeFileSync(BASELINE, JSON.stringify(sorted, null, 2) + "\n");
}

/** Findings over the baseline, and entries that should come down. @param {Baseline} now @param {Baseline} base */
function compare(now, base) {
  const over = [], lower = [];
  const files = new Set([...Object.keys(now), ...Object.keys(base)]);
  for (const f of [...files].sort()) {
    const rules = new Set([...Object.keys(now[f] || {}), ...Object.keys(base[f] || {})]);
    for (const r of [...rules].sort()) {
      const n = (now[f] || {})[r] || 0, b = (base[f] || {})[r] || 0;
      if (n > b) over.push({ file: f, rule: r, n, b });
      else if (n < b) lower.push({ file: f, rule: r, n, b });
    }
  }
  return { over, lower };
}

/**
 * The baseline brought down to the tree: lowered where a file got cleaner, dropped where it is clean; never raised.
 * @param {Baseline} now @param {Baseline} base
 */
function accept(now, base) {
  /** @type {Baseline} */
  const next = {};
  for (const f of Object.keys(base)) {
    for (const r of Object.keys(base[f])) {
      const n = (now[f] || {})[r] || 0;
      if (n > 0) (next[f] = next[f] || {})[r] = Math.min(n, base[f][r]);
    }
  }
  return next;
}

/** @param {string[]} argv */
async function main(argv) {
  const cmd = argv[0] || "check";
  const { counts: now, lines } = await counts();
  if (cmd === "init") {
    if (fs.existsSync(BASELINE)) throw new Error("the baseline exists; `accept` brings it down, nothing raises it");
    writeBaseline(now);
    console.log(`baseline written: ${Object.keys(now).length} file(s) with findings`);
    return 0;
  }
  const base = readBaseline();
  if (cmd === "accept") {
    writeBaseline(accept(now, base));
    return 0;
  }
  const { over, lower } = compare(now, base);
  for (const o of over) {
    console.log(`${o.file}: ${o.rule}: ${o.n} finding(s), the baseline allows ${o.b}`);
    for (const l of lines[o.file] || []) if (l.includes(` ${o.rule}: `)) console.log("  " + l);
  }
  for (const l of lower) console.log(`${l.file}: ${l.rule}: down to ${l.n} from ${l.b}; run \`node tools/quality/lint.js accept\``);
  return over.length || lower.length ? 1 : 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, e => { console.error("lint: " + (e instanceof Error ? e.message : String(e))); process.exitCode = 2; });
}

module.exports = { compare, accept };
