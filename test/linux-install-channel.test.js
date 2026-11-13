"use strict";
/*
 * tools/linux/install.sh --channel (item 405), which Mandarin OS's Reinstall Mandarin runs: dev installs dev's newest
 * build, the "test-server" pre-release (its version its bundle's name, asked of GitHub's API), checked as a release is
 * (signed with the release key, the server saying its version), and the service told to follow dev's builds in its own
 * updates (MANDARIN_CHANNEL=dev); run again without --channel, it stays on dev; latest goes back to the latest release
 * (found where its page leads, as before) and the service follows the releases again. Under a root of its own, against
 * a stand-in GitHub holding release v9.9.9 and dev's 9.9.10-t3.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { RID, sh, keyPair, release, sign, shims, serve, run } = require("./linux-install-standin");

const haveOpenssl = sh("command -v openssl || true").trim() !== "";
const skip = process.platform !== "linux" ? "Linux only" : !haveOpenssl && "openssl is not installed";

test("--channel dev installs dev's newest build and the service follows dev; --channel latest goes back to the release", { skip, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-linux-channel-"));
  const files = path.join(dir, "releases");
  const key = keyPair(dir, "release"), other = keyPair(dir, "other");
  release(files, key, "9.9.9");
  const dev = release(files, key, "9.9.10-t3", "test-server");
  const asked = [];
  const srv = await serve(files, (req, res) => {
    asked.push(req.url);
    if (req.url === "/latest") { res.writeHead(302, { Location: "/releases/tag/v9.9.9" }); res.end(); return true; }
    if (req.url === "/releases/tag/v9.9.9") { res.writeHead(200); res.end("the release's page"); return true; }
    if (req.url === "/api/releases/tags/test-server") {
      res.writeHead(200, { "Content-Type": "application/json" });
      // As GitHub's API answers, the files in its order: the signature before the bundle.
      res.end(JSON.stringify({ tag_name: "test-server", prerelease: true, assets: fs.readdirSync(dev).sort().reverse().map(name => ({ name })) }, null, 2));
      return true;
    }
    return false;
  });
  try {
    const root = path.join(dir, "root"), log = path.join(dir, "calls.log");
    fs.mkdirSync(path.join(root, "srv", "music"), { recursive: true });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const env = Object.assign({}, process.env, { PATH: shims(dir, log) + ":" + process.env.PATH, MANDARIN_ROOT: root,
      MANDARIN_RELEASES: base, MANDARIN_API: base + "/api", MANDARIN_RELEASE_KEY: key.pub });
    delete env.MANDARIN_VERSION;
    const unit = () => fs.readFileSync(path.join(root, "etc", "systemd", "system", "mandarin.service"), "utf8");
    const version = () => sh(`"${root}/opt/mandarin/server/bin/mandarin-server" --version`).trim();

    let r = await run(env, "--music", "/srv/music", "--channel", "dev", "--no-apt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(version(), "9.9.10-t3");
    assert.ok(asked.includes("/test-server/musicd-server-9.9.10-t3.tar.gz"), "from dev's pre-release: " + asked.join(" "));
    assert.match(unit(), /^Environment=MANDARIN_CHANNEL=dev$/m);
    assert.match(r.stdout, /development build/);

    // Again, without --channel: still dev's.
    r = await run(env, "--no-apt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(unit(), /^Environment=MANDARIN_CHANNEL=dev$/m);
    assert.match(unit(), /^Environment=MUSIC_DIR=\/srv\/music$/m);

    // dev's build signed with another key: refused, nothing put in place.
    fs.rmSync(path.join(root, "opt", "mandarin", "server"), { recursive: true });
    sign(other, path.join(dev, `mandarin-server-${RID}.gz`));
    r = await run(env, "--channel", "dev", "--no-apt");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /server isn't signed with Mandarin's release key: not installed/);
    assert.ok(!fs.existsSync(path.join(root, "opt", "mandarin", "server", "bin", "mandarin-server")), "nothing installed");

    // Back to the latest release: the release, and the service follows the releases.
    r = await run(env, "--channel", "latest", "--no-apt");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(version(), "9.9.9");
    assert.doesNotMatch(unit(), /MANDARIN_CHANNEL/);

    assert.notEqual((await run(env, "--channel", "nightly", "--no-apt")).status, 0, "latest or dev only");
  } finally {
    srv.closeAllConnections();
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
