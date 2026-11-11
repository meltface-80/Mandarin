// @ts-check
/*
 * Releases signed with Mandarin's release key (item 371, the security audit's ninth finding): the scripts that sign
 * them and where the workflows run them. The updaters' own checks are tested where they update: the server's in
 * test/Mandarin.Tests/UpdateAloneTests.cs, the Linux Bridge's in bridge-updates.test.js.
 *
 *   - the server and the Bridge carry the same public half (each ReleaseKey.cs);
 *   - tools/release-key.sh makes a key on your own computer and prints its public half;
 *   - .github/sign.sh signs each file with it, refuses a secret that isn't the key the programs carry, and with no
 *     secret signs nothing while they carry none, fails once they do (but for a pull request's build);
 *   - bridge/sidecar.sh puts the Linux tarball's signature in its sidecar, never an APK's;
 *   - the release workflows sign the server's builds, Linux's and the Mac's, and the Bridge's tarballs, with the secret.
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const read = (/** @type {string} */ f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const builtIn = (/** @type {string} */ f) => (/const string BuiltIn = "([^"]*)";/.exec(read(f)) || [])[1];

/** A fresh key: its PEM and its public half as the programs carry it. */
function key() {
  const k = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { pem: /** @type {string} */ (k.privateKey.export({ type: "sec1", format: "pem" })), pub: k.publicKey.export({ type: "spki", format: "der" }).toString("base64"), publicKey: k.publicKey };
}

/** [script] run with [args] and [env] (over this process's, the secret and the event cleared). */
function run(/** @type {string} */ script, /** @type {string[]} */ args, /** @type {Record<string, string>} */ env) {
  const base = Object.assign({}, process.env);
  delete base.RELEASE_SIGNING_KEY; delete base.GITHUB_EVENT_NAME; delete base.RELEASE_KEY_PUB;
  return spawnSync(path.join(ROOT, script), args, { encoding: "utf8", env: Object.assign(base, env) });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "musicd-release-sign-"));

test("the server and the Linux Bridge carry the same release key", () => {
  const server = builtIn("server/Mandarin.Server/Admin/ReleaseKey.cs"), bridge = builtIn("bridge/linux/Mandarin.Bridge/ReleaseKey.cs");
  assert.equal(typeof server, "string");
  assert.equal(server, bridge, "one key, in both programs");
  if (server) assert.doesNotThrow(() => crypto.createPublicKey({ key: Buffer.from(server, "base64"), format: "der", type: "spki" }), "a public key");
});

