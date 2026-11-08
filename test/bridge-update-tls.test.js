"use strict";
/*
 * A Bridge update that can't make a secure connection to GitHub says why (item 359). Reported from a DietPi: "The update
 * couldn't be installed: GitHub couldn't be reached (SecureConnectionError)", and nothing more. A Raspberry Pi has no
 * clock of its own, and one that hasn't set its time sees GitHub's certificate as not valid yet; one whose certificates
 * are missing trusts none. The Linux Bridge, its stand-in GitHub served over HTTPS with a certificate this computer
 * doesn't trust, then with one valid only in January 2020 (as a Pi's wrong clock sees GitHub's), says each in words.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const ports = require("./ports");
const { haveFfmpeg, FFMPEG } = require("./fixtures");

const ROOT = path.join(__dirname, "..");
const BRIDGE = path.join(ROOT, "bridge", "linux", "bin", "mandarin-bridge");
const ENGINE = path.join(ROOT, "engine", "bin", "mandarin-audio");
const haveOpenssl = spawnSync("openssl", ["version"]).status === 0;
const skip = !haveOpenssl ? "openssl is not installed" : !haveFfmpeg() ? "ffmpeg is not installed"
  : !fs.existsSync(BRIDGE) && !process.env.CI && "bridge/linux/build.sh not run";

// A self-signed certificate for 127.0.0.1, valid from now, or only from [start] to [end] (openssl ca can date one so).
function certificate(dir, start, end) {
  fs.mkdirSync(dir, { recursive: true });
  const run = (args) => { const r = spawnSync("openssl", args, { cwd: dir }); assert.equal(r.status, 0, r.stderr.toString()); };
  run(["req", "-new", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=127.0.0.1", "-keyout", "k.pem", "-out", "r.csr"]);
  if (!start) run(["x509", "-req", "-in", "r.csr", "-signkey", "k.pem", "-days", "2", "-out", "c.pem"]);
  else {
    fs.writeFileSync(path.join(dir, "index.txt"), "");
    fs.writeFileSync(path.join(dir, "serial"), "01\n");
    fs.writeFileSync(path.join(dir, "cfg"), "[ca]\ndefault_ca=d\n[d]\ndir=.\ndatabase=index.txt\nnew_certs_dir=.\nserial=serial\ndefault_md=sha256\npolicy=p\n[p]\ncommonName=supplied\n");
    run(["ca", "-selfsign", "-keyfile", "k.pem", "-in", "r.csr", "-out", "c.pem", "-startdate", start, "-enddate", end, "-batch", "-config", "cfg"]);
  }
  return { key: fs.readFileSync(path.join(dir, "k.pem")), cert: fs.readFileSync(path.join(dir, "c.pem")) };
}

const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 100)); } };

for (const [what, start, end, said] of [
  ["a certificate this computer doesn't trust", null, null, /this computer doesn't trust GitHub's certificate: its certificates are missing or out of date/],
  ["a certificate not valid on this computer's date (a Pi's clock wrong)", "20200101000000Z", "20200102000000Z", /GitHub's certificate isn't valid on this computer's date \(\d+ \w+ \d{4}, \d\d:\d\d\): its clock is wrong/],
]) {
  test("an update GitHub's certificate stops says why: " + what, { skip, timeout: 60000 }, async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-tls-"));
    const gh = https.createServer(certificate(path.join(tmp, "cert"), start, end), (req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
    await new Promise(r => gh.listen(0, "127.0.0.1", r));
    t.after(() => gh.close());
    const port = ports.port();
    const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "asound"), "--device", "file:" + path.join(tmp, "dac.raw"),
      "--address", "127.0.0.1", "--engine", ENGINE, "--ffmpeg", FFMPEG, "--update-api", `https://127.0.0.1:${gh.address().port}`, "--server", "127.0.0.1:" + ports.port()],
      { stdio: ["ignore", "ignore", "ignore"] });
    t.after(() => p.kill());
    const BR = "http://127.0.0.1:" + port;
    assert.ok(await until(async () => (await fetch(BR + "/dac.json")).ok, 15000), "the Bridge answers");
    const r = await fetch(BR + "/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: "test-bridge" }) });
    assert.equal(r.status, 202);
    const update = await until(async () => { const u = (await (await fetch(BR + "/dac.json")).json()).update; return u.state === "failed" && u; }, 20000);
    assert.ok(update, "the update failed");
    assert.match(update.says, said, update.says);
    assert.doesNotMatch(update.says, /SecureConnectionError/, "in words, not .NET's name for it");
  });
}
