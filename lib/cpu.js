"use strict";
/*
 * cpu.js — the processor shared out, playback first (v0.8.13; a core kept
 * for a sound device on the server since v0.7.7).
 *
 * Playback keeps cores of its own: one, or two while DSP is in use (its
 * conversions upsample and filter in double precision), the machine's last
 * ones. Everything else runs on the others: the two servers at the usual
 * priority, and the background work (the scan, the tag check, measuring
 * loudness, the phone's downloads) at the lowest, its disk reads last too.
 * On four cores: playback on core 3 (2 and 3 with DSP), the rest on 0–2
 * (0–1), scanning or not.
 *
 * Playback is Mandarin's audio engine and its decoder (a sound device on the
 * server), and every conversion a device is waiting for or will want next,
 * this server's and the C# server's: that one is told the split with the
 * library's state (/internal/library) and keeps to it too (Cpu.cs).
 *
 * Linux, with util-linux's taskset (in the image); elsewhere, or on two cores
 * or fewer, nothing is split and the priorities alone apply. Narrowing a
 * process's cores and lowering a priority need no privileges; raising the
 * audio engine's needs root or the container run with --cap-add SYS_NICE
 * (--privileged has it), and is left out where not allowed.
 *
 *   PLAYBACK_CORES=0    no split (priorities only)
 *   PLAYBACK_CORES=1|2  that many for playback, DSP or not
 *   PLAYBACK_CORE=<n>   (v0.7.7) playback's core; 0 also turns the split off
 */
const fs = require("fs");
const os = require("os");
const { spawnSync } = require("child_process");

// DSP's second core is kept this long after its last conversion: through a
// listening session, without the split moving at every track.
const DSP_HOLD_MS = 10 * 60 * 1000;

/* "0-2,5" → [0, 1, 2, 5] */
function expand(list) {
  const out = [];
  for (const part of String(list || "").split(",")) {
    const m = /^\s*(\d+)(?:-(\d+))?\s*$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] != null ? Number(m[2]) : a;
    for (let i = a; i <= b && i - a < 4096; i++) out.push(i);
  }
  return out;
}

/* [0, 1, 2, 5] → "0-2,5" */
function compact(cores) {
  const s = [...new Set(cores)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    out.push(j > i ? `${s[i]}-${s[j]}` : String(s[i]));
    i = j;
  }
  return out.join(",");
}

/*
 * The cores this server may use (a container can be given fewer than the
 * machine has): as the C# server found them when it started (it starts this
 * one), else this process's own — read once, before this process narrows it.
 */
function allowed(env = process.env) {
  const given = expand(env.MANDARIN_CPUS);
  if (given.length) return given;
  try {
    const m = /Cpus_allowed_list:\s*(\S+)/.exec(fs.readFileSync("/proc/self/status", "utf8"));
    const c = m && expand(m[1]);
    if (c && c.length) return c;
  } catch (e) { /* not Linux */ }
  const n = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return Array.from({ length: Math.max(1, n) }, (_, i) => i);
}

function have(bin, args = ["--version"]) {
  try { return spawnSync(bin, args, { stdio: "ignore", timeout: 5000 }).status === 0; } catch (e) { return false; }
}

/* Whether a process may be started at a higher priority here (nice says so, and runs it anyway, when not). */
function mayRaise() {
  try {
    const r = spawnSync("nice", ["-n", "-10", "true"], { encoding: "utf8", timeout: 5000 });
    return r.status === 0 && !String(r.stderr || "").trim();
  } catch (e) { return false; }
}

/*
 * The split, from the machine and the settings: { split, cores, playback,
 * background, core }. Playback takes one core, or two with DSP, leaving the
 * rest at least two where the machine has four or more; `core` is the one
 * it always has (the engine's playback thread is kept to it).
 */
function decide({ platform = process.platform, cores = allowed(), env = process.env, taskset = true, dsp = false } = {}) {
  const none = { split: false, cores: cores.slice(), playback: [], background: cores.slice(), core: null };
  if (platform !== "linux" || !taskset) return none;
  if (env.PLAYBACK_CORES === "0" || env.PLAYBACK_CORE === "0") return none;
  const n = cores.length;
  const fixed = env.PLAYBACK_CORES != null && env.PLAYBACK_CORES !== "" ? Math.floor(Number(env.PLAYBACK_CORES)) : null;
  const asked = env.PLAYBACK_CORE != null && env.PLAYBACK_CORE !== "" ? Number(env.PLAYBACK_CORE) : null;
  const chosen = (fixed != null && Number.isFinite(fixed)) || (asked != null && Number.isFinite(asked));
  if (n < 2 || (n < 3 && !chosen)) return none;
  let want = fixed != null && Number.isFinite(fixed) && fixed > 0 ? fixed : dsp ? 2 : 1;
  want = Math.max(1, Math.min(want, chosen || n < 4 ? n - 1 : n - 2));
  const playback = [];
  if (asked != null && Number.isFinite(asked)) playback.push(cores.includes(asked) ? asked : cores[n - 1]);
  for (let i = n - 1; i >= 0 && playback.length < want; i--) if (!playback.includes(cores[i])) playback.push(cores[i]);
  const core = playback[0];
  playback.sort((a, b) => a - b);
  return { split: true, cores: cores.slice(), playback, background: cores.filter(c => !playback.includes(c)), core };
}

