"use strict";
/*
 * Random Album Radio does not repeat itself within six months (from Rouen,
 * MusicD Remote v1.9.3): an album the radio played is not played BY THE
 * RADIO again for six months. Albums only, never a dead end, an album used
 * up only once the room has taken it, and the memory kept in the database so
 * it outlives a restart.
 *
 * The C# server's (Playback/RadioMemory.cs, History.cs; lib/radio-memory.js and
 * lib/server/features.js until v0.8.50): the memory asked through
 * `mandarin-server score` { fn: "radio" }, the radio itself through the server.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { score } = require("./score");

const rules = built();
const DAY = 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 183 * DAY;
const START = 1e12;
const albums = (n) => Array.from({ length: n }, (_, i) => ({ id: i, key: "A" + i, title: "A" + i, subtitle: "X" }));
/* One memory, from what was saved, at START: ops in order ({ op: note|tick|at|size|pick }) → each one's answer, and what it saved. */
const run = (ops, saved, start = START) => score({ fn: "radio", runs: [{ saved, start, ops }] }).runs[0];
const pick = (pool, heard) => ({ op: "pick", pool, by: "key", heard, rnd: Array.from({ length: 4 }, Math.random) });
const title = (pool, at) => at === null ? null : pool[at].title;

test("the radio's memory", { skip: rules }, async (t) => {
  await t.test("an album the radio played is not picked again", () => {
    const pool = albums(3);
    const r = run([{ op: "note", key: "A0" }, { op: "note", key: "A1" }, ...Array.from({ length: 50 }, () => pick(pool))]).results.slice(2);
    for (const at of r) assert.equal(title(pool, at), "A2");
  });
  await t.test("six months is the window: still out at 170 days, back after 183", () => {
    const pool = albums(2);
    const r = run([{ op: "note", key: "A0" }, { op: "tick", ms: 170 * DAY }, { op: "at", key: "A0" }, { op: "tick", ms: SIX_MONTHS_MS - 170 * DAY + 1 }, { op: "at", key: "A0" },
      ...Array.from({ length: 60 }, () => pick(pool))]).results;
    assert.notEqual(r[2], null, "dropped before six months");
    assert.equal(r[4], null, "still excluded after six months");
    assert.ok(r.slice(5).some(at => title(pool, at) === "A0"));
  });
  await t.test("the older preference (not heard lately) leans the pick, but never refuses one", () => {
    const pool = albums(3);
    // Heard lately: every album but A1 (by id).
    const r = run([...Array.from({ length: 30 }, () => pick(pool, [0, 2])), pick(pool, [0, 1, 2])]).results;
    for (const at of r.slice(0, 30)) assert.equal(title(pool, at), "A1");
    assert.notEqual(r[30], null, "a library heard in full stopped the radio");
  });
  await t.test("never a dead end: with everything played, the longest-ago radio play comes round first", () => {
    const pool = albums(3);
    const r = run([{ op: "note", key: "A1" }, { op: "tick", ms: DAY }, { op: "note", key: "A0" }, { op: "tick", ms: DAY }, { op: "note", key: "A2" }, pick(pool)]).results;
    assert.equal(title(pool, r[5]), "A1");
  });
  await t.test("it survives a restart: what was saved is what is excluded; what can never exclude anything again is not kept", () => {
    const { saved } = run([{ op: "note", key: "A0" }]);
    const again = run([{ op: "at", key: "A0" }, pick(albums(2))], saved, START + DAY).results;
    assert.notEqual(again[0], null);
    assert.equal(title(albums(2), again[1]), "A1");
    assert.deepEqual(run([{ op: "size" }], saved, START + SIX_MONTHS_MS + DAY).results, [0]);
  });
  await t.test("an empty pool is no pick, not a crash", () => {
    assert.deepEqual(run([pick([])]).results, [null]);
  });
});

