"use strict";
/*
 * The phone playing a list of its own (item 186): its downloads, or its own
 * music, held by the app's player. The page shows that list as the queue;
 * the server's queue for the phone is still there behind it, not playing.
 * What the page does to the queue is done to the list the phone plays, or
 * said plainly that it can't be: Remove and Play next were done to the queue
 * behind it (and the app, rightly, dropped them), and Move to another room
 * sent that queue, not what was playing.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
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

test("the phone playing its own list: the queue's actions act on that list, or say they can't", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const wiim = new FakeRenderer({ name: "WiiM", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro" });
  await wiim.start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)],
    upnpHosts: [wiim.location], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(async () => { await srv.stop(); await house.stop(); await wiim.stop(); });
  const token = await signIn(B);   // the Android app's kind
  const call = async (method, p, body) => {
    const r = await fetch(B + "/api/" + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const api = (p, body) => call(body ? "POST" : "GET", p, body);
  await until(async () => (await api("status")).index_count === 3);
  const kitchen = (await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"))).zone_id;
  const room = house.room("Kitchen");
  const roomTitles = () => room.queue.map(q => /<dc:title>([^<]*)</.exec(q.meta)[1]);
  const albums = (await api("library/albums?sort=album")).albums;
  const one = albums.find(a => a.title === "Album One");

  const h = await api("phone/hello", { name: "Pixel 8" });
  const PHONE = h.zone_id;
  let seq = h.seq;
  // The server's queue for the phone: Album One, Song 1 to 3 — which names the tracks' ids.
  assert.equal((await api("play", { offset: one.offset, zone_or_output_id: PHONE, kind: "play_now" })).status, 200);
  const load = (await api(`phone/commands?after=${seq}`)).commands.find(c => c.op === "load");
  const id = Object.fromEntries(load.items.map(it => [it.title, it.track_id]));
  const report = (local, index = 1) => api("phone/state", { index, position: 5, duration: 3, state: "playing", volume: 40, local: true, local_rev: Date.now(), local_items: local });
  const tune = (title) => ({ title, artist: "Artist A", album: "Album One", duration: 3, track_id: id[title] });
  // Behind it, what the server keeps: the queue as the phone would go back to it.
  const serverQueue = async () => {
    await api("phone/state", { index: 0, position: 0, duration: 3, state: "paused", volume: 40 });
    const q = await api("queue?zone=" + PHONE);
    return q.history.map(i => i.track).concat(q.items.map(i => i.title));
  };
  const commandsSince = async (after) => (await api(`phone/commands?after=${after}`)).commands;

  await t.test("Remove on the phone's own list: refused in words, the queue behind it untouched", async () => {
    await report([tune("Song 3"), tune("Song 1"), { title: "Bought", artist: "Someone", album: "Elsewhere", duration: 200 }]);
    seq = (await api(`phone/commands?after=0`)).seq;
    const r = await api("queue/remove", { zone_or_output_id: PHONE, queue_item_ids: [3] });
    assert.equal(r.status, 409, JSON.stringify(r));
    assert.match(r.error, /its own/);
    assert.deepEqual((await commandsSince(seq)).filter(c => c.op === "remove"), [], "nothing the app would drop sent");
    assert.deepEqual(await serverQueue(), ["Song 1", "Song 2", "Song 3"]);
  });

  await t.test("Play next on the phone's own list: refused in words, the queue behind it untouched", async () => {
    await report([tune("Song 3"), tune("Song 1"), tune("Song 2")], 0);
    seq = (await api(`phone/commands?after=0`)).seq;
    const r = await api("queue/move", { zone_or_output_id: PHONE, queue_item_ids: [3] });
    assert.equal(r.status, 409, JSON.stringify(r));
    assert.match(r.error, /its own/);
    assert.deepEqual((await commandsSince(seq)).filter(c => c.op === "remove" || c.op === "insert"), []);
    assert.deepEqual(await serverQueue(), ["Song 1", "Song 2", "Song 3"]);
  });

  await t.test("Move to a Sonos room: what the phone is playing, from where it is", async () => {
    await report([tune("Song 3"), tune("Song 1")], 1);
    const r = await api("transfer-zone", { from: PHONE, to: kitchen });
    assert.equal(r.status, 200, JSON.stringify(r));
    await until(() => room.queue.length === 2 && room.state === "PLAYING");
    assert.deepEqual(roomTitles(), ["Song 3", "Song 1"], "the phone's list, not the queue behind it");
    assert.equal(room.track, 2, "from Song 1, where the phone was");
    await api("control", { zone_or_output_id: kitchen, command: "stop" });
  });

  await t.test("Move to a renderer: the same", async () => {
    const WIIM = idFor(wiim.udn);
    await until(async () => (await api("audio-devices")).devices.some(d => d.id === WIIM), 20000);
    assert.equal((await call("PATCH", "audio-devices/" + WIIM, { enabled: true })).status, 200);
    await until(async () => (await api("zones")).zones.some(z => z.zone_id === WIIM), 20000);
    await report([tune("Song 3"), tune("Song 1")], 1);
    const r = await api("transfer-zone", { from: PHONE, to: WIIM });
    assert.equal(r.status, 200, JSON.stringify(r));
    const q = await until(async () => { const x = await api("queue?zone=" + WIIM); return x.items.length + x.history.length === 2 && x; });
    assert.deepEqual(q.history.map(i => i.track).concat(q.items.map(i => i.title)), ["Song 3", "Song 1"]);
    assert.equal(q.items[0].title, "Song 1", "from where the phone was");
    await api("control", { zone_or_output_id: WIIM, command: "stop" });
  });

  await t.test("Move with the phone's own music in the list: refused in words, nothing sent", async () => {
    await report([tune("Song 3"), { title: "Bought", artist: "Someone", album: "Elsewhere", duration: 200 }], 0);
    const before = room.log.filter(a => /Queue/.test(a)).length;
    const r = await api("transfer-zone", { from: PHONE, to: kitchen });
    assert.equal(r.status, 409, JSON.stringify(r));
    assert.match(r.error, /isn't in the library/);
    assert.equal(room.log.filter(a => /Queue/.test(a)).length, before, "the Kitchen's queue untouched");
  });
});
