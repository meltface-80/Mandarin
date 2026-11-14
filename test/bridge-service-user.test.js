"use strict";
/*
 * Mandarin Bridge for Linux runs as its own user, never a DynamicUser (item 415). From systemd 256 (Debian 13, Mandarin
 * OS's 257) a DynamicUser's data folder is mounted ID-mapped, and systemd mounts those noexec: the Bridge's update,
 * unpacked into its data folder and run from there, failed with "Permission denied". Read from what is installed:
 *   - the service install.sh installs: User= and Group= mandarin-bridge, no DynamicUser, its data folder made the
 *     Bridge's before it starts (one a DynamicUser left is nobody's, which systemd would still mount noexec), and what
 *     a DynamicUser had (a read-only system, its own /tmp, no new privileges) said as it is;
 *   - install.sh makes the user (kept where it is) before the service is installed and started; run here with useradd
 *     and the rest stood in for;
 *   - Mandarin OS: the user numbered 3503 in the image and by apply, and a drop-in that makes a service installed before
 *     (a DynamicUser's, carried from version to version) run as it;
 *   - the Raspberry Pi image's drop-in keeps its Bridge running as root, as it always has;
 *   - each unit as systemd reads it (systemd-analyze verify), where systemd is here.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(ROOT, p), "utf8");
const SERVICE = "bridge/linux/mandarin-bridge.service";
const DROPIN = "os/mkosi.extra/etc/systemd/system/mandarin-bridge.service.d/mandarin-os.conf";
const CHOWN = /^ExecStartPre=\+-\/bin\/chown -R mandarin-bridge:mandarin-bridge \/var\/lib\/mandarin-bridge$/m;
const HARDENED = ["ProtectSystem=strict", "ProtectHome=read-only", "PrivateTmp=yes", "NoNewPrivileges=yes", "RestrictSUIDSGID=yes", "RemoveIPC=yes"];
/** The values [key] is given in [unit], in order. */
const values = (unit, key) => unit.split("\n").filter(l => l.startsWith(key + "=")).map(l => l.slice(key.length + 1));

test("the Linux Bridge's service runs as its own user, its data folder its own", () => {
  const unit = read(SERVICE);
  assert.deepEqual(values(unit, "DynamicUser"), [], "no DynamicUser");
  assert.deepEqual(values(unit, "User"), ["mandarin-bridge"]);
  assert.deepEqual(values(unit, "Group"), ["mandarin-bridge"]);
  assert.deepEqual(values(unit, "StateDirectory"), ["mandarin-bridge"]);
  assert.deepEqual(values(unit, "SupplementaryGroups"), ["audio"]);
  assert.match(unit, /^ExecStart=\/usr\/lib\/mandarin-bridge\/mandarin-bridge --data \/var\/lib\/mandarin-bridge /m);
  assert.match(unit, CHOWN, "its data folder made its own, as root, before it starts");
  for (const l of ["Environment=HOME=/var/lib/mandarin-bridge", "AmbientCapabilities=CAP_SYS_NICE", "LimitRTPRIO=95", "LimitMEMLOCK=infinity", ...HARDENED]) {
    assert.ok(unit.split("\n").includes(l), l);
  }
});

test("install.sh makes the Bridge's user, keeping one that is there, before it installs and starts the service", { skip: process.platform === "win32" && "sh" }, () => {
  const install = read("bridge/linux/install.sh");
  const lines = install.split("\n");
  const from = lines.findIndex(l => l.startsWith("if ! id -u mandarin-bridge"));
  const to = lines.findIndex((l, i) => i > from && l === "fi");
  assert.ok(from > 0 && to > from, "install.sh's user");
  assert.ok(to < lines.findIndex(l => l.includes("/etc/systemd/system/mandarin-bridge.service")), "before the service is installed");
  /** The step run with [have] (the user, the group, both or none) there: what it asked for. */
  const run = (have) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-user-"));
    try {
      const bin = path.join(dir, "bin"), log = path.join(dir, "log");
      fs.mkdirSync(bin);
      const shim = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
      shim("id", have.includes("user") ? "exit 0" : "exit 1");
      shim("getent", have.includes("group") ? "exit 0" : "exit 2");
      shim("groupadd", "exit 0");
      shim("useradd", "exit 0");
      const r = spawnSync("sh", ["-c", "set -e\n" + lines.slice(from, to + 1).join("\n")], { encoding: "utf8", env: Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH }) });
      assert.equal(r.status, 0, r.stderr);
      return fs.readFileSync(log, "utf8").split("\n").filter(l => /^(useradd|groupadd)/.test(l));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const made = ["useradd --system --gid mandarin-bridge --no-create-home --home-dir /var/lib/mandarin-bridge --shell /usr/sbin/nologin mandarin-bridge"];
  assert.deepEqual(run([]), ["groupadd --system mandarin-bridge", ...made], "none: its group, then its user");
  assert.deepEqual(run(["group"]), made, "its group there (Mandarin OS's): the user in it");
  assert.deepEqual(run(["user", "group"]), [], "there: kept as it is");
});

