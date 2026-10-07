"use strict";
/*
 * cores.js — a core of the server's own for playback (v0.7.7).
 *
 * On a machine with four cores or more, the last one is kept for the
 * decoder and the device sink of a sound device on the server: the server
 * process itself — and so everything it starts, which inherits its set — is
 * moved to the other cores the first time a device is opened, and the
 * playback pair is started on the reserved one (taskset, from util-linux).
 * The pair also asks for a higher priority, which is granted where the
 * server may (root, or a container run --privileged) and ignored elsewhere.
 *
 * None of this needs privileges but the priority: a process may always
 * narrow its own affinity. PLAYBACK_CORE=0 turns it off; PLAYBACK_CORE=<n>
 * picks the core.
 */
const os = require("os");
const { spawnSync } = require("child_process");

let state = null;   // { core } once decided; { core: null } when not reserved

function decide({ platform = process.platform, cpus = os.cpus().length, env = process.env, have = haveTaskset } = {}) {
  if (platform !== "linux" || env.PLAYBACK_CORE === "0") return { core: null };
  const asked = env.PLAYBACK_CORE != null && env.PLAYBACK_CORE !== "" ? Number(env.PLAYBACK_CORE) : null;
  if (asked == null && cpus < 4) return { core: null };
  if (!have()) return { core: null };
  const core = asked != null && Number.isFinite(asked) && asked >= 0 && asked < cpus ? asked : cpus - 1;
  return { core, cpus };
}

function haveTaskset() {
  try { return spawnSync("taskset", ["--version"], { stdio: "ignore" }).status === 0; } catch (e) { return false; }
}

/* The reserved core (a number), or null; decided once. */
function core(opts) {
  if (!state) state = decide(opts);
  return state.core;
}

/*
 * The server process moved off the reserved core — every thread of it, and
 * so everything started from here on — the first time it is asked.
 */
function reserve(log = () => {}, opts) {
  const c = core(opts);
  if (c == null || state.reserved) return c;
  state.reserved = true;
  const others = [];
  for (let i = 0; i < state.cpus; i++) if (i !== c) others.push(i);
  const r = spawnSync("taskset", ["-a", "-p", "-c", others.join(","), String(process.pid)], { stdio: "ignore" });
  if (r.status === 0) log(`[local] core ${c} kept for playback; the server runs on ${others.length === 1 ? "core " + others[0] : "cores " + others[0] + "–" + others[others.length - 1]}`);
  else log(`[local] couldn't keep core ${c} for playback (taskset said no); playback shares the cores`);
  return c;
}

/* A command and its arguments, started on the reserved core when there is one. */
function wrap(bin, args) {
  const c = core();
  return c == null ? [bin, args] : ["taskset", ["-c", String(c), bin].concat(args)];
}

/* A higher priority for a playback process, where allowed. */
function favour(pid) {
  try { os.setPriority(pid, -10); return true; } catch (e) { return false; }
}

function reset() { state = null; }

module.exports = { decide, core, reserve, wrap, favour, reset };
