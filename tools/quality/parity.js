#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * The screens contract's gate (docs/specs/native-parity.md): the Android app's
 * native screens hold to docs/specs/screens.json as the page does
 * (test/parity.test.js holds the page). Here:
 *   - the contract is whole: each item a known kind, each control named,
 *     each page-only item with its reason, each `in` a control of its screen;
 *   - core's Contract.kt is the contract's labels as written by this tool;
 *   - every Compose file in the app is a contract screen's, or the shell's;
 *   - each native screen has every item of its screen, as the kind the page
 *     has it, and nothing the contract hasn't (tools/quality/parity-kotlin.js
 *     reads the source); a control takes its label from the contract;
 *   - what a screen in preview lacks yet is in tools/quality/parity-gaps.json,
 *     which only shrinks: against the commit before and the branch's base on
 *     dev, nothing is added to it, and a screen out of preview has none.
 * So a control added to the page goes into the contract (the page's test
 * fails otherwise), and from there into the app in the same change.
 *
 *   node tools/quality/parity.js           check (the gates run this)
 *   node tools/quality/parity.js write     write Contract.kt from the contract
 *   node tools/quality/parity.js accept    take what is built off the gaps list
 *                                          (a screen new to the app: its gaps
 *                                          written; never one added otherwise)
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { scan, contractKotlin, KOTLIN_DIR } = require("./parity-kotlin");

const CONTRACT = "docs/specs/screens.json";
const GAPS = "tools/quality/parity-gaps.json";
const APP = "android/app/src/main/";
const KINDS = ["action", "shows"];

/**
 * @typedef {{ kind: string, label?: string | string[], in?: string, when?: string, each?: boolean, only?: string, why?: string }} Item
 * @typedef {{ page: string, native?: string[], preview?: boolean, items: Record<string, Item> }} Screen
 * @typedef {{ screens: Record<string, Screen>, shell?: Record<string, string> }} Contract
 * @typedef {Record<string, string[]>} Gaps
 */

/** What is wrong with the contract itself. @param {Contract} c @returns {string[]} */
function validate(c) {
  const out = [];
  for (const [s, screen] of Object.entries(c.screens || {})) {
    for (const [k, it] of Object.entries(screen.items || {})) {
      const at = `${CONTRACT}: ${s}.${k}`;
      if (!KINDS.includes(it.kind)) out.push(`${at}: kind is "${it.kind}", not ${KINDS.join(" or ")}`);
      if (it.kind === "action" && !it.label) out.push(`${at}: a control with no label`);
      if (it.only && (it.only !== "page" || !it.why)) out.push(`${at}: only "page", and why`);
      if (it.in && !(screen.items[it.in] && screen.items[it.in].kind === "action")) out.push(`${at}: in "${it.in}", which is not a control of ${s}`);
    }
  }
  return out;
}

/**
 * Every key of the contract written out in the page's source, as the page
 * test can't bring about every state a screen has (a booklet, a review, the
 * app's own Download): a key lost or misspelt fails here whether or not the
 * page test saw its item.
 * @param {Contract} c @param {string} page the page's source, joined @returns {string[]}
 */
function onPage(c, page) {
  const out = [];
  for (const [s, screen] of Object.entries(c.screens)) for (const k of Object.keys(screen.items)) {
    if (!page.includes(`${s}.${k}`)) out.push(`${s}.${k}: written nowhere in the page (public/): the page carries every key as data-parity`);
  }
  return out;
}

/**
 * The native screens against the contract.
 * @param {{ contract: Contract, gaps: Gaps, sources: Record<string, string>, composables: string[], refs: { name: string, contract: Contract | null, gaps: Gaps }[] }} x
 *   sources: each native screen's file and its text; composables: the app's
 *   files with a @Composable in them; refs: the commits it is held against.
 * @returns {{ findings: string[], missing: Gaps }}
 */
