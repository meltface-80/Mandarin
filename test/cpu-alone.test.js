"use strict";
/*
 * The processor shared out, playback first, by the program alone (v0.8.50,
 * stage 7 part 4; Cpu.cs): the cores playback keeps, decided from the cores
 * the program may use when it starts and PLAYBACK_CORES / PLAYBACK_CORE, as
 * lib/cpu.js decided it (its rule kept here, as test/Mandarin.Tests/CpuTests.cs held it);
 * every thread of the program moved to the rest; a DSP conversion given
 * playback's second core, held a while after it ends, then given back, the
 * threads moving each time. Run for real where Linux's taskset is, the
 * program started on as many cores as each case wants (taskset -c); where
 * it isn't, nothing is split, and a DSP conversion is still told.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { start, built, BIN } = require("./server");

const linux = process.platform === "linux";
const taskset = linux && spawnSync("taskset", ["--version"], { stdio: "ignore" }).status === 0;
const expand = (list) => String(list).split(",").flatMap(r => { const [a, b] = r.split("-").map(Number); return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i); });
const compact = (cores) => { const out = []; for (let i = 0; i < cores.length; i++) { let j = i; while (j + 1 < cores.length && cores[j + 1] === cores[j] + 1) j++; out.push(j > i ? `${cores[i]}-${cores[j]}` : String(cores[i])); i = j; } return out.join(","); };
const allowedOf = (pid) => (/Cpus_allowed_list:\s*(\S+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8")) || [])[1];
const threadsOf = (pid) => fs.readdirSync(`/proc/${pid}/task`).map(t => { try { return (/Cpus_allowed_list:\s*(\S+)/.exec(fs.readFileSync(`/proc/${pid}/task/${t}/status`, "utf8")) || [])[1]; } catch (e) { return null; } }).filter(Boolean);
const mine = linux ? expand(allowedOf(process.pid)) : [];
const skipReal = built() || (!taskset ? "no taskset here" : mine.length < 4 ? "fewer than four cores here" : false);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out: " + what);
    await sleep(100);
  }
}

/* lib/cpu.js's decide, kept: playback's cores from the cores given, the settings and whether DSP is in use. */
function decide({ cores, env = {}, dsp = false }) {
  const none = { split: false, cores: cores.slice(), playback: [], background: cores.slice(), core: null };
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

/* The program started on [cores] (taskset -c), with [env]: its plan, and its process to look at. */
async function server(t, { cores = null, env = {} } = {}) {
  const lib = makeLibrary();
  let bin = BIN;
  if (cores) {
    bin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "musicd-cpu-bin-")), "mandarin-server");
    fs.writeFileSync(bin, `#!/bin/sh\nexec taskset -c ${compact(cores)} "${BIN}" "$@"\n`, { mode: 0o755 });
  }
  const srv = await start({ port: ports.port(), musicDir: lib.music, dataDir: lib.data, bin, env: Object.assign({ PLAYBACK_CORES: "", PLAYBACK_CORE: "" }, env) });
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(srv.base) };
  const cpu = async () => { const r = await fetch(srv.base + "/api/cpu", { headers: H }); assert.equal(r.headers.get("x-mandarin-answered"), "C#"); return r.json(); };
  return { srv, H, cpu, lib, pid: srv.proc.pid };
}
const shape = (p) => ({ split: p.split, cores: p.cores, playback: p.playback, background: p.background, core: p.core });

test("playback's cores, as lib/cpu.js decided them, for the cores the program starts on and the settings", { skip: skipReal, timeout: 180000 }, async (t) => {
  const four = mine.slice(0, 4), cases = [
    ["four cores: one for playback, three for the rest", four, {}],
    ["eight or all this machine has", mine.slice(0, Math.min(8, mine.length)), {}],
    ["three cores", mine.slice(0, 3), {}],
    ["two cores: shared", mine.slice(0, 2), {}],
    ["two cores, a core asked for: even on two", mine.slice(0, 2), { PLAYBACK_CORE: String(mine[1]) }],
    ["a core chosen", four, { PLAYBACK_CORE: String(four[1]) }],
    ["a core the machine hasn't: the last", four, { PLAYBACK_CORE: "99" }],
    ["PLAYBACK_CORE=0 turns it off", four, { PLAYBACK_CORE: "0" }],
    ["PLAYBACK_CORES=0 turns it off", four, { PLAYBACK_CORES: "0" }],
    ["two always", four, { PLAYBACK_CORES: "2" }],
    ["never every core", four, { PLAYBACK_CORES: "9" }]
  ];
  for (const [what, cores, env] of cases) {
    await t.test(what, async (tt) => {
      const s = await server(tt, { cores, env });
      const want = decide({ cores, env });
      assert.deepEqual(shape(await s.cpu()), want, what);
      // Every thread of the program on the rest (none moved where nothing is split).
      const rest = compact(want.background);
      await until(async () => threadsOf(s.pid).every(x => x === rest), 15000, what + ": the program on the rest: " + threadsOf(s.pid).join(" "));
    });
  }
});

