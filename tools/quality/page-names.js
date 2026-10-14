#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * The page's names (docs/specs/page-modules.md): the page's script is carved
 * into parts (public/app/parts.txt) joined into one script, so the names a
 * part declares at its top are the whole page's: every part, and every other
 * script index.html loads, shares them on one window. No compiler sees a
 * clash or a name missing there; the page just stops, or one screen throws.
 * So, over the parts joined and the page's other scripts:
 *   - no name is declared twice at the top (two `function load`s: the last
 *     one wins in silence; two `const`s stop the page);
 *   - none takes a browser's own name (a top-level `function close` is
 *     window.close for every script on the page);
 *   - each is read somewhere: one read nowhere is dead, or its reader lost;
 *   - every name read is declared in a part or another of the page's
 *     scripts, or is the browser's.
 * ESLint reads each part alone; it is told the parts' names
 * (tools/lint/eslint.config.js, through partNames) and this holds the join.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const LINT = path.join(ROOT, "tools", "lint", "node_modules");
const PARSE = { ecmaVersion: /** @type {2024} */ (2024), sourceType: /** @type {"script"} */ ("script"), range: true, loc: true };
/** Globals the page's scripts are given beyond the browser's (the Android app's bridges; tools/lint/eslint.config.js). */
const GIVEN = ["ShareCard", "MusicdSrp", "MusicdDownloads"];

/** The parts of the page's script, in order, as the server reads public/app/parts.txt. @param {string} [root] @returns {string[]} */
function parts(root = ROOT) {
  return fs.readFileSync(path.join(root, "public", "app", "parts.txt"), "utf8").split("\n").map(l => l.trim())
    .filter(l => l && !l.startsWith("#") && l.endsWith(".js") && !l.startsWith("/") && !l.includes("\\") && l.split("/").every(s => s && s !== "." && s !== ".."));
}

/**
 * The page's scripts as index.html loads them, /app.js as its parts: [name, text][].
 * @param {string} [root] @returns {[string, string][]}
 */
