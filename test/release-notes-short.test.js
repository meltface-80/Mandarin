"use strict";
/*
 * A release's notes are short (item 344): its CHANGELOG.md section opens with a summary and one short line for each
 * change ("- New - …", "- Changed - …", "- Fixed - …"), and "### Every change" heads the entries the repository keeps.
 * The GitHub release (release.yml) and Settings → Updates (tools/release-notes.js, the server's ReleaseNotes) take the
 * part above it alone, where they took every entry in full; the release says where every change is, under the title
 * Mandarin Server & Remote.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { shortNotes, section } = require("../tools/release-notes");

const CHANGELOG = `# Changelog

## Unreleased

- Fixed - not yet released

## v9.9.9

The summary.

- New - Two acts of one name are two artists
- Fixed - Queuing stopped the one playing

### Every change

- Fixed - queuing an album while another played stopped the one playing, at length (item 337)
- New - two acts of one name, at length (item 330)

## v9.9.8

- Fixed - the one before
`;

test("the short lines alone, for Settings → Updates", () => {
  assert.equal(shortNotes(section(CHANGELOG, "9.9.9")), "• New - Two acts of one name are two artists\n• Fixed - Queuing stopped the one playing");
  assert.equal(shortNotes(section(CHANGELOG, "9.9.8")), "• Fixed - the one before", "a section with no \"### Every change\" whole, as before");
});

test("the release's notes: the summary and the short lines, then where every change is, under its title", () => {
  const yml = fs.readFileSync(path.join(__dirname, "..", ".github/workflows/release.yml"), "utf8");
  const awk = /awk -v h="## v\$v" '([^']+)' CHANGELOG\.md > notes\.md/.exec(yml);
  assert.ok(awk, "release.yml takes its notes from the changelog with awk");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
  fs.writeFileSync(path.join(dir, "CHANGELOG.md"), CHANGELOG);
  const notes = execFileSync("awk", ["-v", "h=## v9.9.9", awk[1], "CHANGELOG.md"], { cwd: dir, encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(notes, "\nThe summary.\n\n- New - Two acts of one name are two artists\n- Fixed - Queuing stopped the one playing\n\n");
  assert.match(yml, /Every change: https:\/\/github\.com\/%s\/blob\/main\/CHANGELOG\.md/);
  assert.match(yml, /--title "Mandarin Server & Remote v\$v"/);
});
