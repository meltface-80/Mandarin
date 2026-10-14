"use strict";
/*
 * update-alone.test.js — the in-app update with no Node server anywhere
 * (v0.8.50, stage 7 part 3 of docs/specs/csharp-migration.md; Admin/Updater.cs):
 * the C# server asks GitHub, downloads and checks the release's bundle (its
 * package.json names it; no index.js is looked for), fetches its own program
 * of the new version and puts it in place of the file it runs from, lays the
 * bundle's files over the install (never the data), and starts again from the
 * new file in its own process (Front.StartAgain) — no launcher, no
 * .update/READY, no npm. Each refusal leaves nothing changed.
 *
 * GitHub is stood in for; the server runs for real, from a copy of its program
 * in an install of its own, so nothing of this checkout is touched. The new
 * program is a stand-in that writes down how it was started and leaves.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFileSync, spawnSync } = require("child_process");
const pkg = require("../package.json");
const { makeLibrary, stopServer } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { start, built, BIN } = require("./server");

const ROOT = path.join(__dirname, "..");
// The program's build for this machine, as Admin/Updater.cs names it (release.yml's assets).
const sys = process.platform === "linux" ? "linux" : null;
const build = sys && ["x64", "arm64"].includes(process.arch) ? `${sys}-${process.arch}` : null;
const skip = built() || (!build && "no C# server is built for this machine");

const FAKE = ports.port();
const GH = "http://127.0.0.1:" + FAKE;
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

// GitHub, stood in for: the latest release (or a status instead), the release of v9.9.9 the program is fetched from, and the files of both.
const fake = { latest: null, latestStatus: 404, tag: null, files: {} };
const gh = http.createServer((req, res) => {
  const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json" }); res.end(body); };
  if (req.url === "/repos/me/musicd/releases/latest") return fake.latest ? send(200, JSON.stringify(fake.latest)) : send(fake.latestStatus, "{}");
  if (req.url === "/repos/me/musicd/releases/tags/v9.9.9") return fake.tag ? send(200, JSON.stringify(fake.tag)) : send(404, "{}");
  if (fake.files[req.url]) return send(200, fake.files[req.url], "application/octet-stream");
  send(404, "{}");
});

/* The release's bundle (musicd-server/ at the top), without a Node server in it: package.json, a page, a file of its own. */
function bundle(tmp, { name = "musicd-server", withPackage = true } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "bundle-"));
  const top = path.join(dir, "musicd-server");
  fs.mkdirSync(path.join(top, "public"), { recursive: true });
  fs.writeFileSync(path.join(top, "public", "new.js"), "// new in 9.9.9\n");
  fs.writeFileSync(path.join(top, "README.md"), "# 9.9.9\n");
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  if (withPackage) fs.writeFileSync(path.join(top, "package.json"), JSON.stringify(Object.assign(p, { name, version: "9.9.9" }), null, 2));
  const out = path.join(dir, "musicd-server-9.9.9.tar.gz");
  execFileSync("tar", ["-C", dir, "-czf", out, "musicd-server"]);
  fake.files["/dl/musicd-server-9.9.9.tar.gz"] = fs.readFileSync(out);
  fake.latest = { tag_name: "v9.9.9", html_url: GH + "/r", body: "Notes for 9.9.9", assets: [{ name: "musicd-server-9.9.9.tar.gz", browser_download_url: GH + "/dl/musicd-server-9.9.9.tar.gz" }] };
}

/*
 * The release of 9.9.9 the program is fetched from: a stand-in that says 9.9.9 (or `says`), and started as the
 * server writes down how (to `marker`) and leaves with 3; its sum right unless `badSum`.
 */
function program(marker, { withProgram = true, says = "9.9.9", badSum = false } = {}) {
  const prog = Buffer.from(`#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${says}; exit 0; fi\necho "$0|$#|$*" > "${marker}"\nexit 3\n`);
  const gz = zlib.gzipSync(prog);
  const name = `mandarin-server-${build}.gz`;
  fake.files["/dl/" + name] = gz;
  fake.files["/dl/mandarin-server.sha256"] = `${crypto.createHash("sha256").update(badSum ? Buffer.from("other") : gz).digest("hex")}  ${name}\n${"0".repeat(64)}  mandarin-server-other.gz\n`;
  fake.tag = { tag_name: "v9.9.9", assets: (withProgram ? [name, "mandarin-server.sha256"] : []).map(n => ({ name: n, browser_download_url: GH + "/dl/" + n })) };
  return prog;
}

