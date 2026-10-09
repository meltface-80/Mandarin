"use strict";
/*
 * Random Album Radio does not repeat itself within six months (from Rouen,
 * MusicD Remote v1.9.3): an album the radio played is not played BY THE
 * RADIO again for six months (lib/radio-memory.js). Albums only, never a dead
 * end, an album used up only once the room has taken it, and the memory kept
 * in the database so it outlives a restart (lib/server/features.js).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRadioMemory, radioKey, SIX_MONTHS_MS } = require("../lib/radio-memory");

const DAY = 24 * 60 * 60 * 1000;
const albums = (n) => Array.from({ length: n }, (_, i) => ({ title: "A" + i, subtitle: "X" }));
const keyOf = (al) => al.title;

function memory(start, saved) {
  let clock = start || 1e12;
  let written = null;
  const m = createRadioMemory({ load: () => saved || null, save: (o) => { written = o; }, now: () => clock });
  return { m, tick: (ms) => { clock += ms; }, written: () => written };
}

test("the radio's memory", async (t) => {
  await t.test("an album the radio played is not picked again", () => {
    const { m } = memory();
    const pool = albums(3);
    m.note("A0"); m.note("A1");
    for (let i = 0; i < 50; i++) assert.equal(m.pick(pool, keyOf, null, Math.random).title, "A2");
  });
  await t.test("six months is the window: still out at 170 days, back after 183", () => {
    const { m, tick } = memory();
    const pool = albums(2);
    m.note("A0");
    tick(170 * DAY);
    assert.notEqual(m.playedAt("A0"), null, "dropped before six months");
    tick(SIX_MONTHS_MS - 170 * DAY + 1);
    assert.equal(m.playedAt("A0"), null, "still excluded after six months");
    const seen = new Set();
    for (let i = 0; i < 60; i++) seen.add(m.pick(pool, keyOf, null, Math.random).title);
    assert.ok(seen.has("A0"));
    assert.equal(SIX_MONTHS_MS, 183 * DAY);
  });
  await t.test("the older preference (not heard lately) leans the pick, but never refuses one", () => {
    const { m } = memory();
    const pool = albums(3);
    const heard = (al) => al.title !== "A1";
    for (let i = 0; i < 30; i++) assert.equal(m.pick(pool, keyOf, heard, Math.random).title, "A1");
    assert.ok(m.pick(pool, keyOf, () => true, Math.random), "a library heard in full stopped the radio");
  });
  await t.test("never a dead end: with everything played, the longest-ago radio play comes round first", () => {
    const { m, tick } = memory();
    const pool = albums(3);
    m.note("A1"); tick(DAY); m.note("A0"); tick(DAY); m.note("A2");
    assert.equal(m.pick(pool, keyOf, null, Math.random).title, "A1");
  });
  await t.test("it survives a restart: what was saved is what is excluded", () => {
    const first = memory();
    first.m.note("A0");
    const again = memory(1e12 + DAY, first.written());
    assert.notEqual(again.m.playedAt("A0"), null);
    assert.equal(again.m.pick(albums(2), keyOf, null, Math.random).title, "A1");
  });
  await t.test("what can never exclude anything again is not kept", () => {
    const first = memory();
    first.m.note("A0");
    assert.equal(memory(1e12 + SIX_MONTHS_MS + DAY, first.written()).m.size(), 0);
  });
  await t.test("an empty pool is no pick, not a crash", () => {
    assert.equal(memory().m.pick([], keyOf, null, Math.random), null);
  });
});

test("every album has a radio key, including titles the fold empties", () => {
  const a = radioKey({ title: "÷", artist: "Ed Sheeran" });
  const b = radioKey({ title: "+", artist: "Ed Sheeran" });
  const c = radioKey({ title: "テスト", artist: "Someone" });
  assert.ok(a && b && c, "an empty key can never be noted, so the rule would never apply");
  assert.equal(new Set([a, b, c]).size, 3);
  assert.equal(radioKey({ title: "Kid A", artist: "Radiohead" }), "kid a|radiohead");
  assert.equal(radioKey({ title: "Abbey Road", artist: "The Beatles" }), radioKey({ title: "ABBEY ROAD", artist: "Beatles" }), "the library's own identity");
});

test("Random Album Radio uses it: exact, used up only once the room has the album, kept in the database", async () => {
  const { Features } = require("../lib/server/features");
  const DB = require("../lib/library/db");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-radio-"));
  const db = DB.open(dir, { log: () => {} });
  const lib = {
    albums: ["Abbey Road", "Kid A", "Blue", "Hounds of Love"].map((title, i) => ({ id: i + 1, title, artist: "Someone " + i })),
    get count() { return this.albums.length; },
    heard: new Set(),
    playedAlbumIdsSince() { return this.heard; }
  };
  const queued = [];
  let refuse = false;
  const playback = { async playAlbum(zone, id, how) { if (refuse) throw new Error("the room didn't answer"); queued.push([zone, id, how]); } };
  const make = () => new Features({ db, library: lib, playback, log: () => {} });
  try {
    let f = make();
    // Heard lately: Blue. It comes last while the others are free.
    lib.heard = new Set([3]);
    for (let i = 0; i < 3; i++) await f.radioTopUp("kitchen", true);
    assert.deepEqual(queued.map(q => q[2]), ["queue", "queue", "queue"]);
    assert.deepEqual(new Set(queued.map(q => q[1])), new Set([1, 2, 4]), "three different albums, none heard lately");
    await f.radioTopUp("kitchen", true);
    assert.equal(queued[3][1], 3, "then the one heard lately, rather than a repeat");
    // Every album the radio's: the one longest ago comes round. (The times
    // set apart, and read back, so no two share a millisecond.)
    const at = (id, daysAgo) => db.raw.prepare("UPDATE radio_played SET ts = ? WHERE key = ?").run(Date.now() - daysAgo * DAY, radioKey(lib.albums[id - 1]));
    at(1, 3); at(2, 40); at(3, 1); at(4, 9);
    f = make();
    await f.radioTopUp("kitchen", true);
    assert.equal(queued[4][1], 2, "Kid A, the radio's 40 days ago");
    // A refused add uses nothing up.
    const rows = () => db.raw.prepare("SELECT key, ts FROM radio_played ORDER BY key").all();
    const before = rows();
    refuse = true;
    await assert.rejects(f.radioTopUp("kitchen", true));
    refuse = false;
    assert.deepEqual(rows(), before);
    assert.equal(before.length, 4);
    assert.ok(before.every(r => /\|someone \d$/.test(r.key)), "albums by their identity, not their ids");
    // A restart: the memory is read back.
    db.raw.prepare("DELETE FROM radio_played WHERE key = ?").run(radioKey(lib.albums[1]));
    f = make();
    queued.length = 0;
    await f.radioTopUp("kitchen", true);
    assert.equal(queued[0][1], 2, "the one album the database says is free");
  } finally {
    db.raw.close();
  }
});
