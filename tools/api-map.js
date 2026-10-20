#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * The server's routes, as docs/specs/api.md lists them (v0.9.4, the audit's
 * D2, old/audit-b4-main.md): each one's method, address, who may ask
 * (Auth.cs's gate) and the file that answers it, read from the C# sources
 * (the file, not its line, so the map changes only when a route does). The
 * routes are written in a few ways, and each is read here:
 *   a route table              ["/api/x"] = Handler, in Gets, Posts or Deletes
 *   a list of addresses        HashSet<string> Gets = ["/api/x", …] (PlaybackRoutes.cs)
 *   a mapped route             app.MapMethods("/x", Http.GetOrHead, …), MapPost(…)
 *   an address compared        p == "/api/x", case "POST" when p == "/api/x", p is "/a" or "/b"
 *   a pattern                  [GeneratedRegex(@"^/api/(a|b)/x$")]
 *   a prefix                   p.StartsWith("/api/x/")
 * Kept current by a gate, as the file lengths are:
 *   node tools/api-map.js            check: docs/specs/api.md is what the sources say; exit 1 if not
 *   node tools/api-map.js write      write it
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "server", "Mandarin.Server");
const OUT = path.join(ROOT, "docs", "specs", "api.md");

/** @typedef {{ method: string, path: string, file: string, line: number, how: string }} Route */

/** Every .cs file under the server's project, bin/ and obj/ aside, by its path from the project. @param {string} dir @returns {string[]} */
function sources(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "bin" || e.name === "obj") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (e.name.endsWith(".cs")) out.push(p);
  }
  return out.sort();
}

const ADDRESS = /"(\/(?:api|stream|internal|upnp|server-info|login|display|shelf)[^"\s]*)"/g;
const METHODS = { Gets: "GET", Posts: "POST", Deletes: "DELETE" };

/**
 * The method named nearest before `at` on a line (`get && p == …`, `post && p is …`, `case "POST" when …`),
 * else the one the whole line names, or "".
 * @param {string} l @param {number} [at]
 */
function methodBefore(l, at = l.length) {
  const before = l.slice(0, at);
  let best = -1, method = "";
  for (const [re, m] of /** @type {[RegExp, string][]} */ ([[/\bget\b/g, "GET"], [/\bpost\b/g, "POST"], [/case "(GET|POST|PUT|PATCH|DELETE)"/g, ""]]))
    for (const x of before.matchAll(re)) if ((x.index ?? -1) > best) { best = x.index ?? -1; method = m || x[1]; }
  return method || methodOf(l);
}

