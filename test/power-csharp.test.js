"use strict";
/*
 * Restart and Shut down answered by the C# server (v0.8.31, stage 1d of
 * docs/specs/csharp-migration.md; PowerRoutes.cs), and how the processor is
 * shared out (/api/cpu). Run for real, as an install runs it, in a data
 * folder of its own: until v0.8.50 the C# server started the Node server
 * itself; since stage 7 it runs alone (MANDARIN_NODE=0, as with no index.js
 * beside it).
 *
 *   - Restart: started again in its same process (from its file, as after an
 *     update), the library and the account as they were;
 *   - Shut down: it stops, with 0;
 *   - /api/system/power and /api/cpu: as the Node server's were.
 *
 * Away (over Tailscale: a request Tailscale's proxy on this machine forwards
 * from a tailnet address) both are refused, nothing stopped. On a Mac, Shut
 * down unloads the installer's login item (launchctl bootout, else the older
 * unload, else a plain stop), here with a stand-in launchctl on the PATH.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (process.platform === "win32" && "not on Windows");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "waiting") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out " + what);
    await sleep(100);
  }
}

/* The C# server on its own, from this checkout; its output kept. */
function start(t, lib, more = {}) {
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const out = [];
  // Its own, not the test's: what this process was started with left out, then the case's own.
  const inherited = Object.assign({}, process.env);
  for (const k of ["MANDARIN_UPSTREAM", "MANDARIN_FRONT_KEY", "INTERNAL_PORT", "MANDARIN_LAUNCHD", "XPC_SERVICE_NAME", "NODE_OPTIONS"]) delete inherited[k];
  const env = Object.assign(inherited, {
    PORT: String(PORT), DATA_DIR: lib.data, MUSIC_DIR: lib.music, SONOS_HOSTS: "", UPNP_DISCOVERY: "0",
    MANDARIN_APP_DIR: path.join(__dirname, ".."), MANDARIN_LOOPBACK_ONLY: "1", DOCKER: "", MANDARIN_NODE: "0"
  }, more);
  const p = spawn(BIN, [], { env, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", d => out.push(String(d)));
  p.stderr.on("data", d => out.push(String(d)));
  const exited = new Promise(r => p.once("exit", (code, signal) => r({ code, signal })));
  t.after(async () => {
    if (p.exitCode == null && p.signalCode == null) { p.kill("SIGTERM"); await Promise.race([exited, sleep(15000)]); }
    if (p.exitCode == null && p.signalCode == null) p.kill("SIGKILL");
  });
  return { p, B, exited, log: () => out.join("") };
}

test("Restart and Shut down by the C# server, as an install runs it", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const c = start(t, lib);
  const health = () => fetch(c.B + "/api/health", { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false);
  await until(health, 60000, "for the servers to start: " + c.log());
  const token = await signIn(c.B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const get = (p) => fetch(c.B + p, { headers: H });

  await t.test("what this install can do, answered by the C# server; signed in only", async () => {
    assert.equal((await fetch(c.B + "/api/system/power")).status, 401, "signed in only");
    const r = await get("/api/system/power");
    assert.equal(r.headers.get("x-mandarin-answered"), "C#");
    assert.deepEqual(await r.json(), { restart: true, shutdown: true, docker: false, start_again: "manual" });
  });

  await t.test("the processor split (v0.8.48: decided by the C# server; test/cpu-alone.test.js holds the decision)", async () => {
    const r = await get("/api/cpu");
    assert.equal(r.headers.get("x-mandarin-answered"), "C#");
    const plan = await r.json();
    for (const k of ["split", "cores", "playback", "background", "core", "dsp", "raised", "tools"]) assert.ok(k in plan, k + " in " + JSON.stringify(plan));
    assert.ok(Array.isArray(plan.cores) && plan.cores.length >= 1);
  });

  await t.test("Restart: started again in its same process", async () => {
    const pid = c.p.pid;
    assert.doesNotMatch(c.log(), /started the Node server/, "on its own: " + c.log());
    const albums = (await until(async () => { const x = await get("/api/library/albums"); const j = x.ok && await x.json(); return j && j.albums && j.albums.length && j.albums; }, 30000, "for the library")).length;
    const r = await fetch(c.B + "/api/system/restart", { method: "POST", headers: H, body: "{}" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, restarting: true });
    await until(() => /starting again from /.test(c.log()), 30000, "for the C# server to start again: " + c.log());
    await until(health, 60000, "for it to answer again: " + c.log());
    assert.equal(c.p.exitCode, null, "the C# server never stopped");
    assert.equal(c.p.pid, pid, "in the same process");
    assert.match(c.log(), /\[power\] restart asked for from Settings/);
    // As they were: still signed in, the same library.
    const again = await until(async () => { const x = await get("/api/library/albums"); const j = x.ok && await x.json(); return j && j.albums && j.albums.length && j.albums; }, 30000, "for the library");
    assert.equal(again.length, albums);
  });

  await t.test("Shut down: it stops, with 0", async () => {
    const r = await fetch(c.B + "/api/system/shutdown", { method: "POST", headers: H, body: "{}" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, start_again: "manual" });
    const how = await Promise.race([c.exited, sleep(30000).then(() => null)]);
    assert.deepEqual(how, { code: 0, signal: null }, "left with 0: " + c.log());
    assert.match(c.log(), /\[power\] shut down asked for from Settings/);
  });
});

test("in Docker, Shut down isn't offered: docker stop is the way", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const c = start(t, lib, { DOCKER: "1" });
  await until(() => fetch(c.B + "/api/health", { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false), 60000, "for the servers to start: " + c.log());
  const H = { Authorization: "Bearer " + await signIn(c.B), "Content-Type": "application/json" };
  assert.deepEqual(await (await fetch(c.B + "/api/system/power", { headers: H })).json(), { restart: true, shutdown: false, docker: true, start_again: "docker" });
  const r = await fetch(c.B + "/api/system/shutdown", { method: "POST", headers: H, body: "{}" });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: "In Docker, stop the container instead: docker stop musicd-server" });
  await sleep(1000);
  assert.equal(c.p.exitCode, null, "still running");
});

test("neither from away: Restart and Shut down refused over Tailscale, nothing stopped", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const c = start(t, lib);
  await until(() => fetch(c.B + "/api/health", { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false), 60000, "for the server to start: " + c.log());
  const H = { Authorization: "Bearer " + await signIn(c.B), "Content-Type": "application/json", "X-Forwarded-For": "100.101.102.103" };
  for (const p of ["/api/system/restart", "/api/system/shutdown"]) {
    const r = await fetch(c.B + p, { method: "POST", headers: H, body: "{}" });
    assert.equal(r.status, 403, p);
    assert.equal((await r.json()).away, true, p);
  }
  await sleep(1000);
  assert.equal(c.p.exitCode, null, "still running");
  assert.doesNotMatch(c.log(), /\[power\] (restart|shut down) asked for/);
});

/* A stand-in launchctl, first on the PATH: each call written down, answering with [code]. */
function launchctl(lib, code) {
  const dir = path.join(lib.root, "bin");
  fs.mkdirSync(dir, { recursive: true });
  const calls = path.join(lib.root, "launchctl.calls");
  fs.writeFileSync(path.join(dir, "launchctl"), `#!/bin/sh\necho "$*" >> "${calls}"\nexit ${code}\n`, { mode: 0o755 });
  return { PATH: dir + ":" + process.env.PATH, MANDARIN_LAUNCHD: "app.mandarin.server", calls: () => fs.existsSync(calls) ? fs.readFileSync(calls, "utf8").trim().split("\n") : [] };
}
const mac = process.platform === "darwin" ? false : "a Mac's own (launchd)";

test("Shut down on a Mac: the login item is unloaded, not merely exited", { skip: skip || mac, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const lc = launchctl(lib, 0);
  const c = start(t, lib, { PATH: lc.PATH, MANDARIN_LAUNCHD: lc.MANDARIN_LAUNCHD });
  await until(() => fetch(c.B + "/api/health", { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false), 60000, "for the server to start: " + c.log());
  const H = { Authorization: "Bearer " + await signIn(c.B), "Content-Type": "application/json" };
  const r = await fetch(c.B + "/api/system/shutdown", { method: "POST", headers: H, body: "{}" });
  assert.deepEqual(await r.json(), { ok: true, start_again: "icon" });
  await until(() => lc.calls().length, 15000, "for launchctl to be asked");
  assert.deepEqual(lc.calls(), [`bootout gui/${process.getuid()}/app.mandarin.server`]);
  await sleep(1500);
  assert.equal(c.p.exitCode, null, "launchd stops it: no exit of its own");
});

test("…and if bootout fails, the older unload, then a plain stop", { skip: skip || mac, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const lc = launchctl(lib, 1);
  const c = start(t, lib, { PATH: lc.PATH, MANDARIN_LAUNCHD: lc.MANDARIN_LAUNCHD });
  await until(() => fetch(c.B + "/api/health", { signal: AbortSignal.timeout(3000) }).then(r => r.ok, () => false), 60000, "for the server to start: " + c.log());
  const H = { Authorization: "Bearer " + await signIn(c.B), "Content-Type": "application/json" };
  await fetch(c.B + "/api/system/shutdown", { method: "POST", headers: H, body: "{}" });
  const how = await Promise.race([c.exited, sleep(30000).then(() => null)]);
  assert.deepEqual(how, { code: 0, signal: null }, "a plain stop: " + c.log());
  assert.deepEqual(lc.calls().map(l => l.split(" ")[0]), ["bootout", "unload"]);
  assert.match(lc.calls()[1], /Library\/LaunchAgents\/app\.mandarin\.server\.plist$/);
});
