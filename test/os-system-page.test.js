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
    // Every log as one file (item 389, 0.1.1), in time order, each line with where it came from; a line with no time of
    // its own under the line before it; the files' own headers, and the box, at its head.
    const all = await fetch(B + "/api/logs.txt");
    assert.match(all.headers.get("content-disposition") || "", /attachment; filename="mandarin-logs-\d{8}-\d{4}\.txt"/);
    const text = await all.text();
    assert.match(text, /^# Mandarin — every log on this box, merged in time order \(UTC\)/);
    assert.match(text, /^# Mandarin OS 0\.1\.0 on mandarin/m);
    assert.match(text, /^# USB drives: Music SSD \(exfat, read-only: it wasn't removed safely, and couldn't be repaired\)$/m);
    assert.match(text, /^# \[Bridges\/Mandarin_Bridge_mandarin\] — Mandarin Bridge: Mandarin Bridge \(mandarin\) \(linux 0\.3\.8\) —$/m);
    const lines = text.split("\n").filter(l => /^\d{4}-/.test(l) || l.startsWith("    "));
    assert.deepEqual(lines.map(l => l.replace(/\s+/g, " ")), [
      "2026-11-12 07:00:00.000 MandarinOS/MandarinOS INFO [apply] done",
      "2026-11-12 07:00:00.500 journal INFO systemd[1]: Started Mandarin.",
      "2026-11-12 07:00:01.000 MandarinServer INFO [server] started",
      "2026-11-12 07:00:02.000 Bridges/Mandarin_Bridge_mandarin INFO [http] listening on 49494",
      "2026-11-12 07:00:03.250 Apps/Nothing_A142 WARN [NET] server POST /api/settings/qobuz/import → SocketTimeoutException",
      "2026-11-12 07:00:04.000 Bridges/Mandarin_Bridge_mandarin INFO update failed: tar couldn't be run",
      "2026-11-12 07:00:05.000 MandarinServer INFO [slimproto] t335.flac: no PCM: Error opening input: Server returned 400 Bad Request",
      " Error opening input file http://127.0.0.1:3500/stream/t335.flac",
      "2026-11-12 07:01:00.000 MandarinOS/MandarinOS WARN [usb] Music SSD (exfat) mounted read-only"], text)
    // Five wrong passwords, and no more are tried, the right one included.
    for (let i = 0; i < 5; i++) assert.equal((await post("/api/check", { password: "guess" + i })).status, 401);
    assert.equal((await post("/api/check", { password: PASSWORD })).status, 429);
  } finally {
    await box.stop();
  }
});