function compare({ contract, gaps, sources, composables, refs }) {
  const findings = validate(contract);
  /** @type {Gaps} */
  const missing = {};
  const shell = Object.keys(contract.shell || {});
  const natives = Object.values(contract.screens).flatMap(s => s.native || []);
  for (const f of composables) if (!natives.includes(f) && !shell.includes(f)) findings.push(`${f}: Compose, and no screen of the contract's nor the shell's: a native screen is in ${CONTRACT} first`);
  for (const [s, screen] of Object.entries(contract.screens)) {
    if (!screen.native || !screen.native.length) { if (gaps[s]) findings.push(`${GAPS}: ${s} is not native, so it has no gaps`); continue; }
    /** @type {Map<string, Set<string>>} */
    const have = new Map();
    for (const f of screen.native) {
      if (!(f in sources)) { findings.push(`${f}: ${s}'s native screen, not found`); continue; }
      const r = scan(sources[f]);
      for (const x of r.findings) findings.push(`${f}: ${x}`);
      for (const t of r.tags) {
        if (!t.key) continue;
        // One element can be two screens' (Now playing's corner buttons are the Queue's too): its keys space-separated, as on the page.
        const keys = t.key.split(/\s+/).filter(Boolean);
        const where = `${f}:${t.line}`;
        if (t.kind === "action" && !keys.includes(t.label || "")) findings.push(`${where}: ${keys[0]}'s label from the contract: parity("${t.key}", Contract.label("${keys[0]}"…))`);
        for (const key of keys) {
          const [ts, ...rest] = key.split("."), k = rest.join(".");
          if (ts !== s) {
            const other = contract.screens[ts];
            if (!other || !(other.native || []).includes(f)) findings.push(`${where}: ${key}, of no screen drawn in ${path.basename(f)}`);
            continue;
          }
          const it = screen.items[k];
          if (!it) { findings.push(`${where}: ${key}, which ${s}'s contract hasn't: on the page and in the contract first, or not in the app`); continue; }
          if (it.only) { findings.push(`${where}: ${key} is the page's alone (${it.why})`); continue; }
          if (t.kind === "action" && it.kind !== "action") { findings.push(`${where}: ${key} is a control here; on the page it only shows`); continue; }
          if (!have.has(k)) have.set(k, new Set());
          have.get(k).add(t.kind);
        }
      }
    }
    const lacks = Object.entries(screen.items).filter(([k, it]) => !it.only && !(have.get(k) || new Set()).has(it.kind)).map(([k]) => k);
    const listed = gaps[s] || [];
    missing[s] = lacks;
    if (!screen.preview) {
      for (const k of lacks) findings.push(`${s}.${k}: on the page, not in the app (${path.basename(screen.native[0])})`);
      if (listed.length) findings.push(`${GAPS}: ${s} is out of preview, so it has no gaps`);
    } else {
      for (const k of lacks) if (!listed.includes(k)) findings.push(`${s}.${k}: on the page, not in the app (${path.basename(screen.native[0])}), nor on the gaps list, which only shrinks: build it`);
      for (const k of listed) if (!lacks.includes(k)) findings.push(`${s}.${k}: built: \`npm run parity -- accept\` takes it off the gaps list`);
    }
    for (const ref of refs) {
      const was = ref.contract && ref.contract.screens[s];
      if (!was || !was.native || !was.native.length) continue;
      if (screen.preview && !was.preview) findings.push(`${s}: out of preview at ${ref.name}; a screen never goes back into it`);
      const before = ref.gaps[s] || [];
      for (const k of listed) if (!before.includes(k)) findings.push(`${GAPS}: ${s}.${k} is a gap ${ref.name} hadn't: the list only shrinks`);
    }
  }
  for (const s of Object.keys(gaps)) if (!contract.screens[s]) findings.push(`${GAPS}: ${s}, no screen of the contract's`);
  // A file two screens draw is read for each: what is wrong in it, said once.
  return { findings: [...new Set(findings)], missing };
}

/** @param {string} root @param {string[]} a */
const git = (root, ...a) => { const r = spawnSync("git", a, { cwd: root, encoding: "utf8" }); return r.status === 0 ? r.stdout.trim() : null; };
/** @param {string} root @param {string} ref @param {string} file @returns {any} */
const atRef = (root, ref, file) => { const t = git(root, "show", `${ref}:${file}`); try { return t ? JSON.parse(t) : null; } catch { return null; } };

/**
 * The commits the gaps are held against: the one before (HEAD, or HEAD's
 * first parent on dev itself) and where the branch left dev.
 * @param {string} root @returns {{ name: string, contract: Contract | null, gaps: Gaps }[]}
 */
function refs(root) {
  const head = git(root, "rev-parse", "HEAD");
  if (!head) return [];
  const names = new Set(["HEAD"]);
  const base = git(root, "merge-base", "HEAD", "origin/dev");
  if (base && base !== head) names.add(base);
  else if (git(root, "rev-parse", "--verify", "-q", "HEAD^1")) names.add("HEAD^1");
  return [...names].map(n => ({ name: n === base ? "dev (" + n.slice(0, 7) + ")" : n, contract: atRef(root, n, CONTRACT), gaps: atRef(root, n, GAPS) || {} }));
}