function scripts(root = ROOT) {
  const pub = path.join(root, "public");
  const html = fs.readFileSync(path.join(pub, "index.html"), "utf8");
  /** @type {[string, string][]} */
  const out = [];
  for (const m of html.matchAll(/<script[^>]*\ssrc="\/?([^"?#]+)"/g)) {
    if (m[1] === "app.js") for (const p of parts(root)) out.push([p, fs.readFileSync(path.join(pub, p), "utf8")]);
    else if (fs.existsSync(path.join(pub, m[1]))) out.push([m[1], fs.readFileSync(path.join(pub, m[1]), "utf8")]);
  }
  return out;
}

/**
 * What one program declares at its top and what it reads that it doesn't declare.
 * @param {string} text
 * @returns {{ declared: { name: string, line: number, kind: string, read: boolean }[], through: { name: string, line: number }[] }}
 */
function survey(text) {
  const espree = require(path.join(LINT, "espree"));
  const scope = require(path.join(LINT, "eslint-scope"));
  const ast = espree.parse(text, PARSE);
  const sm = scope.analyze(ast, { ecmaVersion: 2024, sourceType: "script" });
  const g = sm.globalScope;
  const declared = [];
  for (const v of g.variables) {
    for (const d of v.defs) {
      declared.push({
        name: v.name, line: d.name.loc.start.line, kind: d.type === "Variable" ? d.parent.kind : d.type,
        read: v.references.some(r => r.isRead())
      });
    }
  }
  const through = g.through.map(r => ({ name: r.identifier.name, line: r.identifier.loc.start.line }));
  return { declared, through };
}

/**
 * The verdict, free of parsing: every clash, browser name, unread name and undeclared read.
 * @param {{ declared: { name: string, where: string, kind: string, read: boolean }[], through: { name: string, where: string }[] }} page
 *   what the parts joined declare (read: anywhere in the join) and read without declaring, with where ("part:line")
 * @param {{ declared: { name: string, where: string }[] }} others what the page's other scripts declare
 * @param {Set<string>} browser the browser's own names
 * @returns {string[]}
 */
function judge(page, others, browser) {
  const failures = [];
  /** @type {Map<string, string[]>} */
  const at = new Map();
  for (const d of [...page.declared, ...others.declared]) at.set(d.name, [...(at.get(d.name) || []), d.where]);
  for (const [name, where] of at) if (where.length > 1) failures.push(`${name}: declared ${where.length} times at the page's top (${where.join(", ")}); one name, one thing`);
  for (const d of page.declared) {
    if (browser.has(d.name)) failures.push(`${d.where}: ${d.name} is the browser's own name (window.${d.name}); name it for what it is`);
    if (!d.read && d.kind !== "ImplicitGlobalVariable") failures.push(`${d.where}: ${d.name} is read nowhere on the page`);
  }
  const known = new Set([...at.keys(), ...browser]);
  for (const r of page.through) if (!known.has(r.name)) failures.push(`${r.where}: ${r.name} is declared in no part of the page, and isn't the browser's`);
  return failures;
}

/** Where a line of the join is: "part:line". @param {[string, string][]} list @returns {(line: number) => string} */
function locator(list) {
  /** @type {[number, string][]} */
  const starts = [];
  for (let i = 0; i < list.length; i++) {
    const before = join(list.slice(0, i + 1)).length - list[i][1].length;   // where the part's own text begins
    starts.push([join(list).slice(0, before).split("\n").length, list[i][0]]);
  }
  return (n) => { let s = starts[0]; for (const x of starts) if (x[0] <= n) s = x; return s[1] + ":" + (n - s[0] + 1); };
}

/** The join, as the server makes it (server/Mandarin.Server/Pages.Script.cs). @param {[string, string][]} list */
const join = (list) => list.map(([p, t]) => "// " + p + "\n" + t).join("\n;\n");

/**
 * The names the parts declare at their top, as ESLint globals (let and var writable), for
 * tools/lint/eslint.config.js: each part is linted alone, and these are the rest's.
 * @param {string} [root] @returns {Record<string, "readonly" | "writable">}
 */
function partNames(root = ROOT) {
  /** @type {Record<string, "readonly" | "writable">} */
  const out = {};
  for (const p of parts(root)) {
    for (const d of survey(fs.readFileSync(path.join(root, "public", p), "utf8")).declared) {
      out[d.name] = d.kind === "let" || d.kind === "var" ? "writable" : "readonly";
    }
  }
  return out;
}

function main() {
  const all = scripts();
  const own = new Set(parts());
  const list = all.filter(([p]) => own.has(p));
  const where = locator(list);
  let s;
  try { s = survey(join(list)); } catch (e) {
    // Two parts declaring one let or const, or a part cut mid-statement: the page stops before it starts.
    console.error(`${e.lineNumber ? where(e.lineNumber) + ": " : ""}the parts joined don't parse: ${e.message}`);
    return 1;
  }
  const page = {
    declared: s.declared.map(d => ({ name: d.name, where: where(d.line), kind: d.kind, read: d.read })),
    through: s.through.filter(r => !GIVEN.includes(r.name)).map(r => ({ name: r.name, where: where(r.line) }))
  };
  const others = { declared: all.filter(([p]) => !own.has(p)).flatMap(([p, t]) => survey(t).declared.map(d => ({ name: d.name, where: p + ":" + d.line }))) };
  const globals = require(path.join(LINT, "globals"));
  const failures = judge(page, others, new Set([...Object.keys(globals.browser), ...Object.keys(globals.es2024)]));
  for (const f of failures) console.error(f);
  if (!failures.length) console.log(`page names: ${page.declared.length} at the top of ${list.length} parts, none clashing, each read`);
  return failures.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { judge, partNames, parts };
