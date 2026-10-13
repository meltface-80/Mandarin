"use strict";
/*
 * Tailscale built into the server (Admin/Tailscale.cs; lib/server/tsnode.js
 * until v0.8.50), driven against a stand-in for the engine that answers its
 * control API the way the real one does (the real one is tested against a
 * private tailnet in android/musicdnet). Through the server's own routes; the
 * order an away address is chosen in asked through `mandarin-server score`.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { signIn } = require("./auth-helper");
const { built } = require("./server");
const { score } = require("./score");

const PORT = ports.port();
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
  const { createServer } = require("./server");
  return createServer(Object.assign({ port: PORT, musicDir: path.join(dir, "music"), dataDir: path.join(dir, "data"), serverIp: "127.0.0.1", sonosHosts: [], tailscaleBin: bin }, extraConfig));
}

test("signing the server in to Tailscale from Settings", { skip: built() }, async () => {
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

    // Signed out (v0.9.1, the audit's T1): the engine told, then started afresh, to be signed in again.
    const starts = () => (eng.calls().match(/POST \/start /g) || []).length;
    const before = starts();
    const out = await api("tailscale/logout", {});
    assert.equal(out.enabled, true, JSON.stringify(out));
    assert.match(eng.calls(), /POST \/logout /);
    await until(async () => starts() === before + 1 && (await api("tailscale")).state === "NeedsLogin");
    // Away, the way you're reaching the server is what it would change: refused, nothing asked of the engine.
    const away = await fetch(B + "/api/tailscale/logout", { method: "POST", headers: Object.assign({ "X-Forwarded-For": "100.101.102.103" }, auth), body: "{}" });
    assert.equal(away.status, 403);
    assert.equal((eng.calls().match(/POST \/logout /g) || []).length, 1);

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

// How it is, from Settings → Away from home.
async function tailscaleOf(token) {
  return (await fetch(B + "/api/tailscale", { headers: { Authorization: "Bearer " + token } })).json();
}

test("with TS_AUTHKEY it joins by itself, serves the server's port, and phones learn its address", { skip: built() }, async () => {
  const eng = stubEngine();
  const srv = server(eng.bin, { TS_AUTHKEY: "tskey-auth-test" });
  await srv.start();
  try {
    const token = await signIn(B);
    const st = await until(async () => { const s = await tailscaleOf(token); return s.serving && s; });
    assert.equal(st.state, "Running");
    assert.equal(st.address, "http://100.90.1.2:" + PORT);
    assert.equal(st.dns_name, "musicd.tail1.ts.net");
    assert.match(eng.calls(), new RegExp(`POST /serve\\?port=${PORT}&upstream=http%3A%2F%2F127\\.0\\.0\\.1%3A${PORT}`));
    // The key goes through the API, never the engine's environment.
    assert.match(eng.calls(), /"AuthKey":"tskey-auth-test"/);
    assert.match(fs.readFileSync(path.join(eng.dir, "args.txt"), "utf8"), /\nok$/);
    // The address a phone is given when it says hello: the built-in one (asked
    // of the C# server when it runs the engine).
    const hello = await (await fetch(B + "/api/phone/hello", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" })).json();
    assert.equal(hello.away_address, "http://100.90.1.2:" + PORT);
    // And the order they're chosen in: TAILSCALE_ADDRESS, the built-in one, the host's.
    const host = { tailscale0: [{ family: "IPv4", address: "100.64.9.9" }] };
    assert.deepEqual(score({ fn: "auth", aways: [{ port: PORT, own: st.address, ifaces: host }, { port: PORT, set: "nas.tail1.ts.net", own: st.address, ifaces: host },
      { port: PORT, ifaces: host }] }).aways, ["http://100.90.1.2:" + PORT, "http://nas.tail1.ts.net:" + PORT, "http://100.64.9.9:" + PORT]);
  } finally {
    await srv.stop();
    delete process.env.TS_AUTHKEY;
  }
});

test("without the engine (a source install) it says so and stays out of the way", { skip: built() }, async () => {
  const srv = server("/nonexistent/musicdnet");
  await srv.start();
  try {
    const token = await signIn(B);
    const s = await tailscaleOf(token);
    assert.equal(s.available, false);
    assert.equal(s.state, "Stopped");
    const r = await fetch(B + "/api/tailscale/login", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: "{}" });
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /isn't in this install/);
  } finally {
    await srv.stop();
  }
});

/*
 * An install updated in place (no engine in the image): the server, and a
 * release site (here, a server of our own) with the engine and its checksums.
 * `fetched()`: how often the engine was downloaded; `sums`: what the site
 * says the checksums are.
 */