/** @param {string} root @param {string} f */
const read = (root, f) => fs.readFileSync(path.join(root, f), "utf8");
/** The parts of the labels on disk that [kotlin] (the files written now) no longer has. @param {string} root @param {Record<string, string>} kotlin @returns {string[]} */
const staleParts = (root, kotlin) => !fs.existsSync(path.join(root, KOTLIN_DIR)) ? [] :
  fs.readdirSync(path.join(root, KOTLIN_DIR)).filter(n => /^ContractLabels\d+\.kt$/.test(n)).map(n => KOTLIN_DIR + n).filter(f => !(f in kotlin));

/** The tree's contract, gaps, native sources and Compose files. @param {string} root */
function load(root) {
  /** @type {Contract} */
  const contract = JSON.parse(read(root, CONTRACT));
  const gaps = fs.existsSync(path.join(root, GAPS)) ? JSON.parse(read(root, GAPS)) : {};
  /** @type {Record<string, string>} */
  const sources = {};
  for (const s of Object.values(contract.screens)) for (const f of s.native || []) if (fs.existsSync(path.join(root, f))) sources[f] = read(root, f);
  const tracked = (git(root, "ls-files", "--cached", "--others", "--exclude-standard", APP) || "").split("\n").filter(f => f.endsWith(".kt") && fs.existsSync(path.join(root, f)));
  const composables = tracked.filter(f => /@Composable\b/.test(read(root, f)));
  const page = (git(root, "ls-files", "--cached", "--others", "--exclude-standard", "public/") || "").split("\n")
    .filter(f => /\.(html|js)$/.test(f) && fs.existsSync(path.join(root, f))).map(f => read(root, f)).join("\n");
  return { contract, gaps, sources, composables, page };
}

/** @param {string[]} argv @param {string} [root] @returns {number} the exit code */
function main(argv, root = process.env.PARITY_ROOT || path.resolve(__dirname, "..", "..")) {
  const cmd = argv[0] || "check";
  const x = load(root);
  const kotlin = contractKotlin(x.contract);
  if (cmd === "write") {
    fs.mkdirSync(path.join(root, KOTLIN_DIR), { recursive: true });
    for (const f of staleParts(root, kotlin)) fs.rmSync(path.join(root, f));
    for (const [f, text] of Object.entries(kotlin)) fs.writeFileSync(path.join(root, f), text);
    console.log(`parity: ${Object.keys(kotlin).sort().join(", ")} written`);
    return 0;
  }
  const r = refs(root);
  if (!r.length && process.env.PARITY_REQUIRE_BASE) { console.error("parity: no commit to hold the gaps list against (a shallow clone?)"); return 1; }
  const { findings, missing } = compare(Object.assign({ refs: r }, x));
  findings.push(...onPage(x.contract, x.page));
  if (cmd === "accept") {
    /** @type {Gaps} */
    const next = {};
    for (const [s, screen] of Object.entries(x.contract.screens)) {
      if (!screen.preview || !missing[s] || !missing[s].length) continue;
      const native = r.filter(ref => ref.contract && ref.contract.screens[s] && (ref.contract.screens[s].native || []).length);
      next[s] = missing[s].filter(k => native.every(ref => (ref.gaps[s] || []).includes(k)));
    }
    fs.mkdirSync(path.dirname(path.join(root, GAPS)), { recursive: true });
    fs.writeFileSync(path.join(root, GAPS), JSON.stringify(next, null, 2) + "\n");
    console.log(`parity: ${GAPS} written`);
    return main(["check"], root);
  }
  for (const [f, text] of Object.entries(kotlin)) if (!fs.existsSync(path.join(root, f)) || read(root, f) !== text) findings.unshift(`${f}: not the contract's labels: npm run parity -- write`);
  for (const f of staleParts(root, kotlin)) findings.unshift(`${f}: a part of the contract's labels no longer written: npm run parity -- write`);
  for (const f of findings) console.log(f);
  const gapCount = Object.values(x.gaps).reduce((n, g) => n + g.length, 0);
  if (!findings.length) console.log(`parity: the app's native screens keep the contract${gapCount ? ` (${gapCount} items still to build in preview, ${GAPS})` : ""}`);
  return findings.length ? 1 : 0;
}

module.exports = { validate, compare, onPage, refs, load, main };
if (require.main === module) process.exit(main(process.argv.slice(2)));
