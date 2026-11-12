"use strict";
/*
 * A stand-in Mandarin OS box for the system page's tests (os/…/system-page/server.py, item 389): the real server, its
 * commands (systemctl, Samba's pdbedit, nmcli, ip, lsblk, resolvectl…) stood in for on PATH and each call written to a
 * log, its paths under a root of its own, and Mandarin a fake answering /api/health.
 *
 *   const box = await standIn({ rooms: 1 });   box.base, box.root, box.calls(), box.stderr(); await box.stop()
 *
 * The password is "password": Samba keeps it as its NT hash (MD4 of it in UTF-16LE). Neither OpenSSL 3 nor Node offer
 * MD4, so the well-known hash of "password" stands in, independent of the page's own MD4.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");
const ports = require("./ports");

const SERVER = path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os", "system-page", "server.py");
const PASSWORD = "password", NT = "8846F7EAEE8FB117AD06BDD830B7586C";
const noPython = spawnSync("python3", ["--version"]).status !== 0 && "python3 is not installed";

/** The box started, its page answering; [opts]: Mandarin's albums and rooms. */
async function standIn({ albums = 1234, rooms = 3 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-system-page-"));
  const root = path.join(dir, "root"), bin = path.join(dir, "bin"), log = path.join(dir, "calls.log");
  const mk = (p, text) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), text); };
  mk("/data/MachineSettings/share-user", "music\n");
  mk("/data/MachineSettings/setup.json", JSON.stringify({ share_user: "music", network: { mode: "dhcp" } }));
  mk("/data/MandarinOS/Logs/MandarinOS_log.txt", "# Mandarin OS 0.1.0 log\n2026-11-12 07:00:00.000 UTC  INFO   [apply] done\n2026-11-12 07:01:00.000 UTC  WARN   [usb] Music SSD (exfat) mounted read-only\n");
  mk("/data/MandarinServer/Logs/MandarinServer_log.txt", "# Mandarin Server 1.3.1-t1 log\n2026-11-12 07:00:01.000 UTC  INFO   [server] started\n" +
    "2026-11-12 07:00:05.000 UTC  INFO   [slimproto] t335.flac: no PCM: Error opening input: Server returned 400 Bad Request\nError opening input file http://127.0.0.1:3500/stream/t335.flac\n");
  // A Bridge's log as the server keeps it (an older Bridge's times: to the second, no UTC), and the app's.
  mk("/data/MandarinServer/Logs/Bridges/Mandarin_Bridge_mandarin.txt", "# — Mandarin Bridge: Mandarin Bridge (mandarin) (linux 0.3.8) —\n2026-11-12 07:00:02 [http] listening on 49494\n2026-11-12 07:00:04 update failed: tar couldn't be run\n");
  mk("/data/MandarinServer/Logs/Apps/Nothing_A142.txt", "# The Mandarin app on Nothing A142\n2026-11-12 07:00:03.250 UTC  WARN   [NET] server POST /api/settings/qobuz/import → SocketTimeoutException\n");
  mk("/data/Storage/USB/Music SSD/.keep", "");
  mk("/run/mandarin-os/usb/Music SSD", "ro\nit wasn't removed safely, and couldn't be repaired\n");
  mk("/usr/lib/mandarin-os/VERSION", "0.1.0\n");
  mk("/etc/hostname", "mandarin\n");
  fs.mkdirSync(bin);
  const shim = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body || ""}\n`, { mode: 0o755 });
  shim("systemctl", `[ "$1" = is-active ] && { case "$2" in mandarin-bridge.service) echo inactive; exit 3 ;; *) echo active ;; esac; }; exit 0`);
  shim("pdbedit", `echo "music:1001:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX:${NT}:[U          ]:LCT-00000000:"`);
  shim("nmcli", `echo "eth0:ethernet:connected"`);
  shim("ip", `case "$*" in *"addr show"*) echo "2: eth0    inet 192.168.0.57/24 brd 192.168.0.255 scope global dynamic eth0" ;; *route*) echo "default via 192.168.0.1 dev eth0" ;; esac`);
  shim("findmnt", `case "$*" in *Music*) echo exfat ;; *SOURCE*/) echo /dev/sda2 ;; *) exit 1 ;; esac`);
  shim("lsblk", `case "$*" in *-J*) echo '{"blockdevices":[{"name":"sda","size":256000000000,"model":"SSD","tran":"sata","rm":false,"type":"disk"},{"name":"sdb","size":4000000000000,"model":"WDC WDS400T2B0A","tran":"sata","rm":false,"type":"disk"}]}' ;; *) echo sda ;; esac`);
  shim("journalctl", `echo "2026-11-12T07:00:00.500000+00:00 mandarin systemd[1]: Started Mandarin."`);
  // As an OptiPlex answered it: the link's name beside its server.
  shim("resolvectl", `printf 'Global:\\nLink 2 (enp0s31f6): 8.8.8.8\\n'`);
  const mandarin = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, version: "1.3.1-t1", albums, rooms, busy: { any: false } }));
  });
  await new Promise(r => mandarin.listen(0, "127.0.0.1", r));
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const page = spawn("python3", [SERVER], { env: Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH, MANDARIN_OS_ROOT: root,
    MANDARIN_OS_PORT: String(port), MANDARIN_URL: "http://127.0.0.1:" + mandarin.address().port }), stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  page.stderr.on("data", d => { stderr += d; });
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + "/api/state"); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); }
  }
  return {
    base, port, root, password: PASSWORD,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""),
    stderr: () => stderr,
    async stop() {
      page.kill();
      mandarin.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

module.exports = { standIn, noPython, PASSWORD };
