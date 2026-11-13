"use strict";
/*
 * Mandarin Bridge for Linux updating where systemd runs it (item 391), as on Mandarin OS: its service (DynamicUser)
 * gives it no HOME, and .NET then couldn't open its certificate stores (PersistedFiles_NoHomeDirectory), so the update
 * couldn't connect to GitHub securely; its fallback, curl, then failed too, said only as "tar couldn't be run".
 *   - with no HOME, its data folder is its home: what it runs (the update, here a script that says its HOME) is given it;
 *   - a program it can't start (tar, not on its PATH) is named, with why.
 * With a GitHub of the test's own, as test/bridge-updates.test.js has it.
 */
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const ports = require("./ports");
const { haveFfmpeg, FFMPEG } = require("./fixtures");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const built = fs.existsSync(BRIDGE) && fs.existsSync(ENGINE);
const skip = !haveFfmpeg() ? "ffmpeg is not installed" : !built && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const ARCH = "linux-" + (process.arch === "arm64" ? "arm64" : "x64");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(150);
  }
}

test("a Bridge with no HOME updates with its data folder as its home, and a program it can't start is named", { skip, timeout: 120000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-home-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, "asound"));
  fs.writeFileSync(path.join(tmp, "asound", "cards"), " 0 [PCH            ]: HDA-Intel - HDA Intel PCH\n");
  // The update: a script that says it is 9.9.9 and, run, writes the HOME it was given and runs the Bridge built here.
  const said = path.join(tmp, "its-home");
  const pkg = path.join(tmp, "pkg", "mandarin-bridge");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "mandarin-bridge"), `#!/bin/sh\nif [ "$1" = --version ]; then echo "mandarin-bridge 9.9.9 (fffffff)"; exit 0; fi\necho "$HOME" > "${said}"\nexec "${BRIDGE}" "$@"\n`, { mode: 0o755 });
  fs.copyFileSync(ENGINE, path.join(pkg, "mandarin-audio"));
  fs.chmodSync(path.join(pkg, "mandarin-audio"), 0o755);
  const tgz = path.join(tmp, `mandarin-bridge-${ARCH}.tar.gz`);
  assert.equal(spawnSync("tar", ["-C", path.join(tmp, "pkg"), "-czf", tgz, "mandarin-bridge"]).status, 0);
  const tar = fs.readFileSync(tgz);
  const key = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const gh = http.createServer((req, res) => {
    const json = o => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const at = n => `http://127.0.0.1:${gh.address().port}/download/${n}`;
    if (req.url === "/repos/meltface-80/Mandarin/releases/tags/mandarin-bridge-v9.9.9") {
      return json({ tag_name: "mandarin-bridge-v9.9.9", assets: [`mandarin-bridge-${ARCH}.tar.gz`, `mandarin-bridge-${ARCH}.tar.gz.json`].map(n => ({ name: n, browser_download_url: at(n) })) });
    }
    if (req.url === `/download/mandarin-bridge-${ARCH}.tar.gz.json`) {
      return json({ commit: "fffffff", version: "9.9.9", sha256: crypto.createHash("sha256").update(tar).digest("hex"), sig: crypto.sign("sha256", tar, key.privateKey).toString("base64") });
    }
    if (req.url === `/download/mandarin-bridge-${ARCH}.tar.gz`) { res.writeHead(200); return res.end(tar); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => gh.listen(0, "127.0.0.1", r));
  t.after(() => gh.close());

  const data = path.join(tmp, "data"), PORT = ports.port(), BR = "http://127.0.0.1:" + PORT;
  // As systemd's DynamicUser runs it: no HOME. [pathDirs]: its PATH.
  const run = (pathDirs) => {
    const env = { ...process.env, PATH: pathDirs, UPDATE_KEY: key.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
    delete env.HOME;
    const p = spawn(BRIDGE, ["--port", String(PORT), "--data", data, "--asound", path.join(tmp, "asound"), "--address", "127.0.0.1", "--engine", ENGINE,
      "--ffmpeg", FFMPEG, "--update-api", `http://127.0.0.1:${gh.address().port}`, "--server", "127.0.0.1:1"], { stdio: ["ignore", "ignore", "pipe"], env });
    p.log = "";
    p.stderr.on("data", d => { p.log += d; });
    p.exited = new Promise(r => p.on("exit", code => r(code)));
    t.after(() => p.kill());
    return p;
  };
  const update = () => fetch(BR + "/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: "mandarin-bridge-v9.9.9" }) });
  const state = async () => (await (await fetch(BR + "/dac.json")).json()).update;

  // tar not on its PATH (an empty folder): the update fails saying tar couldn't be run, and why.
  const empty = path.join(tmp, "empty");
  fs.mkdirSync(empty);
  let bridge = run(empty);
  await until(async () => (await fetch(BR + "/dac.json")).ok, 15000);
  assert.equal((await update()).status, 202);
  const failed = await until(async () => { const s = await state(); return s.state === "failed" && s; });
  assert.match(failed.says, /tar couldn't be run \(.+\)/, JSON.stringify(failed));
  bridge.kill();
  await bridge.exited;

  // Its PATH as the system's: put in place, then started again (as systemd does) into it, with its data folder as HOME.
  bridge = run(process.env.PATH);
  await until(async () => (await fetch(BR + "/dac.json")).ok, 15000);
  assert.equal((await update()).status, 202);
  assert.equal(await bridge.exited, 0, "stopped to be started again: " + bridge.log);
  run(process.env.PATH);   // stopped by the test's end (run's t.after)
  const home = await until(() => fs.existsSync(said) && fs.readFileSync(said, "utf8").trim(), 15000);
  assert.equal(home, data, "the update given the Bridge's data folder as its home");
});