test("sign.sh: each file signed with the key, checked by its public half", () => {
  const dir = tmp(), k = key();
  try {
    for (const n of ["a.gz", "b.gz"]) fs.writeFileSync(path.join(dir, n), "build " + n);
    const r = run(".github/sign.sh", [path.join(dir, "a.gz"), path.join(dir, "b.gz")], { RELEASE_SIGNING_KEY: k.pem, RELEASE_KEY_PUB: k.pub });
    assert.equal(r.status, 0, r.stderr);
    for (const n of ["a.gz", "b.gz"]) {
      const sig = fs.readFileSync(path.join(dir, n + ".sig"));
      assert.ok(crypto.verify("sha256", fs.readFileSync(path.join(dir, n)), k.publicKey, sig), n + ": its signature, by the key");
      assert.ok(!crypto.verify("sha256", Buffer.from("something else"), k.publicKey, sig), n + ": of that file alone");
    }
    // The key as a phone's copy can paste it: its lines joined by spaces, CRs, four dashes, the public half after it.
    const lines = k.pem.trim().split("\n");
    for (const pasted of [lines.join(" "), lines.join("\r\n") + "\r\n", k.pem.replace(/^-----/, "----") + "\n" + k.pub, lines.join("")]) {
      fs.rmSync(path.join(dir, "a.gz.sig"));
      const p = run(".github/sign.sh", [path.join(dir, "a.gz")], { RELEASE_SIGNING_KEY: pasted, RELEASE_KEY_PUB: k.pub });
      assert.equal(p.status, 0, p.stderr);
      assert.ok(crypto.verify("sha256", fs.readFileSync(path.join(dir, "a.gz")), k.publicKey, fs.readFileSync(path.join(dir, "a.gz.sig"))), "signed from a key pasted as " + JSON.stringify(pasted.slice(0, 40)));
    }
    // Not a key at all: said what it looked like, never what it holds.
    const bad = run(".github/sign.sh", [path.join(dir, "a.gz")], { RELEASE_SIGNING_KEY: "-----BEGIN EC PRIVATE KEY-----\nabc", RELEASE_KEY_PUB: k.pub });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /2 line\(s\), BEGIN line yes, END line no, 3 characters/);
    assert.doesNotMatch(bad.stderr, /abc/);
    // Before the programs carry a key: signed all the same, ready for when they do.
    fs.rmSync(path.join(dir, "a.gz.sig"));
    assert.equal(run(".github/sign.sh", [path.join(dir, "a.gz")], { RELEASE_SIGNING_KEY: k.pem, RELEASE_KEY_PUB: "" }).status, 0);
    assert.ok(fs.existsSync(path.join(dir, "a.gz.sig")));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("sign.sh: a secret that isn't the programs' key, or none once they carry one, fails the build", () => {
  const dir = tmp(), k = key(), other = key();
  try {
    const f = path.join(dir, "a.gz");
    fs.writeFileSync(f, "build");
    let r = run(".github/sign.sh", [f], { RELEASE_SIGNING_KEY: other.pem, RELEASE_KEY_PUB: k.pub });
    assert.equal(r.status, 1, "another key: no install would take what it signs");
    assert.match(r.stderr, /isn't the key whose public half the programs carry/);
    assert.ok(!fs.existsSync(f + ".sig"), "nothing signed");
    r = run(".github/sign.sh", [f], { RELEASE_SIGNING_KEY: "not a key", RELEASE_KEY_PUB: k.pub });
    assert.equal(r.status, 1, "not a key at all");
    // No secret: nothing signed, and fine, while the programs carry no key; a failure once they do.
    r = run(".github/sign.sh", [f], { RELEASE_KEY_PUB: "" });
    assert.deepEqual([r.status, fs.existsSync(f + ".sig")], [0, false], r.stderr);
    r = run(".github/sign.sh", [f], { RELEASE_KEY_PUB: k.pub });
    assert.equal(r.status, 1, "the programs carry a key, and there's no secret to sign with");
    assert.match(r.stderr, /RELEASE_SIGNING_KEY secret isn't set/);
    // A pull request's build, never published: not signed, and not stopped for it.
    r = run(".github/sign.sh", [f], { RELEASE_KEY_PUB: k.pub, GITHUB_EVENT_NAME: "pull_request" });
    assert.deepEqual([r.status, fs.existsSync(f + ".sig")], [0, false], r.stderr);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("sidecar.sh: the Linux tarball's signature in its sidecar, never an APK's", () => {
  const dir = tmp(), k = key();
  try {
    const tgz = path.join(dir, "mandarin-bridge-linux-x64.tar.gz"), apk = path.join(dir, "mandarin-bridge.apk");
    fs.writeFileSync(tgz, "tarball"); fs.writeFileSync(apk, "apk");
    const env = { RELEASE_SIGNING_KEY: k.pem, RELEASE_KEY_PUB: k.pub };
    assert.equal(run("bridge/sidecar.sh", [tgz, "abcdef1234567", "0.3.4"], env).status, 0);
    const side = JSON.parse(fs.readFileSync(tgz + ".json", "utf8"));
    assert.deepEqual([side.commit, side.version, side.sha256], ["abcdef1", "0.3.4", crypto.createHash("sha256").update("tarball").digest("hex")]);
    assert.ok(crypto.verify("sha256", Buffer.from("tarball"), k.publicKey, Buffer.from(side.sig, "base64")), "the tarball's signature, by the key");
    assert.ok(!fs.existsSync(tgz + ".sig"), "in the sidecar, not beside it");
    assert.equal(run("bridge/sidecar.sh", [apk, "abcdef1234567", "0.3.4"], env).status, 0);
    assert.equal(JSON.parse(fs.readFileSync(apk + ".json", "utf8")).sig, undefined, "an APK: Android checks its own signature");
    // No key yet: the sidecar as before.
    assert.equal(run("bridge/sidecar.sh", [tgz, "abcdef1234567", "0.3.4"], { RELEASE_KEY_PUB: "" }).status, 0);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(tgz + ".json", "utf8"))), ["commit", "version", "sha256"]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("release-key.sh: a key made here, its public half printed, which sign.sh then signs with", () => {
  const dir = tmp();
  try {
    const pem = path.join(dir, "k.pem");
    const r = run("tools/release-key.sh", [pem], {});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.statSync(pem).mode & 0o077, 0, "the private half readable by its owner alone");
    const pub = (/^([A-Za-z0-9+/=]{80,})$/m.exec(r.stdout) || [])[1];
    assert.ok(pub, "its public half printed: " + r.stdout);
    const f = path.join(dir, "a.gz");
    fs.writeFileSync(f, "build");
    assert.equal(run(".github/sign.sh", [f], { RELEASE_SIGNING_KEY: fs.readFileSync(pem, "utf8"), RELEASE_KEY_PUB: pub }).status, 0);
    assert.ok(crypto.verify("sha256", Buffer.from("build"), crypto.createPublicKey({ key: Buffer.from(pub, "base64"), format: "der", type: "spki" }), fs.readFileSync(f + ".sig")));
    assert.equal(run("tools/release-key.sh", [pem], {}).status, 1, "a key that is there already kept, never made over");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the release workflows sign with the secret: the server's builds, Linux's and the Mac's, and the Bridge's tarballs", () => {
  const release = read(".github/workflows/release.yml"), linux = read(".github/workflows/bridge-linux.yml");
  const step = (/** @type {string} */ yml, /** @type {string} */ name) => { const i = yml.indexOf("- name: " + name); assert.ok(i >= 0, name); const j = yml.indexOf("\n      - ", i + 1); return yml.slice(i, j < 0 ? undefined : j); };
  for (const [yml, name, signs] of [[release, "Build the C# server for in-app updates", ".github/sign.sh out/csharp/mandarin-server-*.gz"],
    [release, "Build and add the Mac's C# server", ".github/sign.sh out/mac/mandarin-server-osx-*.gz"],
    [linux, "Build and package", "./bridge/sidecar.sh mandarin-bridge-linux-"]]) {
    const s = step(yml, name);
    assert.match(s, /RELEASE_SIGNING_KEY: \$\{\{ secrets\.RELEASE_SIGNING_KEY \}\}/, name + ": the secret given");
    assert.ok(s.includes(signs), name + ": signs");
  }
  // A Bridge release builds its Linux tarballs with the secret too (a called workflow has none unless given it).
  assert.match(read(".github/workflows/bridge-release.yml"), /linux:\n\s+uses: \.\/\.github\/workflows\/bridge-linux\.yml\n\s+secrets: inherit/);
  // The server's signatures uploaded with its builds (out/csharp/*, out/mac/*).
  assert.ok(release.includes('gh release create "v$v" "musicd-server-$v.tar.gz" out/csharp/*') && release.includes("gh release upload \"v$v\" out/mac/* --clobber"));
});
