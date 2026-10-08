"use strict";
/*
 * The processor shared out, playback first (lib/cpu.js, v0.8.13; a core kept
 * for a sound device since v0.7.7): which cores playback keeps — one, two
 * while DSP is in use — from the machine and PLAYBACK_CORES / PLAYBACK_CORE;
 * each kind of work started where it belongs; the server itself, and anything
 * running, moved when DSP takes or gives back its second core; and, through
 * the C# server (MANDARIN_FRONT=1), that server keeping to the same split.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const CPU = require("../lib/cpu");

const linux = process.platform === "linux";
const taskset = linux && spawnSync("taskset", ["--version"], { stdio: "ignore" }).status === 0;
const four = (() => { try { return CPU.decide({ cores: undefined, taskset: true, env: {} }).cores.length >= 4; } catch (e) { return false; } })();
const skipReal = !taskset ? "no taskset here" : !four ? "fewer than four cores here" : false;

const allowedOf = (pid) => (/Cpus_allowed_list:\s*(\S+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8")) || [])[1];
const threadsOf = (pid) => fs.readdirSync(`/proc/${pid}/task`).map(t => (/Cpus_allowed_list:\s*(\S+)/.exec(fs.readFileSync(`/proc/${pid}/task/${t}/status`, "utf8")) || [])[1]);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms, what) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out: " + what);
    await sleep(100);
  }
};

test("playback's cores: the last one (two with DSP), at least two left on four or more; chosen or turned off", () => {
  const d = (o) => { const r = CPU.decide(Object.assign({ platform: "linux", taskset: true, env: {} }, o)); return [r.split, r.playback, r.background, r.core]; };
  const n = (k) => Array.from({ length: k }, (_, i) => i);
  assert.deepEqual(d({ cores: n(4) }), [true, [3], [0, 1, 2], 3], "four cores: one for playback, three for the rest");
  assert.deepEqual(d({ cores: n(4), dsp: true }), [true, [2, 3], [0, 1], 3], "with DSP: two and two");
  assert.deepEqual(d({ cores: n(8) }), [true, [7], [0, 1, 2, 3, 4, 5, 6], 7]);
  assert.deepEqual(d({ cores: n(8), dsp: true }), [true, [6, 7], [0, 1, 2, 3, 4, 5], 7]);
  assert.deepEqual(d({ cores: n(3) }), [true, [2], [0, 1], 2]);
  assert.deepEqual(d({ cores: n(3), dsp: true }), [true, [1, 2], [0], 2]);
  assert.deepEqual(d({ cores: n(2) }), [false, [], [0, 1], null], "two cores: shared");
  assert.deepEqual(d({ cores: n(2), env: { PLAYBACK_CORE: "1" } }), [true, [1], [0], 1], "asked for: even on two");
  assert.deepEqual(d({ cores: n(8), env: { PLAYBACK_CORE: "2" } }), [true, [2], [0, 1, 3, 4, 5, 6, 7], 2], "a core chosen");
  assert.deepEqual(d({ cores: n(8), env: { PLAYBACK_CORE: "2" }, dsp: true }), [true, [2, 7], [0, 1, 3, 4, 5, 6], 2], "and DSP's second from the end");
  assert.deepEqual(d({ cores: n(8), env: { PLAYBACK_CORE: "99" } }), [true, [7], [0, 1, 2, 3, 4, 5, 6], 7], "a core the machine hasn't: the last");
  assert.deepEqual(d({ cores: n(8), env: { PLAYBACK_CORE: "0" } })[0], false, "PLAYBACK_CORE=0 turns it off (v0.7.7)");
  assert.deepEqual(d({ cores: n(8), env: { PLAYBACK_CORES: "0" } })[0], false, "PLAYBACK_CORES=0 turns it off");
  assert.deepEqual(d({ cores: n(4), env: { PLAYBACK_CORES: "2" } }), [true, [2, 3], [0, 1], 3], "two always");
  assert.deepEqual(d({ cores: n(4), env: { PLAYBACK_CORES: "1" }, dsp: true }), [true, [3], [0, 1, 2], 3], "one always, DSP or not");
  assert.deepEqual(d({ cores: n(4), env: { PLAYBACK_CORES: "9" } }), [true, [1, 2, 3], [0], 3], "never every core");
  assert.deepEqual(d({ cores: [4, 5, 6, 7] }), [true, [7], [4, 5, 6], 7], "a container's own cores");
  assert.deepEqual(d({ cores: n(8), platform: "darwin" })[0], false, "a Mac has no taskset");
  assert.deepEqual(d({ cores: n(8), taskset: false })[0], false, "no taskset: shared");
  assert.deepEqual(CPU.expand("0-2,5"), [0, 1, 2, 5]);
  assert.equal(CPU.compact([5, 0, 2, 1]), "0-2,5");
});

test("each kind started where it belongs, below what it should yield to", () => {
  CPU.reset();
  const tools = { taskset: true, nice: true, ionice: true };
  // Split, without moving this process (what would be done, only).
  CPU.init({ tools, raise: false, cores: [0, 1, 2, 3], env: {}, pin: false });
  assert.deepEqual(CPU.plan().playback, [3]);
  assert.deepEqual(CPU.wrap("ffmpeg", ["-i", "x"], "realtime"), ["taskset", ["-c", "3", "ffmpeg", "-i", "x"]]);
  assert.deepEqual(CPU.wrap("ffmpeg", ["-i", "x"], "playback"), ["taskset", ["-c", "3", "ffmpeg", "-i", "x"]]);
  assert.deepEqual(CPU.wrap("ffmpeg", ["-i", "x"], "ahead"), ["nice", ["-n", "5", "taskset", "-c", "3", "ffmpeg", "-i", "x"]]);
  assert.deepEqual(CPU.wrap("ffmpeg", ["-i", "x"], "background"), ["nice", ["-n", "19", "ionice", "-c", "2", "-n", "7", "taskset", "-c", "0-2", "ffmpeg", "-i", "x"]]);
  assert.equal(CPU.core(), 3);
  assert.equal(CPU.slots(), 3);
  CPU.reset();
  // Allowed to raise: the engine starts higher.
  CPU.init({ tools, raise: true, cores: [0, 1, 2, 3], env: {}, pin: false });
  assert.deepEqual(CPU.wrap("e", [], "realtime"), ["nice", ["-n", "-10", "taskset", "-c", "3", "e"]]);
  CPU.reset();
  // Nothing split (two cores): the priorities alone.
  CPU.init({ tools, raise: false, cores: [0, 1], env: {}, pin: false });
  assert.deepEqual(CPU.wrap("ffmpeg", ["-i", "x"], "playback"), ["ffmpeg", ["-i", "x"]]);
  assert.deepEqual(CPU.wrap("ffmpeg", ["-i", "x"], "background"), ["nice", ["-n", "19", "ionice", "-c", "2", "-n", "7", "ffmpeg", "-i", "x"]]);
  assert.equal(CPU.core(), null);
  assert.equal(CPU.slots(), 2);
  CPU.reset();
  // No tools at all (a Mac without nice): as it is.
  CPU.init({ tools: { taskset: false, nice: false, ionice: false }, raise: false, cores: [0, 1, 2, 3], env: {}, pin: false });
  assert.deepEqual(CPU.wrap("ffmpeg", ["-i", "x"], "background"), ["ffmpeg", ["-i", "x"]]);
  CPU.reset();
});

test("for real: this process off playback's core, children where they belong, moved when DSP takes a second core", { skip: skipReal, timeout: 30000 }, async () => {
  CPU.reset();
  const lines = [];
  const all = CPU.decide({ taskset: true, env: {} }).cores;
  const before = allowedOf(process.pid);
  const p = CPU.init({ log: (l) => lines.push(l), env: {}, hold: 300 });
  const last = all[all.length - 1];
  try {
    assert.equal(p.split, true);
    assert.deepEqual(p.playback, [last]);
    assert.ok(lines.some(l => /kept for playback/.test(l)), lines.join("\n"));
    for (const t of threadsOf(process.pid)) assert.equal(t, CPU.compact(p.background), "every thread of this process on the rest");
    // A background child: the rest of the cores, the lowest priority, its reads last.
    const [bb, ba] = CPU.wrap("sleep", ["20"], "background");
    const bg = CPU.adopt(spawn(bb, ba, { stdio: "ignore" }), "background");
    // A playback child: playback's core.
    const [pb, pa] = CPU.wrap("sleep", ["20"], "playback");
    const pl = CPU.adopt(spawn(pb, pa, { stdio: "ignore" }), "playback");
    await until(() => { try { return allowedOf(bg.pid) === CPU.compact(p.background) && allowedOf(pl.pid) === String(last); } catch (e) { return false; } }, 5000, "the children placed");
    const nice = Number(fs.readFileSync(`/proc/${bg.pid}/stat`, "utf8").split(") ")[1].split(" ")[16]);
    assert.equal(nice, 19);
    // DSP: playback has a second core; this process and the background child move off it, the playback child stays.
    CPU.dsp(true);
    const d = CPU.plan();
    assert.deepEqual(d.playback, all.slice(-2));
    assert.equal(d.dsp, true);
    assert.equal(allowedOf(process.pid), CPU.compact(d.background));
    assert.equal(allowedOf(bg.pid), CPU.compact(d.background));
    assert.equal(allowedOf(pl.pid), String(last), "within playback's cores already: left where it is");
    assert.equal(CPU.slots(), d.background.length);
    // The engine started meanwhile, on both, its decoder with it.
    const [eb, ea] = CPU.wrap("sh", ["-c", "sleep 20 & wait"], "realtime");
    const eng = CPU.adopt(spawn(eb, ea, { stdio: "ignore" }), "realtime");
    const kidOf = (pid) => fs.readdirSync("/proc").filter(x => /^\d+$/.test(x)).find(x => {
      try { const st = fs.readFileSync(`/proc/${x}/stat`, "utf8"); return Number(st.slice(st.lastIndexOf(")") + 2).split(" ")[1]) === pid; } catch (e) { return false; }
    });
    const dec = await until(() => kidOf(eng.pid), 5000, "the engine's decoder");
    assert.equal(allowedOf(dec), CPU.compact(d.playback));
    // Ended: held a while, then given back; the engine and its decoder back to the one core.
    CPU.dsp(false);
    assert.deepEqual(CPU.plan().playback, all.slice(-2), "held after the last DSP conversion");
    await until(() => CPU.plan().playback.length === 1, 3000, "the second core given back");
    assert.equal(CPU.plan().dsp, false);
    assert.equal(allowedOf(process.pid), CPU.compact(p.background));
    assert.equal(allowedOf(eng.pid), String(last));
    assert.equal(allowedOf(dec), String(last), "the decoder moved with the engine");
    bg.kill(); pl.kill(); eng.kill(); try { process.kill(Number(dec)); } catch (e) { /* gone */ }
  } finally {
    spawnSync("taskset", ["-a", "-p", "-c", before, String(process.pid)], { stdio: "ignore" });
    CPU.reset();
  }
});

