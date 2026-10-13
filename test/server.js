"use strict";
/*
 * server.js — the C# server alone, as the image will run it (v0.8.50, stage 7
 * of docs/specs/csharp-migration.md): started on a port of this file's own
 * (test/ports.js) with a test's environment, waited for, stopped. No Node
 * server anywhere: MANDARIN_NODE=0. The environment the suite gives every
 * server (test/setup.js: nothing off this machine, no identification scan, no
 * sound devices, no update checks) is given here too; a test adds its own
 * (the fakes' addresses, MANDARIN_CONFIG).
 *
 *   const { start } = require("./server");
 *   const srv = await start({ port, musicDir, dataDir, env: { QOBUZ_URL: fake.base } });
 *   … fetch(srv.base + "/api/…") …
 *   await srv.stop();
 */
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BIN = process.env.MANDARIN_SERVER_BIN || path.join(ROOT, "server", "bin", "mandarin-server");

/** Whether the program is built: a test skips with this reason when it isn't. */
const built = () => fs.existsSync(BIN) ? false : "the C# server isn't built (server/build.sh): " + BIN;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * The server started and answering on [port]; [env] over the suite's.
 * @returns {Promise<{ base: string, key: string, proc: import("child_process").ChildProcess, stop: () => Promise<void> }>}
 */
async function start({ port, musicDir, dataDir, env = {}, timeoutMs = 60000 }) {
  const key = crypto.randomBytes(24).toString("hex");
  const e = Object.assign({}, process.env, {
    PORT: String(port), MUSIC_DIR: musicDir, DATA_DIR: dataDir, SERVER_IP: "127.0.0.1", MANDARIN_NODE: "0", MANDARIN_APP_DIR: ROOT,
    MANDARIN_FRONT_KEY: key, IDENTIFY: "0", LOCAL_AUDIO: "0", UPDATE_CHECK: "false", UPNP_DISCOVERY: "0", ITUNES_URL: "http://127.0.0.1:9"
  }, process.env.ALLOW_NETWORK ? {} : { MANDARIN_LOOPBACK_ONLY: "1" }, env);
  for (const k of ["MANDARIN_UPSTREAM", "MANDARIN_FRONT_RUNS", "INTERNAL_PORT"]) delete e[k];
  fs.mkdirSync(dataDir, { recursive: true });
  const proc = spawn(BIN, [], { env: e, stdio: ["ignore", "inherit", "inherit"] });
  let exited = null;
  proc.on("exit", (code, signal) => { exited = { code, signal }; });
  const base = "http://127.0.0.1:" + port;
  const t0 = Date.now();
  for (;;) {
    if (exited) throw new Error(`the C# server exited before it listened (code ${exited.code}, signal ${exited.signal})`);
    try {
      const r = await fetch(base + "/server-info", { signal: AbortSignal.timeout(2000) });
      if (r.status === 200 && (await r.json()).server === "C#") break;
    } catch (err) { /* not yet */ }
    if (Date.now() - t0 > timeoutMs) { proc.kill("SIGKILL"); throw new Error("the C# server didn't answer on " + port + " within " + timeoutMs + " ms"); }
    await sleep(100);
  }
  const stop = async () => {
    if (exited) return;
    const gone = new Promise(r => proc.once("exit", r));
    proc.kill("SIGTERM");
    await Promise.race([gone, sleep(8000)]);
    if (!exited) { proc.kill("SIGKILL"); await gone; }
  };
  return { base, key, proc, stop };
}

module.exports = { start, built, BIN };
