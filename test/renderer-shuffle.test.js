"use strict";
/*
 * Shuffle on a renderer (item 183). The track after this one is picked once
 * for the track playing and kept: a renderer is read every second or so, and
 * each read used to pick again — SetNextAVTransportURI sent again with
 * another track, and another conversion started each time. And what has been
 * played is the tracks themselves, not their places in the queue: a track
 * removed, added or moved no longer makes shuffle play one twice and skip
 * another.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeRenderer, idFor } = require("./fake-renderer");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await sleep(100);
  }
}

test("shuffle on a renderer: one next track per track, and played means the tracks", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const wiim = new FakeRenderer({ name: "WiiM", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro" });
  await wiim.start();
  // Every SetNextAVTransportURI, with the address it named.
  const nexts = [];
  const handle = wiim.handle.bind(wiim);
  wiim.handle = (action, a) => { if (action === "SetNextAVTransportURI") nexts.push(a.NextURI); return handle(action, a); };
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpHosts: [wiim.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { await srv.stop(); await wiim.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  const WIIM = idFor(wiim.udn);
  const state = async () => (await api("zone-state?zone=" + WIIM)).zone;
  const queued = async () => { const q = await api("queue?zone=" + WIIM); return q.items.length + q.history.length; };
  const title = async () => { const z = await state(); return z && z.now_playing && z.now_playing.line1; };
  await until(async () => (await api("status")).index_count === 3);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === WIIM), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + WIIM, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === WIIM), 20000);
  const albums = (await api("library/albums?sort=album")).albums;
  const one = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");
  const shuffleOn = async () => assert.equal((await api("zone-settings", { zone_or_output_id: WIIM, shuffle: true })).status, 200);
  // Album One, playing Song 1 from the start of the queue, shuffle on: the clock held, so Song 1 never ends.
  const start = async () => {
    wiim.release();
    await shuffleOn();
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: WIIM, kind: "play_now" })).status, 200);
    await until(() => wiim.state === "PLAYING");
    wiim.hold();
    await until(async () => (await title()) === "Song 1");
  };

  await t.test("the next track is picked once while a track plays, not at every read", async () => {
    await start();
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: WIIM, kind: "queue" })).status, 200);
    await until(async () => (await queued()) === 5);
    // Settled: one next set for Song 1 with all five there.
    await until(() => wiim.nextUri);
    await sleep(1500);
    const from = nexts.length;
    // Six seconds of reads, the zone watched (read every second): four tracks it could pick each time.
    for (let i = 0; i < 12; i++) { await state(); await sleep(500); }
    const sent = nexts.slice(from);
    assert.deepEqual(sent, [], `SetNextAVTransportURI sent again ${sent.length} times while Song 1 played: ${sent.map(u => u.split("?")[0].split("/").pop()).join(", ")}`);
  });

  await t.test("a track removed before the one playing: the tracks played stay the ones played", async () => {
    // Song 1, then Song 2 (both played); Song 1 taken out: Song 3 is still to come.
    await start();
    assert.equal((await api("play-from-here", { zone_or_output_id: WIIM, queue_item_id: 2 })).status, 200);
    await until(async () => (await title()) === "Song 2");
    assert.equal((await api("queue/remove", { zone_or_output_id: WIIM, queue_item_ids: [1] })).status, 200);
    await until(async () => (await queued()) === 2);
    const r = await api("control", { zone_or_output_id: WIIM, command: "next" });
    assert.equal(r.status, 200, "Song 3 hasn't played: " + JSON.stringify(r));
    await until(async () => (await title()) === "Song 3");
  });

  await t.test("a track added after the one playing: the next is the one not yet played", async () => {
    // Song 1, Song 3, Song 2, back to Song 1: all three played; Hi 1 added next is the only one left.
    await start();
    for (const n of [3, 2, 1]) {
      assert.equal((await api("play-from-here", { zone_or_output_id: WIIM, queue_item_id: n })).status, 200);
      await until(async () => (await title()) === `Song ${n}`);
    }
    assert.equal((await api("play-track", { offset: hi.offset, track_index: 0, zone_or_output_id: WIIM, kind: "play_next" })).status, 200);
    await until(async () => (await queued()) === 4);
    assert.equal((await api("control", { zone_or_output_id: WIIM, command: "next" })).status, 200);
    await until(async () => (await state()).state === "playing" && (await title()) !== "Song 1");
    assert.equal(await title(), "Hi 1", "not Song 3 again");
  });

  await t.test("a played track moved to play next: the one not yet played is still the one to come", async () => {
    // Song 1, then Song 3 (both played); Song 1 moved after Song 3: Song 2 is the one left.
    await start();
    assert.equal((await api("play-from-here", { zone_or_output_id: WIIM, queue_item_id: 3 })).status, 200);
    await until(async () => (await title()) === "Song 3");
    assert.equal((await api("queue/move", { zone_or_output_id: WIIM, queue_item_ids: [1] })).status, 200);
    const r = await api("control", { zone_or_output_id: WIIM, command: "next" });
    assert.equal(r.status, 200, "Song 2 hasn't played: " + JSON.stringify(r));
    await until(async () => (await title()) === "Song 2");
  });
});
