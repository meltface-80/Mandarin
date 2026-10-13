"use strict";
/*
 * The database in the data volume, opened as the server opens it
 * (`mandarin-server db <dir>`, v0.8.50; lib/library/db.js before).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const Database = require("better-sqlite3");
const { built, BIN } = require("./server");

const skip = built();

/* Opened, and what it came to: { ok, existed, aside, version }. */
function open(dir) {
  const r = spawnSync(BIN, ["db", dir], { encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout.split("\n").filter(Boolean).pop());
}

test("a database left in the volume by another program is moved aside, not crashed on", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-db-"));
  const old = new Database(path.join(dir, "musicd.db"));
  old.exec("CREATE TABLE tracks (id INTEGER PRIMARY KEY, path TEXT, title TEXT); INSERT INTO tracks(path, title) VALUES('x', 'y');");
  old.exec("CREATE TABLE albums (id INTEGER PRIMARY KEY, title TEXT);");
  old.close();

  const said = open(dir);
  assert.ok(said.aside && /^musicd\.old-\d+\.db$/.test(path.basename(said.aside)), JSON.stringify(said));
  assert.ok(fs.existsSync(said.aside));
  const db = new Database(path.join(dir, "musicd.db"));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM tracks").get().n, 0);
  assert.equal(db.pragma("user_version", { simple: true }), said.version);
  assert.ok(said.version > 0);
  db.close();
});

test("our own database is kept across restarts", { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-db-"));
  assert.equal(open(dir).existed, false);
  let db = new Database(path.join(dir, "musicd.db"));
  db.prepare("INSERT INTO settings(key, value) VALUES('k', '42')").run();
  db.close();
  const said = open(dir);
  assert.equal(said.existed, true);
  assert.equal(said.aside, null);
  db = new Database(path.join(dir, "musicd.db"));
  assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'k'").get().value), 42);
  db.close();
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes("old")), []);
});
