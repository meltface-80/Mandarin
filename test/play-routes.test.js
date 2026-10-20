"use strict";
/*
 * play-routes.test.js — the playback routes no test called before (v0.9.1,
 * the audit's T1, old/audit-b4-main.md), each against a fake Sonos
 * household, the speaker's own queue read for what was put on it:
 *   POST /api/play-multi               several albums at once, in order
 *   POST /api/queue/play-history-next  a track played before, found by its names, next
 *   POST /api/queue/history-multi      several of them, the ones not in the library said
 *   GET  /api/shortcut/play-unheard    the shortcut's Random Album, to the room asked for
 *   POST /api/output/standby, /api/output/convenience-switch   what a Sonos room hasn't
 *   POST /api/playlist/play, /api/playlist/play-track, GET /api/playlist/art   gone since v0.6
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { built } = require("./server");
const { started, until } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("several albums, tracks played before, the shortcut's Random Album: on the speaker's queue as asked", { skip, timeout: 120000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { api, album, base, H } = await started(t, { sonosHosts: [ports.host(0)] });
  const zones = await until(async () => { const z = (await api("zones")).json; return z && z.zones.length === 2 && z.zones; }, 30000, "the two rooms");
  const kitchen = zones.find(z => z.display_name === "Kitchen").zone_id;
  const room = house.room("Kitchen");
  const titles = () => room.queue.map(q => /<dc:title>([^<]*)/.exec(q.meta)[1]);
  const one = await album("Album One"), hires = await album("Hi Res");

  // Several albums, in the order given; one no longer there, counted.
  let r = await api("play-multi", { offsets: [hires.offset, one.offset, 987654], zone_or_output_id: kitchen, kind: "play_now" });
  assert.deepEqual(r, { status: 200, json: { ok: true, queued: 2, failed: 1, total: 3, first_error: "Some albums are no longer in the library" } });
  await until(() => room.queue.length === 5 && room.track === 1, 15000, "the queue on the speaker");
  assert.deepEqual(titles(), ["Hi 1", "Hi 2", "Song 1", "Song 2", "Song 3"]);
  assert.deepEqual((await api("play-multi", { offsets: [], zone_or_output_id: kitchen, kind: "play_now" })).json, { error: "offsets required" });

  // A track played before, found by its names: next, after the one playing.
  r = await api("queue/play-history-next", { zone_or_output_id: kitchen, album: "Album One", artist: "Artist A", track: "Song 3" });
  assert.deepEqual(r, { status: 200, json: { ok: true, track: "Song 3" } });
  await until(() => room.queue.length === 6, 15000, "the track played next");
  assert.deepEqual(titles(), ["Hi 1", "Song 3", "Hi 2", "Song 1", "Song 2", "Song 3"]);
  assert.deepEqual(await api("queue/play-history-next", { zone_or_output_id: kitchen, album: "Elsewhere", artist: "Nobody", track: "Not Here" }),
    { status: 404, json: { error: "Not in your library", unresolved: true } });

  // Several of them, at the end; the one not in the library said, by its name.
  r = await api("queue/history-multi", { zone_or_output_id: kitchen, kind: "queue", tracks: [
    { album: "Hi Res", artist: "Artist B", track: "Hi 2" }, { album: "Elsewhere", artist: "Nobody", track: "Not Here" }, { album: "Album One", artist: "Artist A", track: "Song 1" }] });
  assert.deepEqual(r, { status: 200, json: { ok: true, queued: 2, unresolved: ["Not Here"], failed: [] } });
  await until(() => room.queue.length === 8, 15000, "the tracks at the end");
  assert.deepEqual(titles().slice(6), ["Hi 2", "Song 1"]);

  // The shortcut's Random Album (an album not heard in a year; here, any): played now, in the room asked for.
  const sc = await fetch(base + "/api/shortcut/play-unheard?zone=" + encodeURIComponent(kitchen), { headers: H });
  const picked = await sc.json();
  assert.equal(sc.status, 200, JSON.stringify(picked));
  assert.equal(picked.ok, true);
  const want = { "Album One": ["Song 1", "Song 2", "Song 3"], "Hi Res": ["Hi 1", "Hi 2"], "Best Of": ["C1", "C2"] }[picked.album.title];
  assert.ok(want, "an album of the library: " + picked.album.title);
  await until(() => titles().join() === want.join() && room.track === 1, 15000, "the picked album on the speaker");
});

test("what a Sonos room hasn't, and the playlist routes gone since v0.6: said, nothing played", { skip, timeout: 120000 }, async (t) => {
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  const { api, base, H } = await started(t, { sonosHosts: [ports.host(0)] });
  const zones = await until(async () => { const z = (await api("zones")).json; return z && z.zones.length === 2 && z.zones; }, 30000, "the two rooms");
  const kitchen = zones.find(z => z.display_name === "Kitchen");
  const output = kitchen.outputs[0].output_id;
  assert.deepEqual(await api("output/standby", { output_id: output }), { status: 501, json: { error: "Sonos rooms have no standby control" } });
  assert.deepEqual(await api("output/convenience-switch", { output_id: output }), { status: 501, json: { error: "Sonos rooms have no source switch" } });
  assert.deepEqual(await api("playlist/play", { id: "p1", zone_or_output_id: kitchen.zone_id }), { status: 404, json: { error: "No such playlist" } });
  assert.deepEqual(await api("playlist/play-track", { id: "p1", index: 0, zone_or_output_id: kitchen.zone_id }), { status: 404, json: { error: "No such playlist" } });
  const art = await fetch(base + "/api/playlist/art?id=p1", { headers: H });
  assert.equal(art.status, 404);
  assert.equal(art.headers.get("x-mandarin-answered"), "C#");
  assert.equal(house.room("Kitchen").queue.length, 0, "nothing put on the speaker");
});
