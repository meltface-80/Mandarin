"use strict";
/*
 * score.js — the C# program's rules asked directly from a test, through
 * `mandarin-server score` (server/Mandarin.Server/Identify/ScoreCommand.cs
 * lists them): a job in, its answer out. For the tests of rules that were
 * lib/'s until v0.8.50 and are the C# server's alone now.
 */
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const { BIN } = require("./server");

/** @param {Record<string, any>} job  { fn, … }  @returns {any} */
function score(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(job) + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}

module.exports = { score };
