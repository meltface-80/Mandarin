"use strict";
/*
 * Mandarin OS's USB drives (item 389, 0.1.1): the udev rule that mounts one as it is plugged in knows it by what it is
 * plugged into (SUBSYSTEMS=="usb"), never by ID_BUS. udev asks a USB SSD in a SATA enclosure (non-removable) its ATA
 * identity first (ata_id, systemd's 60-persistent-storage.rules), and ID_BUS is then "ata": the rule on ID_BUS=="usb"
 * never met the OptiPlex's three USB SSDs, only sticks and QEMU's USB disks (which answer no ATA, so stay "usb"), and
 * the boot test's virtual drives can't show it. A filesystem on it, added: its mandarin-usb@ service wanted.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const RULE = path.join(__dirname, "..", "os", "mkosi.extra", "etc", "udev", "rules.d", "90-mandarin-usb.rules");

test("a USB drive is known by what it is plugged into, not by the bus udev names (a USB SSD's is ata)", () => {
  const rules = fs.readFileSync(RULE, "utf8").split("\n").filter(l => l.trim() && !l.trim().startsWith("#"));
  assert.equal(rules.length, 1, "one rule");
  const rule = rules[0];
  assert.match(rule, /(^|,\s*)SUBSYSTEMS=="usb"/, "plugged in by USB");
  assert.doesNotMatch(rule, /ID_BUS/, "not by ID_BUS, which is ata for a USB SSD in a SATA enclosure");
  assert.match(rule, /ACTION=="add"/);
  assert.match(rule, /SUBSYSTEM=="block"/);
  assert.match(rule, /ENV\{ID_FS_USAGE\}=="filesystem"/);
  assert.match(rule, /ENV\{SYSTEMD_WANTS\}\+="mandarin-usb@%k\.service"/);
  assert.match(rule, /TAG\+="systemd"/);
});
