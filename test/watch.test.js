"use strict";
/*
 * The music folders watched: a file added or removed starts one scan once
 * the changes have gone quiet; a folder that appears later is watched too,
 * and one taken out of the library is let go.
 *
 * The C# server's watching (Scans.cs, Watcher; lib/library/watch.js until
 * v0.8.50), its quiet and gap shortened, the scans it starts counted from
 * what it says as it starts each ("[watch] 5 changes in the music folders
 * …: reading") and the folders it watches from "[watch] watching <dir>".
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { built } = require("./server");
const { libraryServer } = require("./library-server");

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Until fn() holds, or ms have gone: the file system tells of a change, and
// the quiet is waited out, later on a busy machine than on a quiet one.
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await sleep(20); };
const QUIET = 300, GAP = 600, SETTLED = 2000;

test("changes in a watched folder are noticed and gathered into one scan", { skip: built(), timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-watch-"));
  const a = path.join(root, "a"); fs.mkdirSync(a);
  const b = path.join(root, "b");
  const env = { MANDARIN_WATCH_QUIET_MS: String(QUIET), MANDARIN_WATCH_GAP_MS: String(GAP) };
  const was = {};
  for (const [k, v] of Object.entries(env)) { was[k] = process.env[k]; process.env[k] = v; }
  let s;
  try { s = await libraryServer(t, { music: a, data: path.join(root, "data") }); }
  finally { for (const [k, v] of Object.entries(was)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
  const scans = () => s.ctx.logs.filter(l => /\[watch\] \d+ changes? in the music folders/.test(l)).length;
  const watching = d => s.ctx.logs.some(l => l.trimEnd().endsWith("[watch] watching " + d));

  // Both folders the library's; only the one that exists is watched (from the next refresh, after a scan).
  s.db.setSetting("music_folders", [a, b]);
  await s.scan();
  assert.ok(watching(a), "the folder that exists is watched");
  assert.ok(!watching(b), "only the folder that exists is watched");
  // Hearing already? On a Mac the file system's notifications start a moment
  // after the watch is made (longer on a busy machine), and what changes
  // before then is never told; inotify (Linux) hears at once. A file written
  // until it is heard, and its scan let finish: the counting starts after.
  const probe = path.join(a, "probe");
  for (let i = 0; i < 100 && !scans(); i++) { fs.writeFileSync(probe, String(i)); await sleep(100); }
  await until(() => scans() >= 1);
  assert.ok(scans() >= 1, "the watch hears a change at all");
  await sleep(SETTLED);
  const base = scans();
  // Several files in quick succession: one scan, after the quiet.
  fs.mkdirSync(path.join(a, "Artist", "Album"), { recursive: true });
  for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(a, "Artist", "Album", `0${i}.flac`), "x");
  await until(() => scans() >= base + 1);
  assert.equal(scans(), base + 1, "one scan for the burst");
  // Quiet: no more.
  await sleep(SETTLED);
  assert.equal(scans(), base + 1);
  // A deletion counts too (after the minimum gap).
  fs.rmSync(path.join(a, "Artist"), { recursive: true });
  await until(() => scans() >= base + 2);
  assert.equal(scans(), base + 2, "the removal was noticed");
  await sleep(SETTLED);
  assert.equal(scans(), base + 2, "one scan for the removal");
  // The second folder appears: watched after a refresh, and heard.
  fs.mkdirSync(b);
  await s.scan();
  assert.ok(watching(b), "the folder that appeared is watched");
  fs.writeFileSync(path.join(b, "new.flac"), "x");
  await until(() => scans() >= base + 3);
  assert.equal(scans(), base + 3, "a change in it heard");
  await sleep(SETTLED);
  // Taken out of the library: let go at the next refresh, its changes no longer heard.
  s.db.setSetting("music_folders", [a]);
  await s.scan();
  const before = scans();
  fs.writeFileSync(path.join(b, "other.flac"), "x");
  await sleep(SETTLED);
  assert.equal(scans(), before, "a folder removed from the library is let go");
});
