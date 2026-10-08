"use strict";
/*
 * scan-worker.js — a library scan on a thread of its own (v0.7.7).
 *
 * The scanner used to run on the server's one JavaScript thread, beside the
 * pump that feeds a sound device on the server. Its synchronous reads — a
 * stat per file, a readdir per folder, the database transactions — are
 * fast on a local disk and anything but on a network share, and while one
 * of them waited, so did the pump. A scheduled scan during playback was
 * found, by a bit-for-bit capture, to run the device dry.
 *
 * So the scan runs here: its own thread, its own database connection (WAL
 * mode: the server reads and writes alongside), at a lower priority. The
 * main thread's Scanner (scanner.js) starts it, mirrors its progress for the
 * page, reloads the library as albums land, and takes the result.
 */
const { parentPort, workerData } = require("worker_threads");

// On Linux a priority set on "this process" from a thread applies to the
// thread: the scan at the lowest, its reads last (v0.8.13), on the cores
// playback doesn't keep (the server's own, lib/cpu.js) — it yields to
// playback, the page and everything else.
require("../cpu").lowerThisThread();

const post = (m) => { try { parentPort.postMessage(m); } catch (e) { /* the server is leaving */ } };
const log = (...a) => post({ type: "log", line: a.join(" ") });

(async () => {
  const DB = require("./db");
  const { Scanner } = require("./scanner");
  const { dataDir, root, roots, massRemoval, force, reader } = workerData;
  // The database was opened (and migrated) by the server already: a quiet open.
  const db = DB.open(dataDir, { log: () => {} });
  try {
    const scanner = new Scanner({ db, root, roots: () => roots, log, massRemoval, worker: false, reader });
    scanner.onProgress = () => post({ type: "progress", state: scanner.state });
    const tick = setInterval(() => post({ type: "state", state: scanner.state }), 500);
    let result;
    try { result = await scanner.scan({ force }); } finally { clearInterval(tick); }
    post({ type: "result", result, state: scanner.state });
  } catch (e) {
    post({ type: "error", message: e && e.message ? e.message : String(e) });
  } finally {
    try { db.close(); } catch (e) { /* already closed */ }
  }
})();
