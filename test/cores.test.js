"use strict";
/*
 * A core kept for playback (lib/local/cores.js, v0.7.7): decided from the
 * machine and PLAYBACK_CORE, the playback pair started on it through
 * taskset, nothing on a small machine or where taskset is missing.
 */
const test = require("node:test");
const assert = require("node:assert");
const C = require("../lib/local/cores");

test("the last core on four or more, chosen or turned off by PLAYBACK_CORE, none without taskset or on a small machine", () => {
  const yes = () => true, no = () => false;
  assert.deepEqual(C.decide({ platform: "linux", cpus: 4, env: {}, have: yes }), { core: 3, cpus: 4 });
  assert.deepEqual(C.decide({ platform: "linux", cpus: 8, env: {}, have: yes }), { core: 7, cpus: 8 });
  assert.deepEqual(C.decide({ platform: "linux", cpus: 2, env: {}, have: yes }), { core: null }, "two cores: shared");
  assert.deepEqual(C.decide({ platform: "linux", cpus: 2, env: { PLAYBACK_CORE: "1" }, have: yes }), { core: 1, cpus: 2 }, "asked for: even on two");
  assert.deepEqual(C.decide({ platform: "linux", cpus: 8, env: { PLAYBACK_CORE: "2" }, have: yes }), { core: 2, cpus: 8 });
  assert.deepEqual(C.decide({ platform: "linux", cpus: 8, env: { PLAYBACK_CORE: "0" }, have: yes }), { core: null }, "0 turns it off");
  assert.deepEqual(C.decide({ platform: "linux", cpus: 8, env: { PLAYBACK_CORE: "99" }, have: yes }), { core: 7, cpus: 8 }, "a core the machine hasn't: the last");
  assert.deepEqual(C.decide({ platform: "darwin", cpus: 8, env: {}, have: yes }), { core: null }, "a Mac has no taskset");
  assert.deepEqual(C.decide({ platform: "linux", cpus: 8, env: {}, have: no }), { core: null }, "no taskset: shared");
});

test("the playback pair is started on the core through taskset; without one, as it is", () => {
  C.reset();
  assert.deepEqual(C.wrap("ffmpeg", ["-i", "x"], ), C.core({ platform: "linux", cpus: 4, env: {}, have: () => true }) === 3
    ? ["taskset", ["-c", "3", "ffmpeg", "-i", "x"]] : ["ffmpeg", ["-i", "x"]]);
  C.reset();
  assert.equal(C.core({ platform: "linux", cpus: 2, env: {}, have: () => true }), null);
  assert.deepEqual(C.wrap("ffmpeg", ["-i", "x"]), ["ffmpeg", ["-i", "x"]]);
  C.reset();
});
