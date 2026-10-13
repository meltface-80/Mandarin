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

/*
 * answers.js's kind of recording (v0.8.50, stage 7 part 5): a parity suite's
 * cases still made here, seeded, and the Node server's module's answers to
 * them kept — in full where they are few, else as a short sum of each run of
 * PER cases (the whole of them would be a hundred megabytes) — so the C#
 * program alone is held to them case for case once lib/ is gone.
 *
 *   const kept = answers("sonos-csharp", RECORD);
 *   kept.same("planMoves", labels, cases, got, RECORD && (() => cases.map(…lib…)));
 *   const doc = kept.input("a queue's DIDL", RECORD && (() => DIDL.build(…)));
 *   …
 *   kept.done();
 */
const crypto = require("crypto");
const PER = 32, FULL = 4096;
const { isDeepStrictEqual } = require("util");
/* JSON as the suites compare it, with a −0 told from a 0 (JSON writes both "0"). */
const json = (v) => JSON.stringify(v, (k, x) => Object.is(x, -0) ? "\u0000-0" : x) ?? "undefined";
const sum = (list) => crypto.createHash("sha256").update(list.map(json).join("\n")).digest("hex").slice(0, 8);

/**
 * @param {string} name  test/golden/<name>.json
 * @param {boolean} record
 */
function answers(name, record) {
  const file = path.join(__dirname, "golden", name + ".json");
  /** @type {{ answers: Record<string, any>, inputs: Record<string, any> }} */
  const book = record ? { answers: {}, inputs: {} } : (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : { answers: {}, inputs: {} });
  const used = new Map();
  const key = (/** @type {string} */ what) => { const n = (used.get(what) || 0) + 1; used.set(what, n); return n > 1 ? `${what} #${n}` : what; };
  return {
    file,
    exists: () => fs.existsSync(file),
    /**
     * C#'s answers [got] to [cases], each the Node server's answer: [want]
     * asked of it while recording (as plain JSON values), else as kept.
     * @param {string} what
     * @param {any[]} labels  where each case came from, for a failure's message
     * @param {any[]} cases
     * @param {any[]} got
     * @param {false | (() => any[])} [want]
     */
    same(what, labels, cases, got, want) {
      const k = key(what);
      let w;
      if (record) {
        if (!want) throw new Error(k + ": recording, and nothing to record");
        w = want();
        const whole = json(w);
        book.answers[k] = whole.length <= FULL ? { n: w.length, all: w } : { n: w.length, per: PER, sums: Array.from({ length: Math.ceil(w.length / PER) }, (_, i) => sum(w.slice(i * PER, (i + 1) * PER))).join("") };
      }
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
     * An input the Node server's module made for a case: [make] asked while
     * recording, else as kept, whole.
     * @param {string} label
     * @param {false | (() => any)} [make]
     */
    input(label, make) {
      const k = key("input: " + label);
      if (record) {
        if (!make) throw new Error(k + ": recording, and nothing to record");
        book.inputs[k] = JSON.parse(JSON.stringify(make() ?? null));
      }
      assert.ok(k in book.inputs, `${k}: not in ${path.basename(file)}`);
      return book.inputs[k];
    },
    /** Recording: the file written. Reading: every kept answer asked for. */
    done() {
      if (record) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        // The answers a line a value; each input on one line of its own.
        const inputs = Object.entries(book.inputs).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
        fs.writeFileSync(file, `{\n "answers": ${JSON.stringify(book.answers, null, 1).replace(/\n/g, "\n ")},\n "inputs": {${inputs ? "\n" + inputs + "\n " : ""}}\n}\n`);
      } else {
        const asked = new Set();
        for (const [what, n] of used) for (let i = 1; i <= n; i++) asked.add(i > 1 ? `${what} #${i}` : what);
        const left = Object.keys(book.answers).filter(k => !asked.has(k));
        assert.deepEqual(left, [], "every kept answer compared");
      }
    }
  };
}

module.exports = { recording, answers };
