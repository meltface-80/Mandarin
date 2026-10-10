"use strict";
/*
 * Restart and Shut down answered by the C# server (v0.8.31, stage 1d of
 * docs/specs/csharp-migration.md; PowerRoutes.cs), and how the processor is
 * shared out (/api/cpu). Run for real: the C# server starts the Node server
 * itself, as an install does (only then does it answer these), in a data
 * folder of its own.
 *
 *   - Restart: both servers start again; the C# one in its same process
 *     (started again from its file, as after an update), with a new Node
 *     server, the library and the account as they were;
 *   - Shut down: both stop, the C# server with 0;
 *   - /api/system/power and /api/cpu: as the Node server's.
 *
 * Away (over Tailscale) both are refused, as before: no address here is away,
 * so that is left to test/power.test.js and the code.
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

/* The C# server, starting the Node server from this checkout; its output kept. */
function start(t, lib, more = {}) {
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const out = [];
  const env = Object.assign({}, process.env, {
    PORT: String(PORT), DATA_DIR: lib.data, MUSIC_DIR: lib.music, SONOS_HOSTS: "", UPNP_DISCOVERY: "0",
    MANDARIN_APP_DIR: path.join(__dirname, ".."), MANDARIN_LOOPBACK_ONLY: "1", DOCKER: ""
  }, more);
  // Its own, not the test's: the C# server starts the Node server here.
  for (const k of ["MANDARIN_UPSTREAM", "MANDARIN_FRONT_KEY", "INTERNAL_PORT", "MANDARIN_LAUNCHD", "XPC_SERVICE_NAME", "NODE_OPTIONS"]) delete env[k];
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

const nodePid = (s) => { const m = [...s.matchAll(/started the Node server \(pid (\d+)\)/g)]; return m.length ? Number(m[m.length - 1][1]) : null; };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };

test("Restart and Shut down through the C# server: both servers, as an install runs them", { skip, timeout: 180000 }, async (t) => {
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

  await t.test("the processor split, as the Node server decides it", async () => {
    const r = await get("/api/cpu");
    assert.equal(r.headers.get("x-mandarin-answered"), "C#");
    const plan = await r.json();
    for (const k of ["split", "cores", "playback", "background", "core", "dsp", "raised", "tools"]) assert.ok(k in plan, k + " in " + JSON.stringify(plan));
    assert.ok(Array.isArray(plan.cores) && plan.cores.length >= 1);
  });

  await t.test("Restart: the Node server started afresh, the C# server again in its same process", async () => {
    const pid = c.p.pid, before = nodePid(c.log());
    assert.ok(before, "the Node server's pid: " + c.log());
    const albums = (await until(async () => { const x = await get("/api/library/albums"); const j = x.ok && await x.json(); return j && j.albums && j.albums.length && j.albums; }, 30000, "for the library")).length;
    const r = await fetch(c.B + "/api/system/restart", { method: "POST", headers: H, body: "{}" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, restarting: true });
    await until(() => /starting again from /.test(c.log()), 30000, "for the C# server to start again: " + c.log());
    await until(() => nodePid(c.log()) !== before, 30000, "for a new Node server");
    assert.equal(alive(before), false, "the old Node server stopped");
    await until(health, 60000, "for the servers to answer again: " + c.log());
    assert.equal(c.p.exitCode, null, "the C# server never stopped");
    assert.equal(c.p.pid, pid, "in the same process");
    assert.match(c.log(), /\[power\] restart asked for from Settings/);
    // As they were: still signed in, the same library.
    const again = await until(async () => { const x = await get("/api/library/albums"); const j = x.ok && await x.json(); return j && j.albums && j.albums.length && j.albums; }, 30000, "for the library");
    assert.equal(again.length, albums);
  });

  await t.test("Shut down: both stop, the C# server with 0", async () => {
    const node = nodePid(c.log());
    const r = await fetch(c.B + "/api/system/shutdown", { method: "POST", headers: H, body: "{}" });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, start_again: "manual" });
    const how = await Promise.race([c.exited, sleep(30000).then(() => null)]);
    assert.deepEqual(how, { code: 0, signal: null }, "left with 0: " + c.log());
    await until(() => !alive(node), 10000, "for the Node server to stop");
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