test("every album has a radio key, including titles the fold empties", { skip: rules }, () => {
  const [a, b, c, kid, abbey, beatles] = score({ fn: "radio", keys: [{ title: "÷", artist: "Ed Sheeran" }, { title: "+", artist: "Ed Sheeran" }, { title: "テスト", artist: "Someone" },
    { title: "Kid A", artist: "Radiohead" }, { title: "Abbey Road", artist: "The Beatles" }, { title: "ABBEY ROAD", artist: "Beatles" }] }).keys;
  assert.ok(a && b && c, "an empty key can never be noted, so the rule would never apply");
  assert.equal(new Set([a, b, c]).size, 3);
  assert.equal(kid, "kid a|radiohead");
  assert.equal(abbey, beatles, "the library's own identity");
});

const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const ZONE = "RINCON_KITCHEN01400";

async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

test("Random Album Radio uses it: exact, used up only once the room has the album, kept in the database", { skip: rules || (!haveFfmpeg() && "ffmpeg is not installed"), timeout: 120000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  // The Kitchen never starts (a silent room, where each switch-on queues one album, and
  // nothing playing that the radio would top up by itself), and refuses what's added to
  // its queue when the test says.
  const kitchen = house.room("Kitchen");
  const handle = kitchen.handle.bind(kitchen);
  let refuse = false, refused = 0;
  kitchen.handle = (action, args) => {
    if (action === "Play") return {};
    if (refuse && /^Add/.test(action)) { refused++; throw 701; }
    return handle(action, args);
  };
  const lib = makeLibrary();
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); });
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const get = async p => (await fetch(B + p, { headers: H })).json();
  const ready = () => until(async () => (await get("/api/status")).index_count === 3 && (await get("/api/zones")).zones.some(z => z.zone_id === ZONE), 30000, "the library and the Kitchen");
  await ready();
  const shelf = (await get("/api/library/albums?sort=album")).albums;
  const idOf = name => shelf.find(a => a.title === name).offset;
  // Switched on in the silent Kitchen, the radio queues one album: which, from what it says.
  const radio = async () => {
    const said = ctx.logs.length;
    const r = await fetch(B + "/api/radio", { method: "POST", headers: H, body: JSON.stringify({ zone: ZONE, enabled: true }) });
    assert.equal(r.status, 200);
    const line = await until(() => ctx.logs.slice(said).find(l => /\[radio\]/.test(l)), 10000, "the radio's album");
    return /queued "(.*)" by/.exec(line)[1];
  };
  const rows = () => ctx.db.raw.prepare("SELECT key, ts FROM radio_played ORDER BY key").all();

  // Heard lately: Album One. It comes last while the others are free.
  ctx.features.insertPlay.run(idOf("Album One"), null, "Song 1", "Artist A", "Album One", "z", Date.now() - DAY);
  assert.deepEqual([await radio(), await radio()].sort(), ["Best Of", "Hi Res"], "two different albums, none heard lately");
  assert.equal(await radio(), "Album One", "then the one heard lately, rather than a repeat");
  const keys = score({ fn: "radio", keys: ["Album One", "Best Of", "Hi Res"].map(name => ({ title: name, artist: shelf.find(a => a.title === name).subtitle })) }).keys;
  assert.deepEqual(rows().map(r => r.key), [...keys].sort(), "albums by their identity, not their ids");

  // A refused add uses nothing up.
  const before = rows();
  refuse = true;
  await fetch(B + "/api/radio", { method: "POST", headers: H, body: JSON.stringify({ zone: ZONE, enabled: true }) });
  await until(() => refused > 0, 10000, "the Kitchen asked");
  // A window: nothing may be used up in it.
  await new Promise(r => setTimeout(r, 500));
  refuse = false;
  assert.deepEqual(rows(), before);

  // Every album the radio's: the one longest ago comes round, read back after a restart.
  const at = (name, daysAgo) => ctx.db.raw.prepare("UPDATE radio_played SET ts = ? WHERE key = ?").run(Date.now() - daysAgo * DAY, keys[["Album One", "Best Of", "Hi Res"].indexOf(name)]);
  at("Album One", 3); at("Best Of", 40); at("Hi Res", 9);
  await ctx.restart(token);
  await ready();
  assert.equal(await radio(), "Best Of", "Best Of, the radio's 40 days ago");

  // Another restart: the one album the database says is free.
  ctx.db.raw.prepare("DELETE FROM radio_played WHERE key = ?").run(keys[2]);
  await ctx.restart(token);
  await ready();
  assert.equal(await radio(), "Hi Res");
});
