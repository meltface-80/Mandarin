"use strict";
/*
 * ports.js — ports and loopback addresses that are this test file's alone,
 * so the suite can run several files side by side (package.json's
 * --test-concurrency) without two of them reaching for the same one.
 *
 *   const ports = require("./ports");
 *   const PORT = ports.port();       // a port no other test file is given
 *   const PORT2 = ports.port();      // another: each call hands out the next
 *   ports.host(0), ports.host(1)     // loopback addresses no other file is given
 *
 * Never write a port number or a 127.0.0.x address (other than 127.0.0.1)
 * into a test: take one from here. A server that can take port 0 (a fake
 * that tells you its port once listening) needs nothing from here at all.
 *
 * How: each test process (node --test runs a file per process) claims a
 * slot, 0 to SLOTS - 1, in a little registry in the system's temp directory
 * (a file per slot naming the process that holds it, reclaimed when that
 * process is gone), under a lock so two processes never take the same one.
 * Slot k owns the ports BASE + k * PER_SLOT … + PER_SLOT - 1 (well below the
 * ephemeral ports Linux and macOS hand out for port 0, so they never clash
 * with those either), and the addresses 127.0.0.(FIRST_HOST + k * HOSTS) …
 * + HOSTS - 1. Two `npm test` runs at once on one machine share the registry,
 * so they keep apart too.
 *
 * Sonos speakers answer on port 1400 and nowhere else, so the stand-in
 * household (fake-sonos.js) puts its rooms on host(0), host(1)…: an address
 * apiece instead of a port. Linux answers on all of 127/8; a Mac on 127.0.0.1
 * alone until an address is added to lo0, which CI's Mac job does for every
 * address here: `node test/ports.js --addresses` lists them.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const SLOTS = 16;
const BASE = Number(process.env.MANDARIN_TEST_PORT_BASE) || 20000;
const PER_SLOT = 100;
const FIRST_HOST = 16;
const HOSTS = 8;

const all = () => {
  const out = [];
  for (let i = FIRST_HOST; i < FIRST_HOST + SLOTS * HOSTS; i++) out.push("127.0.0." + i);
  return out;
};

if (require.main === module) {
  if (process.argv.includes("--addresses")) { console.log(all().join(" ")); process.exit(0); }
  console.error("usage: node test/ports.js --addresses");
  process.exit(2);
}

const DIR = path.join(os.tmpdir(), "mandarin-test-slots");
const LOCK = path.join(DIR, "lock");
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function alive(pid) {
  if (!(pid > 0)) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

function locked(fn) {
  fs.mkdirSync(DIR, { recursive: true });
  for (let tries = 0; ; tries++) {
    try { fs.mkdirSync(LOCK); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // Held for a moment only: one left behind by a process that died holding it is broken.
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 10000) fs.rmdirSync(LOCK); } catch (e2) { /* gone meanwhile */ }
      if (tries > 3000) throw new Error("test/ports.js: couldn't take the slot lock " + LOCK);
      pause(5);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(LOCK); } catch (e) { /* already gone */ } }
}

let slot = null;
function claim() {
  if (slot != null) return slot;
  slot = locked(() => {
    for (let k = 0; k < SLOTS; k++) {
      const file = path.join(DIR, "slot-" + k);
      let holder = 0;
      try { holder = Number(fs.readFileSync(file, "utf8")); } catch (e) { /* free */ }
      if (holder === process.pid || !alive(holder)) { fs.writeFileSync(file, String(process.pid)); return k; }
    }
    throw new Error(`test/ports.js: all ${SLOTS} slots are taken (${DIR}); run fewer test files at once`);
  });
  const file = path.join(DIR, "slot-" + slot);
  process.on("exit", () => {
    try { if (Number(fs.readFileSync(file, "utf8")) === process.pid) fs.unlinkSync(file); } catch (e) { /* gone */ }
  });
  return slot;
}

let next = 0;
/** The next port of this file's own: a different one each call. */
function port() {
  if (next >= PER_SLOT) throw new Error(`test/ports.js: a test file has ${PER_SLOT} ports; this one asked for more`);
  return BASE + claim() * PER_SLOT + next++;
}

/** This file's i-th loopback address (0 ≤ i < HOSTS): the same one each call. */
function host(i = 0) {
  if (!(i >= 0 && i < HOSTS)) throw new Error(`test/ports.js: host(${i}): a test file has ${HOSTS} addresses, 0 to ${HOSTS - 1}`);
  return "127.0.0." + (FIRST_HOST + claim() * HOSTS + i);
}

module.exports = { port, host, addresses: all, SLOTS, HOSTS };
