#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * The site's languages (item 408; docs/i18n.js shows them). Every page of docs/ is written in English, each text to
 * translate marked data-i18n="key" and each attribute to translate named in data-i18n-attr="attribute:key".
 *
 *   node tools/docs/i18n.js          (npm run i18n) writes docs/i18n/en.json: every key and its English, sorted —
 *                                    the translators' source
 *   node tools/docs/i18n.js check    what is wrong, exit 1 if anything is: en.json behind the pages, a key marked
 *                                    twice with two Englishes, a mark inside a mark, prose left unmarked, and in each
 *                                    other language file a key missing or stale, or a translation whose markup isn't
 *                                    the English's (the same tags with the same attributes, so the same links, and the
 *                                    same <code> contents)
 *
 * test/site-languages.test.js runs the check, so a page changed without its translations fails the suite.
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const DOCS = path.join(ROOT, "docs");
const DIR = path.join(DOCS, "i18n");
/** The languages besides English, in the selector's order. */
const LANGS = ["fr", "de", "es", "it", "nl", "sv", "da", "no"];

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style"]);
// Never prose: code, the selector's own names, pictures.
const SKIP = new Set(["pre", "code", "script", "style", "select", "svg", "head", "kbd", "samp"]);
// One word that is a name stays as it is everywhere; any other word is prose.
const NAMES = new Set(["Mandarin", "Linux", "Android", "Sonos", "Qobuz", "Tidal", "Tailscale", "Windows", "Debian", "Ubuntu"]);
const KEY = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** @typedef {{ strings: Record<string, string>, attrKeys: Set<string>, problems: string[] }} Extract */

/** A tag's attributes, values as written. @param {string} s @returns {Record<string, string>} */
function attributes(s) {
  /** @type {Record<string, string>} */
  const out = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;
  let m;
  while ((m = re.exec(s))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return out;
}

/** Entities as the browser reads them, for attribute values and the prose check. @param {string} s */
function decode(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => e[0] === "#"
    ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    : (named[e.toLowerCase()] ?? all));
}

/** Text a reader would translate: two words or more, or one word that isn't a name. @param {string} text */
function isProse(text) {
  const t = decode(text).replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2,}/.test(t)) return false;
  if (!t.includes(" ")) return /^[A-Za-z][a-z]+$/.test(t) && !NAMES.has(t);
  return true;
}

const collapse = (/** @type {string} */ s) => s.replace(/\s+/g, " ").trim();

/**
 * One page's marked texts and attributes, and what is wrong with its marks.
 * @param {string} html @param {string} file a name for the messages
 * @returns {{ texts: { key: string, value: string, attr: boolean, line: number }[], problems: string[] }}
 */
function scan(html, file) {
  /** @type {{ key: string, value: string, attr: boolean, line: number }[]} */
  const texts = [];
  const problems = [];
  /** @type {{ tag: string, at: number, line: number, key: string | null, quiet: boolean }[]} */
  const stack = [];
  const lineAt = (/** @type {number} */ i) => html.slice(0, i).split("\n").length;
  const re = /<!--[\s\S]*?-->|<![^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      const quiet = stack.some(s => s.quiet || s.key !== null);
      if (!quiet && isProse(m[4])) problems.push(`${file}:${lineAt(m.index)}: prose with no data-i18n: "${collapse(decode(m[4])).slice(0, 70)}"`);
      continue;
    }
    if (!m[2]) continue;  // a comment
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const open = stack.pop();
      if (!open || open.tag !== tag) {
        problems.push(`${file}:${lineAt(m.index)}: </${tag}> closes <${open ? open.tag : "nothing"}>`);
        return { texts, problems };
      }
      if (open.key !== null) texts.push({ key: open.key, value: collapse(html.slice(open.at, m.index)), attr: false, line: open.line });
      continue;
    }
    const a = attributes(m[3]);
    const line = lineAt(m.index);
    const inside = stack.find(s => s.key !== null);
    for (const pair of (a["data-i18n-attr"] || "").split(";").filter(Boolean)) {
      const i = pair.indexOf(":");
      const name = pair.slice(0, i).trim(), key = pair.slice(i + 1).trim();
      if (i < 1 || !(name in a)) problems.push(`${file}:${line}: data-i18n-attr "${pair}" names no attribute of <${tag}>`);
      else texts.push({ key, value: decode(a[name]), attr: true, line });
      if (inside) problems.push(`${file}:${line}: data-i18n-attr inside data-i18n="${inside.key}", which would be written over`);
    }
    if ("data-i18n" in a && inside) problems.push(`${file}:${line}: data-i18n="${a["data-i18n"]}" inside data-i18n="${inside.key}"`);
    if (VOID.has(tag) || m[3].trim().endsWith("/")) continue;
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
      re.lastIndex = end < 0 ? html.length : end;
      stack.push({ tag, at: re.lastIndex, line, key: null, quiet: true });
      continue;
    }
    const quiet = SKIP.has(tag) || a.translate === "no";
    stack.push({ tag, at: re.lastIndex, line, key: "data-i18n" in a ? a["data-i18n"] : null, quiet });
  }
  if (stack.length) problems.push(`${file}: <${stack[stack.length - 1].tag}> (line ${stack[stack.length - 1].line}) is never closed`);
  // <title> is in <head>, where nothing else is prose: it is read alone.
  return { texts, problems };
}

