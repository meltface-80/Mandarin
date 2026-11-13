#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * Mandarin's logs as one timeline (logs, item 389): every file in a zip from Settings → Logs → Download all logs
 * (GET /api/diagnostics/zip), or in a folder (the Logs folder itself, a zip unpacked), merged in time order, each
 * line with the file it came from. A line without a time of its own (a stack trace's) stays under the line before it.
 *
 *   npm run logs -- <zip or folder> [--level WARN|ERROR] [--grep text] [--source name] [--since "2026-11-11 21:00"] [--until …]
 *
 * Times read: the server's, the Bridges' and the page's ("2026-11-11 21:14:03.123 UTC  INFO   …"), and Android's
 * ("2026-11-11 21:14:03.123  4242  4250 W Tag: …", taken in UTC as the Bridge and the app ask logcat for it).
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

/** @typedef {{ at: string, level: string, source: string, text: string, more: string[] }} Entry */

const OURS = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}) UTC {2}(INFO|WARN|ERROR|DEBUG)\s+(.*)$/;
const LOGCAT = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3})\s+\d+\s+\d+ ([VDIWEF]) (.*)$/;
const LOGCAT_LEVEL = /** @type {Record<string, string>} */ ({ V: "DEBUG", D: "DEBUG", I: "INFO", W: "WARN", E: "ERROR", F: "ERROR" });
const RANK = /** @type {Record<string, number>} */ ({ DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 });

/**
 * The files of a zip, by name: read from its central directory, stored or deflated (the server's zips are no bigger
 * than zip64 needs).
 * @param {Buffer} buf
 * @returns {Map<string, string>}
 */
function readZip(buf) {
  const files = new Map();
  let end = buf.length - 22;
  while (end >= 0 && buf.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("not a zip");
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error("a broken zip");
    const method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28), extraLen = buf.readUInt16LE(at + 30), commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    if (!name.endsWith("/")) files.set(name, (method === 8 ? zlib.inflateRawSync(data) : data).toString("utf8"));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

/** @param {string} dir @returns {Map<string, string>} */
function readFolder(dir) {
  const files = new Map();
  const walk = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else files.set(path.relative(dir, p).split(path.sep).join("/"), fs.readFileSync(p, "utf8"));
    }
  };
  walk(dir);
  return files;
}

/** "Bridges/Lounge Pi.03.txt" → "Bridges/Lounge Pi"; "MandarinServer_log.01.txt" → "MandarinServer". @param {string} name */
function sourceOf(name) {
  return name.replace(/\.txt$/, "").replace(/\.\d\d$/, "").replace(/_log$/, "");
}

/**
 * Every timed line of [files], oldest first.
 * @param {Map<string, string>} files
 * @returns {Entry[]}
 */
function entries(files) {
  /** @type {Entry[]} */
  const all = [];
  for (const [name, text] of files) {
    if (name === "about.txt") continue;
    const source = sourceOf(name);
    /** @type {Entry | null} */
    let last = null;
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      let m = OURS.exec(line);
      if (m) { last = { at: m[1], level: m[2], source, text: m[3], more: [] }; all.push(last); continue; }
      m = LOGCAT.exec(line);
      if (m) { last = { at: m[1], level: LOGCAT_LEVEL[m[2]] || "INFO", source, text: m[3], more: [] }; all.push(last); continue; }
      if (last) last.more.push(line);
    }
  }
  // Stable: lines of one file at the same millisecond keep their order.
  return all.map((e, i) => ({ e, i })).sort((a, b) => a.e.at < b.e.at ? -1 : a.e.at > b.e.at ? 1 : a.i - b.i).map(x => x.e);
}

/**
 * [all] narrowed as asked.
 * @param {Entry[]} all
 * @param {{ level?: string, grep?: string, source?: string, since?: string, until?: string }} o
 */
function narrow(all, o) {
  const g = (o.grep || "").toLowerCase(), src = (o.source || "").toLowerCase();
  return all.filter(e => (!o.level || RANK[e.level] >= RANK[o.level.toUpperCase()])
    && (!g || (e.text + "\n" + e.more.join("\n")).toLowerCase().includes(g))
    && (!src || e.source.toLowerCase().includes(src))
    && (!o.since || e.at >= o.since) && (!o.until || e.at <= o.until));
}

/** @param {Entry[]} list */
function render(list) {
  const width = Math.min(28, Math.max(8, ...list.map(e => e.source.length)));
  return list.map(e => `${e.at}  ${e.level.padEnd(5)}  ${e.source.padEnd(width)}  ${e.text}` + e.more.map(l => "\n" + " ".repeat(33 + width) + l).join("")).join("\n") + (list.length ? "\n" : "");
}

/** @param {string} where */
function read(where) {
  return fs.statSync(where).isDirectory() ? readFolder(where) : readZip(fs.readFileSync(where));
}

function main() {
  const args = process.argv.slice(2);
  /** @type {Record<string, string>} */
  const o = {};
  let where = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) o[args[i].slice(2)] = args[++i] || "";
    else where = args[i];
  }
  if (!where) { console.error("npm run logs -- <zip or folder> [--level WARN|ERROR] [--grep text] [--source name] [--since time] [--until time]"); process.exit(2); }
  process.stdout.write(render(narrow(entries(read(where)), o)));
}

if (require.main === module) main();
module.exports = { readZip, readFolder, entries, narrow, render, sourceOf };
