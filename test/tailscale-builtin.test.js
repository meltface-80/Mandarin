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
    if (u.pathname === "/serve") { st.serving = "100.90.1.2:" + u.searchParams.get("port"); return reply({ addr: st.serving }); }
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

function server(bin, extraEnv = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-tsd-"));
  fs.mkdirSync(path.join(dir, "music"));
  for (const k of Object.keys(extraEnv)) process.env[k] = extraEnv[k];
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  return createServer({ port: PORT, musicDir: path.join(dir, "music"), dataDir: path.join(dir, "data"), serverIp: "127.0.0.1", sonosHosts: [], tailscaleBin: bin });
}

test("signing the server in to Tailscale from Settings", async () => {
  const eng = stubEngine();
  const srv = server(eng.bin);
  const ctx = await srv.start();
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