/* A zone with DSP, and a hi-res track to convert for it: a conversion with DSP asked for (`?o=`). */
async function dspConversion(s) {
  const now = Date.now();
  const db = new (require("better-sqlite3"))(path.join(s.lib.data, "musicd.db"));
  try {
    db.prepare("INSERT INTO audio_devices(id, kind, network_name, first_seen, last_seen) VALUES('UPNP_cpu-dsp', 'upnp', 'DSP', ?, ?)").run(now, now);
  } finally { db.close(); }
  const set = await fetch(s.srv.base + "/api/audio-devices/UPNP_cpu-dsp", { method: "PATCH", headers: Object.assign({ "Content-Type": "application/json" }, s.H),
    body: JSON.stringify({ dsp: { enabled: true, peq: { bands: [{ type: "peak", freq: 1000, gain: 4, q: 1.2 }] } } }) });
  assert.equal(set.status, 200, await set.text());
  const albums = (await until(async () => { const j = await (await fetch(s.srv.base + "/api/library/albums?sort=album", { headers: s.H })).json(); return j.albums && j.albums.length >= 3 && j.albums; }, 30000, "the library")).find(a => a.title === "Hi Res");
  const page = await (await fetch(s.srv.base + "/api/album?offset=" + albums.offset, { headers: s.H })).json();
  return async () => {
    const r = await fetch(`${s.srv.base}/stream/t${page.tracks[0].track_id}.48000-24.flac?o=UPNP_cpu-dsp&n=${Date.now()}`, { headers: s.H });
    assert.equal(r.status, 200);
    await r.arrayBuffer();
  };
}

test("a DSP conversion: playback's second core, held a while after it ends, then given back; the program moving each time", { skip: skipReal, timeout: 120000 }, async (t) => {
  const cores = mine.slice(0, 4);
  const s = await server(t, { cores, env: { MANDARIN_CPU_HOLD_MS: "4000" } });
  const plain = decide({ cores }), withDsp = decide({ cores, dsp: true });
  assert.deepEqual(Object.assign(shape(await s.cpu()), { dsp: (await s.cpu()).dsp }), Object.assign({}, plain, { dsp: false }));
  const convert = await dspConversion(s);
  await convert();
  // Held after it ends: the split with DSP, and the program moved off playback's two cores.
  const p = await until(async () => { const x = await s.cpu(); return x.dsp && x; }, 5000, "the split with DSP");
  assert.deepEqual(shape(p), withDsp, "with DSP: two for playback");
  await until(async () => threadsOf(s.pid).every(x => x === compact(withDsp.background)), 15000, "the program moved for DSP: " + threadsOf(s.pid).join(" "));
  // Then given back once the hold is over; the program back on the rest.
  const back = await until(async () => { const x = await s.cpu(); return !x.dsp && x; }, 15000, "the second core given back");
  assert.deepEqual(shape(back), plain);
  await until(async () => threadsOf(s.pid).every(x => x === compact(plain.background)), 15000, "the program back on the rest: " + threadsOf(s.pid).join(" "));
});

test("nothing to split: the program still says when DSP is in use", { skip: built(), timeout: 120000 }, async (t) => {
  const s = await server(t, { env: { PLAYBACK_CORES: "0", MANDARIN_CPU_HOLD_MS: "1500" } });
  const p = await s.cpu();
  assert.deepEqual([p.split, p.playback, p.dsp], [false, [], false], "nothing split, no DSP: " + JSON.stringify(p));
  const convert = await dspConversion(s);
  await convert();
  await until(async () => (await s.cpu()).dsp === true, 5000, "DSP in use");
  assert.equal((await s.cpu()).split, false, "still nothing split");
  await until(async () => (await s.cpu()).dsp === false, 10000, "and no longer, once the hold is over");
});
