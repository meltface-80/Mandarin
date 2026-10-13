"use strict";
/*
 * The in-app update made by the C# server (v0.8.48, stage 5 part 4 of
 * docs/specs/csharp-migration.md; Admin/Updater.cs, UpdateRoutes.cs): once the
 * Node server has handed "update" over, Settings → Updates is answered by the
 * C# server, which asks GitHub, downloads and checks the release, fetches its
 * own program of the new version first (as lib/server/csharp-update.js prepare
 * did), then stages the bundle for launcher.js and asks the Node server to
 * start again (code 75), as lib/updater.js did — each refusal word for word.
 *
 * GitHub is stood in for; the server runs for real through the C# server
 * (MANDARIN_FRONT=1), on a copy of the app and of its program, so nothing of
 * this checkout is touched. The Node server's exit is recorded, not made.
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
const { execFileSync } = require("child_process");
const pkg = require("../package.json");
const { makeLibrary, stopServer } = require("./fixtures");
const { signIn } = require("./auth-helper");

const ROOT = path.join(__dirname, "..");
const BIN = process.env.MANDARIN_SERVER_BIN || path.join(ROOT, "server", "bin", "mandarin-server");
// The program's build for this machine, as Admin/Updater.cs names it (release.yml's assets).
const sys = { linux: "linux", darwin: "osx" }[process.platform];
const build = sys && ["x64", "arm64"].includes(process.arch) ? `${sys}-${process.arch}` : null;
const skip = process.env.MANDARIN_FRONT !== "1" ? "the suite isn't going through the C# server (MANDARIN_FRONT=1)"
  : !fs.existsSync(BIN) ? "the C# server isn't built (server/build.sh)"
  : !build ? "no C# server is built for this machine" : false;

const FAKE = ports.port();
const B = "http://127.0.0.1:" + FAKE;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out " + what);
    await sleep(100);
  }
}

// GitHub, stood in for: the latest release (or a status instead), the release
// of v9.9.9 the program is fetched from, and the files of both.
const fake = { latest: null, latestStatus: 404, tag: null, files: {}, asked: [] };
const gh = http.createServer((req, res) => {
  fake.asked.push(req.url);
  const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json" }); res.end(body); };
  if (req.url === "/repos/me/musicd/releases/latest") return fake.latest ? send(200, JSON.stringify(fake.latest)) : send(fake.latestStatus, "{}");
  if (req.url === "/repos/me/musicd/releases/tags/v9.9.9") return fake.tag ? send(200, JSON.stringify(fake.tag)) : send(404, "{}");
  if (fake.files[req.url]) return send(200, fake.files[req.url], "application/octet-stream");
  send(404, "{}");
});

/* The release's bundle, as release.yml makes it (musicd-server/ at the top): index.js, package.json, a file of its own. */
function bundle(tmp, { name = "musicd-server", withIndex = true } = {}) {
  const dir = fs.mkdtempSync(path.join(tmp, "bundle-"));
  const top = path.join(dir, "musicd-server");
  fs.mkdirSync(path.join(top, "lib"), { recursive: true });
  if (withIndex) fs.writeFileSync(path.join(top, "index.js"), "// 9.9.9\n");
  fs.writeFileSync(path.join(top, "lib", "new.js"), "// new in 9.9.9\n");
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  fs.writeFileSync(path.join(top, "package.json"), JSON.stringify(Object.assign(p, { name, version: "9.9.9" }), null, 2));
  const out = path.join(dir, "musicd-server-9.9.9.tar.gz");
  execFileSync("tar", ["-C", dir, "-czf", out, "musicd-server"]);
  fake.files["/dl/musicd-server-9.9.9.tar.gz"] = fs.readFileSync(out);
}

/* GitHub's latest release: v9.9.9, its bundle at /dl. */
function latest() {
  fake.latest = {
    tag_name: "v9.9.9", html_url: B + "/r", body: "  Notes for 9.9.9  ",
    assets: [{ name: "musicd-server-9.9.9.tar.gz", browser_download_url: B + "/dl/musicd-server-9.9.9.tar.gz" }]
  };
}

/* The release of 9.9.9 the program is fetched from (test/csharp-update.test.js): one that says `says`; its sum right unless `badSum`. */
function program({ says = "9.9.9", badSum = false, withProgram = true } = {}) {
  const prog = Buffer.from(`#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${says}; exit 0; fi\nexit 3\n`);
  const gz = zlib.gzipSync(prog);
  const sum = crypto.createHash("sha256").update(badSum ? Buffer.from("other") : gz).digest("hex");
  const name = `mandarin-server-${build}.gz`;
  fake.files["/dl/" + name] = gz;
  fake.files["/dl/mandarin-server.sha256"] = `${sum}  ${name}\n${"0".repeat(64)}  mandarin-server-other.gz\n`;
  fake.tag = {
    tag_name: "v9.9.9",
    assets: (withProgram ? [name, "mandarin-server.sha256"] : ["musicd-server-9.9.9.tar.gz"]).map(n => ({ name: n, browser_download_url: B + "/dl/" + n }))
  };
  return prog;
}

