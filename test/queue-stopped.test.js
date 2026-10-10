"use strict";
/*
 * Queue and Play next on a zone that isn't playing (v0.8.34): a queue with
 * music in it isn't cleared, and isn't started — what's added joins it. Only
 * a queue that was empty is started, as before. While music plays, as before.
 *
 * Before, a Sonos room stopped, or not on its queue (another source, or a
 * while stopped), had its queue replaced by an album queued to it, and that
 * played; a stopped one on its queue jumped to it and played; a renderer or
 * the phone stopped did the same.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { FakeRenderer } = require("./fake-renderer");
const { signIn } = require("./auth-helper");
const { idFor } = require("../lib/renderers/discovery");

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

test("Queue and Play next on a zone that isn't playing: added to what's there, nothing replaced or started", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro" });
  await wiim.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [wiim.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); await wiim.stop(); });
  const token = await signIn(B);
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => (await api("status")).index_count === 3);
  const kitchen = (await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"))).zone_id;
  const albums = (await api("library/albums?sort=album")).albums;
  const one = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");
  const room = house.room("Kitchen");

  await t.test("a Sonos room: stopped, paused or not on its queue, its queue kept and not started; an empty one started", async () => {
    // What's in the queue, as each case starts: Album One, three tracks, on track 1.
    const setUp = async (state, onQueue) => {
      assert.equal((await api("play", { offset: one.offset, zone_or_output_id: kitchen, kind: "play_now" })).status, 200);
      await until(() => room.queue.length === 3 && room.state === "PLAYING");
      room.state = state;
      if (!onQueue) room.currentUri = "";
      // The server polls the room once a second: it has seen how it is now.
      await sleep(2500);
    };
    const titles = () => room.queue.map(q => /<dc:title>([^<]*)</.exec(q.meta)[1]);
    for (const [state, onQueue, how] of [["STOPPED", true, "queue"], ["PAUSED_PLAYBACK", true, "queue"], ["STOPPED", false, "queue"],
      ["STOPPED", true, "play_next"], ["STOPPED", false, "play_next"]]) {
      await setUp(state, onQueue);
      assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: kitchen, kind: how })).status, 200);
      await sleep(800);
      const what = `${how}, ${state.toLowerCase()}${onQueue ? "" : ", not on its queue"}`;
      assert.equal(room.queue.length, 5, what + ": added to the three there, none taken away");
      assert.deepEqual(titles().filter(x => /^Song/.test(x)), ["Song 1", "Song 2", "Song 3"], what + ": the queue there kept");
      assert.notEqual(room.state, "PLAYING", what + ": not started");
    }
    // An empty queue: started, as before.
    await api("queue/clear", { zone_or_output_id: kitchen });
    await until(() => room.queue.length === 0);
    room.state = "STOPPED";
    await sleep(2500);
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: kitchen, kind: "queue" })).status, 200);
    await until(() => room.state === "PLAYING" && room.queue.length === 2);
  });

  await t.test("a renderer stopped with a queue: what's added joins it, nothing plays", async () => {
    const WIIM = idFor(wiim.udn);
    await until(async () => (await api("audio-devices")).devices.some(d => d.id === WIIM), 20000);
    assert.equal((await call("PATCH", "audio-devices/" + WIIM, { enabled: true })).status, 200);
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: WIIM, kind: "play_now" })).status, 200);
    await until(async () => { const z = (await api("zone-state?zone=" + WIIM)).zone; return z && z.state === "playing"; });
    assert.equal((await api("control", { zone_or_output_id: WIIM, command: "stop" })).status, 200);
    await until(async () => (await api("zone-state?zone=" + WIIM)).zone.state === "stopped");
    const sets = wiim.log.filter(a => a === "SetAVTransportURI").length;
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: WIIM, kind: "queue" })).status, 200);
    await sleep(800);
    assert.deepEqual((await api("queue?zone=" + WIIM)).items.map(i => i.title), ["Song 1", "Song 2", "Song 3", "Hi 1", "Hi 2"], "joined the queue");
    assert.equal(wiim.log.filter(a => a === "SetAVTransportURI").length, sets, "nothing started");
    assert.equal(wiim.state, "STOPPED");
  });

  await t.test("the phone stopped with a queue: told to insert, not to play", async () => {
    const h = await api("phone/hello", { name: "Pixel 8" });
    const phoneZone = h.zone_id;
    let seq = h.seq;
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: phoneZone, kind: "play_now" })).status, 200);
    await api("phone/state", { index: 0, position: 0, duration: 60, state: "stopped", volume: 40 });
    seq = (await api(`phone/commands?after=${seq}`)).seq;
    assert.equal((await api("play", { offset: hi.offset, zone_or_output_id: phoneZone, kind: "queue" })).status, 200);
    const got = await api(`phone/commands?after=${seq}`);
    const ins = got.commands.find(c => c.op === "insert");
    assert.ok(ins, "an insert: " + JSON.stringify(got.commands));
    assert.equal(ins.at, 3, "after the three there");
    assert.equal(ins.play, false, "not started");
  });
});
