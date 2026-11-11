"use strict";
/*
 * Mandarin Bridge's port has no sign-in, so a browser's POST is taken only from its own page (item 352). A page on
 * another site that points its own name at the Bridge (DNS rebinding) is its own page there, Origin and Host alike:
 * the Bridge now takes a browser's POST only under a name a home uses, as Mandarin's server does (item 172). And the
 * Android Bridge refuses a Content-Length that isn't one, where Content-Length: -1 from any computer on the network
 * stopped it, and keeps whatever one request does wrong to that request.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const ports = require("./ports");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const skip = !(fs.existsSync(BRIDGE) && fs.existsSync(ENGINE)) && !process.env.CI && "bridge/linux/build.sh and engine/build.sh not run";
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* A POST with exactly these headers (Host and Origin included, which fetch won't let a test set). */
function post(port, headers, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: "POST", path: "/api/settings", agent: false,
      headers: Object.assign({ "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, headers) }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", d => { text += d; });
      res.on("end", () => { let json = {}; try { json = JSON.parse(text); } catch (e) { /* not JSON */ } resolve({ status: res.statusCode, json }); });
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("a page that points its own name at the Bridge (DNS rebinding) changes nothing; its own page does", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-bridge-rebind-"));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const port = ports.port();
  const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "none"), "--device", "file:" + path.join(tmp, "dac.raw"),
    "--address", "127.0.0.1", "--engine", ENGINE], { stdio: "ignore" });
  t.after(() => p.kill());
  const state = async () => (await fetch("http://127.0.0.1:" + port + "/api/state")).json();
  for (let i = 0; i < 100; i++) { try { await state(); break; } catch (e) { await sleep(100); } }

  for (const name of ["evil.example", "music.example.com", "1.2.3.4.nip.io", "local.evil.example"]) {
    const site = name + ":" + port;
    const r = await post(port, { Host: site, Origin: "http://" + site }, JSON.stringify({ name: "Owned" }));
    assert.equal(r.status, 403, site);
    assert.match(r.json.error, /another site's name/);
  }
  assert.notEqual((await state()).name, "Owned");
  for (const [host, name] of [["127.0.0.1:" + port, "Study DAC"], ["bridge.local:" + port, "Kitchen DAC"], ["pi:" + port, "Pi DAC"]]) {
    const r = await post(port, { Host: host, Origin: "http://" + host }, JSON.stringify({ name }));
    assert.equal(r.status, 200, host);
    assert.equal((await state()).name, name);
  }
});

test("the Android Bridge refuses a Content-Length that isn't one, and one request's failure ends only that request", () => {
  const src = fs.readFileSync(path.join(ROOT, "bridge/android/app/src/main/java/com/musicd/server/android/HttpServer.kt"), "utf8");
  assert.match(src, /if \(length < 0\) throw IOException\("bad Content-Length/);
  assert.match(src, /toIntOrNull\(\) \?: throw IOException\("bad Content-Length/);
  assert.match(src, /catch \(e: RuntimeException\) \{[^}]*Log\.w/);
  const guard = fs.readFileSync(path.join(ROOT, "bridge/android/app/src/main/java/com/musicd/server/android/Guard.kt"), "utf8");
  assert.match(guard, /if \(!homeName\(host\)\) return "asked for under another site's name"/);
});
