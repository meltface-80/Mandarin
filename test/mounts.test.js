"use strict";
/* What the server can see of the machine's drives and shares (server/Mandarin.Server/Mounts.cs; lib/server/mounts.js until v0.8.50). */
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");

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

test("the drives and shares mounted into the container, and a share it can't see", { skip: built() }, () => {
  const { mounts, hints } = score({ fn: "mounts", mountinfo: INFO, dataDir: "/app/data",
    hints: [["/mnt/nas", 0, true], ["/mnt/share", 3, true], ["/srv", 0, true], ["/srv", 0, false]] });
  assert.deepEqual(mounts.map(x => [x.path, x.type, x.waiting]), [
    ["/mnt", "ext4", false],
    ["/mnt/nas", "autofs", true],          // DietPi's on-demand share, not here
    ["/mnt/share", "cifs", false],         // the same kind, mounted: fine
    ["/mnt/usb drive", "ext4", false],
    ["/music", "ext4", false]
  ]);
  assert.match(hints[0], /rslave/);
  assert.equal(hints[1], null);
  assert.match(hints[2], /Nothing from the machine is mounted here/);
  assert.equal(hints[3], null);
});