// ------------------------------------------------------------------ the state

const state = {
  ready: false,
  log: () => {},
  env: process.env,
  tools: { taskset: false, nice: false, ionice: false },
  raise: false,            // whether playback may be started at a higher priority
  cores: [],               // every core this server may use, as it started
  hold: DSP_HOLD_MS,
  pin: true,               // false in the tests that only ask what would be done
  plan: decide({ taskset: false }),
  dsp: 0,                  // DSP conversions under way
  dspUntil: 0,             // and the second core kept until then
  timer: null,
  children: new Set(),     // { proc, kind, cores } running, moved when the split changes
  listeners: []
};

/* Decided once, when the server starts: this process moved to the other cores. */
function init({ log, env, tools, raise, cores, hold, pin } = {}) {
  if (state.ready) return plan();
  state.ready = true;
  if (log) state.log = log;
  if (env) state.env = env;
  if (hold != null) state.hold = hold;
  if (pin === false) state.pin = false;
  const linux = process.platform === "linux";
  state.tools = tools || (linux ? { taskset: have("taskset"), nice: have("nice"), ionice: have("ionice") }
    : { taskset: false, nice: process.platform !== "win32" && have("nice", ["-n", "0", "true"]), ionice: false });
  state.raise = raise != null ? !!raise : state.tools.nice && mayRaise();
  state.cores = cores ? cores.slice() : allowed(state.env);
  state.plan = decide({ env: state.env, cores: state.cores, taskset: state.tools.taskset, dsp: false });
  apply(true);
  return plan();
}

/* The split as it stands, for the page and the C# server. */
function plan() {
  const p = state.plan;
  return { split: p.split, cores: p.cores.slice(), playback: p.playback.slice(), background: p.background.slice(),
    core: p.core, dsp: dspActive(), raised: state.raise, tools: Object.assign({}, state.tools) };
}

/* Playback's own core, the one it always has; null when nothing is split. */
function core() { return state.plan.split ? state.plan.core : null; }

function dspActive() { return state.dsp > 0 || Date.now() < state.dspUntil; }

/* A process's children, and theirs (the audio engine's decoder). */
function descendants(pid) {
  const parent = new Map();
  try {
    for (const d of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(d)) continue;
      try { const st = fs.readFileSync(`/proc/${d}/stat`, "utf8"); parent.set(Number(d), Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1])); } catch (e) { /* gone */ }
    }
  } catch (e) { return []; }
  const out = [];
  const walk = (p) => { for (const [c, pp] of parent) if (pp === p && !out.includes(c)) { out.push(c); walk(c); } };
  walk(pid);
  return out;
}

function setAffinity(pid, cores) {
  if (!state.tools.taskset || !cores.length) return false;
  if (!state.pin) return true;
  try {
    return spawnSync("taskset", ["-a", "-p", "-c", compact(cores), String(pid)], { stdio: "ignore", timeout: 5000 }).status === 0;
  } catch (e) { return false; }
}

function coresFor(kind) {
  return kind === "background" ? state.plan.background : state.plan.playback;
}

const span = (c) => c.length === 1 ? "core " + c[0] : "cores " + compact(c).replace(/-/g, "–");

/* The split applied: this process (and so whatever it starts) on the other cores, children where they belong. */
function apply(first) {
  const p = state.plan;
  if (p.split) {
    const ok = setAffinity(process.pid, p.background);
    if (ok) state.log(`[cpu] ${p.cores.length} cores: ${span(p.playback)} kept for playback${dspActive() ? " (DSP in use)" : ""}, ${span(p.background)} for everything else`);
    else if (first) state.log("[cpu] couldn't keep a core for playback (taskset said no); playback comes first by priority alone");
  } else if (first) {
    state.log(`[cpu] ${p.cores.length} core${p.cores.length === 1 ? "" : "s"}, shared; playback comes first by priority`);
  }
  if (first && p.split && !state.raise) state.log("[cpu] playback runs at the usual priority on its own cores (--cap-add SYS_NICE would let it run higher)");
  // A child already within its cores stays (the engine's playback thread keeps its own core); one outside them is moved.
  for (const c of state.children) {
    const want = p.split ? coresFor(c.kind) : p.cores;
    if (c.cores.length && c.cores.every(x => want.includes(x))) continue;
    if (setAffinity(c.proc.pid, want)) {
      c.cores = want.slice();
      if (state.pin) for (const d of descendants(c.proc.pid)) setAffinity(d, want);
    }
  }
  for (const fn of state.listeners) { try { fn(plan()); } catch (e) { /* a listener's own trouble */ } }
}