/* An install, apart from this checkout: the app's files, its pages, and the program the C# server runs from. */
function install() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-upd-cs-"));
  const app = path.join(dir, "app");
  fs.mkdirSync(app);
  for (const f of ["index.js", "launcher.js", "package.json"]) fs.copyFileSync(path.join(ROOT, f), path.join(app, f));
  fs.cpSync(path.join(ROOT, "public"), path.join(app, "public"), { recursive: true });
  const bin = path.join(app, "server", "bin", "mandarin-server");
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, "the old program", { mode: 0o755 });
  return { dir, app, bin, left: () => fs.readdirSync(path.dirname(bin)).sort(), ready: () => path.join(app, ".update", "READY") };
}

/*
 * The server through the C# server, set up as an install is (where GitHub is
 * asked, under the launcher or not, the app and the program apart): the C#
 * server told so by the hand-over. Answered there once it holds the update.
 */
async function server(t, i, { viaLauncher }) {
  const env = { MANDARIN_APP_DIR: i.app, MANDARIN_SERVER_BIN: i.bin, UPDATE_API: B, UPDATE_REPO: "me/musicd", UPDATE_CHECK: "false", MUSICD_VIA_LAUNCHER: viaLauncher ? "1" : undefined };
  const was = {};
  for (const [k, v] of Object.entries(env)) { was[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  t.after(() => { for (const [k, v] of Object.entries(was)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const lib = makeLibrary();
  const PORT = ports.port(), at = "http://127.0.0.1:" + PORT;
  const exits = [];
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    exitProcess: c => exits.push(c) });
  await srv.start();
  // Its restart (an update staged) stops it itself; otherwise stopped here.
  t.after(async () => { if (!exits.length) await srv.stop().catch(() => {}); });
  const H = { Authorization: "Bearer " + await signIn(at), "Content-Type": "application/json" };
  const api = async (p, post) => {
    const r = await fetch(at + "/api/update/" + p, post ? { method: "POST", headers: H, body: "{}" } : { headers: H });
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), body: await r.json() };
  };
  const first = await until(async () => { const r = await api("status"); return r.by === "C#" && r; }, 30000, "for the C# server to take the update over");
  return { exits, api, first: first.body };
}

/* lib/updater.js's status, as Settings reads it, less what the Node server lays over it. */
const core = (st) => { const o = Object.assign({}, st); delete o.csharp; return o; };
const api = (s, p, post) => s.api(p, post);

test("the in-app update, made by the C# server", { skip, timeout: 180000 }, async (t) => {
  await new Promise(r => gh.listen(FAKE, "127.0.0.1", r));
  t.after(() => stopServer(gh));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-upd-gh-"));
  const realBin = fs.statSync(BIN);

  await t.test("under the launcher, as the image runs it: checked, refused for each reason as before, then staged with the C# server of the new version in place first", async (tt) => {
    const i = install();
    const s = await server(tt, i, { viaLauncher: true });
    assert.deepEqual(core(s.first), {
      current: pkg.version, latest: null, latestTag: null, available: false, isDowngrade: false, html_url: null, notes: null, source: null,
      checkedAt: 0, checking: false, error: null, viaLauncher: true, apply: { phase: "idle", error: null, version: null }, is_docker: false
    }, "nothing known yet, as lib/updater.js starts");
    assert.equal(s.first.csharp.phase, "none", "the Node server's word on this program's update, with it");

    // GitHub refusing, or rate-limiting: the check says so; an install asked for then says the same.
    fake.latestStatus = 500;
    let r = await api(s, "check", true);
    assert.deepEqual([r.body.error, r.body.available, r.body.checkedAt], ["GitHub API HTTP 500", false, 0]);
    r = await api(s, "apply", true);
    assert.equal(r.status, 409);
    assert.deepEqual([r.body.error, r.body.status.apply], ["GitHub API HTTP 500", { phase: "error", error: "GitHub API HTTP 500", version: null }]);
    fake.latestStatus = 403;
    r = await api(s, "check", true);
    assert.equal(r.body.error, "GitHub rate-limited or forbidden (set GITHUB_TOKEN to raise the limit)");
    // No release, no tags: nothing on offer.
    fake.latestStatus = 404;
    r = await api(s, "check", true);
    assert.deepEqual([r.body.error, r.body.latest, r.body.available, r.body.checkedAt > 0], [null, null, false, true]);
    r = await api(s, "apply", true);
    assert.equal(r.status, 409);
    assert.deepEqual(r.body.error, "No update available");

    // A release: offered, its notes trimmed; the bundle not there to download.
    latest();
    r = await api(s, "check", true);
    assert.deepEqual([r.body.latest, r.body.latestTag, r.body.available, r.body.html_url, r.body.notes, r.body.source, r.body.error],
      ["9.9.9", "v9.9.9", true, B + "/r", "Notes for 9.9.9", "release", null]);
    r = await api(s, "apply", true);
    assert.equal(r.status, 409);
    assert.deepEqual([r.body.error, r.body.status.apply], ["download HTTP 404", { phase: "error", error: "download HTTP 404", version: "9.9.9" }]);
    // A bundle that isn't the server's.
    bundle(tmp, { withIndex: false });
    r = await api(s, "apply", true);
    assert.deepEqual([r.status, r.body.error], [409, "downloaded build is missing index.js/package.json"]);
    bundle(tmp, { name: "other" });
    r = await api(s, "apply", true);
    assert.deepEqual([r.status, r.body.error], [409, "downloaded build is other, not musicd-server"]);

    // The bundle right: the C# server of 9.9.9 has to come with it, or nothing is staged (v0.8.29).
    bundle(tmp);
    for (const [why, rel, said] of [
      ["no program in the release", { withProgram: false }, `release v9.9.9 carries no mandarin-server-${build}.gz`],
      ["a wrong sum", { badSum: true }, `mandarin-server-${build}.gz doesn't match its sum`],
      ["the wrong version", { says: "1.0.0" }, "the new program says 1.0.0, not 9.9.9"]
    ]) {
      program(rel);
      r = await api(s, "apply", true);
      assert.equal(r.status, 409, why);
      assert.equal(r.body.error, `the C# server 9.9.9 couldn't be fetched (${said}); nothing was changed`, why);
      assert.equal(r.body.status.apply.version, "9.9.9", why);
      assert.equal(fs.readFileSync(i.bin, "utf8"), "the old program", why + ": the old program as it was");
      assert.deepEqual(i.left(), ["mandarin-server"], why + ": nothing left beside it");
      assert.ok(!fs.existsSync(i.ready()), why + ": nothing staged for the launcher");
      assert.deepEqual(s.exits, [], why + ": the Node server not asked to start again");
    }

    // Everything there: the program put in place, the bundle staged for the
    // launcher, and the Node server asked to start again with 75 (which, under
    // the launcher, lays the new files in and starts the new version).
    const prog = program();
    r = await api(s, "apply", true);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.status.apply, { phase: "restarting", error: null, version: "9.9.9" });
    await until(() => s.exits.length, 15000, "for the Node server to be asked to start again");
    assert.deepEqual(s.exits, [75], "code 75: the launcher applies the update");
    const ready = JSON.parse(fs.readFileSync(i.ready(), "utf8"));
    assert.deepEqual(ready, { staged: path.join(i.app, ".update", "extract", "musicd-server"), version: "9.9.9" });
    assert.ok(fs.existsSync(path.join(ready.staged, "lib", "new.js")), "the bundle unpacked where READY says");
    assert.deepEqual(fs.readFileSync(i.bin), prog, "the new program in place");
    assert.ok(fs.statSync(i.bin).mode & 0o100, "and runnable");
    assert.equal(fs.readFileSync(i.bin + ".version", "utf8"), "9.9.9\n");
    assert.deepEqual(i.left(), ["mandarin-server", "mandarin-server.version"], "nothing else left beside it");
    assert.equal(JSON.parse(fs.readFileSync(path.join(i.app, "package.json"), "utf8")).version, pkg.version, "the app's files are the launcher's to lay in");
    assert.ok(!fs.existsSync(path.join(ROOT, ".update")), "nothing staged in this checkout");
    const now = fs.statSync(BIN);
    assert.deepEqual([now.size, now.mtimeMs], [realBin.size, realBin.mtimeMs], "the C# server running the suite untouched");
  });

  await t.test("without a launcher: the new files laid in here, then the start again", async (tt) => {
    const i = install();
    bundle(tmp);
    latest();
    const prog = program();
    const s = await server(tt, i, { viaLauncher: false });
    assert.equal(s.first.viaLauncher, false);
    const r = await api(s, "apply", true);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.status.apply, { phase: "restarting", error: null, version: "9.9.9" });
    await until(() => s.exits.length, 15000, "for the Node server to be asked to start again");
    assert.deepEqual(s.exits, [75]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(i.app, "package.json"), "utf8")).version, "9.9.9", "the app's files are the new version's");
    assert.equal(fs.readFileSync(path.join(i.app, "index.js"), "utf8"), "// 9.9.9\n");
    assert.ok(fs.existsSync(path.join(i.app, "lib", "new.js")), "a file new in it");
    assert.ok(fs.existsSync(path.join(i.app, "public", "index.html")), "what the bundle doesn't carry left as it was");
    assert.ok(!fs.existsSync(path.join(i.app, ".update")), "the staging folder cleaned up");
    assert.deepEqual(fs.readFileSync(i.bin), prog);
    assert.equal(fs.readFileSync(i.bin + ".version", "utf8"), "9.9.9\n");
  });
});