/** Every page's marks, as en.json holds them. @param {string} [dir] @returns {Extract} */
function extract(dir = DOCS) {
  /** @type {Record<string, string>} */
  const strings = {};
  /** @type {Record<string, string>} */
  const where = {};
  const attrKeys = new Set();
  const problems = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith(".html")).sort()) {
    const r = scan(fs.readFileSync(path.join(dir, f), "utf8"), f);
    problems.push(...r.problems);
    for (const t of r.texts) {
      if (!KEY.test(t.key)) problems.push(`${f}:${t.line}: "${t.key}" is not a key (page.part.name: a-z, 0-9 and -)`);
      if (!t.value) problems.push(`${f}:${t.line}: "${t.key}" marks no text`);
      if (t.key in strings && strings[t.key] !== t.value) {
        problems.push(`${f}:${t.line}: "${t.key}" is also at ${where[t.key]} with other English: one key, one text`);
        continue;
      }
      strings[t.key] = t.value;
      where[t.key] = `${f}:${t.line}`;
      if (t.attr) attrKeys.add(t.key);
    }
  }
  const sorted = Object.fromEntries(Object.keys(strings).sort().map(k => [k, strings[k]]));
  return { strings: sorted, attrKeys, problems };
}

/** en.json's text for these strings: sorted, two-space JSON, one line each. @param {Record<string, string>} strings */
const render = (strings) => JSON.stringify(strings, null, 2) + "\n";

/**
 * A text's markup, which a translation keeps: each tag with its attributes (so each link's address), and what each
 * <code> holds. The words between are the translator's.
 * @param {string} html @returns {{ tags: string[], code: string[], balanced: boolean }}
 */
function structure(html) {
  const tags = [];
  const code = [];
  const open = [];
  let balanced = true;
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[2].toLowerCase();
    if (m[1]) {
      const o = open.pop();
      if (!o || o.tag !== tag) balanced = false;
      else if (tag === "code") code.push(html.slice(o.at, m.index));
      continue;
    }
    const a = attributes(m[3]);
    tags.push(tag + Object.keys(a).sort().map(k => ` ${k}="${a[k]}"`).join(""));
    if (!VOID.has(tag)) open.push({ tag, at: re.lastIndex });
  }
  return { tags: tags.sort(), code: code.sort(), balanced: balanced && open.length === 0 };
}

/**
 * What is wrong with one language's file against the English.
 * @param {string} lang @param {unknown} dict the file, parsed @param {Extract} en
 * @param {{ allowEmpty?: boolean }} [opts] allowEmpty: a file that is exactly {} is let off its missing keys
 * @returns {string[]}
 */
function checkLanguage(lang, dict, en, opts = {}) {
  const file = `docs/i18n/${lang}.json`;
  if (!dict || typeof dict !== "object" || Array.isArray(dict)) return [`${file}: not a { key: text } object`];
  const d = /** @type {Record<string, unknown>} */ (dict);
  const problems = [];
  const keys = Object.keys(d);
  if (!(opts.allowEmpty && keys.length === 0)) {
    for (const k of Object.keys(en.strings)) if (!(k in d)) problems.push(`${file}: "${k}" is missing`);
  }
  for (const k of keys) {
    if (!(k in en.strings)) { problems.push(`${file}: "${k}" is no longer on any page`); continue; }
    const t = d[k];
    if (typeof t !== "string" || !t.trim()) { problems.push(`${file}: "${k}" is not a text`); continue; }
    if (en.attrKeys.has(k)) {
      if (/[<>]/.test(t)) problems.push(`${file}: "${k}" is an attribute's text: no markup`);
      continue;
    }
    const want = structure(en.strings[k]), got = structure(t);
    if (!got.balanced) problems.push(`${file}: "${k}": a tag is left open or closed twice`);
    if (want.tags.join("\n") !== got.tags.join("\n")) {
      problems.push(`${file}: "${k}": its tags aren't the English's (${want.tags.join(" ") || "none"}; this has ${got.tags.join(" ") || "none"})`);
    }
    if (want.code.join("\n") !== got.code.join("\n")) problems.push(`${file}: "${k}": <code> must hold what the English's holds (${want.code.join(", ")})`);
  }
  return problems;
}

/**
 * Everything wrong, from the pages through en.json to each language.
 * @param {{ allowEmpty?: boolean, dir?: string }} [opts] @returns {string[]}
 */
function check(opts = {}) {
  const dir = opts.dir || DOCS;
  const en = extract(dir);
  const problems = [...en.problems];
  const ej = path.join(dir, "i18n", "en.json");
  if (!fs.existsSync(ej) || fs.readFileSync(ej, "utf8") !== render(en.strings)) {
    problems.push("docs/i18n/en.json is not what the pages say: run npm run i18n");
  }
  for (const lang of LANGS) {
    const f = path.join(dir, "i18n", `${lang}.json`);
    if (!fs.existsSync(f)) { problems.push(`docs/i18n/${lang}.json is missing`); continue; }
    let dict;
    try { dict = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { problems.push(`docs/i18n/${lang}.json: not JSON (${e.message})`); continue; }
    problems.push(...checkLanguage(lang, dict, en, opts));
  }
  return problems;
}

function main() {
  const cmd = process.argv[2] || "write";
  if (cmd === "check") {
    const problems = check();
    for (const p of problems) console.error(p);
    if (!problems.length) console.log(`i18n: ${Object.keys(extract().strings).length} keys; every language in step`);
    return problems.length ? 1 : 0;
  }
  if (cmd !== "write") { console.error("usage: node tools/docs/i18n.js [write|check]"); return 2; }
  const en = extract();
  for (const p of en.problems) console.error(p);
  if (en.problems.length) return 1;
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, "en.json"), render(en.strings));
  console.log(`docs/i18n/en.json: ${Object.keys(en.strings).length} keys`);
  return 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { LANGS, extract, render, structure, checkLanguage, check, scan, isProse };
