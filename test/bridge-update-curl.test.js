"use strict";
/*
 * A Linux Bridge whose secure connection to GitHub fails before any certificate is seen (item 385). A DietPi's update
 * failed every time with "GitHub couldn't be reached (SecureConnectionError)": not its clock, not its certificates (item
 * 359 says those in words), and the same computer's curl, the install line's, fetched GitHub's releases. Now the Bridge
 * says what .NET said, and fetches with curl instead, its download checked as before. Its stand-in GitHub here answers
 * plain http where https is asked, which no TLS handshake gets past; the stand-in curl asks it over http.
 *
 * And an update in its data folder older than the program installed (item 385): installed again by hand, a newer
 * Bridge handed over to an older update left there, and ran it. Now the older one is let go.
 */
const test = require("node:test");
const assert = require("node:assert");
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
const haveCurl = spawnSync("curl", ["--version"]).status === 0;
const skip = !haveCurl ? "curl is not installed" : !haveFfmpeg() ? "ffmpeg is not installed"
  : !fs.existsSync(BRIDGE) && !process.env.CI && "bridge/linux/build.sh not run";

const until = async (fn, ms) => { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (e) { /* not yet */ } if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 100)); } };

/** The Bridge started in [tmp], asking [api] for releases, with [curl] as its curl; what it logs kept in [said]. */
function bridge(t, tmp, api, curl) {
  const port = ports.port();
  const out = { said: "", base: "http://127.0.0.1:" + port };
  const p = spawn(BRIDGE, ["--port", String(port), "--data", path.join(tmp, "data"), "--asound", path.join(tmp, "asound"), "--device", "file:" + path.join(tmp, "dac.raw"),
    "--address", "127.0.0.1", "--engine", ENGINE, "--ffmpeg", FFMPEG, "--update-api", api, "--server", "127.0.0.1:" + ports.port(), "--curl", curl],
  { stdio: ["ignore", "ignore", "pipe"] });
  p.stderr.on("data", d => { out.said += d; });
  t.after(() => p.kill());
  return out;
}

async function failedUpdate(br) {
  assert.ok(await until(async () => (await fetch(br.base + "/dac.json")).ok, 15000), "the Bridge answers: " + br.said);
  const r = await fetch(br.base + "/update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: "test-bridge" }) });
  assert.equal(r.status, 202);
  const update = await until(async () => { const u = (await (await fetch(br.base + "/dac.json")).json()).update; return u.state === "failed" && u; }, 30000);
  assert.ok(update, "the update ended: " + br.said);
  return update;
}

// GitHub as plain http: every ask answered, as GitHub's API answers a release that has no builds.
async function plainGithub(t) {
  const asks = [];
  const gh = http.createServer((req, res) => { asks.push(req.url); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ tag_name: "test-bridge", assets: [] })); });
  await new Promise(r => gh.listen(0, "127.0.0.1", r));
  t.after(() => gh.close());
  return { asks, api: `https://127.0.0.1:${gh.address().port}` };
}

test("a secure connection that fails before any certificate: fetched with curl, the reason said", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-curl-"));
  const gh = await plainGithub(t);
  // curl as the computer's, asking the stand-in over http (it speaks no TLS).
  const curl = path.join(tmp, "curl");
  fs.writeFileSync(curl, `#!/bin/sh\nfor a in "$@"; do shift; set -- "$@" "$(printf '%s' "$a" | sed 's|^https://|http://|')"; done\nexec curl "$@"\n`, { mode: 0o755 });
  const br = bridge(t, tmp, gh.api, curl);
  const update = await failedUpdate(br);
  // Past GitHub's answer: the release read, by curl, and found to have no build for this machine.
  assert.match(update.says, /the release test-bridge has no mandarin-bridge-linux-\w+\.tar\.gz\.json/, update.says);
  assert.ok(gh.asks.includes("/repos/meltface-80/Mandarin/releases/tags/test-bridge"), "curl asked GitHub: " + gh.asks.join(", "));
  assert.match(br.said, /couldn't make a secure connection to GitHub \(.+\); fetched with curl instead/, br.said);
});

test("a secure connection that fails before any certificate, no curl here: what .NET said, in its own words", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-curl-"));
  const gh = await plainGithub(t);
  const update = await failedUpdate(bridge(t, tmp, gh.api, path.join(tmp, "no-curl")));
  assert.match(update.says, /^The update couldn't be installed: a secure connection to GitHub couldn't be made \(.+\)$/, update.says);
  assert.doesNotMatch(update.says, /\(SecureConnectionError\)$/, "the reason, not .NET's name for the kind of failure");
});

test("an update older than the program installed, left in its data folder: let go, never run", { skip, timeout: 60000 }, async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-older-"));
  const app = path.join(tmp, "data", "app");
  fs.mkdirSync(app, { recursive: true });
  const marker = path.join(tmp, "ran");
  fs.writeFileSync(path.join(app, "mandarin-bridge"), `#!/bin/sh\nif [ "$1" = --version ]; then echo "mandarin-bridge 0.0.1 (aaaaaaa)"; exit 0; fi\necho ran > "${marker}"\nsleep 30\n`, { mode: 0o755 });
  fs.copyFileSync(ENGINE, path.join(app, "mandarin-audio"));
  const br = bridge(t, tmp, "http://127.0.0.1:9", "curl");
  assert.ok(await until(async () => (await fetch(br.base + "/dac.json")).ok, 15000), "the program installed answers: " + br.said);
  assert.ok(!fs.existsSync(marker), "the older update never ran: " + br.said);
  assert.ok(!fs.existsSync(app), "and was let go");
  assert.match(br.said, /update: app\/ holds 0\.0\.1, older than this Bridge \([\d.]+\); let go/, br.said);
});

test("install.sh: an update fetched earlier gives way to the program it installs", () => {
  // The service's data folder (StateDirectory, under /var/lib/private with its DynamicUser), whose app/ the program
  // installed hands over to: installed again by hand, the Bridge went on running the update left there (item 385).
  const service = fs.readFileSync(path.join(ROOT, "bridge", "linux", "mandarin-bridge.service"), "utf8");
  const data = /--data (\S+)/.exec(service)[1];
  const install = fs.readFileSync(path.join(ROOT, "bridge", "linux", "install.sh"), "utf8");
  const lines = install.split("\n");
  const rm = lines.findIndex(l => /^rm -rf /.test(l) && l.includes(data + "/app"));
  assert.ok(rm > 0, "install.sh removes " + data + "/app");
  assert.ok(lines[rm].includes("/var/lib/private/" + path.basename(data) + "/app"), "and where systemd keeps it for a DynamicUser");
  assert.ok(rm < lines.findIndex(l => l.startsWith("systemctl restart")), "before the Bridge is started again");
});
