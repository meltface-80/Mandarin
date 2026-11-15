"use strict";
/*
 * Mandarin OS carries Mandarin Bridge's own user's data folder into the next version (item 415, 0.1.7): the Bridge runs
 * as mandarin-bridge (3503 in every version), no longer a DynamicUser, so its data folder is a folder of its own, no
 * longer a link into /var/lib/private. os-update, run as it is on the stand-in box (test/os-update-box.js):
 *   - the folder is carried as it is, who the Bridge is to Mandarin with it;
 *   - a new version numbering the Bridge's user otherwise is refused, as one numbering Mandarin's is: its files would be
 *     another's there. A system from before 0.1.7, with no such user, updates as before (test/os-update.test.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeBox, releaseFiles, serveReleases, testKey, skip } = require("./os-update-box");

const PASSWD = "root:x:0:0::/root:/bin/bash\nmandarin:x:3500:3500::/data/MandarinServer:/usr/sbin/nologin\n";
const BRIDGE = "mandarin-bridge:x:3503:3503::/var/lib/mandarin-bridge:/usr/sbin/nologin\n";

/** The stand-in box as 0.1.7 leaves it: the Bridge's user, its data folder its own (moved back from /var/lib/private). */
function bridgeBox(newRoot) {
  const box = makeBox({ newRoot: Object.assign({ "etc/group": "root:x:0:\nmandarin:x:3500:\nmandarin-bridge:x:3503:\n" }, newRoot) });
  box.put("etc/passwd", box.read("etc/passwd") + BRIDGE);
  box.put("etc/group", box.read("etc/group") + "mandarin-bridge:x:3503:\n");
  fs.unlinkSync(path.join(box.root, "var/lib/mandarin-bridge"));
  fs.rmSync(path.join(box.root, "var/lib/private"), { recursive: true });
  box.put("var/lib/mandarin-bridge/settings.json", "{\"udn\":\"uuid:the-bridge\"}\n");
  box.put("var/lib/mandarin-bridge/app/mandarin-bridge", "the update it fetched\n");
  return box;
}

test("os-update: the Bridge's own data folder carried; a version numbering its user otherwise refused", { skip, timeout: 180000 }, async (t) => {
  const key = testKey(), rel = releaseFiles("0.1.5", key.privateKey);
  const gh = await serveReleases({ "test-os": rel.files });
  const env = { MANDARIN_OS_UPDATE_API: gh.api, MANDARIN_OS_UPDATE_KEY: key.pub };
  t.after(() => gh.close());
  const box = bridgeBox({ "etc/passwd": PASSWD + BRIDGE });
  try {
    const r = await box.run("apply", env);
    assert.equal(r.status, 0, r.stderr + box.oslog());
    const n = p => path.join(box.mounted, p);
    assert.ok(fs.lstatSync(n("var/lib/mandarin-bridge")).isDirectory(), "a folder, as it is here");
    for (const p of ["var/lib/mandarin-bridge/settings.json", "var/lib/mandarin-bridge/app/mandarin-bridge"]) assert.equal(fs.readFileSync(n(p), "utf8"), box.read(p), p);
    assert.ok(!fs.existsSync(n("var/lib/private/mandarin-bridge")), "nothing in /var/lib/private");
    assert.match(box.calls(), /^systemctl reboot$/m);
  } finally { box.cleanup(); }

  const moved = bridgeBox({ "etc/passwd": PASSWD + "mandarin-bridge:x:990:990::/var/lib/mandarin-bridge:/usr/sbin/nologin\n" });
  try {
    const r = await moved.run("apply", env);
    assert.equal(r.status, 1, r.stderr + moved.oslog());
    assert.match(moved.json("run/mandarin-os/os-update.json").error, /numbers mandarin-bridge as 990:3503, this system as 3503:3503/);
    assert.doesNotMatch(moved.calls(), /reboot|mandarin-os_0\.1\.5/);
  } finally { moved.cleanup(); }
});
