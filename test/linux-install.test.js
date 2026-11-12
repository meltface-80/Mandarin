"use strict";
/*
 * Mandarin on Linux without Docker (tools/linux/install.sh; item 389's plan, phase 2), run end to end under a root of
 * its own against a stand-in release, apt-get, systemctl and the user tools stood in for:
 *   - what Mandarin needs from apt; the release's page and this machine's server, each taken only signed with the
 *     release key, into /opt/mandarin; the data folder kept apart; its own user; a systemd service, enabled and started,
 *     that says it is the installer's (MANDARIN_SYSTEMD), started again on a failure but not after Shut down;
 *   - a server not signed with the release key refused, nothing installed;
 *   - run again without --music: the music folder kept; --uninstall: the service and the program gone, the data kept.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const { spawn, spawnSync } = require("child_process");

const ROOT_DIR = path.join(__dirname, "..");
const INSTALL = path.join(ROOT_DIR, "tools", "linux", "install.sh");
const RID = os.arch() === "arm64" ? "linux-arm64" : "linux-x64";
const VERSION = "9.9.9";
const haveOpenssl = spawnSync("openssl", ["version"]).status === 0;
const skip = process.platform !== "linux" ? "Linux only" : !haveOpenssl && "openssl is not installed";

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

/** The stand-in release v9.9.9 in [dir]: the bundle and this machine's server, each signed with [key]. */
function release(dir, key) {
  const v = path.join(dir, "v" + VERSION);
  fs.mkdirSync(path.join(dir, "bundle", "musicd-server", "public"), { recursive: true });
  fs.writeFileSync(path.join(dir, "bundle", "musicd-server", "package.json"), JSON.stringify({ name: "musicd-server", version: VERSION }));
  fs.writeFileSync(path.join(dir, "bundle", "musicd-server", "public", "index.html"), "<!doctype html><title>Mandarin</title>");
  fs.mkdirSync(v, { recursive: true });
  sh(`tar -czf "${v}/musicd-server-${VERSION}.tar.gz" -C "${dir}/bundle" musicd-server`);
  fs.writeFileSync(path.join(v, `mandarin-server-${RID}.gz`), zlib.gzipSync(`#!/bin/sh\n[ "$1" = --version ] && echo ${VERSION}\n`));
  for (const f of [`musicd-server-${VERSION}.tar.gz`, `mandarin-server-${RID}.gz`]) sh(`openssl dgst -sha256 -sign "${key.pem}" -out "${v}/${f}.sig" "${v}/${f}"`);
  return v;
}

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

test("Mandarin installed on Linux as a systemd service, only what is signed with the release key", { skip, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-linux-install-"));
  const files = path.join(dir, "releases");
  const key = keyPair(dir, "release"), other = keyPair(dir, "other");
  const v = release(files, key);
  const srv = http.createServer((req, res) => {
    const f = path.join(files, decodeURIComponent(req.url));
    if (!f.startsWith(files) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(fs.readFileSync(f));
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  try {
    const root = path.join(dir, "root"), log = path.join(dir, "calls.log");
    fs.mkdirSync(path.join(root, "srv", "music"), { recursive: true });
    const env = Object.assign({}, process.env, {
      PATH: shims(dir, log) + ":" + process.env.PATH, MANDARIN_ROOT: root, MANDARIN_VERSION: VERSION,
      MANDARIN_RELEASES: `http://127.0.0.1:${srv.address().port}`, MANDARIN_RELEASE_KEY: key.pub,
    });
    // Run without blocking: the stand-in release is answered from this same process.
    const run = (...args) => new Promise((resolve) => {
      const p = spawn("bash", [INSTALL, ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      p.stdout.on("data", d => { stdout += d; });
      p.stderr.on("data", d => { stderr += d; });
      p.on("close", status => resolve({ status, stdout, stderr }));
    });

    let r = await run("--music", "/srv/music", "--port", "3600");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const opt = path.join(root, "opt", "mandarin");
    assert.equal(sh(`"${opt}/server/bin/mandarin-server" --version`).trim(), VERSION);
    assert.ok(fs.existsSync(path.join(opt, "public", "index.html")), "the page");
    assert.ok(fs.existsSync(path.join(root, "var", "lib", "mandarin")), "the data folder");
    const unit = fs.readFileSync(path.join(root, "etc", "systemd", "system", "mandarin.service"), "utf8");
    for (const l of ["User=mandarin", "Environment=MANDARIN_APP_DIR=/opt/mandarin", "Environment=DATA_DIR=/var/lib/mandarin", "Environment=MUSIC_DIR=/srv/music",
      "Environment=PORT=3600", "Environment=MANDARIN_SYSTEMD=mandarin.service", "ExecStart=/opt/mandarin/server/bin/mandarin-server", "Restart=on-failure", "WantedBy=multi-user.target"]) {
      assert.ok(unit.split("\n").includes(l), l + " in:\n" + unit);
    }
    const calls = fs.readFileSync(log, "utf8");
    assert.match(calls, /^apt-get install -y -q --no-install-recommends ffmpeg poppler-utils python3 python3-numpy curl ca-certificates openssl libicu74$/m);
    assert.match(calls, /^useradd --system .*--groups audio mandarin$/m);
    assert.match(calls, /^systemctl daemon-reload$/m);
    assert.match(calls, /^systemctl enable --now mandarin\.service$/m);

    // Again, without --music: the folder chosen before kept, the server put in place again.
    r = await run();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(root, "etc", "systemd", "system", "mandarin.service"), "utf8"), /^Environment=MUSIC_DIR=\/srv\/music$/m);

    // A server signed with another key: refused, and nothing put in its place.
    fs.rmSync(path.join(opt, "server"), { recursive: true });
    sh(`openssl dgst -sha256 -sign "${other.pem}" -out "${v}/mandarin-server-${RID}.gz.sig" "${v}/mandarin-server-${RID}.gz"`);
    r = await run("--music", "/srv/music");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /server isn't signed with Mandarin's release key: not installed/);
    assert.ok(!fs.existsSync(path.join(opt, "server", "bin", "mandarin-server")), "nothing installed");

    // Mandarin OS's image: its data folder on the data partition, enabled to start with the computer, not started.
    fs.writeFileSync(log, "");
    sh(`openssl dgst -sha256 -sign "${key.pem}" -out "${v}/mandarin-server-${RID}.gz.sig" "${v}/mandarin-server-${RID}.gz"`);
    r = await run("--music", "/data/Storage", "--data", "/data/MandarinServer", "--no-start", "--no-apt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(fs.readFileSync(path.join(root, "etc", "systemd", "system", "mandarin.service"), "utf8"), /^Environment=DATA_DIR=\/data\/MandarinServer$/m);
    assert.ok(fs.existsSync(path.join(root, "data", "MandarinServer")), "the data folder made");
    assert.match(fs.readFileSync(log, "utf8"), /^systemctl enable mandarin\.service$/m);
    assert.doesNotMatch(fs.readFileSync(log, "utf8"), /--now/, "not started");
    assert.doesNotMatch(fs.readFileSync(log, "utf8"), /^apt-get/m, "nothing from apt");
    assert.notEqual((await run("--data", "relative/path")).status, 0, "a whole path only");

    // Uninstalled: the service and the program gone, the data kept.
    r = await run("--uninstall");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(opt) && !fs.existsSync(path.join(root, "etc", "systemd", "system", "mandarin.service")));
    assert.ok(fs.existsSync(path.join(root, "var", "lib", "mandarin")), "the data kept");
    assert.match(r.stdout, /data is kept in .*var\/lib\/mandarin/);
  } finally {
    srv.closeAllConnections();
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