const skipFront = process.env.MANDARIN_FRONT !== "1" ? "the suite isn't going through the C# server (MANDARIN_FRONT=1)" : skipReal;

test("the C# server keeps to the split, and moves with it", { skip: skipFront, timeout: 60000 }, async () => {
  CPU.reset();
  const { signIn } = require("./auth-helper");
  const os = require("os");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-cpu-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  fs.mkdirSync(music);
  const PORT = 3698, B = "http://127.0.0.1:" + PORT;
  const before = allowedOf(process.pid);
  const srv = require("../index.js").createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  try {
    await srv.start();
    const H = { Authorization: "Bearer " + await signIn(B) };
    const p = await (await fetch(B + "/api/cpu", { headers: H })).json();
    assert.equal(p.split, true);
    // The C# server: this process's child of that name.
    const cs = fs.readdirSync("/proc").filter(d => /^\d+$/.test(d)).find(d => {
      try {
        const st = fs.readFileSync(`/proc/${d}/stat`, "utf8");
        return st.includes("(mandarin-server)") && Number(st.split(") ")[1].split(" ")[1]) === process.pid;
      } catch (e) { return false; }
    });
    assert.ok(cs, "the C# server found");
    // Within the five seconds it asks the library's state in: every thread of it on the rest.
    await until(() => threadsOf(cs).every(t => t === CPU.compact(p.background)), 15000, "the C# server on the rest: " + threadsOf(cs).join(" "));
    CPU.dsp(true);
    const d = CPU.plan();
    await until(() => threadsOf(cs).every(t => t === CPU.compact(d.background)), 15000, "the C# server moved for DSP: " + threadsOf(cs).join(" "));
    assert.deepEqual((await (await fetch(B + "/api/cpu", { headers: H })).json()).playback, d.playback);
  } finally {
    await srv.stop().catch(() => {});
    spawnSync("taskset", ["-a", "-p", "-c", before, String(process.pid)], { stdio: "ignore" });
    CPU.reset();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
