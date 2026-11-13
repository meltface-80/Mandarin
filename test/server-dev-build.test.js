// @ts-check
/*
 * dev's Mandarin Server on the "test-server" pre-release (item 405), which the updater's dev channel reads
 * (Admin/Updater.Channel.cs) and Mandarin OS's Reinstall Mandarin installs on it (tools/linux/install.sh --channel dev):
 *   - .github/server-assets.sh makes a release's files and a test build's alike: the update bundle with its version in
 *     its name and its package.json (a release's package.json as it is), the page and SQ-tool's Python in it;
 *   - release.yml and server-dev.yml both make theirs with it, and sign them with the release key;
 *   - server-dev.yml runs on dev's pushes alone, waits for CI, numbers the build as tools/test-version.js does, and
 *     publishes to test-server as a pre-release, never the latest release, keeping only this version's bundle;
 *   - the updater asks for the pre-release the workflow publishes.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const skip = process.platform !== "linux" && "Linux only";

/** [step]'s text in workflow [yml]: from its "- name:" to the next step. */
function step(/** @type {string} */ yml, /** @type {string} */ name) {
  const i = yml.indexOf("- name: " + name);
  assert.ok(i >= 0, name);
  const j = yml.indexOf("\n      - ", i + 1);
  return yml.slice(i, j < 0 ? undefined : j);
}

/** The bundle server-assets.sh makes at [version]: its package.json, and the names of its files. */
function bundle(/** @type {string} */ version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-server-assets-"));
  try {
    const r = spawnSync(path.join(ROOT, ".github", "server-assets.sh"), ["bundle", version, path.join(dir, "out")], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const tgz = path.join(dir, "out", `musicd-server-${version}.tar.gz`);
    assert.ok(fs.existsSync(tgz), "named by its version");
    const names = spawnSync("tar", ["-tzf", tgz], { encoding: "utf8" }).stdout.split("\n");
    const pkg = spawnSync("tar", ["-xzOf", tgz, "musicd-server/package.json"], { encoding: "utf8" }).stdout;
    return { pkg, names };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("server-assets.sh: a test build's bundle carries its own version; a release's package.json as it is", { skip }, () => {
  const dev = bundle("9.9.9-t5");
  assert.equal(JSON.parse(dev.pkg).version, "9.9.9-t5");
  assert.equal(JSON.parse(dev.pkg).name, "musicd-server");
  for (const n of ["musicd-server/public/index.html", "musicd-server/sq-tool/sqtool/", "musicd-server/CHANGELOG.md", "musicd-server/LICENSE"]) {
    assert.ok(dev.names.includes(n), n + " in the bundle");
  }
  const own = require("../package.json").version;
  assert.equal(bundle(own).pkg, read("package.json"), "a release's package.json, byte for byte");
});

test("release.yml and server-dev.yml make their files with server-assets.sh, and sign them with the release key", () => {
  const release = read(".github/workflows/release.yml"), dev = read(".github/workflows/server-dev.yml");
  assert.ok(step(release, "Build the C# server for in-app updates").includes('.github/server-assets.sh program "$v" out/csharp'));
  assert.ok(step(release, "Build the update bundle and notes").includes('.github/server-assets.sh bundle "$v" .'));
  const build = step(dev, "Build Mandarin Server at dev's test version");
  assert.match(build, /v=\$\(node tools\/test-version\.js\)/);
  assert.ok(build.includes('.github/server-assets.sh program "$v" out') && build.includes('.github/server-assets.sh bundle "$v" out'));
  const sign = step(dev, "Signed with the release key");
  assert.match(sign, /RELEASE_SIGNING_KEY: \$\{\{ secrets\.RELEASE_SIGNING_KEY \}\}/);
  assert.ok(sign.includes('.github/sign.sh out/mandarin-server-*.gz "out/musicd-server-${{ steps.v.outputs.version }}.tar.gz"'));
});

test("server-dev.yml: dev's pushes alone, after CI, onto the test-server pre-release and never the latest release", () => {
  const dev = read(".github/workflows/server-dev.yml");
  assert.match(dev, /\non:\n {2}push:\n {4}branches: \[dev\]\n\n/, "a push to dev, and nothing else");
  assert.ok(dev.indexOf(".github/wait-for-ci.sh \"$GITHUB_SHA\"") < dev.indexOf("- name: Build"), "CI passed before anything is built");
  assert.ok(dev.indexOf(".github/wait-for-ci.sh") < dev.indexOf("gh release upload"));
  const pub = step(dev, 'Publish to the "test-server" pre-release');
  assert.match(pub, /gh release create test-server --prerelease --latest=false/);
  assert.match(pub, /gh release edit test-server --prerelease --latest=false/);
  assert.match(pub, /gh release upload test-server out\/\* --clobber/);
  assert.doesNotMatch(dev, /--latest(?!=false)/, "never made the latest release");
  assert.doesNotMatch(dev, /gh release create (?!test-server)/, "no release but test-server");
  assert.match(pub, /grep -v "\^musicd-server-\$V\\\.tar\\\.gz"/, "the bundles before deleted");
  const tag = (/const string DevTag = "([^"]+)"/.exec(read("server/Mandarin.Server/Admin/Updater.Channel.cs")) || [])[1];
  assert.equal(tag, "test-server", "the updater asks for the pre-release the workflow publishes");
});
