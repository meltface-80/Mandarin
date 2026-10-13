// @ts-check
"use strict";
/*
 * listen.js — the server's port taken, with a few tries (v0.8.49).
 *
 * A server that starts in the place of one just stopped (the in-app update's
 * restart, a backup put back, the tests' servers on one port) can find the
 * port still held for a moment: the connections of the one before are being
 * let go, and the kernel keeps the port with them. Here the bind is tried
 * again every fifth of a second for a few seconds before it is given up on,
 * so a restart never fails on the moment it happened to pick.
 */
const http = require("http");

/**
 * An HTTP server for [handler], listening on [port] at [host]; EADDRINUSE
 * tried again for up to [patienceMs], anything else thrown as it came.
 * @param {import("http").RequestListener} handler
 * @param {number} port
 * @param {string} host
 * @param {{ log?: (line: string) => void, patienceMs?: number }} [opts]
 * @returns {Promise<import("http").Server>}
 */
async function listen(handler, port, host, { log = () => {}, patienceMs = 5000 } = {}) {
  const t0 = Date.now();
  for (let tries = 0; ; tries++) {
    const srv = http.createServer(handler);
    try {
      await new Promise((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(port, host, () => { srv.removeListener("error", reject); resolve(undefined); });
      });
      return srv;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== "EADDRINUSE" || Date.now() - t0 > patienceMs) throw e;
      if (tries === 0) log(`[musicd] port ${port} is still held (the server before letting go): trying again for a few seconds`);
      await new Promise(r => setTimeout(r, 200));
    }
  }
}

module.exports = { listen };
