"use strict";
/*
 * The music folders watched: a file added or removed starts one scan once
 * the changes have gone quiet; a folder that appears later is watched too.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { LibraryWatcher } = require("../lib/library/watch");

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Until fn() holds, or ms have gone: the file system tells of a change, and
// the quiet is waited out, later on a busy machine than on a quiet one.
const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(20); };

test("changes in a watched folder are noticed and gathered into one scan", { timeout: 20000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-watch-"));
  const a = path.join(root, "a"); fs.mkdirSync(a);
  const b = path.join(root, "b");
  let roots = [a, b];
  let scans = 0;
  const w = new LibraryWatcher({ roots: () => roots, onChange: async () => { scans++; await sleep(50); }, quietMs: 200, minGapMs: 400, log: () => {} });
  w.refresh();
  if (!w.status().supported) { w.stop(); return; }   // no recursive watching here: nothing to test
  assert.deepEqual(w.status().watching, [a], "only the folder that exists is watched");
  // Several files in quick succession: one scan, after the quiet.
  fs.mkdirSync(path.join(a, "Artist", "Album"), { recursive: true });
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(a, "Artist", "Album", `0${i}.flac`), "x");
  await until(() => scans >= 1);
  assert.equal(scans, 1, "one scan for the burst");
  // Quiet: no more.
  await sleep(600);
  assert.equal(scans, 1);
  // A deletion counts too (after the minimum gap).
  fs.rmSync(path.join(a, "Artist"), { recursive: true });
  await until(() => scans >= 2);
  assert.equal(scans, 2, "the removal was noticed");
  await sleep(600);
  assert.equal(scans, 2, "one scan for the removal");
  // The second folder appears: watched after a refresh.
  fs.mkdirSync(b);
  w.refresh();
  assert.deepEqual(w.status().watching.sort(), [a, b].sort());
  roots = [a];
  w.refresh();
  assert.deepEqual(w.status().watching, [a], "a folder removed from the library is let go");
  w.stop();
  assert.deepEqual(w.status().watching, []);
  fs.rmSync(root, { recursive: true, force: true });
});
