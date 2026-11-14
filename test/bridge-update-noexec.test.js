"use strict";
/*
 * Mandarin Bridge for Linux whose data folder won't run programs (item 415): on Mandarin OS (Debian 13, systemd 257)
 * the service's DynamicUser had its data folder mounted so nothing in it could be run, and the update, checked and
 * unpacked there, failed as "mandarin-bridge couldn't be run (ErrorStartingProcess, …, Permission denied)". Said now in
 * words the owner can act on: which folder, and what to do (Mandarin OS updated, or the install line run again).
 * Refused here as such a folder refuses it: the update's program without its execute bit. With a GitHub of the test's
 * own, as test/bridge-update-home.test.js has it.
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
const skip = process.platform !== "linux" ? "Linux only" : !haveFfmpeg() ? "ffmpeg is not installed"
  : !built && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
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

test("an update its data folder won't run says so, and what to do", { skip, timeout: 120000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-noexec-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  fs.mkdirSync(path.join(tmp, "asound"));
  fs.writeFileSync(path.join(tmp, "asound", "cards"), " 0 [PCH            ]: HDA-Intel - HDA Intel PCH\n");
  // The update: its program can't be run (no execute bit), as nothing can be in a folder mounted noexec.
  const pkg = path.join(tmp, "pkg", "mandarin-bridge");
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, "mandarin-bridge"), "#!/bin/sh\necho \"mandarin-bridge 9.9.9 (fffffff)\"\n", { mode: 0o644 });
  fs.copyFileSync(ENGINE, path.join(pkg, "mandarin-audio"));
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
  const env = { ...process.env, UPDATE_KEY: key.publicKey.export({ type: "spki", format: "der" }).toString("base64") };
  const bridge = spawn(BRIDGE, ["--port", String(PORT), "--data", data, "--asound", path.join(tmp, "asound"), "--address", "127.0.0.1", "--engine", ENGINE,
    "--ffmpeg", FFMPEG, "--update-api", `http://127.0.0.1:${gh.address().port}`, "--server", "127.0.0.1:1"], { stdio: ["ignore", "ignore", "pipe"], env });
  let log = "";
  bridge.stderr.on("data", d => { log += d; });
  t.after(() => bridge.kill());
  await until(async () => (await fetch(BR + "/dac.json")).ok, 15000);
  const asked = await fetch(BR + "/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: "mandarin-bridge-v9.9.9" }) });
  assert.equal(asked.status, 202);
  const failed = await until(async () => { const s = (await (await fetch(BR + "/dac.json")).json()).update; return s.state === "failed" && s; });
  assert.match(failed.says, /^The update couldn't be installed: this computer won't run programs from Mandarin Bridge's data folder \(.+data\)/, JSON.stringify(failed));
  assert.match(failed.says, /on Mandarin OS, update Mandarin OS .*; elsewhere, run the install line again/, JSON.stringify(failed));
  // What .NET said kept for the log, with the program it couldn't run.
  assert.match(log, /update: mandarin-bridge couldn't be run \([^\n]*app\.new\/mandarin-bridge\/mandarin-bridge[^\n]*Permission denied\)/, log);
  assert.ok(!fs.existsSync(path.join(data, "app")), "nothing put in place");
});