async function engineSite(t) {
  const eng = stubEngine();
  const zlib = require("zlib"), crypto = require("crypto"), http = require("http");
  const gz = zlib.gzipSync(fs.readFileSync(eng.bin));
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  const good = crypto.createHash("sha256").update(gz).digest("hex") + "  musicdnet-linux-" + arch + ".gz\n";
  const site = { sums: good, good, arch, fetches: 0 };
  const web = http.createServer((req, res) => {
    if (req.url === "/SHA256SUMS") return res.end(site.sums);
    if (req.url === "/musicdnet-linux-" + arch + ".gz") { site.fetches++; return res.end(gz); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => web.listen(0, "127.0.0.1", r));
  t.after(() => { web.close(); delete process.env.TS_ENGINE_URL; });
  const srv = server("/nonexistent/musicdnet", { TS_ENGINE_URL: "http://127.0.0.1:" + web.address().port });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  return { site, ctx, token, bin: path.join(ctx.config.dataDir, "bin", "musicdnet") };
}

test("an install updated in place downloads the engine, checked, once per server version", { skip: built() || (process.platform !== "linux" && "the engine is built for Linux only"), timeout: 180000 }, async (t) => {
  const { site, ctx, token, bin } = await engineSite(t);
  const version = require("../package.json").version;
  const waiting = () => until(async () => { const s = await tailscaleOf(token); return s.state === "NeedsLogin" && s; }, 30000);
  assert.equal((await waiting()).available, true);
  assert.equal(site.fetches, 1);
  assert.ok(fs.existsSync(bin));
  assert.equal(fs.readFileSync(bin + ".version", "utf8"), version, "fetched for this version of the server");

  // The same version again: nothing fetched.
  await ctx.restart(token);
  await waiting();
  assert.equal(site.fetches, 1);

  // The server updated (the engine there was fetched for an older one): fetched again.
  // A damaged download is refused, and the old engine still runs.
  fs.writeFileSync(bin + ".version", "0.3.21");
  site.sums = "0".repeat(64) + "  musicdnet-linux-" + site.arch + ".gz\n";
  await ctx.restart(token);
  assert.match((await waiting()).error || "", /checksum/);
  assert.equal(site.fetches, 2);
  assert.equal(fs.readFileSync(bin + ".version", "utf8"), "0.3.21");
  // Mended: taken, and noted for this version.
  site.sums = site.good;
  await ctx.restart(token);
  assert.equal((await waiting()).error, null);
  assert.equal(site.fetches, 3);
  assert.equal(fs.readFileSync(bin + ".version", "utf8"), version);
});

// The engine is built for Linux only: anywhere else (a Mac) it isn't offered
// even with somewhere to fetch it from, and nothing is fetched.
test("off Linux the engine isn't offered, and nothing is fetched", { skip: built() || (process.platform === "linux" && "Linux has the engine"), timeout: 60000 }, async (t) => {
  const { site, token, bin } = await engineSite(t);
  const s = await tailscaleOf(token);
  assert.equal(s.available, false);
  assert.equal(s.state, "Stopped");
  assert.equal(site.fetches, 0);
  assert.ok(!fs.existsSync(bin));
});

// The watchdog (v0.7.2): an engine that says Running but isn't online on the
// tailnet is asked to rebind, and started afresh when that doesn't help.
test("a node that is Running but not online is rebound, then started afresh", { skip: built(), timeout: 120000 }, async () => {
  const eng = stubEngine();
  const srv = server(eng.bin, { TS_AUTHKEY: "tskey-auth-test", TS_STUB_STALE: "1" }, { tailscaleWatchdog: { rebindMs: 400, restartMs: 1500 } });
  await srv.start();
  let token = null, st = null;
  try {
    token = await signIn(B);
    st = await until(async () => { const s = await tailscaleOf(token); return s.serving && s; });
    assert.equal(st.online, false, "the status says it isn't online");
    // The engine is asked every 5 s: the rebind within three asks, the fresh start a few after.
    await until(async () => /POST \/rebind/.test(eng.calls()), 40000);
    // Still not online after the rebind: the engine is started afresh (a second /start).
    await until(async () => (eng.calls().match(/POST \/start/g) || []).length >= 2, 40000);
    await until(async () => (eng.calls().match(/POST \/serve/g) || []).length >= 2, 40000);
  } catch (e) {
    console.log("CALLS:\n" + eng.calls() + "\nSTATUS: " + JSON.stringify(token ? await tailscaleOf(token).catch(() => st) : st));
    throw e;
  } finally {
    await srv.stop();
    delete process.env.TS_AUTHKEY; delete process.env.TS_STUB_STALE;
  }
});
