// @ts-check
"use strict";
/*
 * The app's half of the screens contract (docs/specs/native-parity.md): what
 * a native screen's Compose source shows and does, read from the source, and
 * the contract's labels written out as Kotlin for it.
 *
 * Every control in a native screen (a Material button, a slider, a tab, a
 * modifier that takes a tap or a drag) carries Modifier.parity("<screen>.<item>",
 * Contract.label(…)) in its own arguments; every readout (Text, Image, Icon,
 * Canvas) carries one too, or sits inside a control or inside a container
 * that does. A key on a control is an action; any other key, a readout. The
 * source is read as text, its comments and the insides of its strings
 * blanked first, so a word in either is never taken for code.
 */

/** Material's controls: each one is something to tap or drag. */
const CONTROLS = ["IconButton", "FilledIconButton", "FilledTonalIconButton", "OutlinedIconButton", "IconToggleButton", "FilledIconToggleButton",
  "Button", "TextButton", "OutlinedButton", "ElevatedButton", "FilledTonalButton", "Slider", "RangeSlider", "Switch", "Checkbox", "TriStateCheckbox",
  "RadioButton", "DropdownMenuItem", "Tab", "LeadingIconTab", "NavigationBarItem", "NavigationRailItem", "FloatingActionButton",
  "SmallFloatingActionButton", "LargeFloatingActionButton", "ExtendedFloatingActionButton", "FilterChip", "AssistChip", "InputChip",
  "SuggestionChip", "BasicTextField", "TextField", "OutlinedTextField", "SearchBar"];
/** Modifiers that make anything a control. */
const GESTURES = ["clickable", "combinedClickable", "toggleable", "triStateToggleable", "selectable", "draggable", "anchoredDraggable", "swipeable", "pointerInput"];
/** What shows something. */
const READOUTS = ["Text", "BasicText", "Image", "AsyncImage", "Icon", "Canvas", "CircularProgressIndicator", "LinearProgressIndicator"];

/**
 * [src] with its comments, its imports and the insides of its strings and
 * characters as spaces, every offset and line where it was.
 * @param {string} src @returns {string}
 */
