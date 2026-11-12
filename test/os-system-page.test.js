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
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const ports = require("./ports");

const SERVER = path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os", "system-page", "server.py");
const skip = spawnSync("python3", ["--version"]).status !== 0 && "python3 is not installed";
// Samba's record of it: its NT hash (MD4 of the password in UTF-16LE). Neither OpenSSL 3 nor Node offer MD4, so the
// well-known hash of "password" stands in as the reference, independent of the page's own MD4.
const PASSWORD = "password", NT = "8846F7EAEE8FB117AD06BDD830B7586C";

test("Mandarin OS's system page: its state, its guards, its password, its actions", { skip, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-system-page-"));
  const root = path.join(dir, "root"), bin = path.join(dir, "bin"), calls = path.join(dir, "calls.log");
  const mk = (p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };
  mk("/data/MachineSettings/share-user", "music\n");
  mk("/data/MachineSettings/setup.json", JSON.stringify({ share_user: "music", network: { mode: "dhcp" } }));
  mk("/data/MandarinOS/Logs/MandarinOS_log.txt", "# Mandarin OS 0.1.0 log\n2026-11-12 07:00:00.000 UTC  INFO   [apply] done\n2026-11-12 07:01:00.000 UTC  WARN   [usb] Music SSD (exfat) mounted read-only\n");
  mk("/data/MandarinServer/Logs/MandarinServer_log.txt", "# Mandarin Server 1.3.1-t1 log\n2026-11-12 07:00:01.000 UTC  INFO   [server] started\n");
  mk("/data/Storage/USB/Music SSD/.keep", "");
  mk("/run/mandarin-os/usb/Music SSD", "ro\nit wasn't removed safely, and couldn't be repaired\n");
  mk("/usr/lib/mandarin-os/VERSION", "0.1.0\n");
  mk("/etc/hostname", "mandarin\n");
  fs.mkdirSync(bin);
  const shim = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${calls}"\n${body || ""}\n`, { mode: 0o755 });
  shim("systemctl", `[ "$1" = is-active ] && { case "$2" in mandarin-bridge.service) echo inactive; exit 3 ;; *) echo active ;; esac; }; exit 0`);
  shim("pdbedit", `echo "music:1001:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:${NT}:[U          ]:LCT-00000000:"`);
  shim("nmcli", `echo "eth0:ethernet:connected"`);
  shim("ip", `case "$*" in *"addr show"*) echo "2: eth0    inet 192.168.0.57/24 brd 192.168.0.255 scope global dynamic eth0" ;; *route*) echo "default via 192.168.0.1 dev eth0" ;; esac`);
  shim("findmnt", `case "$*" in *Music*) echo exfat ;; *SOURCE*/) echo /dev/sda2 ;; *) exit 1 ;; esac`);
  shim("lsblk", `case "$*" in *-J*) echo '{"blockdevices":[{"name":"sda","size":256000000000,"model":"SSD","tran":"sata","rm":false,"type":"disk"},{"name":"sdb","size":4000000000000,"model":"WDC WDS400T2B0A","tran":"sata","rm":false,"type":"disk"}]}' ;; *) echo sda ;; esac`);
  shim("journalctl", `echo "2026-11-12T07:00:00 mandarin systemd[1]: Started Mandarin."`);
  // Mandarin, answering its health.
  const mandarin = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, version: "1.3.1-t1", albums: 1234, rooms: 3, busy: { any: false } })); });
  await new Promise(r => mandarin.listen(0, "127.0.0.1", r));
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const page = spawn("python3", [SERVER], { env: Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH, MANDARIN_OS_ROOT: root, MANDARIN_OS_PORT: String(PORT),
    MANDARIN_URL: "http://127.0.0.1:" + mandarin.address().port }), stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; page.stderr.on("data", d => { stderr += d; });
  try {
    for (let i = 0; i < 100; i++) { try { await fetch(B + "/api/state"); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }
    const post = (p, body, headers) => fetch(B + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, headers), body: JSON.stringify(body) });

    assert.match(await (await fetch(B + "/")).text(), /<title>Mandarin OS<\/title>/);
    const st = await (await fetch(B + "/api/state")).json();
    assert.equal(st.os.version, "0.1.0", stderr);
    assert.deepEqual([st.mandarin.answering, st.mandarin.version, st.mandarin.albums], [true, "1.3.1-t1", 1234]);
    assert.equal(st.services.find(s => s.unit === "mandarin.service").state, "active");
    assert.equal(st.services.find(s => s.unit === "mandarin-bridge.service").state, "not installed");
    assert.deepEqual(st.usb.map(u => [u.name, u.read_only, u.why]), [["Music SSD", true, "it wasn't removed safely, and couldn't be repaired"]]);
    assert.deepEqual(st.internal.disks.map(d => d.disk), ["/dev/sdb"], "only the disk that isn't the system's");
    assert.equal(st.network.address, "192.168.0.57/24");
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
    assert.match(fs.readFileSync(calls, "utf8"), /^systemctl restart mandarin\.service$/m);
    // A static address whose gateway isn't in its network: refused, nothing changed.
    const bad = await post("/api/network", { password: PASSWORD, mode: "static", address: "192.168.0.80/24", gateway: "10.0.0.1", dns: "1.1.1.1" });
    assert.equal(bad.status, 400);
    assert.doesNotMatch(fs.readFileSync(calls, "utf8"), /network static/);
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
    page.kill();
    mandarin.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
