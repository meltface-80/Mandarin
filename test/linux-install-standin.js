"use strict";
/*
 * Stand-ins for tools/linux/install.sh's tests (linux-install.test.js, linux-install-channel.test.js): a release key,
 * a release laid out as GitHub's downloads are (a folder a tag, the bundle and this machine's server in it, each
 * signed), and apt-get, apt-cache, systemctl and the user tools on PATH, each call written to a log.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const { spawn, spawnSync } = require("child_process");

const INSTALL = path.join(__dirname, "..", "tools", "linux", "install.sh");
const RID = os.arch() === "arm64" ? "linux-arm64" : "linux-x64";

function sh(cmd, opts = {}) {
  const r = spawnSync("bash", ["-c", cmd], Object.assign({ encoding: "utf8" }, opts));
  if (r.status !== 0) throw new Error(cmd + ": " + r.stderr);
  return r.stdout;
}

/** A key pair: the private key's file, and the public half as the installer takes it (base64 DER). */
function keyPair(dir, name) {
  const pem = path.join(dir, name + ".pem");
  sh(`openssl ecparam -name prime256v1 -genkey -noout -out "${pem}"`);
  return { pem, pub: sh(`openssl ec -in "${pem}" -pubout -outform DER 2>/dev/null | base64 | tr -d '\\n'`) };
}

/** Mandarin [version] in [dir]/[tag] (v<version> unless said): the bundle and this machine's server, each signed with [key]. */
function release(dir, key, version, tag = "v" + version) {
  const v = path.join(dir, tag), b = path.join(dir, "bundle-" + version);
  fs.mkdirSync(path.join(b, "musicd-server", "public"), { recursive: true });
  fs.writeFileSync(path.join(b, "musicd-server", "package.json"), JSON.stringify({ name: "musicd-server", version }));
  fs.writeFileSync(path.join(b, "musicd-server", "public", "index.html"), "<!doctype html><title>Mandarin</title>");
  fs.mkdirSync(v, { recursive: true });
  sh(`tar -czf "${v}/musicd-server-${version}.tar.gz" -C "${b}" musicd-server`);
  fs.writeFileSync(path.join(v, `mandarin-server-${RID}.gz`), zlib.gzipSync(`#!/bin/sh\n[ "$1" = --version ] && echo ${version}\n`));
  for (const f of [`musicd-server-${version}.tar.gz`, `mandarin-server-${RID}.gz`]) sign(key, path.join(v, f));
  return v;
}

/** [file] signed with [key] ([file].sig beside it, as .github/sign.sh makes it). */
function sign(key, file) { sh(`openssl dgst -sha256 -sign "${key.pem}" -out "${file}.sig" "${file}"`); }

/** apt-get, apt-cache, systemctl and the user tools stood in for: each call written to [log]. */
function shims(dir, log) {
  const bin = path.join(dir, "shims");
  fs.mkdirSync(bin);
  const shim = (name, body = "") => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`, { mode: 0o755 });
  shim("apt-get");
  shim("apt-cache", "echo libicu74");
  shim("systemctl");
  shim("useradd");
  shim("usermod");
  shim("chown");
  shim("getent", "exit 2");
  shim("id", `[ "$1" = mandarin ] && exit 1; exec /usr/bin/id "$@"`);
  return bin;
}

/** A server of the files under [files], and of whatever [extra] answers first (it returns true when it has). */
async function serve(files, extra = () => false) {
  const srv = http.createServer((req, res) => {
    if (extra(req, res)) return;
    const f = path.join(files, decodeURIComponent(req.url));
    if (!f.startsWith(files) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  return srv;
}

/** The installer run with [args] under [env], without blocking (the stand-in release is answered from this process). */
function run(env, ...args) {
  return new Promise((resolve) => {
    const p = spawn("bash", [INSTALL, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", d => { stdout += d; });
    p.stderr.on("data", d => { stderr += d; });
    p.on("close", status => resolve({ status, stdout, stderr }));
  });
}

module.exports = { INSTALL, RID, sh, keyPair, release, sign, shims, serve, run };
