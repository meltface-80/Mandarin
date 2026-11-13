"use strict";
/*
 * Mandarin OS updates itself in place (item 401, 0.1.4): os-update, run as it is on a stand-in installed box
 * (test/os-update-box.js: its disk files, its EFI partition a folder, the commands that touch disks stood in for).
 *   - check: the newest version out, from the test-os pre-release (a test image) or the newest mandarin-os-v* release
 *     carrying a system partition (a released one); only a newer one is offered;
 *   - apply: downloaded, each file's checksum and signature checked; written into the other system partition and never
 *     the one running, read back, labelled mandarin-os_<version>; the box's own (fstab, machine-id, the share's
 *     password, the network, Mandarin Bridge and its identity, a newer Mandarin) carried into it; its kernel image and
 *     an entry of three tries naming its own partition put on the EFI partition, the running version's entry kept, an
 *     older one on the other partition taken off; then the computer started again;
 *   - auto (the weekly upkeep's): as apply, but never a version that didn't start before;
 *   - refused, nothing written and nothing new on the EFI partition: a file not signed with the key, one that isn't what
 *     its checksum says, a new system that numbers Mandarin's user otherwise (its files on the drives would be
 *     another's), and while the version running is itself still being tried.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn, spawnSync, execSync } = require("child_process");
const { makeBox, releaseFiles, serveReleases, testKey, skip, B } = require("./os-update-box");

test("os-update: check, then apply into the other partition, the box's own carried, three tries on the EFI partition", { skip, timeout: 180000 }, async () => {
  const key = testKey(), rel = releaseFiles("0.1.5", key.privateKey);
  const gh = await serveReleases({ "test-os": rel.files });
  const box = makeBox();
  try {
    const env = { MANDARIN_OS_UPDATE_API: gh.api, MANDARIN_OS_UPDATE_KEY: key.pub };
    let r = await box.run("check", env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(box.json("run/mandarin-os/os-update.json").available, "0.1.5");

    const running = fs.readFileSync(path.join(box.dev, "vda2"));
    r = await box.run("apply", env);
    assert.equal(r.status, 0, r.stderr + box.oslog());
    // Written into the other partition, as released, and read back; the one running untouched.
    assert.ok(fs.readFileSync(path.join(box.dev, "vda3")).equals(rel.raw), "the other partition holds the new system");
    assert.ok(fs.readFileSync(path.join(box.dev, "vda2")).equals(running), "the partition running untouched");
    const calls = box.calls();
    const labels = calls.split("\n").filter(l => l.includes("--part-label"));
    assert.deepEqual(labels.map(l => l.split(" ").slice(-2).join(" ")), ["3 _empty", "3 mandarin-os_0.1.5"], calls);
    assert.doesNotMatch(calls, /(e2fsck|resize2fs|mount)[^\n]*vda2/, "never the partition running");
    assert.match(calls, /e2fsck -fy \S+\/vda3/);
    assert.match(calls, /resize2fs \S+\/vda3/);
    // The EFI partition: 0.1.4's entry kept, 0.1.3's (on the partition written) gone with its image, 0.1.5's with three tries.
    assert.deepEqual(box.entries(), ["mandarin-os_0.1.4.conf", "mandarin-os_0.1.5+3.conf"]);
    assert.ok(!box.exists("efi/EFI/mandarin-os/mandarin-os_0.1.3.efi"), "0.1.3's kernel image gone");
    assert.ok(fs.readFileSync(path.join(box.root, "efi/EFI/mandarin-os/mandarin-os_0.1.5.efi")).equals(rel.files["mandarin-os-0.1.5-x64.efi"]));
    assert.equal(box.read("efi/loader/entries/mandarin-os_0.1.5+3.conf"), "title Mandarin OS 0.1.5\nversion 0.1.5\nefi /EFI/mandarin-os/mandarin-os_0.1.5.efi\n" +
      `options root=PARTUUID=${B} rw quiet loglevel=3 console=ttyS0 panic=30\n`, "its own partition, its own command line (no other root=, no ro)");
    // The box's own, carried into the new system.
    const n = p => fs.readFileSync(path.join(box.mounted, p), "utf8");
    for (const p of ["etc/fstab", "etc/machine-id", "var/lib/samba/private/passdb.tdb", "etc/NetworkManager/system-connections/Mandarin.nmconnection",
      "var/lib/NetworkManager/secret_key", "usr/lib/mandarin-bridge/mandarin-bridge", "etc/systemd/system/mandarin-bridge.service",
      "var/lib/private/mandarin-bridge/identity.json"]) assert.equal(n(p), box.read(p), p);
    assert.equal(fs.readlinkSync(path.join(box.mounted, "var/lib/mandarin-bridge")), "private/mandarin-bridge");
    assert.ok(fs.existsSync(path.join(box.mounted, "etc/systemd/system/multi-user.target.wants/mandarin-bridge.service")), "the Bridge still started");
    assert.equal(n("opt/mandarin/server/bin/mandarin-server.version"), "1.4.0\n", "Mandarin 1.4.0 kept over the image's 1.4.0-t3, a test build before it");
    assert.match(n("etc/passwd"), /systemd-network:x:998/, "the new system's own users, not this one's");
    // Then the computer started again, the update to come said for its first start.
    assert.match(calls, /^systemctl reboot$/m);
    const pending = box.json("data/MandarinOS/update-pending.json");
    assert.deepEqual([pending.from, pending.to, pending.mandarin], ["0.1.4", "0.1.5", false], "Mandarin not answering here: not asked of the new one");
    assert.equal(box.json("run/mandarin-os/os-update.json").state, "restarting");
    assert.ok(!box.exists("data/MandarinOS/update"), "its download removed");
    assert.match(box.oslog(), /\[update\] Mandarin OS 0\.1\.4 → 0\.1\.5: begun \(the system page\)/);
  } finally { box.cleanup(); gh.close(); }
});

test("os-update: a file not signed with the key, or Mandarin numbered otherwise in the new system: nothing that starts it", { skip, timeout: 180000 }, async () => {
  const key = testKey(), other = testKey();
  const unsigned = await serveReleases({ "test-os": releaseFiles("0.1.5", key.privateKey, { sigKey: other.privateKey }).files });
  const box = makeBox();
  try {
    const was = fs.readFileSync(path.join(box.dev, "vda3"));
    let r = await box.run("apply", { MANDARIN_OS_UPDATE_API: unsigned.api, MANDARIN_OS_UPDATE_KEY: key.pub });
    assert.equal(r.status, 1);
    assert.match(box.json("run/mandarin-os/os-update.json").error, /mandarin-os-0\.1\.5-x64\.efi isn't signed with Mandarin's release key: not taken/);
    assert.ok(fs.readFileSync(path.join(box.dev, "vda3")).equals(was), "nothing written");
    assert.deepEqual(box.entries(), ["mandarin-os_0.1.3.conf", "mandarin-os_0.1.4.conf"], "the EFI partition as it was");
    assert.doesNotMatch(box.calls(), /reboot|--part-label/);
  } finally { box.cleanup(); unsigned.close(); }

  const signed = await serveReleases({ "test-os": releaseFiles("0.1.5", key.privateKey).files });
  const moved = makeBox({ newRoot: { "etc/passwd": "root:x:0:0::/root:/bin/bash\nmandarin:x:989:3500::/data/MandarinServer:/usr/sbin/nologin\n" } });
  try {
    const r = await moved.run("apply", { MANDARIN_OS_UPDATE_API: signed.api, MANDARIN_OS_UPDATE_KEY: key.pub });
    assert.equal(r.status, 1);
    assert.match(moved.json("run/mandarin-os/os-update.json").error, /numbers mandarin as 989:3500, this system as 3500:3500/);
    assert.deepEqual(moved.entries(), ["mandarin-os_0.1.4.conf"], "nothing new to start; 0.1.3's, whose partition was being written, gone");
    assert.match(moved.calls(), /--part-label \S+ 3 _empty/);
    assert.doesNotMatch(moved.calls(), /reboot|mandarin-os_0\.1\.5/);
  } finally { moved.cleanup(); signed.close(); }
});

test("os-update check: a released Mandarin OS follows the newest release with a system partition, and only a newer one", { skip, timeout: 120000 }, async () => {
  const key = testKey(), files = v => releaseFiles(v, key.privateKey, { system: Buffer.from("x") }).files;
  const gh = await serveReleases({ "v1.4.0": { "mandarin-server-linux-x64.gz": Buffer.from("x") }, "mandarin-os-v0.1.10": files("0.1.10"),
    "mandarin-os-v0.1.9": files("0.1.9"), "mandarin-os-v0.1.3": { "mandarin-os-0.1.3-x64.img.xz": Buffer.from("x") }, "test-os": files("0.1.11") });
  const box = makeBox({ from: "release" });
  try {
    const r = await box.run("check", { MANDARIN_OS_UPDATE_API: gh.api });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(box.json("run/mandarin-os/os-update.json").available, "0.1.10", "0.1.10 over 0.1.9; never test-os");
    box.put("usr/lib/mandarin-os/VERSION", "0.1.10\n");
    await box.run("check", { MANDARIN_OS_UPDATE_API: gh.api });
    assert.equal(box.json("run/mandarin-os/os-update.json").available, null, "not newer: none");
  } finally { box.cleanup(); gh.close(); }
});

test("os-update auto (the weekly upkeep): never a version that didn't start before; the computer started again once nothing plays", { skip, timeout: 180000 }, async () => {
  const key = testKey(), rel = releaseFiles("0.1.5", key.privateKey);
  const gh = await serveReleases({ "test-os": rel.files });
  // Mandarin, playing nothing: what the upkeep asks before it starts the computer again.
  const mandarin = http.createServer((req, res) => res.end(JSON.stringify({ ok: true, version: "1.4.0", busy: { any: false } })));
  await new Promise(r => mandarin.listen(0, "127.0.0.1", r));
  const box = makeBox();
  try {
    const env = { MANDARIN_OS_UPDATE_API: gh.api, MANDARIN_OS_UPDATE_KEY: key.pub, MANDARIN_OS_MANDARIN: "http://127.0.0.1:" + mandarin.address().port };
    box.put("data/MandarinOS/update-last.json", JSON.stringify({ result: "failed", from: "0.1.4", to: "0.1.5", at: "2026-11-12 03:00 UTC" }));
    let r = await box.run("auto", env);
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(box.calls(), /--part-label|reboot/, "0.1.5 didn't start last time: left alone");
    assert.match(box.oslog(), /Mandarin OS 0\.1\.5 didn't start last time: the upkeep leaves it/);

    box.put("data/MandarinOS/update-last.json", JSON.stringify({ result: "updated", from: "0.1.3", to: "0.1.4", at: "2026-11-01 03:00 UTC" }));
    r = await box.run("auto", env);
    assert.equal(r.status, 0, r.stderr + box.oslog());
    assert.deepEqual(box.entries(), ["mandarin-os_0.1.4.conf", "mandarin-os_0.1.5+3.conf"]);
    assert.match(box.calls(), /^systemctl reboot$/m);
    assert.match(box.oslog(), /begun \(the weekly upkeep\)/);
    assert.equal(box.json("data/MandarinOS/update-pending.json").mandarin, true, "Mandarin answered: its first starts ask it too");
  } finally { box.cleanup(); gh.close(); mandarin.close(); }
});

test("os-update: refused while the version running is still being tried, and for a file that isn't what its checksum says", { skip, timeout: 180000 }, async () => {
  const key = testKey(), rel = releaseFiles("0.1.5", key.privateKey);
  const gh = await serveReleases({ "test-os": rel.files });
  const box = makeBox();
  try {
    // 0.1.4 started from an entry with tries left, not yet kept (systemd-boot says so in an EFI variable).
    fs.renameSync(path.join(box.root, "efi/loader/entries/mandarin-os_0.1.4.conf"), path.join(box.root, "efi/loader/entries/mandarin-os_0.1.4+2-1.conf"));
    box.put("sys/firmware/efi/efivars/LoaderBootCountPath-4a67b082-0a4c-41cf-b6c7-440b29bb8c4f", "x");
    const r = await box.run("apply", { MANDARIN_OS_UPDATE_API: gh.api, MANDARIN_OS_UPDATE_KEY: key.pub });
    assert.equal(r.status, 1);
    assert.match(box.json("run/mandarin-os/os-update.json").error, /still being tried/);
    assert.doesNotMatch(box.calls(), /--part-label|reboot/);
    assert.deepEqual(box.entries(), ["mandarin-os_0.1.3.conf", "mandarin-os_0.1.4+2-1.conf"], "nothing taken off");
  } finally { box.cleanup(); gh.close(); }

  rel.files["mandarin-os-0.1.5-x64.root.raw.xz.sha256"] = Buffer.from("0".repeat(64) + "  mandarin-os-0.1.5-x64.root.raw.xz\n");
  const wrong = await serveReleases({ "test-os": rel.files });
  const other = makeBox();
  try {
    const r = await other.run("apply", { MANDARIN_OS_UPDATE_API: wrong.api, MANDARIN_OS_UPDATE_KEY: key.pub });
    assert.equal(r.status, 1);
    assert.match(other.json("run/mandarin-os/os-update.json").error, /root\.raw\.xz isn't what its checksum says: not taken/);
    assert.doesNotMatch(other.calls(), /--part-label|reboot|dd /);
    assert.ok(!other.exists("data/MandarinOS/update"), "its download removed");
  } finally { other.cleanup(); wrong.close(); }
});

test("os-update checks signatures against Mandarin's release key, the one Mandarin's own updates are checked against", () => {
  const own = fs.readFileSync(path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os", "os-update"), "utf8");
  const cs = fs.readFileSync(path.join(__dirname, "..", "server", "Mandarin.Server", "Admin", "ReleaseKey.cs"), "utf8");
  const key = /MANDARIN_OS_UPDATE_KEY:-([A-Za-z0-9+/=]+)\}/.exec(own), built = /const string BuiltIn = "([^"]*)"/.exec(cs);
  assert.ok(key && built && built[1].length > 0);
  assert.equal(key[1], built[1]);
});

test("os-update: never restarts while dpkg works, and isn't held back by unattended-upgrades' own service", { skip, timeout: 180000 }, async () => {
  const key = testKey(), rel = releaseFiles("0.1.5", key.privateKey);
  const gh = await serveReleases({ "test-os": rel.files });
  const box = makeBox();
  // Real processes, as pgrep finds them on the box: unattended-upgrades' service, always there and waiting for a
  // shutdown (the boot test's box waited half an hour for it: its name, as the kernel keeps it, is unattended-upgr),
  // and dpkg at work until the update says it waits for it. Each is sleep, started by a link of the name and path it
  // would have (the kernel names a process by what was started; a link needs no copy, nor /tmp to allow programs).
  fs.unlinkSync(path.join(box.dir, "bin", "pgrep"));
  const sleep = execSync("command -v sleep", { shell: "/bin/bash", encoding: "utf8" }).trim();
  const as = (name, comm) => {
    const p = path.join(box.dir, "procs", name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.symlinkSync(sleep, p);
    const child = spawn(p, ["120"], { stdio: "ignore" });
    let failed = null;
    child.on("error", e => { failed = e; });
    return { child, async seen() {
      for (let i = 0; i < 50; i++) {
        if (spawnSync("pgrep", ["-x", comm]).status === 0) return;
        await new Promise(res => setTimeout(res, 100));
      }
      assert.fail(`${name} isn't running as ${comm}: ${failed ? failed.message : "no such process"}`);
    } };
  };
  const waiter = as("unattended-upgrades/unattended-upgrade-shutdown", "unattended-upgr");
  let working = null;
  try {
    await waiter.seen();
    const env = { MANDARIN_OS_UPDATE_API: gh.api, MANDARIN_OS_UPDATE_KEY: key.pub, MANDARIN_OS_APT_WAIT: "1" };
    const dpkg = as("dpkg", "dpkg");
    working = dpkg.child;
    await dpkg.seen();
    const running = box.run("apply", env);
    // dpkg done a few seconds after the update said it waits for it.
    for (let i = 0; i < 600 && !/Debian's packages are being updated/.test(box.oslog()); i++) await new Promise(res => setTimeout(res, 100));
    assert.match(box.oslog(), /Debian's packages are being updated: starting again on Mandarin OS 0\.1\.5 once they are/);
    await new Promise(res => setTimeout(res, 3000));
    assert.doesNotMatch(box.calls(), /reboot/, "not while dpkg works");
    working.kill();
    const done = Date.now();
    const r = await running;
    assert.equal(r.status, 0, r.stderr + box.oslog());
    assert.match(box.calls(), /^systemctl reboot$/m, "then started again");
    assert.ok(Date.now() - done < 10000, "once dpkg was done, not held back by unattended-upgrade-shutdown: " + (Date.now() - done) + " ms");
  } finally { waiter.child.kill(); if (working) working.kill(); box.cleanup(); gh.close(); }
});
