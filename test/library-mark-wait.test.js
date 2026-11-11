"use strict";
/*
 * The page waits on the mark of which albums there are (item 232): once an answer has shown it (and ten seconds on,
 * its first asks made), the page asks /api/library/mark with it, and the server holds that until the albums move (LibraryMarkWaitTests), so a scan's
 * albums reach a screen left alone at once. Until then the page asked every ten seconds, and only once it had heard
 * nothing for twenty. library-mark.js run here as the page runs it, against the server's answers; the rows read
 * again are library-live.test.js's.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = fs.readFileSync(path.join(__dirname, "..", "public", "app", "library-mark.js"), "utf8");
const answer = (mark, ok = true) => ({ ok, headers: { get: (h) => (h === "x-mandarin-library" ? mark : null) } });
const settle = () => new Promise((r) => setImmediate(r));

/* The page with library-mark.js in it: its asks, its held waits, its clock's waits and what it told. */
function page() {
  const asked = [], held = [], timers = [], told = [];
  const doc = { hidden: false };
  const win = {
    fetch: (url) => {
      asked.push(url);
      // The mark waited on: answered when the test says; anything else at once, with the mark "3-a".
      if (String(url).startsWith("/api/library/mark?")) return new Promise((r) => held.push(r));
      return Promise.resolve(answer("3-a"));
    },
    __libraryChanged: (o) => told.push(o)
  };
  const ctx = {
    EMBED: false,   // as the page's first part (embed-flag.js) sets it: not the Shelf's album frame
    window: win, document: doc, encodeURIComponent, Date, Promise,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    setInterval: () => 0
  };
  vm.runInNewContext(SRC, ctx);
  /* The timers set for [ms], run (and gone). */
  const run = async (ms) => {
    for (const t of timers.filter((x) => x.ms === ms && x.fn)) { const f = t.fn; t.fn = null; f(); }
    await settle();
  };
  return { win, doc, asked, held, timers, told, run };
}

test("once a mark is seen, the page waits on it once it has started, not after twenty seconds of quiet", async () => {
  const p = page();
  await p.win.fetch("/api/status");
  await settle();
  // Not while the page's first asks need the browser's connections.
  assert.deepEqual(p.asked, ["/api/status"]);
  await p.win.fetch("/api/zones");
  await settle();
  assert.deepEqual(p.asked, ["/api/status", "/api/zones"]);
  await p.run(10000);
  assert.deepEqual(p.asked, ["/api/status", "/api/zones", "/api/library/mark?wait_for=3-a"], "one wait, started once");
});

test("the albums moved: the rows read again after a moment's gathering, and the new mark waited on", async () => {
  const p = page();
  await p.win.fetch("/api/status");
  await p.run(10000);
  p.held.shift()(answer("4-b"));
  await settle();
  assert.equal(p.asked.at(-1), "/api/library/mark?wait_for=4-b", "waiting on the new mark straight away");
  assert.deepEqual(p.told, [], "gathered a moment first");
  await p.run(1000);
  assert.deepEqual(p.told, [{ live: true }]);
});

test("a wait that ran its time: asked again at once, nothing read again", async () => {
  const p = page();
  await p.win.fetch("/api/status");
  await p.run(10000);
  // Held its twenty seconds, then the same mark.
  const realNow = Date.now;
  const start = realNow();
  Date.now = () => start + 20000;
  try { p.held.shift()(answer("3-a")); await settle(); } finally { Date.now = realNow; }
  assert.equal(p.asked.filter((u) => u.startsWith("/api/library/mark?")).length, 2);
  assert.deepEqual(p.told, []);
});

test("not answered, or answered at once with nothing moved: not asked again in a loop", async () => {
  const p = page();
  await p.win.fetch("/api/status");
  await p.run(10000);
  p.held.shift()(answer("3-a", false));
  await settle();
  assert.equal(p.asked.filter((u) => u.startsWith("/api/library/mark?")).length, 1, "a failed wait waits ten seconds");
  await p.run(10000);
  assert.equal(p.asked.filter((u) => u.startsWith("/api/library/mark?")).length, 2);
  p.held.shift()(answer("3-a"));
  await settle();
  assert.equal(p.asked.filter((u) => u.startsWith("/api/library/mark?")).length, 2, "an instant same mark waits ten seconds too");
});

test("hidden, or offline: no wait held until the page is back", async () => {
  const p = page();
  p.doc.hidden = true;
  await p.win.fetch("/api/status");
  await p.run(10000);
  assert.equal(p.asked.filter((u) => u.startsWith("/api/library/mark?")).length, 0);
  p.doc.hidden = false;
  await p.run(2000);
  assert.equal(p.asked.filter((u) => u.startsWith("/api/library/mark?")).length, 1);
});