/** The method a line names (case "POST" when …, IsPost(…), Http.GetOrHead), or "". @param {string} l */
function methodOf(l) {
  const c = /case "(GET|POST|PUT|PATCH|DELETE|HEAD)"/.exec(l);
  if (c) return c[1] === "HEAD" ? "GET" : c[1];
  if (/GetOrHead|\["GET", "HEAD"\]|IsGet\(|MapGet\(/.test(l)) return "GET";
  if (/IsPost\(|MapPost\(/.test(l)) return "POST";
  if (/IsPatch\(/.test(l)) return "PATCH";
  if (/IsDelete\(|MapDelete\(/.test(l)) return "DELETE";
  return "";
}

/** The routes one file holds. @param {string} file @param {string} text @returns {Route[]} */
function routesIn(file, text) {
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  const lines = text.split("\n");
  /** @type {Route[]} */
  const out = [];
  /** @type {string | null} */
  let table = null;
  let listOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const add = (/** @type {string} */ method, /** @type {string} */ p, /** @type {string} */ how) => out.push({ method, path: p, file: rel, line: i + 1, how });
    // A route table opens (Dictionary<string, Handler> Gets = new()) or a list of addresses (HashSet<string> Gets = [).
    const opens = /\b(Gets|Posts|Deletes)\s*=\s*(new\(\)|\[)/.exec(l);
    if (opens && /Dictionary<string, Handler>|HashSet<string>/.test(l)) { table = METHODS[/** @type {"Gets"} */ (opens[1])]; listOpen = opens[2] === "["; }
    if (table) {
      const entry = /^\s*\["([^"]+)"\]\s*=\s*(\w+)/.exec(l);
      if (entry) add(table, entry[1], entry[2]);
      else if (listOpen) for (const m of l.matchAll(ADDRESS)) add(table, m[1], "listed");
      if (/^\s*\};|\];/.test(l)) { table = null; listOpen = false; }
      continue;
    }
    const mapped = /app\.Map(Get|Post|Delete|Methods)\("([^"]+)"/.exec(l);
    if (mapped) { add(mapped[1] === "Methods" ? methodOf(l) || "GET" : mapped[1].toUpperCase(), mapped[2], "mapped"); continue; }
    const pattern = /GeneratedRegex\(@?"\^(\/(?:api|stream|upnp)[^"]*)"/.exec(l);
    if (pattern) { add(methodOf(l), pattern[1].replace(/\$$|\\z$/, ""), "pattern"); continue; }
    if (/\b(p|path|Path\.Value)\s*(==|is)\s*"\//.test(l) || /\bwhen p (==|is) "\//.test(l)) {
      for (const m of l.matchAll(/(?:==|is|or)\s*"(\/[^"]+)"/g))
        // "/api" alone is the not-found page's own check (Pages.NotThere.cs), not a route.
        if (/^\/(api\/|stream|upnp|server-info|internal)/.test(m[1])) add(methodBefore(l, m.index), m[1], "compared");
      continue;
    }
    const prefix = /StartsWith\("(\/api\/[^"]+\/)"/.exec(l);
    // The gate's own rules (Auth.cs IsOpen, IsMedia) say who may ask, not what answers.
    if (prefix && !/static bool Is(Open|Media)/.test(l) && /(Prefix|const string|p\.StartsWith|path\.StartsWith)/.test(l)) add(methodOf(l), prefix[1] + "…", "prefix");
  }
  return out;
}

/** Who the gate lets ask (Auth.cs Gate, IsOpen, IsMedia). @param {string} p */
function access(p) {
  if (/^\/(api\/health|server-info|login)$/.test(p) || p.startsWith("/api/auth/") || p.startsWith("/upnp/event")) return "open";
  if (p.startsWith("/stream/") || p.startsWith("/api/image/")) return "signed in, or a signed address";
  if (p.startsWith("/internal/")) return "the server's own key";
  return "signed in";
}

/** The map, as docs/specs/api.md has it. */
function render() {
  /** @type {Route[]} */
  const all = [];
  for (const f of sources(SRC)) all.push(...routesIn(f, fs.readFileSync(f, "utf8")));
  // One row per method and address: where it is answered first.
  // An address found again where its method isn't said, once it is said elsewhere, adds nothing.
  const said = new Set(all.filter(r => r.method).map(r => r.path));
  const seen = new Set();
  const rows = all.filter(r => !(r.method === "" && said.has(r.path)))
    .filter(r => { const k = r.method + " " + r.path; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.path.localeCompare(b.path, "en") || a.method.localeCompare(b.method, "en"));
  const out = [
    "# The server's routes",
    "",
    "Written by `node tools/api-map.js write` from the C# sources (`server/Mandarin.Server/`), and checked by",
    "`npm run gates`: a route added, moved or gone fails it until this is written again. The method is blank",
    "where the code decides it away from the address (the handler says). \"…\" ends an address the route takes",
    "the rest of; a pattern is as the code writes it. What each answers is said beside its handler.",
    "",
    `${rows.length} routes.`,
    "",
    "| Method | Address | Who may ask | Answered in |",
    "|---|---|---|---|",
    ...rows.map(r => `| ${r.method} | \`${r.path.replace(/\|/g, "\\|")}\` | ${access(r.path)} | \`${r.file}\` |`),
    ""
  ];
  return out.join("\n");
}

function main() {
  const made = render();
  if (process.argv[2] === "write") { fs.writeFileSync(OUT, made); console.log("api-map: " + path.relative(ROOT, OUT) + " written"); return; }
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : "";
  if (have === made) { console.log("api-map: docs/specs/api.md is current"); return; }
  console.error("api-map: docs/specs/api.md is not what the sources say; run `node tools/api-map.js write`");
  process.exit(1);
}

if (require.main === module) main();
module.exports = { routesIn, render, access };
