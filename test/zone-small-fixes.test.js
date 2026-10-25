"use strict";
/*
 * Three small things about rooms and renderers (item 187). A renderer's ✓
 * (the device says it plays what it was sent) stays for the track, where it
 * vanished at the next read a second on. Moving what plays from a queue with
 * something in it that isn't the library's starts at the same track, where
 * it started one on. And a volume nudged before the volume was read goes
 * from where the device is, not from nought.
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

test("a renderer's ✓, a move from a queue with a stranger in it, a nudge of an unread volume", { skip, timeout: 150000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const room = house.room("Kitchen");
  const wiim = new FakeRenderer({ name: "WiiM Pro Plus", manufacturer: "Linkplay Technology Inc.", model: "WiiM Pro Plus", linkplay: { DeviceName: "Living Room WiiM" } });
  await wiim.start();
  // Neither says its volume until the test lets it: the server has never read it.
  let volumesRead = false;
  for (const d of [room, wiim]) {
    const handle = d.handle.bind(d);
    d.handle = (action, a) => { if (action === "GetVolume" && !volumesRead) throw 501; return handle(action, a); };
  }
  const { createServer } = require("./server");
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
  const state = async (zone) => (await api("zone-state?zone=" + zone)).zone;
  await until(async () => (await api("status")).index_count === 3);
  const kitchen = (await until(async () => (await api("zones")).zones.find(z => z.display_name === "Kitchen"))).zone_id;
  const WIIM = idFor(wiim.udn);
  await until(async () => (await api("audio-devices")).devices.some(d => d.id === WIIM), 20000);
  assert.equal((await call("PATCH", "audio-devices/" + WIIM, { enabled: true })).status, 200);
  await until(async () => (await api("zones")).zones.some(z => z.zone_id === WIIM), 20000);
  const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
  const idIn = (uri) => (/\/stream\/t(\d+)\./.exec(uri) || [])[1];

  await t.test("a volume nudged before it was read: from where the device is", async () => {
    // A Sonos room at 20: up 5 is 25 (the room's own relative step), not 5.
    assert.equal(room.volume, 20);
    assert.equal((await api("volume", { output_id: kitchen, how: "relative", value: 5 })).status, 200);
    assert.equal(room.volume, 25, "nudged from 20");
    // A renderer at 25 that can't say where it is: nothing guessed (before, down 5 from "nought" was silence)…
    assert.equal(wiim.volume, 25);
    const r = await api("volume", { output_id: WIIM, how: "relative", value: -5 });
    assert.ok(r.status >= 400, JSON.stringify(r));
    assert.equal(wiim.volume, 25, "left where it was");
    // …and once it can, down 5 from 25.
    volumesRead = true;
    assert.equal((await api("volume", { output_id: WIIM, how: "relative", value: -5 })).status, 200);
    assert.equal(wiim.volume, 20);
  });

  await t.test("moved from a queue with something not the library's before the track playing: the same track", async () => {
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: kitchen, kind: "play_now" })).status, 200);
    await until(() => room.queue.length === 3 && room.state === "PLAYING");
    assert.equal((await api("play-from-here", { zone_or_output_id: kitchen, queue_item_id: 2 })).status, 200);
    room.handle("Pause", {});
    const song2 = idIn(room.queue[1].uri);
    // Something from elsewhere (the Sonos app's own) at the head of the queue: Song 2 is the third of four.
    room.queue.unshift({ uri: "x-sonos-http:elsewhere.mp3", meta: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="x"><dc:title>Elsewhere</dc:title></item></DIDL-Lite>' });
    room.track = 3;
    await until(async () => { const z = await state(kitchen); return z.state === "paused" && z.queue_items_remaining === 1 && z.now_playing.line1 === "Song 2"; });
    const r = await api("transfer-zone", { from: kitchen, to: WIIM });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.equal(idIn(wiim.uri), song2, "Song 2, not the one after it: " + wiim.uri);
    const q = await api("queue?zone=" + WIIM);
    assert.deepEqual(q.history.map(i => i.track).concat(q.items.map(i => i.title)), ["Song 1", "Song 2", "Song 3"]);
  });

  await t.test("the renderer's ✓ stays for the track", async () => {
    wiim.release();
    assert.equal((await api("play", { offset: one.offset, zone_or_output_id: WIIM, kind: "play_now" })).status, 200);
    await until(() => wiim.state === "PLAYING" && wiim.pos() >= 2.2, 10000);
    wiim.hold();
    await until(async () => { const z = await state(WIIM); return /✓/.test(z.now_playing.format.text); }, 15000);
    // Read again, a few times over (it is read every second while looked at).
    for (let i = 0; i < 6; i++) {
      await sleep(500);
      const z = await state(WIIM);
      assert.match(z.now_playing.format.text, /✓/, "still verified at the read " + i);
    }
  });
});