function mask(src) {
  const out = src.split("");
  const blank = (/** @type {number} */ a, /** @type {number} */ b) => { for (let i = a; i < b; i++) if (out[i] !== "\n") out[i] = " "; };
  for (let i = 0; i < src.length;) {
    if (src.startsWith("//", i)) { const e = src.indexOf("\n", i); const end = e < 0 ? src.length : e; blank(i, end); i = end; }
    else if (src.startsWith("/*", i)) { const e = src.indexOf("*/", i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; }
    else if (src.startsWith('"""', i)) { const e = src.indexOf('"""', i + 3); const end = e < 0 ? src.length : e; blank(i + 3, end); i = end + 3; }
    else if (src[i] === '"' || src[i] === "'") {
      const q = src[i]; let j = i + 1;
      while (j < src.length && src[j] !== q && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      blank(i + 1, j); i = j + 1;
    } else i++;
  }
  // The imports and the package name too: `import …foundation.clickable` is no tap.
  return out.join("").replace(/^[ \t]*(import|package)\b[^\n]*/gm, l => " ".repeat(l.length));
}

/**
 * Where the bracket opened at [open] closes in masked source [m]: the offset
 * of its partner, or the end.
 * @param {string} m @param {number} open @returns {number}
 */
function close(m, open) {
  const pair = { "(": ")", "{": "}", "[": "]" };
  const want = [pair[m[open]]];
  for (let i = open + 1; i < m.length; i++) {
    const c = m[i];
    if (c === "(" || c === "{" || c === "[") want.push(pair[c]);
    else if (c === want[want.length - 1]) { want.pop(); if (!want.length) return i; }
  }
  return m.length;
}

/** @typedef {{ name: string, at: number, args: [number, number], body: [number, number] | null }} Call */

/**
 * Every call of a capitalised name (a composable) in masked source [m]: its
 * arguments' span and its trailing lambda's, if it has one.
 * @param {string} m @returns {Call[]}
 */
function calls(m) {
  /** @type {Call[]} */
  const out = [];
  for (const x of m.matchAll(/(?<![.\w])([A-Z]\w*)\s*\(/g)) {
    if (/\bfun\s+(?:[\w.]+\.)?$/.test(m.slice(Math.max(0, (x.index || 0) - 40), x.index))) continue;   // its definition, not a call
    const open = (x.index || 0) + x[0].length - 1, shut = close(m, open);
    let j = shut + 1;
    while (j < m.length && /\s/.test(m[j]) && m[j] !== "\n") j++;
    out.push({ name: x[1], at: x.index || 0, args: [open, shut], body: m[j] === "{" ? [j, close(m, j)] : null });
  }
  return out;
}

/** @param {[number, number] | null} span @param {number} i */
const inside = (span, i) => !!span && i > span[0] && i < span[1];
/** The line of offset [i] in [s]. @param {string} s @param {number} i */
const lineOf = (s, i) => s.slice(0, i).split("\n").length;

/**
 * @typedef {{ key: string | null, kind: "action" | "shows", line: number, label: string | null }} Tag
 * A parity() in the source: its key as written (null: not a written string),
 * whether it marks a control, and the key its Contract.label() names, if any.
 */

/**
 * What one native screen's source shows and does, and what in it the
 * contract can't see: a control or a readout with no key, a label written
 * in the source rather than taken from the contract.
 * @param {string} src
 * @returns {{ tags: Tag[], findings: string[] }}
 */
function scan(src) {
  const m = mask(src);
  const all = calls(m);
  const controls = all.filter(c => CONTROLS.includes(c.name));
  /** @type {string[]} */
  const findings = [];
  /** The top-level argument of the innermost call around [i]: its span. @param {number} i @returns {[number, number] | null} */
  const argAround = (i) => {
    const call = all.filter(c => inside(c.args, i)).sort((a, b) => b.at - a.at)[0];
    if (!call) return null;
    let start = call.args[0] + 1;
    for (let j = start; j < call.args[1]; j++) {
      if (m[j] === "(" || m[j] === "{" || m[j] === "[") { j = close(m, j); continue; }
      if (m[j] === ",") { if (i < j) return [start, j]; start = j + 1; }
    }
    return [start, call.args[1]];
  };
  const gestures = [...m.matchAll(new RegExp("\\.(" + GESTURES.join("|") + ")\\b", "g"))].map(g => ({ name: g[1], at: g.index || 0, arg: argAround(g.index || 0) }));
  /** @type {Tag[]} */
  const tags = [];
  for (const p of m.matchAll(/(?<![.\w])parity\s*\(|\.parity\s*\(/g)) {
    const at = p.index || 0, open = at + p[0].length - 1, args = /** @type {[number, number]} */ ([open, close(m, open)]);
    const text = src.slice(args[0] + 1, args[1]);
    const key = (text.match(/^\s*"([^"]*)"/) || [])[1] || null;
    const label = (text.match(/Contract\.label\(\s*"([^"]*)"/) || [])[1] || null;
    const control = controls.some(c => inside(c.args, at)) || gestures.some(g => inside(g.arg, at));
    tags.push({ key, kind: control ? "action" : "shows", line: lineOf(src, at), label });
    if (!key) findings.push(`line ${lineOf(src, at)}: parity() with its key not written out as a string: the gate reads keys from the source`);
  }
  const tagged = (/** @type {[number, number] | null} */ span) => !!span && /(?<![\w])parity\s*\(|\.parity\s*\(/.test(m.slice(span[0], span[1]));
  for (const c of controls) if (!tagged(c.args)) findings.push(`line ${lineOf(src, c.at)}: ${c.name} with no parity(): every control is in the contract`);
  for (const g of gestures) if (!tagged(g.arg)) findings.push(`line ${lineOf(src, g.at)}: .${g.name} with no parity() beside it: every control is in the contract`);
  const containers = all.filter(c => c.body && tagged(c.args));
  const coveredAt = (/** @type {number} */ i) => controls.some(c => inside(c.args, i) || inside(c.body, i)) || containers.some(c => inside(c.body, i));
  // A composable of the screen's own, drawn by the screen: its readouts are covered where every call of it
  // in the file has a key in its arguments (passed on as its modifier) or sits inside something keyed.
  const helpers = [...m.matchAll(/\bfun\s+(?:[\w.]+\.)?([A-Z]\w*)\s*\(/g)].map(d => {
    const open = (d.index || 0) + d[0].length - 1, shut = close(m, open), brace = m.indexOf("{", shut);
    const uses = all.filter(c => c.name === d[1]);
    return { body: /** @type {[number, number]} */ ([brace, close(m, brace)]), keyed: uses.length > 0 && uses.every(c => tagged(c.args) || coveredAt(c.at)) };
  });
  for (const r of all.filter(c => READOUTS.includes(c.name))) {
    const covered = tagged(r.args) || coveredAt(r.at) || helpers.some(h => h.keyed && inside(h.body, r.at));
    if (!covered) findings.push(`line ${lineOf(src, r.at)}: ${r.name} with no parity(), and in nothing that has one: everything shown is in the contract`);
  }
  for (const d of m.matchAll(/contentDescription\s*=\s*"/g)) {
    findings.push(`line ${lineOf(src, d.index || 0)}: a label written in the screen: take it from the contract (Contract.label)`);
  }
  return { tags, findings };
}

/** Where the labels are written: Contract.kt, and the parts it joins (ContractLabels1.kt …). */
const KOTLIN_DIR = "android/core/src/main/kotlin/com/musicd/server/client/";
/** The most label rows a part holds, so no part nears the files' length watch however many screens there are. */
const PART_ROWS = 300;
const HEAD = "// Written by tools/quality/parity.js from docs/specs/screens.json (npm run parity -- write); never by hand.\npackage com.musicd.server.client\n";

/**
 * The contract's labels as Kotlin (core's Contract.kt and its parts): what
 * each native control is called, aloud too, so the app never spells one
 * itself. A screen's labels are kept in one part; a part takes the next
 * screen while it stays within PART_ROWS rows.
 * @param {{ screens: Record<string, { items: Record<string, { kind: string, label?: string | string[], only?: string }> }> }} contract
 * @returns {Record<string, string>} each file's text by its path from the repository's root
 */
function contractKotlin(contract) {
  /** @type {string[][]} */
  const parts = [[]];
  for (const [s, screen] of Object.entries(contract.screens)) {
    const rows = [];
    for (const [k, it] of Object.entries(screen.items)) {
      if (it.kind !== "action" || !it.label || it.only === "page") continue;
      rows.push(`        "${s}.${k}" to listOf(${[].concat(it.label).map(l => JSON.stringify(l)).join(", ")}),`);
    }
    const last = parts[parts.length - 1];
    if (last.length && last.length + rows.length > PART_ROWS) parts.push(rows); else last.push(...rows);
  }
  /** @type {Record<string, string>} */
  const files = {};
  parts.forEach((rows, i) => {
    files[`${KOTLIN_DIR}ContractLabels${i + 1}.kt`] = `${HEAD}
/** The screens contract's labels, part ${i + 1} of ${parts.length} (Contract.kt joins them). */
internal object ContractLabels${i + 1} {
    val labels: Map<String, List<String>> = mapOf(
${rows.join("\n")}
    )
}
`;
  });
  files[`${KOTLIN_DIR}Contract.kt`] = `${HEAD}
/**
 * The screens contract's labels (docs/specs/native-parity.md): what each
 * native control is called, aloud too, one per state, as the page calls it.
 */
object Contract {
    val labels: Map<String, List<String>> = ${parts.map((_, i) => `ContractLabels${i + 1}.labels`).join(" + ")}

    private val blank = Regex("\\\\{[^}]+\\\\}")

    /**
     * [key]'s label in [state], each {…} in it filled from [fill] in turn. Asked on every frame a control is drawn: one
     * pattern made once, and a label with nothing to fill given as it is.
     */
    fun label(key: String, state: Int = 0, vararg fill: String): String {
        val all = labels[key] ?: throw IllegalArgumentException("$key: not a control of the contract")
        val said = all[state.coerceIn(0, all.size - 1)]
        if ('{' !in said) return said
        var i = 0
        return blank.replace(said) { fill.getOrElse(i++) { "" } }
    }
}
`;
  return files;
}

module.exports = { mask, scan, contractKotlin, KOTLIN_DIR, CONTROLS, GESTURES, READOUTS };
