// @ts-check
"use strict";
/*
 * Mandarin OS is the one way Mandarin is installed (item 426): no public installer of the server's own. Its installer is
 * Mandarin OS's, in the image's own files (os/mkosi.extra/usr/lib/mandarin-os/linux-install.sh), and nothing the
 * public reads (the README, the Pages site in every language, the page and the app) points to another: no install
 * line, no "Install on Linux", no systemd service of its own to start again or reset a password in.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const GONE = [/tools\/linux\/install\.sh/, /install\.html#linux/, /Install on Linux/, /systemctl (start|edit) mandarin/,
  /DATA_DIR=\/var\/lib\/mandarin/];

test("the server's installer is Mandarin OS's own, and no other is offered", () => {
  assert.ok(!fs.existsSync(path.join(ROOT, "tools", "linux", "install.sh")), "no public installer");
  const own = path.join(ROOT, "os", "mkosi.extra", "usr", "lib", "mandarin-os", "linux-install.sh");
  assert.ok(fs.statSync(own).mode & 0o100, "Mandarin OS's, executable, in the image's own files");
  assert.doesNotMatch(read("os/build.sh"), /linux-install\.sh/, "not copied in from elsewhere at build");
  assert.doesNotMatch(read("os/.gitignore"), /linux-install\.sh/, "kept with the rest of Mandarin OS");
  assert.doesNotMatch(read(".github/workflows/os-image.yml"), /tools\/linux/);
});

test("nothing public points to another way to install the server", () => {
  const files = ["README.md", "public/index.html", "public/login.html", "public/login.js", "public/app/settings-account.js",
    "public/app/power.js",
    ...fs.readdirSync(path.join(ROOT, "docs")).filter(f => f.endsWith(".html")).map(f => "docs/" + f),
    ...fs.readdirSync(path.join(ROOT, "docs", "i18n")).filter(f => f.endsWith(".json")).map(f => "docs/i18n/" + f)];
  for (const f of files) for (const re of GONE) assert.doesNotMatch(read(f), re, f);
  assert.doesNotMatch(read("docs/install.html"), /id="linux"/, "no Linux section on the install page");
  assert.doesNotMatch(read("docs/downloads.html"), /raw\.githubusercontent\.com/, "no install line among the downloads");
});
