"use strict";
/*
 * Mandarin OS's system page (os/…/system-page/server.py, item 389), run against a stand-in box: its commands (systemctl,
 * Samba's pdbedit, nmcli, lsblk…) stood in for on PATH, its paths under a root of their own, Mandarin a fake answering
 * /api/health:
 *   - the page, and its state: Mandarin running, the services, a USB drive read-only and why, the network;
 *   - only under a home name (an address, mandarin, .local), and a change only from its own page (Origin);
 *   - every change asks for the shared folder's password, checked as Samba keeps it (its NT hash), and five wrong in five
 *     minutes stop it trying more;
 *   - an action done (Restart Mandarin: systemctl restart), a static address with a gateway outside it refused, the logs
 *     read and zipped.
 */
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const { standIn, noPython, PASSWORD } = require("./os-standin");

test("Mandarin OS's system page: its state, its guards, its password, its actions", { skip: noPython, timeout: 60000 }, async () => {
  const box = await standIn();
  const B = box.base, PORT = box.port;
  try {
    const post = (p, body, headers) => fetch(B + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });

    assert.match(await (await fetch(B + "/")).text(), /<title>Mandarin OS<\/title>/);
    const st = await (await fetch(B + "/api/state")).json();
    assert.equal(st.os.version, "0.1.0", box.stderr());
    assert.deepEqual([st.mandarin.answering, st.mandarin.version, st.mandarin.albums], [true, "1.3.1-t1", 1234]);
    assert.equal(st.services.find(s => s.unit === "mandarin.service").state, "active");
    assert.equal(st.services.find(s => s.unit === "mandarin-bridge.service").state, "not installed");
    assert.deepEqual(st.usb.map(u => [u.name, u.read_only, u.why]), [["Music SSD", true, "it wasn't removed safely, and couldn't be repaired"]]);
    assert.deepEqual(st.internal.disks.map(d => d.disk), ["/dev/sdb"], "only the disk that isn't the system's");
    assert.equal(st.network.address, "192.168.0.57/24");
    assert.equal(st.network.dns, "8.8.8.8", "the server's address alone, not resolvectl's link name beside it");
    assert.equal(st.share.user, "music");

    // A home name only; a change only from its own page.
    // (fetch won't send a Host of its own choosing: http.get does.)
    const under = host => new Promise((res, rej) => http.get({ host: "127.0.0.1", port: PORT, path: "/api/state", headers: { Host: host } }, r => { r.resume(); res(r.statusCode); }).on("error", rej));
    assert.equal(await under("evil.example.com"), 421);
    assert.equal(await under("mandarin.local"), 200);
    assert.equal((await post("/api/check", { password: PASSWORD }, { Origin: "http://evil.example.com" })).status, 403);
    // The password, as Samba keeps it.
    assert.equal((await post("/api/check", { password: PASSWORD })).status, 200);
    // An action: Mandarin started again.
    assert.equal((await post("/api/power", { password: PASSWORD, action: "restart-mandarin" })).status, 200);
    assert.match(box.calls(), /^systemctl restart mandarin\.service$/m);
    // A static address whose gateway isn't in its network: refused, nothing changed.
    const bad = await post("/api/network", { password: PASSWORD, mode: "static", address: "192.168.0.80/24", gateway: "10.0.0.1", dns: "1.1.1.1" });
    assert.equal(bad.status, 400);
    assert.doesNotMatch(box.calls(), /network static/);
    // Formatting the system's own disk: refused.
    assert.equal((await post("/api/internal/format", { password: PASSWORD, disk: "/dev/sda", erase: "erase" })).status, 400);
    // The logs, read and zipped.
    assert.match(await (await fetch(B + "/api/logs/os")).text(), /\[usb\] Music SSD \(exfat\) mounted read-only/);
    assert.match(await (await fetch(B + "/api/logs/mandarin")).text(), /\[server\] started/);
    const zip = Buffer.from(await (await fetch(B + "/api/logs.zip")).arrayBuffer());
    assert.equal(zip.slice(0, 2).toString(), "PK");
    assert.ok(zip.includes(Buffer.from("MandarinOS/MandarinOS_log.txt")) && zip.includes(Buffer.from("journal-this-start.txt")));
    // Five wrong passwords, and no more are tried, the right one included.
    for (let i = 0; i < 5; i++) assert.equal((await post("/api/check", { password: "guess" + i })).status, 401);
    assert.equal((await post("/api/check", { password: PASSWORD })).status, 429);
  } finally {
    await box.stop();
  }
});
