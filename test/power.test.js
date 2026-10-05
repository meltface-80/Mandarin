"use strict";
/*
 * Settings → Restart & shut down (v0.6.12):
 *   - Restart stops the server cleanly and leaves with 75, for launcher.js to
 *     start it again;
 *   - Shut down leaves with 0, or, on a Mac run by the installer's login item,
 *     unloads that item (launchctl bootout) so launchd doesn't start it again;
 *   - neither in Docker's case for Shut down, nor from away for either.
 */
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const power = require("../lib/server/api-power");

const sleep = ms => new Promise(r => setTimeout(r, ms));

// A stand-in for express: the routes, called directly.
function routes(opts, isAway = false) {
  const h = {};
  const app = { get: (p, f) => { h["GET " + p] = f; }, post: (p, f) => { h["POST " + p] = f; } };
  const ctx = { log: () => {}, auth: { isAway: () => isAway } };
  power(app, ctx, opts);
  const call = (key) => new Promise(resolve => {
    const res = { code: 200, status(c) { this.code = c; return this; }, json(j) { resolve({ status: this.code, body: j }); } };
    h[key]({ body: {} }, res);
  });
  return call;
}

test("what each install can do, and how it starts again", () => {
  assert.deepEqual(power.powerInfo({ DOCKER: "1" }, "linux"),
    { restart: true, shutdown: false, docker: true, start_again: "docker" });
  assert.deepEqual(power.powerInfo({ MANDARIN_LAUNCHD: "app.mandarin.server" }, "darwin"),
    { restart: true, shutdown: true, docker: false, start_again: "icon" });
  // An install from before v0.6.12: launchd's own variable names the job.
  assert.equal(power.powerInfo({ XPC_SERVICE_NAME: "app.mandarin.server" }, "darwin").start_again, "icon");
  // Terminal's XPC_SERVICE_NAME is "0": not a login item.
  assert.equal(power.powerInfo({ XPC_SERVICE_NAME: "0" }, "darwin").start_again, "manual");
  assert.equal(power.powerInfo({}, "linux").start_again, "manual");
});

test("Restart: a clean stop, then 75 for the launcher", async () => {
  const seen = [];
  const call = routes({ stop: async () => { seen.push("stop"); }, exit: c => seen.push("exit " + c), env: {}, platform: "linux" });
  const r = await call("POST /api/system/restart");
  assert.equal(r.status, 200);
  assert.equal(r.body.restarting, true);
  await sleep(500);
  assert.deepEqual(seen, ["stop", "exit 75"]);
});

test("Shut down: 0 where nothing would start it again", async () => {
  const seen = [];
  const call = routes({ stop: async () => { seen.push("stop"); }, exit: c => seen.push("exit " + c), env: {}, platform: "linux" });
  const r = await call("POST /api/system/shutdown");
  assert.equal(r.status, 200);
  assert.equal(r.body.start_again, "manual");
  await sleep(500);
  assert.deepEqual(seen, ["stop", "exit 0"]);
});

test("Shut down on a Mac: the login item is unloaded, not merely exited", async () => {
  const seen = [];
  const { EventEmitter } = require("events");
  const spawn = (cmd, args) => {
    seen.push([cmd].concat(args).join(" "));
    const child = new EventEmitter();
    child.unref = () => {};
    setTimeout(() => child.emit("exit", 0), 10);
    return child;
  };
  const call = routes({ stop: async () => seen.push("stop"), exit: c => seen.push("exit " + c), spawn,
    env: { MANDARIN_LAUNCHD: "app.mandarin.server" }, platform: "darwin" });
  const r = await call("POST /api/system/shutdown");
  assert.equal(r.body.start_again, "icon");
  await sleep(500);
  assert.equal(seen.length, 1, "launchd stops it: no exit of its own");
  assert.match(seen[0], /^launchctl bootout gui\/\d+\/app\.mandarin\.server$/);
});

test("…and if bootout fails, the older unload, then a plain stop", async () => {
  const seen = [];
  const { EventEmitter } = require("events");
  const spawn = (cmd, args) => {
    seen.push(args[0]);
    const child = new EventEmitter();
    child.unref = () => {};
    setTimeout(() => child.emit("exit", 1), 10);
    return child;
  };
  const call = routes({ stop: async () => seen.push("stop"), exit: c => seen.push("exit " + c), spawn,
    env: { MANDARIN_LAUNCHD: "app.mandarin.server" }, platform: "darwin" });
  await call("POST /api/system/shutdown");
  await sleep(600);
  assert.deepEqual(seen, ["bootout", "unload", "stop", "exit 0"]);
});

test("not in Docker, and neither from away", async () => {
  const seen = [];
  const docker = routes({ stop: async () => seen.push("stop"), exit: c => seen.push("exit " + c), env: { DOCKER: "1" }, platform: "linux" });
  const r = await docker("POST /api/system/shutdown");
  assert.equal(r.status, 409);
  assert.match(r.body.error, /docker stop musicd-server/);
  const awayCall = routes({ stop: async () => seen.push("stop"), exit: c => seen.push("exit " + c), env: {}, platform: "linux" }, true);
  assert.equal((await awayCall("POST /api/system/restart")).status, 403);
  assert.equal((await awayCall("POST /api/system/shutdown")).status, 403);
  await sleep(500);
  assert.deepEqual(seen, [], "nothing stopped");
});

test("through the real server: signed in, the routes answer and Restart stops it cleanly", { timeout: 30000 }, async () => {
  const lib = makeLibrary();
  const exits = [];
  const { createServer } = require("../index.js");
  const PORT = 3624, B = "http://127.0.0.1:" + PORT;
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpMulticast: false, identify: false, exitProcess: c => exits.push(c), powerEnv: {}, powerPlatform: "linux" });
  await srv.start();
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  assert.equal((await fetch(B + "/api/system/power")).status, 401, "signed in only");
  const info = await (await fetch(B + "/api/system/power", { headers: H })).json();
  assert.deepEqual(info, { restart: true, shutdown: true, docker: false, start_again: "manual" });
  const r = await fetch(B + "/api/system/restart", { method: "POST", headers: H, body: "{}" });
  assert.equal(r.status, 200);
  for (let i = 0; i < 50 && !exits.length; i++) await sleep(100);
  assert.deepEqual(exits, [75]);
  // stop() ran: the port is closed.
  await assert.rejects(fetch(B + "/api/health"));
});
