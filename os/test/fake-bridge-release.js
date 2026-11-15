#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * os/test/fake-bridge-release.js PROGRAMS DIR — a stand-in for GitHub, for the boot test's Bridge update (item 415): one
 * release of Mandarin Bridge for Linux, as bridge-linux.yml publishes one and as the Bridge's Update.cs asks for it:
 *   GET /repos/<owner>/<repo>/releases/tags/mandarin-bridge-v<version>   the release, its files
 *   GET /dl/<name>   mandarin-bridge-linux-x64.tar.gz (PROGRAMS, a folder holding mandarin-bridge and mandarin-audio:
 *                    os/test/next-bridge.sh's next/), and its sidecar (.json: the build, its SHA-256 and its signature,
 *                    ECDSA P-256 over SHA-256, DER, base64, as bridge/sidecar.sh makes it)
 * <version> is what PROGRAMS' mandarin-bridge says it is (--version). Signed with a key made here and kept nowhere: its
 * public half (base64 of its DER SubjectPublicKeyInfo, what the Bridge's UPDATE_KEY takes) is written to DIR/update.pub,
 * the port it listens on (127.0.0.1, which QEMU's network reaches as 10.0.2.2) to DIR/port, once it answers. Each
 * request is a line on standard output: "GET <path> <status>".
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const TARBALL = "mandarin-bridge-linux-x64.tar.gz";

/**
 * The release's files, by name: the tarball of [programs] (as mandarin-bridge/), made in [dir], and its sidecar for
 * build [commit] at [version], signed with [key].
 * @param {string} programs @param {string} version @param {string} commit @param {crypto.KeyObject} key @param {string} dir
 * @returns {Record<string, Buffer>}
 */
function releaseFiles(programs, version, commit, key, dir) {
  const top = path.join(dir, "pkg", "mandarin-bridge");
  fs.rmSync(path.join(dir, "pkg"), { recursive: true, force: true });
  fs.mkdirSync(top, { recursive: true });
  for (const p of ["mandarin-bridge", "mandarin-audio"]) {
    fs.copyFileSync(path.join(programs, p), path.join(top, p));
    fs.chmodSync(path.join(top, p), 0o755);
  }
  const tgz = path.join(dir, TARBALL);
  execFileSync("tar", ["-C", path.join(dir, "pkg"), "-czf", tgz, "mandarin-bridge"]);
  fs.rmSync(path.join(dir, "pkg"), { recursive: true, force: true });
  const tar = fs.readFileSync(tgz);
  const side = { commit, version, sha256: crypto.createHash("sha256").update(tar).digest("hex"), sig: crypto.sign("sha256", tar, key).toString("base64") };
  return { [TARBALL]: tar, [TARBALL + ".json"]: Buffer.from(JSON.stringify(side)) };
}

/**
 * The stand-in, listening on 127.0.0.1 ([port], 0 for any): the release mandarin-bridge-v[version] of [files].
 * @param {string} version @param {Record<string, Buffer>} files @param {number} [port] @returns {Promise<http.Server>}
 */
function serve(version, files, port = 0) {
  const srv = http.createServer((req, res) => {
    const addr = /** @type {import("net").AddressInfo} */ (srv.address());
    // The address the Bridge asked by (http://10.0.2.2:<port> from the virtual machine): its downloads are asked there too.
    const base = `http://${req.headers.host || "127.0.0.1:" + addr.port}`;
    const url = (req.url || "").split("?")[0];
    const send = (/** @type {number} */ status, /** @type {string} */ type, /** @type {Buffer|string} */ body) => {
      res.writeHead(status, { "Content-Type": type }); res.end(body);
      process.stdout.write(`${req.method} ${url} ${status}\n`);
    };
    const tag = "mandarin-bridge-v" + version;
    if (url.endsWith("/releases/tags/" + tag) && /^\/repos\/[^/]+\/[^/]+\//.test(url)) {
      const assets = Object.keys(files).map(name => ({ name, browser_download_url: `${base}/dl/${name}` }));
      return send(200, "application/json", JSON.stringify({ tag_name: tag, prerelease: false, draft: false, assets }));
    }
    const dl = /^\/dl\/(.+)$/.exec(url);
    if (dl && files[dl[1]]) return send(200, "application/octet-stream", files[dl[1]]);
    send(404, "application/json", JSON.stringify({ message: "Not Found" }));
  });
  return new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(port, "127.0.0.1", () => resolve(srv)); });
}

if (require.main === module) {
  const [programs, dir] = process.argv.slice(2);
  if (!programs || !dir) { console.error("os/test/fake-bridge-release.js PROGRAMS DIR"); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  const said = execFileSync(path.join(programs, "mandarin-bridge"), ["--version"], { encoding: "utf8" }).trim();
  const m = /^mandarin-bridge (\S+) \((\S+)\)$/.exec(said);
  if (!m) { console.error("not a Mandarin Bridge: " + said); process.exit(1); }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const files = releaseFiles(programs, m[1], m[2], privateKey, dir);
  serve(m[1], files).then(srv => {
    const port = /** @type {import("net").AddressInfo} */ (srv.address()).port;
    fs.writeFileSync(path.join(dir, "update.pub"), publicKey.export({ type: "spki", format: "der" }).toString("base64"));
    fs.writeFileSync(path.join(dir, "port"), String(port));
    process.stdout.write(`Mandarin Bridge ${m[1]} (mandarin-bridge-v${m[1]}) on 127.0.0.1:${port}\n`);
  }, e => { console.error(e.message); process.exit(1); });
}

module.exports = { releaseFiles, serve };
