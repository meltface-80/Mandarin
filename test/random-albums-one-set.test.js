"use strict";
/*
 * Random albums is one set (item 537). Home's Random albums row and the Random albums wall each asked the server for a
 * random handful of their own, the row again on every visit to Home: the row the owner saw was never the wall it
 * opened, and coming back to Home showed a third. The server now keeps one set (a seed and when it was picked, the
 * setting random_albums): every reading of /api/random-albums without a filter is that set in the same order, a
 * shorter one the head of a longer, until the wall's Refresh (?refresh=1) or Android Auto, every ten minutes while in
 * use, picks a new one, or it is 24 hours old. It is kept through a restart. Against a library of a dozen albums:
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { gen, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const N = 12;

test("item 537: Random albums is one set, the same everywhere until Refresh or 24 hours", { skip, timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-"));
  const music = path.join(root, "music");
  for (let i = 1; i <= N; i++)
    gen(path.join(music, `Artist ${i}`, `Album ${i}`, "01 Song.flac"), { seconds: 1, freq: 100 * i, tags: { title: "Song", artist: `Artist ${i}`, album: `Album ${i}`, track: 1 } });
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: music, dataDir: path.join(root, "data"), serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  let token = await signIn(base);
  const get = async q => {
    const r = await fetch(base + "/api/random-albums" + q, { headers: { Authorization: "Bearer " + token } });
    assert.equal(r.status, 200, q);
    return (await r.json()).albums.map(a => a.title);
  };
  for (let i = 0; i < 300; i++) { const r = await fetch(base + "/api/random-albums?count=96", { headers: { Authorization: "Bearer " + token } }); if (r.ok && (await r.json()).albums.length === N) break; await sleep(200); }

  const first = await get("?count=" + N);
  assert.equal(first.length, N);

  await t.test("read again, the same albums in the same order; a shorter reading is the head of a longer (Home's row, the wall)", async () => {
    assert.deepEqual(await get("?count=" + N), first);
    assert.deepEqual(await get("?count=" + N), first);
    assert.deepEqual(await get("?count=5"), first.slice(0, 5));
  });

  let refreshed;
  await t.test("Refresh picks a new set, and that is the set from then on", async () => {
    refreshed = await get("?count=" + N + "&refresh=1");
    assert.equal(refreshed.length, N);
    assert.notDeepEqual(refreshed, first, "a new set");
    assert.deepEqual(await get("?count=" + N), refreshed);
    assert.deepEqual(await get("?count=5"), refreshed.slice(0, 5));
  });

  await t.test("kept through a restart of the server", async () => {
    await ctx.restart(token);
    token = await signIn(base);
    for (let i = 0; i < 300; i++) { const r = await fetch(base + "/api/random-albums?count=96", { headers: { Authorization: "Bearer " + token } }); if (r.ok && (await r.json()).albums.length === N) break; await sleep(200); }
    assert.deepEqual(await get("?count=" + N), refreshed);
  });

  await t.test("24 hours after it was picked, a new set, then kept", async () => {
    const kept = JSON.parse(ctx.db.raw.prepare("SELECT value FROM settings WHERE key = 'random_albums'").get().value);
    assert.ok(Number.isFinite(kept.seed) && Number.isFinite(kept.at), "the seed and when it was picked");
    ctx.db.raw.prepare("UPDATE settings SET value = ? WHERE key = 'random_albums'").run(JSON.stringify({ seed: kept.seed, at: Date.now() - 23 * 3600 * 1000 }));
    assert.deepEqual(await get("?count=" + N), refreshed, "23 hours old: the same");
    ctx.db.raw.prepare("UPDATE settings SET value = ? WHERE key = 'random_albums'").run(JSON.stringify({ seed: kept.seed, at: Date.now() - 25 * 3600 * 1000 }));
    const next = await get("?count=" + N);
    assert.notDeepEqual(next, refreshed, "25 hours old: a new set");
    assert.deepEqual(await get("?count=" + N), next);
  });
});
