"use strict";
/*
 * Random Album Radio asked for an album when there is none to give (item
 * 185): an empty library (a new install, the music folder not there yet).
 * The room was marked busy with the radio and never let go, so the radio was
 * dead for that room until a restart: switched on again once there was
 * music, nothing came. It is let go on every way out.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const ZONE = "RINCON_KITCHEN01400";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for " + what);
    await sleep(100);
  }
}

test("the radio switched on with no album to give, then with one: it queues it", { skip: built() || (!haveFfmpeg() && "ffmpeg is not installed"), timeout: 120000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  // The music, made aside; the server starts on an empty folder.
  const made = makeLibrary();
  const music = path.join(made.root, "empty");
  fs.mkdirSync(music, { recursive: true });
  const srv = createServer({ port: PORT, musicDir: music, dataDir: made.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); });
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const get = async p => (await fetch(B + p, { headers: H })).json();
  const post = (p, body) => fetch(B + p, { method: "POST", headers: H, body: JSON.stringify(body) });
  await until(async () => (await get("/api/zones")).zones.some(z => z.zone_id === ZONE), 30000, "the Kitchen");
  // Switched on in the silent Kitchen with nothing in the library: nothing to queue.
  assert.equal((await post("/api/radio", { zone: ZONE, enabled: true })).status, 200);
  await sleep(1000);
  assert.equal(house.room("Kitchen").queue.length, 0);
  // The music arrives.
  fs.cpSync(made.music, music, { recursive: true });
  assert.equal((await post("/api/library/rescan", {})).status < 300, true);
  await until(async () => (await get("/api/status")).index_count === 3, 60000, "the library");
  // Switched on again: an album queued.
  const said = ctx.logs.length;
  assert.equal((await post("/api/radio", { zone: ZONE, enabled: true })).status, 200);
  await until(() => ctx.logs.slice(said).some(l => /\[radio\] .*queued "/.test(l)), 15000, "the radio's album");
  await until(() => house.room("Kitchen").queue.length > 0, 10000, "the Kitchen's queue");
});