function recompute() {
  const next = decide({ env: state.env, cores: state.cores, taskset: state.tools.taskset, dsp: dspActive() });
  const same = next.split === state.plan.split && compact(next.playback) === compact(state.plan.playback);
  state.plan = next;
  if (!same) apply(false);
}

/*
 * A DSP conversion started (true) or ended (false): while any runs, and for
 * a while after, playback has its second core.
 */
function dsp(on) {
  if (on) state.dsp++;
  else {
    state.dsp = Math.max(0, state.dsp - 1);
    if (!state.dsp) {
      state.dspUntil = Date.now() + state.hold;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => { state.timer = null; recompute(); }, state.hold + 50);
      if (state.timer.unref) state.timer.unref();
    }
  }
  if (state.ready) recompute();
}

/*
 * A command started where its kind belongs:
 *   "realtime"   the audio engine and its decoder: playback's cores, raised where allowed
 *   "playback"   a conversion a device is waiting for: playback's cores
 *   "ahead"      one made ahead of play: playback's cores, a little lower
 *   "background" everything else: the other cores, the lowest priority, its reads last
 * Returns [bin, args].
 */
function wrap(bin, args, kind = "playback") {
  const t = state.tools, p = state.plan;
  const chain = [];
  if (kind === "background") {
    if (t.nice) chain.push("nice", "-n", "19");
    if (t.ionice) chain.push("ionice", "-c", "2", "-n", "7");
  } else if (kind === "ahead") {
    if (t.nice) chain.push("nice", "-n", "5");
  } else if (kind === "realtime" && state.raise) chain.push("nice", "-n", "-10");
  if (p.split && t.taskset) chain.push("taskset", "-c", compact(coresFor(kind)));
  if (!chain.length) return [bin, args];
  return [chain[0], chain.slice(1).concat([bin], args)];
}

/* A child started through wrap(), followed so it moves when the split does. */
function adopt(proc, kind = "playback") {
  if (!proc || !proc.pid || typeof proc.once !== "function") return proc;
  // Where nice isn't there to start it lower (Windows): lowered now, its first thread at least.
  if (!state.tools.nice && (kind === "background" || kind === "ahead")) {
    try { os.setPriority(proc.pid, kind === "background" ? 19 : 5); } catch (e) { /* not allowed here */ }
  }
  const c = { proc, kind, cores: state.plan.split ? coresFor(kind).slice() : [] };
  state.children.add(c);
  proc.once("exit", () => state.children.delete(c));
  proc.once("error", () => state.children.delete(c));
  return proc;
}

/* fork() options for a Node child of the background kind (the tag check). */
function forkOptions(opts = {}) {
  const [bin, args] = wrap(process.execPath, [], "background");
  if (bin === process.execPath) return opts;
  return Object.assign({}, opts, { execPath: bin, execArgv: args.concat(opts.execArgv || process.execArgv) });
}

/* In a worker thread or child of the background kind: this thread at the lowest priority, its reads last. */
function lowerThisThread() {
  try { os.setPriority(0, 19); } catch (e) { /* not allowed here */ }
  if (process.platform !== "linux") return;
  try {
    const tid = Number(fs.readlinkSync("/proc/thread-self").split("/").pop());
    if (tid) spawnSync("ionice", ["-c", "2", "-n", "7", "-p", String(tid)], { stdio: "ignore", timeout: 5000 });
  } catch (e) { /* no ionice, or not Linux */ }
}

/* How many background jobs at once: one per core of the rest (at least one). */
function slots() { return Math.max(1, state.plan.background.length); }

function onChange(fn) { state.listeners.push(fn); }

/* For the tests. */
function reset() {
  if (state.timer) clearTimeout(state.timer);
  Object.assign(state, { ready: false, log: () => {}, env: process.env, tools: { taskset: false, nice: false, ionice: false },
    raise: false, cores: [], hold: DSP_HOLD_MS, pin: true, plan: decide({ taskset: false }), dsp: 0, dspUntil: 0, timer: null, children: new Set(), listeners: [] });
}

module.exports = { decide, expand, compact, init, plan, core, dsp, wrap, adopt, forkOptions, lowerThisThread, slots, onChange, reset, DSP_HOLD_MS };
