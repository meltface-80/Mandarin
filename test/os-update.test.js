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
 *   - refused, nothing written and nothing new on the EFI partition: a file not signed with the key, and a new system
 *     that numbers Mandarin's user otherwise (its files on the drives would be another's).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeBox, releaseFiles, serveReleases, testKey, skip, B } = require("./os-update-box");

test("os-update: check, then apply into the other partition, the box's own carried, three tries on the EFI partition", { skip, timeout: 180000 }, async () => {
  const key = testKey(), rel = releaseFiles("0.1.5", key.privateKey);
  const gh = await serveReleases({ "test-os": rel.files });
  const box = makeBox();
  try {
    const env = { MANDARIN_OS_UPDATE_API: gh.api, MANDARIN_OS_UPDATE_KEY: key.pub };
    let r = box.run("check", env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(box.json("run/mandarin-os/os-update.json").available, "0.1.5");

    const running = fs.readFileSync(path.join(box.dev, "vda2"));
    r = box.run("apply", env);
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
    assert.deepEqual([box.json("data/MandarinOS/update-pending.json").from, box.json("data/MandarinOS/update-pending.json").to], ["0.1.4", "0.1.5"]);
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
    let r = box.run("apply", { MANDARIN_OS_UPDATE_API: unsigned.api, MANDARIN_OS_UPDATE_KEY: key.pub });
    assert.equal(r.status, 1);
    assert.match(box.json("run/mandarin-os/os-update.json").error, /mandarin-os-0\.1\.5-x64\.efi isn't signed with Mandarin's release key: not taken/);
    assert.ok(fs.readFileSync(path.join(box.dev, "vda3")).equals(was), "nothing written");
    assert.deepEqual(box.entries(), ["mandarin-os_0.1.3.conf", "mandarin-os_0.1.4.conf"], "the EFI partition as it was");
    assert.doesNotMatch(box.calls(), /reboot|--part-label/);
  } finally { box.cleanup(); unsigned.close(); }

  const signed = await serveReleases({ "test-os": releaseFiles("0.1.5", key.privateKey).files });
  const moved = makeBox({ newRoot: { "etc/passwd": "root:x:0:0::/root:/bin/bash\nmandarin:x:989:3500::/data/MandarinServer:/usr/sbin/nologin\n" } });
  try {
    const r = moved.run("apply", { MANDARIN_OS_UPDATE_API: signed.api, MANDARIN_OS_UPDATE_KEY: key.pub });
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
    const r = box.run("check", { MANDARIN_OS_UPDATE_API: gh.api });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(box.json("run/mandarin-os/os-update.json").available, "0.1.10", "0.1.10 over 0.1.9; never test-os");
    box.put("usr/lib/mandarin-os/VERSION", "0.1.10\n");
    box.run("check", { MANDARIN_OS_UPDATE_API: gh.api });
    assert.equal(box.json("run/mandarin-os/os-update.json").available, null, "not newer: none");
  } finally { box.cleanup(); gh.close(); }
});
