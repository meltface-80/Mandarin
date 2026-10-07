"use strict";
/*
 * Tailscale built into the server (lib/server/tsnode.js), driven against a
 * stand-in for the engine that answers its control API the way the real one
 * does (the real one is tested against a private tailnet in android/musicdnet).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { signIn } = require("./auth-helper");
const { awayAddress } = require("../lib/server/tailscale");

const PORT = 3609;
const B = "http://127.0.0.1:" + PORT;

// The engine's control API, as far as the server uses it. It records what it
// was asked, in a file next to itself, so the test can see.
const STUB = `#!/usr/bin/env node
const http = require("http"), fs = require("fs"), path = require("path");
const dir = process.argv[process.argv.indexOf("-dir") + 1];
const log = path.join(__dirname, "calls.log");
const secret = process.env.MUSICDNET_SECRET;
let st = { state: "Stopped", ips: [], serving: "" };
const srv = http.createServer((req, res) => {
  if (req.headers["x-secret"] !== secret) { res.writeHead(403); return res.end(); }
  let body = ""; req.on("data", d => body += d); req.on("end", () => {
    fs.appendFileSync(log, req.method + " " + req.url + " " + body + "\\n");
    const reply = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/start") {
      const b = JSON.parse(body || "{}");
      st = b.AuthKey ? { state: "Running", ips: ["100.90.1.2", "fd7a:115c:a1e0::1"], dns_name: "musicd.tail1.ts.net.", serving: "" }
                     : { state: "NeedsLogin", auth_url: "https://login.tailscale.com/a/abc123", ips: [], serving: "" };
      return reply(st);
    }
    if (u.pathname === "/status") return reply(st);
    if (u.pathname === "/login") return reply(Object.assign(st, { auth_url: "https://login.tailscale.com/a/new456" }));
    if (u.pathname === "/logout") { st = { state: "NeedsLogin", ips: [], serving: "" }; return reply(st); }
    if (u.pathname === "/serve") { st.serving = "100.90.1.2:" + u.searchParams.get("port"); if (process.env.TS_STUB_STALE) st.online = false; return reply({ addr: st.serving }); }
    if (u.pathname === "/rebind") return reply({ ok: true });
    reply({ error: "no" }, 404);
  });
});
srv.listen(0, "127.0.0.1", () => { process.stdout.write("CONTROL " + srv.address().port + "\\n"); });
process.stdin.on("end", () => process.exit(0)); process.stdin.resume();
fs.writeFileSync(path.join(__dirname, "args.txt"), process.argv.slice(2).join(" ") + "\\n" + (process.env.TS_AUTHKEY ? "leaked" : "ok"));
`;

async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 100));
  }
}

function stubEngine() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-ts-"));
  const bin = path.join(dir, "musicdnet");
  fs.writeFileSync(bin, STUB, { mode: 0o755 });
  return { dir, bin, calls: () => { try { return fs.readFileSync(path.join(dir, "calls.log"), "utf8"); } catch (e) { return ""; } } };
}

function server(bin, extraEnv = {}, extraConfig = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-tsd-"));
  fs.mkdirSync(path.join(dir, "music"));
  for (const k of Object.keys(extraEnv)) process.env[k] = extraEnv[k];
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  return createServer(Object.assign({ port: PORT, musicDir: path.join(dir, "music"), dataDir: path.join(dir, "data"), serverIp: "127.0.0.1", sonosHosts: [], tailscaleBin: bin }, extraConfig));
}

test("signing the server in to Tailscale from Settings", async () => {
  const eng = stubEngine();
  const srv = server(eng.bin);
  await srv.start();
  try {
    const token = await signIn(B);
    const auth = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const api = async (p, body) => (await fetch(B + "/api/" + p, body ? { method: "POST", headers: auth, body: JSON.stringify(body) } : { headers: auth })).json();

    // Started by itself, as "musicd", waiting to be signed in, with a link.
    const st = await until(async () => { const s = await api("tailscale"); return s.state === "NeedsLogin" && s; });
    assert.equal(st.available, true);
    assert.equal(st.enabled, true);
    assert.equal(st.auth_url, "https://login.tailscale.com/a/abc123");
    assert.equal(st.address, null);
    assert.match(fs.readFileSync(path.join(eng.dir, "args.txt"), "utf8"), /^-server -dir .*tailscale\nok$/);
    assert.match(eng.calls(), /POST \/start \{"Hostname":"musicd"/);

    // A new link on asking.
    assert.equal((await api("tailscale/login", {})).auth_url, "https://login.tailscale.com/a/new456");

    // Unauthenticated: nothing.
    assert.equal((await fetch(B + "/api/tailscale")).status, 401);

    // Off, and on again.
    const off = await api("tailscale/enable", { on: false });
    assert.equal(off.enabled, false);
    assert.equal(off.state, "Stopped");
    const on = await api("tailscale/enable", { on: true });
    assert.equal(on.enabled, true);
    await until(async () => (await api("tailscale")).state === "NeedsLogin");
  } finally {
    await srv.stop();
  }
});

test("with TS_AUTHKEY it joins by itself, serves the server's port, and phones learn its address", async () => {
  const eng = stubEngine();
  const srv = server(eng.bin, { TS_AUTHKEY: "tskey-auth-test" });
  const ctx = await srv.start();
  try {
    const st = await until(async () => { const s = ctx.tailscale.status(); return s.serving && s; });
    assert.equal(st.state, "Running");
    assert.equal(st.address, "http://100.90.1.2:" + PORT);
    assert.equal(st.dns_name, "musicd.tail1.ts.net");
    assert.match(eng.calls(), new RegExp(`POST /serve\\?port=${PORT}&upstream=http%3A%2F%2F127\\.0\\.0\\.1%3A${PORT}`));
    // The key goes through the API, never the engine's environment.
    assert.match(eng.calls(), /"AuthKey":"tskey-auth-test"/);
    assert.match(fs.readFileSync(path.join(eng.dir, "args.txt"), "utf8"), /\nok$/);
    // The address phones are given: the built-in one before the host's.
    assert.equal(awayAddress(PORT, {}, { tailscale0: [{ family: "IPv4", address: "100.64.9.9" }] }, ctx.tailscale), "http://100.90.1.2:" + PORT);
    assert.equal(awayAddress(PORT, { TAILSCALE_ADDRESS: "nas.tail1.ts.net" }, {}, ctx.tailscale), "http://nas.tail1.ts.net:" + PORT);
  } finally {
    await srv.stop();
    delete process.env.TS_AUTHKEY;
  }
});

test("without the engine (a source install) it says so and stays out of the way", async () => {
  const srv = server("/nonexistent/musicdnet");
  const ctx = await srv.start();
  try {
    const s = ctx.tailscale.status();
    assert.equal(s.available, false);
    assert.equal(s.state, "Stopped");
    await assert.rejects(ctx.tailscale.login(), /isn't in this install/);
  } finally {
    await srv.stop();
  }
});

test("an install updated in place downloads the engine, checked, once per server version", async () => {
  const eng = stubEngine();
  const zlib = require("zlib"), crypto = require("crypto"), http = require("http");
  const gz = zlib.gzipSync(fs.readFileSync(eng.bin));
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  let sums = crypto.createHash("sha256").update(gz).digest("hex") + "  musicdnet-linux-" + arch + ".gz\n";
  let fetched = 0;
  const site = http.createServer((req, res) => {
    if (req.url === "/SHA256SUMS") return res.end(sums);
    if (req.url === "/musicdnet-linux-" + arch + ".gz") { fetched++; return res.end(gz); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => site.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + site.address().port;
  const { TailscaleNode } = require("../lib/server/tsnode");
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-tsdl-"));
  const settings = {};
  const db = { setting: (k, d) => (k in settings ? settings[k] : d), setSetting: (k, v) => { settings[k] = v; } };
  const node = (version, env = {}) => new TailscaleNode({ bin: "/nonexistent/musicdnet", dir: path.join(data, "tailscale"), port: PORT, db, version,
    env: Object.assign({ PATH: process.env.PATH, TS_ENGINE_URL: url }, env) });
  const running = [];
  const node2 = (v, env) => { const n = node(v, env); running.push(n); return n; };
  try {
    // Not in the image, and nowhere to fetch it from: not offered (a source install).
    assert.equal(node("0.3.21", { TS_ENGINE_URL: "" }).available, false);

    const a = node2("0.3.21");
    assert.equal(a.available, true);
    await a.start();
    await until(async () => a.status().state === "NeedsLogin");
    assert.equal(fetched, 1);
    assert.ok(fs.existsSync(path.join(data, "bin", "musicdnet")));
    a.stop();

    // The same version again: nothing fetched.
    const b = node2("0.3.21");
    await b.start();
    await until(async () => b.status().state === "NeedsLogin");
    assert.equal(fetched, 1);
    b.stop();

    // The server updated: fetched again. A damaged download is refused, and the old engine still runs.
    sums = "0".repeat(64) + "  musicdnet-linux-" + arch + ".gz\n";
    const c = node2("0.3.22");
    await c.start();
    await until(async () => c.status().state === "NeedsLogin");
    assert.match(c.status().error || "", /checksum/);
    c.stop();
  } finally {
    for (const n of running) n.stop();
    site.close();
  }
});

// The watchdog (v0.7.2): an engine that says Running but isn't online on the
// tailnet is asked to rebind, and started afresh when that doesn't help.
test("a node that is Running but not online is rebound, then started afresh", { timeout: 120000 }, async () => {
  const eng = stubEngine();
  const srv = server(eng.bin, { TS_AUTHKEY: "tskey-auth-test", TS_STUB_STALE: "1" }, { tailscaleWatchdog: { rebindMs: 400, restartMs: 1500 } });
  const ctx = await srv.start();
  try {
    const st = await until(async () => { const s = ctx.tailscale.status(); return s.serving && s; });
    assert.equal(st.online, false, "the status says it isn't online");
    // The engine is asked every 5 s: the rebind within three asks, the fresh start a few after.
    await until(async () => /POST \/rebind/.test(eng.calls()), 40000);
    // Still not online after the rebind: the engine is started afresh (a second /start).
    await until(async () => (eng.calls().match(/POST \/start/g) || []).length >= 2, 40000);
    await until(async () => (eng.calls().match(/POST \/serve/g) || []).length >= 2, 40000);
  } catch (e) {
    console.log("CALLS:\n" + eng.calls() + "\nSTATUS: " + JSON.stringify(ctx.tailscale.status()));
    throw e;
  } finally {
    await srv.stop();
    delete process.env.TS_AUTHKEY; delete process.env.TS_STUB_STALE;
  }
});
