"use strict";
/*
 * golden.js — the Node server's answers, recorded (v0.8.50, stage 7 parts 4
 * and 5) while index.js and lib/ were still here, for the suites that held
 * the C# server to them side by side. Read back step by step on every run:
 * the program alone held to what the Node server answered.
 *
 *   const rec = recording("library-node");
 *   const want = rec.peek("albums");
 *   … the C# server's answer compared with want …
 *   rec.kept("albums");
 *   …
 *   rec.done();   // every step compared
 */
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

/**
 * @param {string} name  test/golden/<name>.json
 */
function recording(name) {
  const file = path.join(__dirname, "golden", name + ".json");
  let list = /** @type {{ label: string, v: any }[] | null} */ (null);
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
    /** This step done. */
    kept(/** @type {string} */ label) { at++; },
    /** The Node server's side of this step, as it was recorded. */
    want(/** @type {string} */ label) {
      const v = this.peek(label);
      this.kept(label);
      return v;
    },
    /** Every step compared. */
    done() { assert.equal(at, read().length, "every recorded step compared"); }
  };
}

/*
 * answers.js's kind of recording (v0.8.50, stage 7 part 5): a parity suite's
 * cases still made here, seeded, and the Node server's module's answers to
 * them as they were recorded — in full where they are few, else as a short
 * sum of each run of PER cases — so the C# program alone is held to them case
 * for case.
 *
 *   const kept = answers("sonos-csharp");
 *   kept.same("planMoves", labels, cases, got);
 *   const doc = kept.input("a queue's DIDL");
 *   …
 *   kept.done();
 */
const crypto = require("crypto");
const PER = 32;
const { isDeepStrictEqual } = require("util");
/* JSON as the suites compare it, with a −0 told from a 0 (JSON writes both "0"). */
const json = (v) => JSON.stringify(v, (k, x) => Object.is(x, -0) ? "\u0000-0" : x) ?? "undefined";
const sum = (list) => crypto.createHash("sha256").update(list.map(json).join("\n")).digest("hex").slice(0, 8);

/**
 * @param {string} name  test/golden/<name>.json
 */
function answers(name) {
  const file = path.join(__dirname, "golden", name + ".json");
  /** @type {{ answers: Record<string, any>, inputs: Record<string, any> }} */
  const book = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { answers: {}, inputs: {} };
  const used = new Map();
  const key = (/** @type {string} */ what) => { const n = (used.get(what) || 0) + 1; used.set(what, n); return n > 1 ? `${what} #${n}` : what; };
  return {
    file,
    exists: () => fs.existsSync(file),
    /**
     * C#'s answers [got] to [cases], each the Node server's answer as kept.
     * @param {string} what
     * @param {any[]} labels  where each case came from, for a failure's message
     * @param {any[]} cases
     * @param {any[]} got
     */
    same(what, labels, cases, got) {
      const k = key(what);
      const g = book.answers[k];
      assert.ok(g, `${k}: not in ${path.basename(file)}`);
      assert.equal(got.length, g.n, k + ": as many answers as cases");
      const show = (i) => `case: ${JSON.stringify(cases[i]).slice(0, 1500)}\nc#:   ${json(got[i]).slice(0, 3000)}`;
      if (g.all) {
        for (let i = 0; i < g.n; i++) {
          if (!isDeepStrictEqual(got[i], g.all[i]) || json(got[i]) !== json(g.all[i])) assert.fail(`${k} #${i} (${labels[i]}) differs from the Node server's\nnode: ${json(g.all[i]).slice(0, 3000)}\n${show(i)}`);
        }
        return;
      }
      for (let c = 0; c * PER < g.n; c++) {
        const from = c * PER, to = Math.min(g.n, from + PER), mine = sum(got.slice(from, to));
        if (mine === g.sums.slice(c * 8, c * 8 + 8)) continue;
        const lines = [];
        for (let i = from; i < to; i++) lines.push(`#${i} (${labels[i]})\n${show(i)}`);
        assert.fail(`${k}: cases ${from} to ${to - 1}, one or more, differ from the Node server's (kept as a sum)\n${lines.join("\n").slice(0, 12000)}`);
      }
    },
    /**
     * An input the Node server's module made for a case, as kept, whole.
     * @param {string} label
     */
    input(label) {
      const k = key("input: " + label);
      assert.ok(k in book.inputs, `${k}: not in ${path.basename(file)}`);
      return book.inputs[k];
    },
    /** Every kept answer asked for. */
    done() {
      const asked = new Set();
      for (const [what, n] of used) for (let i = 1; i <= n; i++) asked.add(i > 1 ? `${what} #${i}` : what);
      const left = Object.keys(book.answers).filter(k => !asked.has(k));
      assert.deepEqual(left, [], "every kept answer compared");
    }
  };
}

module.exports = { recording, answers };