test("Mandarin OS: the Bridge's user is 3503 in every version, and a service installed before runs as it", () => {
  const post = read("os/mkosi.postinst.chroot");
  assert.match(post, /^groupadd --system --gid 3503 mandarin-bridge$/m);
  assert.match(post, /^useradd --system --uid 3503 --gid mandarin-bridge --home-dir \/var\/lib\/mandarin-bridge --no-create-home --shell \/usr\/sbin\/nologin mandarin-bridge$/m);
  const apply = read("os/mkosi.extra/usr/lib/mandarin-os/apply");
  assert.match(apply, /getent group mandarin-bridge >\/dev\/null \|\| groupadd --system --gid 3503 mandarin-bridge/);
  assert.match(apply, /id mandarin-bridge >\/dev\/null 2>&1 \\\n\s+\|\| useradd --system --uid 3503 --gid mandarin-bridge /);
  for (const n of ["3500", "3501", "3502"]) assert.doesNotMatch(post + apply, new RegExp(`--[ug]id ${n} mandarin-bridge`), "its own number, not another's");

  const drop = read(DROPIN);
  assert.deepEqual(values(drop, "DynamicUser"), ["no"]);
  assert.deepEqual(values(drop, "User"), ["mandarin-bridge"]);
  assert.deepEqual(values(drop, "Group"), ["mandarin-bridge"]);
  assert.deepEqual(values(drop, "ExecStartPre")[0], "", "the service's own reset: its chown run once");
  assert.match(drop, CHOWN);
  for (const l of ["Environment=HOME=/var/lib/mandarin-bridge", ...HARDENED]) assert.ok(drop.split("\n").includes(l), l);
});

test("the Raspberry Pi image's Bridge runs as root, as it always has", () => {
  const pi = read("bridge/pi/pi.conf");
  assert.deepEqual(values(pi, "User"), ["root"]);
  assert.deepEqual(values(pi, "Group"), ["root"]);
  assert.deepEqual(values(pi, "ExecStartPre"), [""], "no chown to a user it hasn't");
  for (const l of ["ProtectSystem=no", "ProtectHome=no", "PrivateTmp=no", "NoNewPrivileges=no"]) assert.ok(pi.split("\n").includes(l), l);
});

const analyze = spawnSync("sh", ["-c", "command -v systemd-analyze"]).status === 0;
test("systemd reads the service, and an old one with Mandarin OS's drop-in, without a complaint", { skip: !analyze && "systemd-analyze is not here" }, () => {
  /** What systemd says of the service [unit] with [dropin] beside it, in a root of the test's own: but that its program and the system's targets aren't there. */
  const said = (unit, dropin) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-unit-"));
    try {
      const sys = path.join(dir, "etc", "systemd", "system");
      fs.mkdirSync(path.join(sys, "mandarin-bridge.service.d"), { recursive: true });
      fs.writeFileSync(path.join(sys, "mandarin-bridge.service"), unit);
      if (dropin) fs.writeFileSync(path.join(sys, "mandarin-bridge.service.d", "mandarin-os.conf"), dropin);
      const r = spawnSync("systemd-analyze", ["verify", "--root=" + dir, "mandarin-bridge.service"], { encoding: "utf8" });
      return (r.stdout + r.stderr).split("\n").filter(l => l.trim() && !/Command \/usr\/lib\/mandarin-bridge\/mandarin-bridge is not executable|Unit \S+\.target not found/.test(l));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  assert.deepEqual(said(read(SERVICE)), [], "install.sh's");
  const old = read("os/test/mandarin-bridge-0.3.11.service");
  assert.deepEqual(values(old, "DynamicUser"), ["yes"], "the service before 0.3.12");
  assert.deepEqual(said(old, read(DROPIN)), [], "the one before it, on Mandarin OS");
  assert.deepEqual(said(read(SERVICE), read(DROPIN)), [], "install.sh's, on Mandarin OS");
  assert.deepEqual(said(read(SERVICE), read("bridge/pi/pi.conf")), [], "install.sh's, on the Pi");
  assert.match(said(old, read(DROPIN) + "NotAKey=1\n").join("\n"), /Unknown key[^\n]*NotAKey/, "what it says of a line it can't read is seen");
});
