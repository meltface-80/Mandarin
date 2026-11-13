"use strict";
/*
 * A USB drive's files made the shared folder's (item 399, Mandarin OS 0.1.3). The owner's three ext4 drives came from
 * his old server: Mandarin OS mounts a Linux filesystem with the owners it was written with, so over the shared folder
 * their music could be copied but not moved ("Access denied"). On the system page's Storage tab such a drive says so,
 * and "Make them the shared folder's", with the share's password, makes its files the shared folder's user's and the
 * mandarin group's, writable by both: never its lost+found, never a drive mounted read-only, nor one whose files are
 * the shared folder's already (exFAT, NTFS). A change that fails says why.
 * Against the stand-in box (test/os-standin.js): chown and chmod stand in, find runs as it is.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { standIn, noPython, PASSWORD } = require("./os-standin");

test("a Linux drive's files made the shared folder's, from the system page", { skip: noPython, timeout: 60000 }, async () => {
  const box = await standIn({ linuxDrives: true });
  const B = box.base;
  try {
    const post = (p, body) => fetch(B + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const usb = async () => Object.fromEntries((await (await fetch(B + "/api/state")).json()).usb.map(u => [u.name, u]));
    let st = await usb();
    assert.deepEqual([st["Old Drive"].fs, st["Old Drive"].others, st["Old Drive"].changing], ["ext4", true, ""], box.stderr());
    assert.equal(st["Music SSD"].others, false, "an exFAT drive's files are the shared folder's");

    assert.equal((await post("/api/usb/own", { password: "wrong", name: "Old Drive" })).status, 401);
    assert.equal((await post("/api/usb/own", { password: PASSWORD, name: "../.." })).status, 404);
    assert.equal((await post("/api/usb/own", { password: PASSWORD, name: "Music SSD" })).status, 409, "read-only");
    const r = await post("/api/usb/own", { password: PASSWORD, name: "Old Drive" });
    assert.equal(r.status, 200);
    assert.match((await r.json()).said, /being made the shared folder's/);
    for (let i = 0; i < 100 && (await usb())["Old Drive"].changing; i++) await new Promise(res => setTimeout(res, 100));
    assert.equal((await usb())["Old Drive"].changing, "", "done");

    const mp = path.join(box.root, "data/Storage/USB/Old Drive");
    const calls = box.calls().split("\n").filter(l => l.includes("Old Drive"));
    assert.ok(calls.includes(`chown music:mandarin ${mp}`), calls.join("\n"));
    assert.ok(calls.includes(`chown -R music:mandarin ${mp}/Artist`), "its music, every file under it: " + calls.join("\n"));
    assert.ok(calls.includes(`chmod -R u+rwX,g+rwX ${mp}/Artist`), "writable by the shared folder and Mandarin's group: " + calls.join("\n"));
    assert.ok(!calls.some(l => l.includes("lost+found")), "never its lost+found: " + calls.join("\n"));

    // One that can't be changed: said why, on the page.
    assert.equal((await post("/api/usb/own", { password: PASSWORD, name: "Broken Drive" })).status, 200);
    let broken = "";
    for (let i = 0; i < 100 && !(broken = (await usb())["Broken Drive"].changing).startsWith("failed"); i++) await new Promise(res => setTimeout(res, 100));
    assert.match(broken, /^failed: chown: changing ownership of 'x': Operation not permitted/);
  } finally { await box.stop(); }
});
