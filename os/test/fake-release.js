#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * os/test/fake-release.js PROGRAM DIR — a stand-in for GitHub, for the boot test's in-app update (item 398): one
 * release, newer than the image's Mandarin, as release.yml publishes one, and as Admin/Updater.cs asks for it:
 *   GET /repos/<owner>/<repo>/releases/latest, /repos/<owner>/<repo>/releases/tags/v<version>  the release, its files
 *   GET /dl/<name>  each file: musicd-server-<version>.tar.gz (this checkout's page and package.json, at <version>),
 *                   mandarin-server-linux-x64.gz (PROGRAM, os/test/next-mandarin.sh's), mandarin-server.sha256, and a
 *                   .sig beside the bundle and the program (ECDSA P-256 over SHA-256, DER, as .github/sign.sh makes them)
 * <version> is what PROGRAM says it is (--version). Signed with a key made here and kept nowhere: its public half
 * (base64 of its DER SubjectPublicKeyInfo, what UPDATE_KEY takes) is written to DIR/update.pub, the port it listens
 * on (127.0.0.1, which QEMU's network reaches as 10.0.2.2) to DIR/port, once it answers. Each request is a line on
 * standard output: "GET <path> <status>".
 */
const fs = require("fs");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const BUILD = "linux-x64";

/**
 * The release's files, by name, for [program] at [version], signed with [key]; the bundle made in [dir].
 * @param {string} program @param {string} version @param {crypto.KeyObject} key @param {string} dir
 * @returns {Record<string, Buffer>}
 */
function releaseFiles(program, version, key, dir) {
  const top = path.join(dir, "bundle", "musicd-server");
  fs.rmSync(path.join(dir, "bundle"), { recursive: true, force: true });
  fs.mkdirSync(path.join(top, "sq-tool"), { recursive: true });
  for (const f of ["public", "README.md", "CHANGELOG.md", "LICENSE"]) fs.cpSync(path.join(ROOT, f), path.join(top, f), { recursive: true });
  fs.cpSync(path.join(ROOT, "sq-tool", "sqtool"), path.join(top, "sq-tool", "sqtool"), { recursive: true });
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  fs.writeFileSync(path.join(top, "package.json"), JSON.stringify(Object.assign(pkg, { version }), null, 2) + "\n");
  const tarball = path.join(dir, "bundle.tar.gz");
  execFileSync("tar", ["-C", path.join(dir, "bundle"), "-czf", tarball, "musicd-server"]);
  fs.rmSync(path.join(dir, "bundle"), { recursive: true, force: true });
  const bundle = fs.readFileSync(tarball), gz = zlib.gzipSync(fs.readFileSync(program));
  const B = `musicd-server-${version}.tar.gz`, S = `mandarin-server-${BUILD}.gz`;
  return {
    [B]: bundle, [B + ".sig"]: crypto.sign("sha256", bundle, key),
    [S]: gz, [S + ".sig"]: crypto.sign("sha256", gz, key),
    "mandarin-server.sha256": Buffer.from(`${crypto.createHash("sha256").update(gz).digest("hex")}  ${S}\n`)
  };
}

/**
 * The stand-in, listening on 127.0.0.1 ([port], 0 for any): the release v[version] of [files].
 * @param {string} version @param {Record<string, Buffer>} files @param {number} [port] @returns {Promise<http.Server>}
 */
function serve(version, files, port = 0) {
  const srv = http.createServer((req, res) => {
    const addr = /** @type {import("net").AddressInfo} */ (srv.address());
    // The address Mandarin asked by (http://10.0.2.2:<port> from the virtual machine): its downloads are asked there too.
    const base = `http://${req.headers.host || "127.0.0.1:" + addr.port}`;
    const url = (req.url || "").split("?")[0];
    const send = (/** @type {number} */ status, /** @type {string} */ type, /** @type {Buffer|string} */ body) => {
      res.writeHead(status, { "Content-Type": type }); res.end(body);
      process.stdout.write(`${req.method} ${url} ${status}\n`);
    };
    const assets = Object.keys(files).map(name => ({ name, browser_download_url: `${base}/dl/${name}` }));
    const rel = /^\/repos\/[^/]+\/[^/]+\/releases\/(latest|tags\/v(.+))$/.exec(url);
    if (rel && (rel[1] === "latest" || rel[2] === version)) {
      return send(200, "application/json", JSON.stringify({ tag_name: "v" + version, html_url: base + "/release",
        body: `Mandarin ${version}, the boot test's update.`, assets }));
    }
    const dl = /^\/dl\/(.+)$/.exec(url);
    if (dl && files[dl[1]]) return send(200, "application/octet-stream", files[dl[1]]);
    send(404, "application/json", JSON.stringify({ message: "Not Found" }));
  });
  return new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(port, "127.0.0.1", () => resolve(srv)); });
}

if (require.main === module) {
  const [program, dir] = process.argv.slice(2);
  if (!program || !dir) { console.error("os/test/fake-release.js PROGRAM DIR"); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  const version = execFileSync(program, ["--version"], { encoding: "utf8" }).trim();
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const files = releaseFiles(program, version, privateKey, dir);
  serve(version, files).then(srv => {
    fs.writeFileSync(path.join(dir, "update.pub"), publicKey.export({ type: "spki", format: "der" }).toString("base64"));
    fs.writeFileSync(path.join(dir, "port"), String(/** @type {import("net").AddressInfo} */ (srv.address()).port));
    process.stdout.write(`release v${version} on 127.0.0.1:${/** @type {import("net").AddressInfo} */ (srv.address()).port}\n`);
  }, e => { console.error(e.message); process.exit(1); });
}

module.exports = { releaseFiles, serve };
