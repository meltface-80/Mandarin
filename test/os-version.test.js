"use strict";
/*
 * Mandarin OS's version (CLAUDE.md, rule 7): each change raises its patch number, so the image written to a stick says
 * which it is (the installer's title, the system page, the image's file name). Its changes are under that version in
 * os/CHANGELOG.md, the newest heading there, with nothing above it; the image is published as it is (.img, for a phone's
 * writer, which doesn't decompress) and compressed (.img.xz), with its system partition (.root.raw.xz) and kernel image
 * (.efi) for an installed one to update itself (item 401), each checked and signed; and a pull request that changes
 * Mandarin OS without raising it is refused (os-image.yml's version job).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const OS = path.join(__dirname, "..", "os");

test("Mandarin OS's version is its changelog's newest, and the image is published plain and compressed", () => {
  const v = fs.readFileSync(path.join(OS, "VERSION"), "utf8").trim();
  assert.match(v, /^\d+\.\d+\.\d+$/);
  const first = fs.readFileSync(path.join(OS, "CHANGELOG.md"), "utf8").split("\n").find(l => l.startsWith("## "));
  assert.equal(first, "## v" + v, "os/CHANGELOG.md's newest heading is os/VERSION's");
  const wf = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "os-image.yml"), "utf8");
  assert.match(wf, /xz -T0 -6 -k "mandarin-os-\$v-x64\.img"/, "the .img kept beside the .img.xz");
  // And for an installed one to update itself in place (item 401): its system partition and its kernel image.
  assert.match(wf, /\.github\/sign\.sh mandarin-os-\*\.img mandarin-os-\*\.img\.xz mandarin-os-\*\.root\.raw\.xz mandarin-os-\*\.efi/, "each signed");
  assert.match(wf, /for f in "mandarin-os-\$v-x64\.img" "mandarin-os-\$v-x64\.img\.xz" "mandarin-os-\$v-x64\.root\.raw\.xz" "mandarin-os-\$v-x64\.efi"; do\n[^]*?sha256sum "\$f"/, "each checked");
  assert.match(wf, /-lt 2147483648/, "none over a release's 2 GiB");
  assert.match(wf, /gh release delete-asset test-os/, "an earlier version's files taken off test-os");
  assert.match(wf, /a change to Mandarin OS raises its version/, "a pull request that doesn't raise it refused");
});
