"use strict";
/*
 * score.js — the C# program's rules asked directly from a test, through
 * `mandarin-server score` (server/Mandarin.Server/Identify/ScoreCommand.cs
 * lists them): a job in, its answer out. For the tests of rules that were
 * lib/'s until v0.8.50 and are the C# server's alone now.
 */
const assert = require("node:assert");
const { spawn, spawnSync } = require("child_process");
const { BIN } = require("./server");

/** @param {Record<string, any>} job  { fn, … }  @returns {any} */
function score(job) {
  const r = spawnSync(BIN, ["score"], { input: JSON.stringify(job) + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const out = JSON.parse(String(r.stdout).split("\n")[0]);
  assert.ok(!out.error, out.error);
  return out;
}

/**
 * The same, waited for without holding this process up: for a job that talks to something served here (a fake player).
 * @param {Record<string, any>} job  @returns {Promise<any>}
 */
function scoreAsync(job) {
  return new Promise((resolve, reject) => {
    const c = spawn(BIN, ["score"]);
    let out = "", err = "";
    c.stdout.on("data", d => { out += d; });
    c.stderr.on("data", d => { err += d; });
    c.on("error", reject);
    c.on("close", code => {
      try {
        assert.equal(code, 0, err);
        const o = JSON.parse(out.split("\n")[0]);
        assert.ok(!o.error, o.error);
        resolve(o);
      } catch (e) { reject(e); }
    });
    c.stdin.end(JSON.stringify(job) + "\n");
  });
}

module.exports = { score, scoreAsync };
