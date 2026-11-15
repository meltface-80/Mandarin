"use strict";
/*
 * The computer's own storage drive formatted from the system page (Storage → Internal storage → Format; item 429), on a
 * stand-in box (test/os-standin.js) whose udev, systemd and mount answer as the test says:
 *   - formatted, its new label waited for (udev asked to read it) before it is mounted, and mounted by systemd (the
 *     fstab line's unit), not at once by mount (which systemd undid: the owner's drive, "not yet formatted" after
 *     every try); its top then the shared folder's user's and Mandarin's group's (2775), and only then said done;
 *   - a mount that doesn't hold (systemd says it started, nothing is mounted), a label udev never links (the boot test's
 *     disk: asked of the partition, then of the disk, then what udev, blkid and /dev know said), and a format that
 *     fails: refused on the page and said in the one log with why, with no "done" line and nothing made the shared
 *     folder's.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { standIn, noPython, PASSWORD } = require("./os-standin");

/** Format /dev/sdb on a box whose drive does [internal]: its answer, its calls, its log's lines (logger's). */
async function format(internal) {
  const box = await standIn({ internal });
  try {
    const r = await fetch(box.base + "/api/internal/format", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD, disk: "/dev/sdb", erase: "erase" }) });
    const calls = box.calls().split("\n").filter(Boolean);
    return { status: r.status, body: await r.json(), calls, said: calls.filter(c => c.startsWith("logger ")).map(c => c.replace(/^logger -t mandarin-os -- /, "")),
      fstab: fs.existsSync(path.join(box.root, "etc/fstab")) ? fs.readFileSync(path.join(box.root, "etc/fstab"), "utf8") : "", root: box.root, stderr: box.stderr() };
  } finally {
    await box.stop();
  }
}

test("internal storage formatted: its label read before it is mounted by systemd, then the shared folder's, then said", { skip: noPython, timeout: 60000 }, async () => {
  const f = await format("mounts");
  assert.equal(f.status, 200, JSON.stringify(f.body) + f.stderr);
  assert.equal(f.body.ok, true);
  const at = c => { const i = f.calls.findIndex(x => x.startsWith(c)); assert.ok(i >= 0, `${c} not run: ${f.calls.join("\n")}`); return i; };
  const mkfs = at("mkfs.ext4 -F -L mandarin-internal /dev/sdb1"), label = at("udevadm trigger --action=change --settle /dev/sdb1");
  const reload = at("systemctl daemon-reload"), mount = at("systemctl start data-Storage-Internal.mount");
  const own = at(`chown music:mandarin ${f.root}/data/Storage/Internal`), mode = at(`chmod 2775 ${f.root}/data/Storage/Internal`);
  const done = f.calls.findIndex(c => c.includes("formatted, mounted at /data/Storage/Internal"));
  assert.ok(mkfs < label && label < reload && reload < mount && mount < own && own < mode && mode < done, "in that order: " + f.calls.join("\n"));
  assert.ok(!f.calls.some(c => /^mount /.test(c)), "never mounted by hand, which systemd undoes");
  assert.equal(f.fstab, "LABEL=mandarin-internal  /data/Storage/Internal ext4  defaults,noatime,nofail,x-systemd.device-timeout=30s  0 2\n");
  assert.deepEqual(f.said, ["WARN [system page] internal storage: /dev/sdb being formatted from the system page",
    "INFO [system page] internal storage: /dev/sdb formatted, mounted at /data/Storage/Internal, the shared folder's"]);
});

test("internal storage that doesn't mount, or doesn't format: refused, and said in the log with why", { skip: noPython, timeout: 60000 }, async () => {
  const undone = await format("undone");
  assert.equal(undone.status, 500, undone.stderr);
  assert.match(undone.body.error, /^\/dev\/sdb couldn't be made internal storage: it didn't mount at \/data\/Storage\/Internal/);
  assert.deepEqual(undone.said, ["WARN [system page] internal storage: /dev/sdb being formatted from the system page",
    "ERROR [system page] internal storage: /dev/sdb couldn't be made Storage/Internal: it didn't mount at /data/Storage/Internal: not mounted"]);
  assert.ok(!undone.calls.some(c => c.startsWith("chown ")), "nothing made the shared folder's");
  const unlabelled = await format("unlabelled");
  assert.equal(unlabelled.status, 500, unlabelled.stderr);
  for (const c of ["udevadm trigger --action=change --settle /dev/sdb1", "partx -u /dev/sdb", "udevadm trigger --action=change --settle /dev/sdb"]) {
    assert.ok(unlabelled.calls.includes(c), `${c} not asked: ${unlabelled.calls.join("\n")}`);
  }
  assert.deepEqual(unlabelled.said.slice(1), ["ERROR [system page] internal storage: /dev/sdb couldn't be made Storage/Internal: its label (mandarin-internal) " +
    "didn't appear in /dev/disk/by-label (udev knows of /dev/sdb1: nothing; blkid finds: LABEL=mandarin-internal UUID=0b5e TYPE=ext4; " +
    "/dev/disk/by-label: No such file or directory; systemd-udevd active)"]);
  assert.ok(!unlabelled.calls.some(c => c.startsWith("systemctl start data-Storage-Internal")), "not mounted without its label");
  const mkfs = await format("mkfs-fails");
  assert.equal(mkfs.status, 500);
  assert.deepEqual(mkfs.said.slice(1), ["ERROR [system page] internal storage: /dev/sdb couldn't be made Storage/Internal: mkfs.ext4: /dev/sdb1 is apparently in use by the system; will not make a filesystem here!"]);
  assert.ok(!mkfs.calls.some(c => c.startsWith("systemctl start data-Storage-Internal")), "not mounted");
});
