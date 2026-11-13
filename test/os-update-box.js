"use strict";
/*
 * A stand-in installed Mandarin OS 0.1.4 for os-update's and os-started's tests (item 401): their scripts run as they
 * are, every file under a root of the test's own (MANDARIN_OS_ROOT), the commands that touch disks stood in for on PATH
 * (each call written to a log), and the system disk files of the test's own: dev/vda2 the system running, dev/vda3 the
 * other system partition, the EFI partition a folder (root/efi) with 0.1.4's entry, and an older one left on vda3.
 *
 *   const box = makeBox({ newRoot: { "etc/passwd": "…" } });   box.run("apply", { env }), box.calls(), box.read(p)…
 *
 * mount of the other partition copies [newRoot] (what the release's system partition holds) into the mount point;
 * the rest is real: curl, openssl, sha256sum, xz, dd (into dev/vda3, a file), jq, flock.
 * makeRelease(): Mandarin OS [version]'s files as the os-image workflow publishes them (a system partition, a kernel
 * image with its .cmdline, each with .sha256 and .sig), served as GitHub's API serves the test-os pre-release and the
 * releases, signed with a key made for the test.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, spawnSync, execFileSync } = require("child_process");

const LIB = path.join(__dirname, "..", "os", "mkosi.extra", "usr", "lib", "mandarin-os");
const A = "aaaaaaaa-0000-4000-8000-000000000002", B = "bbbbbbbb-0000-4000-8000-000000000003";
const ROOT_TYPE = "4F68BCE3-E8CD-4DB1-96E7-FBCAF984B709", ESP_TYPE = "C12A7328-F81F-11D2-BA4B-00A0C93EC93B";
const missing = ["bash", "xz", "openssl", "jq", "flock", "curl"].find(c => spawnSync("sh", ["-c", "command -v " + c]).status !== 0);
const skip = process.platform !== "linux" ? "Linux only" : missing ? missing + " is not installed" : false;

/** A unified kernel image as small as one can be: a PE file with a .cmdline section. */
function uki(cmdline) {
  const pe = 0x40, buf = Buffer.alloc(0x400);
  buf.write("MZ", 0, "latin1"); buf.writeUInt32LE(pe, 0x3c);
  buf.write("PE\0\0", pe, "latin1"); buf.writeUInt16LE(0x8664, pe + 4); buf.writeUInt16LE(1, pe + 6); buf.writeUInt16LE(0, pe + 20);
  const s = pe + 24;
  buf.write(".cmdline", s, "latin1"); buf.writeUInt32LE(cmdline.length + 1, s + 8); buf.writeUInt32LE(0x1000, s + 12);
  buf.writeUInt32LE(0x200, s + 16); buf.writeUInt32LE(0x200, s + 20);
  buf.write(cmdline, 0x200, "latin1");
  return buf;
}

/** Mandarin OS [version]'s release files, signed with [key] (or [sigKey] where a test wants them signed by another). */
function releaseFiles(version, key, { sigKey, system } = {}) {
  const raw = system || crypto.randomBytes(3 * 1024 * 1024);
  const xz = execFileSync("xz", ["-c", "-1"], { input: raw, maxBuffer: 64 << 20 });
  const files = { [`mandarin-os-${version}-x64.root.raw.xz`]: xz, [`mandarin-os-${version}-x64.efi`]: uki("quiet loglevel=3 console=ttyS0 panic=30 root=LABEL=nope ro") };
  for (const [name, data] of Object.entries(files)) {
    files[name + ".sha256"] = Buffer.from(`${crypto.createHash("sha256").update(data).digest("hex")}  ${name}\n`);
    files[name + ".sig"] = crypto.sign("sha256", data, sigKey || key);
  }
  return { files, raw };
}

