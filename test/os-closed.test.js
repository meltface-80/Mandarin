"use strict";
/*
 * Mandarin OS stays closed and looks after itself (item 389; os/), read from what the image is built from (the image
 * itself is built and tested in a virtual machine by .github/workflows/os-image.yml):
 *   - never SSH, sudo or a desktop among its packages; the root account locked; no login on any screen or serial port;
 *   - the firewall refuses everything in by default, and opens only what Mandarin and the system answer;
 *   - apt's own timers off: Debian's security updates alone, applied weekly by the upkeep, which waits for nothing
 *     playing, removes what nothing needs, restarts only when an update needs it, and checks everything after;
 *   - the share: no guest, SMB2 or newer.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const OS = path.join(__dirname, "..", "os");
const read = f => fs.readFileSync(path.join(OS, f), "utf8");

test("Mandarin OS has no way in but its own, and looks after itself", () => {
  const conf = read("mkosi.conf");
  const packages = conf.slice(conf.indexOf("Packages=")).split("\n").slice(1).map(l => l.trim()).filter(Boolean);
  for (const never of ["openssh-server", "ssh", "dropbear", "sudo", "telnetd", "xserver-xorg"]) assert.ok(!packages.includes(never), never);
  for (const need of ["nftables", "samba", "avahi-daemon", "wsdd2", "unattended-upgrades", "ffmpeg", "network-manager"]) assert.ok(packages.includes(need), need);

  const post = read("mkosi.postinst.chroot");
  assert.match(post, /^passwd -l root$/m, "root locked");
  assert.match(post, /systemctl mask getty@\.service serial-getty@\.service autovt@\.service console-getty\.service debug-shell\.service/);
  assert.match(post, /systemctl mask .*apt-daily\.timer apt-daily-upgrade\.timer/, "apt's own timers off");
  assert.match(post, /systemctl enable [^\n]*\\\n[^\n]*nftables\.service/, "the firewall on");

  const fw = read("mkosi.extra/etc/nftables.conf");
  assert.match(fw, /type filter hook input priority filter; policy drop;/);
  assert.match(fw, /tcp dport \{ 80, 445, 3483, 3500, 5357 \} accept/);
  assert.doesNotMatch(fw, /\b22\b/, "nothing for SSH");

  const apt = read("mkosi.extra/etc/apt/apt.conf.d/52mandarin-os");
  assert.match(apt, /Origins-Pattern \{\s*"origin=Debian,codename=\$\{distro_codename\}-security,label=Debian-Security";\s*\};/, "security alone");
  assert.match(apt, /Remove-Unused-Dependencies "true"/);
  assert.match(apt, /Automatic-Reboot "false"/);

  const up = read("mkosi.extra/usr/lib/mandarin-os/maintain");
  assert.match(up, /\.busy\.any/, "waits for nothing under way");
  assert.match(up, /apt-mark manual \$NEEDED/, "never removes what it needs");
  assert.match(up, /autoremove --purge/);
  assert.match(up, /if \[ -f \/run\/reboot-required \]; then\s+wait_idle/, "restarts only when needed, nothing playing");
  assert.match(up, /reinstall-mandarin/, "repairs Mandarin");
  assert.match(read("mkosi.extra/etc/systemd/system/mandarin-os-maintain.timer"), /OnCalendar=Sun 03:00[\s\S]*Persistent=true/);

  const smb = read("mkosi.extra/etc/samba/smb.conf");
  assert.match(smb, /map to guest = never/);
  assert.match(smb, /server min protocol = SMB2_10/);
  assert.match(smb, /valid users = @mandarin-share/);
});
