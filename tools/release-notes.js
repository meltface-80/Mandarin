#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * A version's short notes (item 223): what Settings → Updates shows of a
 * release under the server's and the Android app's buttons. A version's
 * section of CHANGELOG.md opens with one short line for each change
 * ("- Fixed - track times now show on albums", "- New - …", "- Redesign - …")
 * above the entries the repository keeps; these are the short lines alone,
 * "• Fixed - …" one to a line. The server reads the same lines from the
 * release's notes (server/Mandarin.Server/Admin/ReleaseNotes.cs); this is the
 * app's, written into dist/latest.json beside its APK (.github/publish-apk.sh).
 *
 *   node tools/release-notes.js <version>   the notes as JSON (null: none), from
 *                                           the CHANGELOG.md where it is run
 */
const fs = require("fs");
const path = require("path");

/** The kinds of change a short line names, as the update page writes them. */
const KINDS = ["Fixed", "New", "Redesign", "Improved", "Changed", "Removed"];
// A list line at the left edge (an entry's own points are indented), its kind, a dash or colon, its words.
const LINE = new RegExp(`^[-*•]\\s+(${KINDS.join("|")})\\s*[-–—:]\\s+(.+)$`, "i");

/**
 * The short lines of [text] (a version's notes, markdown), "• Fixed - …" one to a line; null when it has none.
 * @param {string} text @returns {string | null}
 */
function shortNotes(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const m = LINE.exec(raw.replace(/\r$/, ""));
    if (!m) continue;
    const kind = KINDS.find(k => k.toLowerCase() === m[1].toLowerCase());
    const words = m[2].replace(/\*\*/g, "").replace(/`/g, "").trim();
    if (words) out.push(`• ${kind} - ${words}`);
  }
  return out.length ? out.join("\n") : null;
}

/**
 * [version]'s section of a changelog ([changelog], its text): the lines under "## v<version>" up to the next version's.
 * @param {string} changelog @param {string} version @returns {string}
 */
function section(changelog, version) {
  const lines = String(changelog).split("\n");
  const start = lines.findIndex(l => l.trim() === `## v${version}`);
  if (start < 0) return "";
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

if (require.main === module) {
  const version = process.argv[2];
  if (!version) { console.error("usage: node tools/release-notes.js <version>"); process.exit(2); }
  const file = path.resolve("CHANGELOG.md");
  const changelog = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  process.stdout.write(JSON.stringify(shortNotes(section(changelog, version))) + "\n");
}

module.exports = { shortNotes, section, KINDS };
