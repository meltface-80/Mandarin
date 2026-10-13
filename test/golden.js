"use strict";
/*
 * golden.js — a recording of the Node server's answers (v0.8.50, stage 7 part
 * 4), for a suite that held the C# server to them side by side. Made while
 * index.js is still here (RECORD_<NAME>=1: both servers live, the Node
 * server's side kept); read back step by step on every run since, the program
 * alone held to it.
 *
 *   const rec = recording("library-node", RECORD);
 *   const want = RECORD ? <the Node server's answer> : rec.peek("albums");
 *   … the C# server's answer compared with want …
 *   rec.kept("albums", want);
 *   …
 *   rec.done();   // recording: written; reading: every step compared
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

/**
 * @param {string} name  test/golden/<name>.json
 * @param {boolean} record
 */
function recording(name, record) {
  const file = path.join(__dirname, "golden", name + ".json");
  let list = /** @type {{ label: string, v: any }[] | null} */ (record ? [] : null);
  let at = 0;
  const read = () => list || (list = JSON.parse(fs.readFileSync(file, "utf8")));
  return {
    file,
    exists: () => fs.existsSync(file),
    /** The next step, which must be the one under this label. */
    peek(/** @type {string} */ label) {
      const g = read()[at];
      assert.ok(g, "the recording ends before " + label);
      assert.equal(g.label, label, "the recording in step");
      return g.v;
    },
    /** This step done: recording, kept; reading, passed. */
    kept(/** @type {string} */ label, /** @type {any} */ v) {
      if (record) read().push({ label, v: v === undefined ? null : v });
      else at++;
    },
    /**
     * The Node server's side of this step: asked now (recording), else as it
     * was recorded; kept as JSON keeps it either way, so both runs compare alike.
     * @param {string} label
     * @param {() => any} ask
     */
    async want(label, ask) {
      const v = record ? JSON.parse(JSON.stringify((await ask()) ?? null)) : this.peek(label);
      this.kept(label, v);
      return v;
    },
    /** Recording: the file written. Reading: every step compared. */
    done() {
      if (record) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(read(), null, 1) + "\n");
      } else assert.equal(at, read().length, "every recorded step compared");
    }
  };
}

module.exports = { recording };