/* An install apart from this checkout: the pages, package.json, and a copy of the program, which the server runs from. */
function install() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-upd-alone-"));
  const app = path.join(dir, "app");
  fs.mkdirSync(app);
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(app, "package.json"));
  fs.cpSync(path.join(ROOT, "public"), path.join(app, "public"), { recursive: true });
  const bin = path.join(app, "server", "bin", "mandarin-server");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.copyFileSync(BIN, bin);
  fs.chmodSync(bin, 0o755);
  return { dir, app, bin, marker: path.join(dir, "started") };
}

test("the in-app update with no Node server: refused with nothing changed, then made and started again from the new file", { skip, timeout: 180000 }, async (t) => {
  await new Promise(r => gh.listen(FAKE, "127.0.0.1", r));
  t.after(() => stopServer(gh));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-upd-gh-"));
  const realBin = fs.statSync(BIN);
  const i = install();
  const lib = makeLibrary();
  fs.mkdirSync(lib.data, { recursive: true });
  fs.writeFileSync(path.join(lib.data, "keep.txt"), "mine");
  const PORT = ports.port();
  const srv = await start({ port: PORT, musicDir: lib.music, dataDir: lib.data, bin: i.bin, env: { MANDARIN_APP_DIR: i.app, UPDATE_API: GH, UPDATE_REPO: "me/musicd" } });
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(srv.base), "Content-Type": "application/json" };
  const api = async (p, post) => {
    const r = await fetch(srv.base + "/api/update/" + p, post ? { method: "POST", headers: H, body: "{}" } : { headers: H });
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), body: await r.json() };
  };
  const was = fs.readFileSync(i.bin);

  let r = await api("status");
  assert.deepEqual([r.by, r.body.current, r.body.viaLauncher, r.body.csharp, "mac_node_only" in r.body], ["C#", pkg.version, false, null, false], "its own, with no launcher and no Node server to match");
  const { current, latest, latestTag, available, isDowngrade, html_url, notes, source, checkedAt, checking, error, apply, is_docker } = r.body;
  assert.deepEqual({ current, latest, latestTag, available, isDowngrade, html_url, notes, source, checkedAt, checking, error, apply, is_docker }, {
    current: pkg.version, latest: null, latestTag: null, available: false, isDowngrade: false, html_url: null, notes: null, source: null,
    checkedAt: 0, checking: false, error: null, apply: { phase: "idle", error: null, version: null }, is_docker: false
  }, "nothing known yet, as lib/updater.js started");

  // GitHub refusing, or rate-limiting: the check says so; an install asked for then says the same, nothing changed.
  fake.latestStatus = 500;
  r = await api("check", true);
  assert.deepEqual([r.body.error, r.body.available, r.body.checkedAt], ["GitHub API HTTP 500", false, 0]);
  r = await api("apply", true);
  assert.equal(r.status, 409);
  assert.deepEqual([r.body.error, r.body.status.apply], ["GitHub API HTTP 500", { phase: "error", error: "GitHub API HTTP 500", version: null }]);
  fake.latestStatus = 403;
  r = await api("check", true);
  assert.equal(r.body.error, "GitHub rate-limited or forbidden (set GITHUB_TOKEN to raise the limit)");
  // No release, no tags: nothing on offer.
  fake.latestStatus = 404;
  r = await api("check", true);
  assert.deepEqual([r.body.error, r.body.latest, r.body.available, r.body.checkedAt > 0], [null, null, false, true], "nothing on offer yet");
  r = await api("apply", true);
  assert.deepEqual([r.status, r.body.error], [409, "No update available"]);
  // A release, its notes trimmed; its bundle not there to download.
  fake.latest = { tag_name: "v9.9.9", html_url: GH + "/r", body: "  Notes for 9.9.9  ", assets: [{ name: "musicd-server-9.9.9.tar.gz", browser_download_url: GH + "/dl/musicd-server-9.9.9.tar.gz" }] };
  r = await api("check", true);
  assert.deepEqual([r.body.latest, r.body.latestTag, r.body.available, r.body.html_url, r.body.notes, r.body.source, r.body.error],
    ["9.9.9", "v9.9.9", true, GH + "/r", "Notes for 9.9.9", "release", null]);
  r = await api("apply", true);
  assert.deepEqual([r.status, r.body.error, r.body.status.apply], [409, "download HTTP 404", { phase: "error", error: "download HTTP 404", version: "9.9.9" }]);

  // A bundle without package.json; one that isn't the server's: refused, as before.
  bundle(tmp, { withPackage: false });
  r = await api("apply", true);
  assert.deepEqual([r.status, r.body.error], [409, "downloaded build is missing package.json"]);
  bundle(tmp, { name: "other" });
  r = await api("apply", true);
  assert.deepEqual([r.status, r.body.error], [409, "downloaded build is other, not musicd-server"]);
  // The bundle right, no program in the release: nothing changed.
  bundle(tmp);
  program(i.marker, { withProgram: false });
  r = await api("apply", true);
  assert.deepEqual([r.status, r.body.error], [409, `the C# server 9.9.9 couldn't be fetched (release v9.9.9 carries no mandarin-server-${build}.gz); nothing was changed`]);
  // One whose sum is wrong, and one that says another version: likewise.
  for (const [why, rel, said] of [["a wrong sum", { badSum: true }, `mandarin-server-${build}.gz doesn't match its sum`], ["the wrong version", { says: "1.0.0" }, "the new program says 1.0.0, not 9.9.9"]]) {
    program(i.marker, rel);
    r = await api("apply", true);
    assert.deepEqual([r.status, r.body.error, r.body.status.apply.version], [409, `the C# server 9.9.9 couldn't be fetched (${said}); nothing was changed`, "9.9.9"], why);
    assert.deepEqual(fs.readdirSync(path.dirname(i.bin)).sort(), ["mandarin-server"], why + ": nothing left beside the program");
  }
  assert.deepEqual(fs.readFileSync(i.bin), was, "the program as it was");
  assert.equal(JSON.parse(fs.readFileSync(path.join(i.app, "package.json"), "utf8")).version, pkg.version, "the install as it was");
  assert.equal(srv.exited(), null, "still running");

  // Everything there: the program put in place, the files laid in, and the server started again from the new file — which here says how it was started and leaves.
  const prog = program(i.marker);
  r = await api("apply", true);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.ok, r.body.status.apply], [true, { phase: "restarting", error: null, version: "9.9.9" }]);
  const ended = await until(() => srv.exited(), 30000, "for the server to start again from the new file");
  assert.deepEqual(ended, { code: 3, signal: null }, "the stand-in's own leaving, in the same process");
  // The file as the program knows itself: its real path (a temporary folder may be reached through a link).
  assert.equal(fs.readFileSync(i.marker, "utf8"), `${fs.realpathSync(i.bin)}|0|\n`, "started from its own file, with the same (no) arguments");
  assert.deepEqual(fs.readFileSync(i.bin), prog, "the new program in place");
  assert.equal(fs.readFileSync(i.bin + ".version", "utf8"), "9.9.9\n");
  assert.equal(JSON.parse(fs.readFileSync(path.join(i.app, "package.json"), "utf8")).version, "9.9.9", "the install's files are the new version's");
  assert.equal(fs.readFileSync(path.join(i.app, "public", "new.js"), "utf8"), "// new in 9.9.9\n", "a file new in it");
  assert.ok(fs.existsSync(path.join(i.app, "public", "index.html")), "what the bundle doesn't carry left as it was");
  assert.ok(!fs.existsSync(path.join(i.app, ".update")), "the staging folder cleaned up");
  assert.ok(!fs.existsSync(path.join(i.app, "node_modules")) && !fs.existsSync(path.join(i.app, "index.js")), "nothing of Node brought in");
  assert.equal(fs.readFileSync(path.join(lib.data, "keep.txt"), "utf8"), "mine", "the data left alone");
  assert.ok(!fs.existsSync(path.join(ROOT, ".update")), "nothing staged in this checkout");
  const now = fs.statSync(BIN);
  assert.deepEqual([now.size, now.mtimeMs], [realBin.size, realBin.mtimeMs], "the C# server of this checkout untouched");
});

test("`mandarin-server --version` says its version, and nothing else", { skip: built() }, () => {
  const r = spawnSync(BIN, ["--version"], { encoding: "utf8", timeout: 30000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, pkg.version + "\n");
});