/** GitHub as os-update asks it: the test-os pre-release and the list of releases, of [releases] ({ tag: files }). */
async function serveReleases(releases) {
  const srv = http.createServer((req, res) => {
    const base = "http://127.0.0.1:" + srv.address().port;
    const one = (tag, files) => ({ tag_name: tag, prerelease: tag === "test-os", draft: false,
      assets: Object.keys(files).map(name => ({ name, size: files[name].length, browser_download_url: `${base}/dl/${tag}/${name}` })) });
    const url = req.url || "";
    let m;
    if (url.startsWith("/repos/o/r/releases?")) return res.end(JSON.stringify(Object.entries(releases).map(([t, f]) => one(t, f))));
    if ((m = /^\/repos\/o\/r\/releases\/tags\/(.+)$/.exec(url)) && releases[m[1]]) return res.end(JSON.stringify(one(m[1], releases[m[1]])));
    if ((m = /^\/dl\/([^/]+)\/(.+)$/.exec(url)) && releases[m[1]] && releases[m[1]][m[2]]) return res.end(releases[m[1]][m[2]]);
    res.writeHead(404); res.end("{}");
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  return { api: `http://127.0.0.1:${srv.address().port}/repos/o/r`, close: () => srv.close() };
}

/** The stand-in box, as described above. */
function makeBox({ newRoot = {}, version = "0.1.4", mandarin = "1.4.0", from = "test-os" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-os-update-"));
  const root = path.join(dir, "root"), bin = path.join(dir, "bin"), lib = path.join(dir, "lib"), dev = path.join(dir, "dev"), log = path.join(dir, "calls.log");
  const put = (base, p, text) => { fs.mkdirSync(path.dirname(path.join(base, p)), { recursive: true }); fs.writeFileSync(path.join(base, p), text); };
  for (const d of [bin, lib, dev]) fs.mkdirSync(d, { recursive: true });
  for (const f of ["os-update", "os-started", "boot.sh", "log.sh", "uki-cmdline"]) fs.copyFileSync(path.join(LIB, f), path.join(lib, f));
  put(lib, "update-from", from + "\n");
  const own = {
    "usr/lib/mandarin-os/VERSION": version + "\n", "data/MachineSettings/share-user": "music\n", "data/MachineSettings/share-uid": "3501\n",
    "etc/passwd": "root:x:0:0::/root:/bin/bash\nmandarin:x:3500:3500::/data/MandarinServer:/usr/sbin/nologin\nmusic:x:3501:3500::/data/Share:/usr/sbin/nologin\n",
    "etc/group": "root:x:0:\nmandarin:x:3500:music\n", "etc/fstab": "LABEL=mandarin-data /data ext4 defaults,nofail 0 2\n",
    "etc/machine-id": "0123456789abcdef0123456789abcdef\n", "var/lib/samba/private/passdb.tdb": "the share's password\n",
    "etc/NetworkManager/system-connections/Mandarin.nmconnection": "[ipv4]\nmethod=manual\naddress1=192.168.1.20/24\n",
    "var/lib/NetworkManager/secret_key": "nm\n", "usr/lib/mandarin-bridge/mandarin-bridge": "bridge\n",
    "etc/systemd/system/mandarin-bridge.service": "[Service]\n", "var/lib/private/mandarin-bridge/identity.json": "{\"id\":\"the bridge\"}\n",
    "opt/mandarin/server/bin/mandarin-server.version": mandarin + "\n", "opt/mandarin/server/bin/mandarin-server": "mandarin " + mandarin + "\n",
    "efi/EFI/mandarin-os/mandarin-os_0.1.4.efi": "0.1.4's kernel\n", "efi/EFI/mandarin-os/mandarin-os_0.1.3.efi": "0.1.3's kernel\n",
    "efi/loader/entries/mandarin-os_0.1.4.conf": `title Mandarin OS 0.1.4\nversion 0.1.4\nefi /EFI/mandarin-os/mandarin-os_0.1.4.efi\noptions root=PARTUUID=${A} rw quiet\n`,
    "efi/loader/entries/mandarin-os_0.1.3.conf": `title Mandarin OS 0.1.3\nversion 0.1.3\nefi /EFI/mandarin-os/mandarin-os_0.1.3.efi\noptions root=PARTUUID=${B.toUpperCase()} rw quiet\n`
  };
  for (const [p, text] of Object.entries(own)) put(root, p, text);
  fs.symlinkSync("private/mandarin-bridge", path.join(root, "var/lib/mandarin-bridge"));
  const wants = path.join(root, "etc/systemd/system/multi-user.target.wants");
  fs.mkdirSync(wants, { recursive: true });
  fs.symlinkSync("../mandarin-bridge.service", path.join(wants, "mandarin-bridge.service"));
  const tmpl = path.join(dir, "new-root");
  const img = Object.assign({ "usr/lib/mandarin-os/VERSION": "0.1.5\n", "etc/fstab": "# none\n", "etc/machine-id": "uninitialized\n",
    "etc/passwd": "root:x:0:0::/root:/bin/bash\nsystemd-network:x:998:998::/:/usr/sbin/nologin\nmandarin:x:3500:3500::/data/MandarinServer:/usr/sbin/nologin\n",
    "etc/group": "root:x:0:\nmandarin:x:3500:\n", "var/lib/samba/private/.keep": "", "opt/mandarin/server/bin/mandarin-server.version": "1.4.0-t3\n" }, newRoot);
  for (const [p, text] of Object.entries(img)) put(tmpl, p, text);
  fs.writeFileSync(path.join(dev, "vda2"), "the system running\n".repeat(1000));
  fs.writeFileSync(path.join(dev, "vda3"), "0.1.3, on the other partition\n".repeat(1000));
  const table = { partitiontable: { label: "gpt", device: dev + "/vda", unit: "sectors", sectorsize: 512, partitions: [
    { node: dev + "/vda1", start: 2048, size: 1048576, type: ESP_TYPE, uuid: "EEEEEEEE-0000-4000-8000-000000000001", name: "esp" },
    { node: dev + "/vda2", start: 1050624, size: 8388608, type: ROOT_TYPE, uuid: A.toUpperCase(), name: "mandarin-os_0.1.4" },
    { node: dev + "/vda3", start: 9439232, size: 8388608, type: ROOT_TYPE, uuid: B.toUpperCase(), name: "mandarin-os_0.1.3" },
    { node: dev + "/vda4", start: 17827840, size: 50000000, type: "0FC63DAF-8483-4772-8E79-3D69D8477DE4", uuid: "DDDDDDDD-0000-4000-8000-000000000004", name: "mandarin-data" }] } };
  const script = (file, what, env) => new Promise(resolve => {
    const p = spawn("bash", [file, what], { env: Object.assign({}, process.env, { PATH: bin + ":" + process.env.PATH, MANDARIN_OS_ROOT: root,
      MANDARIN_OS_MANDARIN: "http://127.0.0.1:9", MANDARIN_OS_PAGE: "http://127.0.0.1:9" }, env) });
    let stdout = "", stderr = "";
    p.stdout.on("data", d => { stdout += d; });
    p.stderr.on("data", d => { stderr += d; });
    const kill = setTimeout(() => p.kill(), 120000);
    p.on("close", status => { clearTimeout(kill); resolve({ status, stdout, stderr }); });
  });
  const shim = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\necho "${name} $*" >> "${log}"\n${body || ""}\n`, { mode: 0o755 });
  shim("findmnt", `case "$*" in "-no SOURCE /") echo "${dev}/vda2" ;; *"-S ${dev}/vda1") echo "${root}/efi" ;; *) exit 1 ;; esac`);
  shim("lsblk", `case "$*" in *PKNAME*) echo vda ;; *) exit 1 ;; esac`);
  shim("sfdisk", `[ "$1" = -J ] && { cat <<'EOF'\n${JSON.stringify(table)}\nEOF\n}; exit 0`);
  shim("mount", `for a; do last="$a"; done; case "$last" in */update-root) cp -a "${tmpl}/." "$last/" ;; esac`);
  shim("mountpoint", `case "$2" in */data) exit 0 ;; *) exit 1 ;; esac`);
  for (const c of ["umount", "e2fsck", "resize2fs", "blockdev", "systemctl"]) shim(c);
  shim("pgrep", "exit 1");   // no apt running on the box
  shim("logger", `printf '%s\\n' "$*" >> "${dir}/oslog"`);
  return {
    dir, root, dev, tmpl, mounted: path.join(root, "run/mandarin-os/update-root"),
    /** os-update [what], as it runs: asynchronously, so a stand-in GitHub in the test's own process can answer it. */
    run: (what, env) => script(path.join(lib, "os-update"), what, env),
    /** os-started [what]. */
    started: (what, env) => script(path.join(lib, "os-started"), what, env),
    shim,
    calls: () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8") : ""),
    oslog: () => (fs.existsSync(path.join(dir, "oslog")) ? fs.readFileSync(path.join(dir, "oslog"), "utf8") : ""),
    read: (p) => fs.readFileSync(path.join(root, p), "utf8"),
    json: (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8")),
    exists: (p) => fs.existsSync(path.join(root, p)),
    entries: () => fs.readdirSync(path.join(root, "efi/loader/entries")).sort(),
    put: (p, text) => put(root, p, text),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true })
  };
}

/** A key pair for the test's signatures: the private key, and the public half as MANDARIN_OS_UPDATE_KEY takes it. */
function testKey() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { privateKey, pub: publicKey.export({ type: "spki", format: "der" }).toString("base64") };
}

module.exports = { makeBox, releaseFiles, serveReleases, testKey, uki, skip, A, B, LIB };
