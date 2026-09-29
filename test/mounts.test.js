"use strict";
/* What the server can see of the machine's drives and shares (lib/server/mounts.js). */
const test = require("node:test");
const assert = require("node:assert");
const M = require("../lib/server/mounts");

const INFO = [
  "23 28 0:22 / /proc rw - proc proc rw",
  "28 1 0:40 / / rw - overlay overlay rw",
  "40 28 8:1 /srv/music /music ro,relatime - ext4 /dev/sda1 ro",
  "41 28 179:2 /mnt /mnt ro,relatime master:1 - ext4 /dev/mmcblk0p2 ro",
  "42 41 0:50 / /mnt/nas rw,relatime - autofs systemd-1 rw",
  "43 41 8:17 / /mnt/usb\\040drive rw - ext4 /dev/sdb1 rw",
  "44 41 0:52 / /mnt/share rw - autofs systemd-1 rw",
  "45 44 0:53 / /mnt/share rw - cifs //nas/music rw",
  "46 28 8:1 /data /app/data rw - ext4 /dev/sda1 rw",
  "47 28 8:1 /x /etc/hosts rw - ext4 /dev/sda1 rw"
].join("\n");

test("the drives and shares mounted into the container, and a share it can't see", () => {
  const m = M.musicMounts({ mountinfo: INFO, dataDir: "/app/data" });
  assert.deepEqual(m.map(x => [x.path, x.type, x.waiting]), [
    ["/mnt", "ext4", false],
    ["/mnt/nas", "autofs", true],          // DietPi's on-demand share, not here
    ["/mnt/share", "cifs", false],         // the same kind, mounted: fine
    ["/mnt/usb drive", "ext4", false],
    ["/music", "ext4", false]
  ]);
  assert.match(M.hintFor("/mnt/nas", m, { entries: 0, docker: true }), /rslave/);
  assert.equal(M.hintFor("/mnt/share", m, { entries: 3, docker: true }), null);
  assert.match(M.hintFor("/srv", m, { entries: 0, docker: true }), /Nothing from the machine is mounted here/);
  assert.equal(M.hintFor("/srv", m, { entries: 0, docker: false }), null);
});
