"use strict";
/*
 * The processor shared out, playback first (v0.8.13; a core kept for a sound
 * device since v0.7.7): which cores playback keeps — one, two while DSP is in
 * use — from the machine and PLAYBACK_CORES / PLAYBACK_CORE, and each kind of
 * work started where it belongs. The C# server's rule (Cpu.cs, Cpu.Place.cs;
 * lib/cpu.js until v0.8.50), asked through `mandarin-server score`; the
 * program kept to it for real in test/cpu-alone.test.js.
 */
const test = require("node:test");
const assert = require("node:assert");
const { built } = require("./server");
const { score } = require("./score");

const skip = built();
/* The split for a machine: [split, playback, background, core]. */
const decide = (o) => score({ fn: "cpu", decides: [o] }).decides[0];
/* A command line as the server would start it: [kind] where it belongs on [cores], with [tools]. */
const wrap = (bin, args, kind, o) => score({ fn: "cpu", places: [Object.assign({ bin, args, kind }, o)] }).places[0];

test("playback's cores: the last one (two with DSP), at least two left on four or more; chosen or turned off", { skip }, () => {
  const d = (o) => { const r = decide(Object.assign({ linux: !o.notLinux, taskset: true, env: {} }, o)); return [r.split, r.playback, r.background, r.core]; };
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
  assert.deepEqual(d({ cores: n(8), notLinux: true })[0], false, "off Linux: no taskset, shared");
  assert.deepEqual(d({ cores: n(8), taskset: false })[0], false, "no taskset: shared");
  const { expands, compacts } = score({ fn: "cpu", expands: ["0-2,5"], compacts: [[5, 0, 2, 1]] });
  assert.deepEqual(expands[0], [0, 1, 2, 5]);
  assert.equal(compacts[0], "0-2,5");
});

test("each kind started where it belongs, below what it should yield to", { skip }, () => {
  // A Linux machine's plan (taskset, ionice), only decided, nothing run.
  const tools = { taskset: true, nice: true, ionice: true };
  const four = { tools, cores: [0, 1, 2, 3], env: {} };
  const w = (kind, o = four, bin = "ffmpeg", args = ["-i", "x"]) => wrap(bin, args, kind, o);
  assert.deepEqual(decide(four).playback, [3]);
  assert.deepEqual(w("realtime"), ["taskset", "-c", "3", "ffmpeg", "-i", "x"]);
  assert.deepEqual(w("playback"), ["taskset", "-c", "3", "ffmpeg", "-i", "x"]);
  assert.deepEqual(w("ahead"), ["nice", "-n", "5", "taskset", "-c", "3", "ffmpeg", "-i", "x"]);
  assert.deepEqual(w("background"), ["nice", "-n", "19", "ionice", "-c", "2", "-n", "7", "taskset", "-c", "0-2", "ffmpeg", "-i", "x"]);
  assert.equal(decide(four).core, 3);
  assert.equal(decide(four).slots, 3);
  // Allowed to raise: the engine starts higher.
  assert.deepEqual(w("realtime", Object.assign({ raise: true }, four), "e", []), ["nice", "-n", "-10", "taskset", "-c", "3", "e"]);
  // Nothing split (two cores): the priorities alone.
  const two = { tools, cores: [0, 1], env: {} };
  assert.deepEqual(w("playback", two), ["ffmpeg", "-i", "x"]);
  assert.deepEqual(w("background", two), ["nice", "-n", "19", "ionice", "-c", "2", "-n", "7", "ffmpeg", "-i", "x"]);
  assert.equal(decide(two).core, null);
  assert.equal(decide(two).slots, 2);
  // No tools at all: as it is.
  assert.deepEqual(w("background", { tools: { taskset: false, nice: false, ionice: false }, cores: [0, 1, 2, 3], env: {} }), ["ffmpeg", "-i", "x"]);
});
