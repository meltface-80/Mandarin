"use strict";
/*
 * Mandarin OS's installer, its last screen (item 389, 0.1.1): the installer runs from the USB stick, so the stick is
 * taken out only once the computer is off. Its last screen said to take the stick out, then press Enter: the installer
 * lost its own files ("Input/output error", ext4 errors on the screen) and nothing restarted. Enter switches the
 * computer off, and the screen says to take the stick out then, and switch it on; after it, nothing but the switching
 * off (the boot test runs the installer unattended, which switches off the same way).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const INSTALL = path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os", "install");

test("the installer's last screen switches the computer off, and only then is the stick taken out", () => {
  const lines = fs.readFileSync(INSTALL, "utf8").trimEnd().split("\n");
  const at = lines.findIndex(l => /D --title "Installed"/.test(l));
  assert.ok(at > 0, "the last screen");
  const said = lines[at];
  assert.match(said, /Press Enter: the computer switches off\.\\n\\nThen take the USB stick out and switch the computer on/);
  assert.doesNotMatch(said, /USB stick out[^\\]*then press Enter/i, "the stick isn't taken out while the installer runs from it");
  assert.match(said, /Mandarin OS \$VER is on/, "the version installed");
  assert.deepEqual(lines.slice(at + 1), ["end poweroff"], "Enter switches off, and nothing after it");
});
