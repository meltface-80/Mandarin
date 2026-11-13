#!/usr/bin/env node
// @ts-check
"use strict";
/*
 * os/test/fake-os-release.js DIR — a stand-in for GitHub, for the boot test's Mandarin OS update in place (item 401):
 * the Mandarin OS release in DIR/current (a folder of the files os-image.yml publishes: mandarin-os-<version>-x64.root
 * .raw.xz and .efi, each with .sha256 and .sig), as os-update asks for it:
 *   GET /repos/<owner>/<repo>/releases/tags/test-os   the test-os pre-release, a test image's (update-from: test-os)
 *   GET /repos/<owner>/<repo>/releases                 a released image's: the one release, mandarin-os-v<version>
 *   GET /dl/<name>                                     each file, read from the disk as it is asked for
 * DIR/current is read at each request, so the test moves it to the next version (a link) between updates. The port it
 * listens on (127.0.0.1, which QEMU's network reaches as 10.0.2.2) is written to DIR/port once it answers; each request
 * is a line on standard output: "GET <path> <status>".
 */
const fs = require("fs");
const path = require("path");
const http = require("http");

/**
 * The stand-in for the release in [dir]/current, listening on 127.0.0.1.
 * @param {string} dir @returns {Promise<http.Server>}
 */
function serve(dir) {
  const current = path.join(dir, "current");
  const srv = http.createServer((req, res) => {
    const addr = /** @type {import("net").AddressInfo} */ (srv.address());
    const base = `http://${req.headers.host || "127.0.0.1:" + addr.port}`;
    const url = (req.url || "").split("?")[0];
    const said = (/** @type {number} */ status) => process.stdout.write(`${req.method} ${url} ${status}\n`);
    const json = (/** @type {number} */ status, /** @type {unknown} */ body) => {
      res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); said(status);
    };
    const names = fs.existsSync(current) ? fs.readdirSync(current).filter(n => n.startsWith("mandarin-os-")).sort() : [];
    const version = (names.map(n => /^mandarin-os-(.+)-x64\.root\.raw\.xz$/.exec(n)).find(Boolean) || [])[1];
    const assets = names.map(name => ({ name, size: fs.statSync(path.join(current, name)).size, browser_download_url: `${base}/dl/${name}` }));
    if (/^\/repos\/[^/]+\/[^/]+\/releases\/tags\/test-os$/.test(url)) return json(200, { tag_name: "test-os", prerelease: true, draft: false, assets });
    if (/^\/repos\/[^/]+\/[^/]+\/releases$/.test(url)) {
      return json(200, version ? [{ tag_name: "mandarin-os-v" + version, prerelease: false, draft: false, assets }] : []);
    }
    const dl = /^\/dl\/([^/]+)$/.exec(url);
    if (dl && names.includes(dl[1])) {
      const file = path.join(current, dl[1]);
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": fs.statSync(file).size });
      fs.createReadStream(file).pipe(res).on("finish", () => said(200));
      return;
    }
    json(404, { message: "Not Found" });
  });
  return new Promise((resolve, reject) => { srv.once("error", reject); srv.listen(0, "127.0.0.1", () => resolve(srv)); });
}

if (require.main === module) {
  const [dir] = process.argv.slice(2);
  if (!dir) { console.error("os/test/fake-os-release.js DIR"); process.exit(2); }
  fs.mkdirSync(dir, { recursive: true });
  serve(dir).then(srv => {
    const port = /** @type {import("net").AddressInfo} */ (srv.address()).port;
    fs.writeFileSync(path.join(dir, "port"), String(port));
    process.stdout.write(`Mandarin OS releases on 127.0.0.1:${port}\n`);
  }, e => { console.error(e.message); process.exit(1); });
}

module.exports = { serve };
