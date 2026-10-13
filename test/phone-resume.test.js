"use strict";
/*
 * phone-resume.test.js — the app installed over itself (v0.9.5, Phones.Hello):
 * its player starts empty and says hello, and is handed back the list it was
 * last playing. Until v0.9.5 that was always the server's queue, even when the
 * phone had since played a list of its own (a download, the phone's music):
 * the app showed an album from earlier in the day, and played it. Now the
 * phone's own list comes back when the server can name its tracks, and
 * nothing does when it can't; across a server restart too.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg } = require("./fixtures");
const { built } = require("./server");
const { started, until } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("hello after a reinstall: the list the phone last played comes back, not the server's older queue", { skip, timeout: 120000 }, async (t) => {
  const { base, H, srv, ctx, api } = await started(t);
  const call = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: Object.assign({}, H, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const hello = () => call("POST", "/api/phone/hello", { name: "Pixel 8" });
  const albums = (await api("library/albums?sort=album")).json.albums;
  const [older, later] = albums;
  assert.ok(older && later && older.offset !== later.offset, "two albums");
  const zoneId = (await hello()).zone_id;
  let seq = 0;
  /** The album played on the phone through the server: the tracks it is handed. */
  const play = async (a) => {
    await call("POST", "/api/play", { offset: a.offset, zone_or_output_id: zoneId, kind: "play_now" });
    const got = await call("GET", `/api/phone/commands?after=${seq}`);
    seq = got.seq;
    const load = got.commands.find(c => c.op === "load");
    assert.ok(load, JSON.stringify(got.commands));
    return load.items;
  };
  const laterItems = await play(later);
  assert.ok(laterItems.length >= 2 && laterItems.every(i => i.track_id > 0), JSON.stringify(laterItems));
  // Earlier in the day: an album played through the server, which keeps it as the phone's queue.
  const olderItems = await play(older);
  await call("POST", "/api/phone/state", { index: 0, position: 3, duration: 60, state: "playing", volume: 40 });
  // Then a list of the phone's own: the later album, downloaded, its tracks named by the server's ids.
  const own = laterItems.map(i => ({ title: i.title, artist: i.artist, album: i.album, duration: i.duration, ext: "flac", track_id: i.track_id }));
  await call("POST", "/api/phone/state", { index: 1, position: 30, duration: 60, state: "paused", volume: 40, local: true, local_rev: 1, local_items: own });

  await t.test("the phone's own list, named by the server's ids, is handed back at its place", async () => {
    const h = await hello();
    assert.ok(h.resume, "a list handed back");
    assert.deepEqual(h.resume.items.map(i => i.track_id), laterItems.map(i => i.track_id), "the later album, not the older one (" + olderItems.map(i => i.title) + ")");
    assert.equal(h.resume.index, 1);
    assert.ok(Math.abs(h.resume.seconds - 30) < 2, String(h.resume.seconds));
    assert.equal(h.resume.play, false);
    seq = h.seq;
    // The zone shows that list until the app reports, and its queue is that list.
    const st = await call("GET", "/api/zone-state?zone=" + zoneId);
    assert.equal(st.zone.state, "paused");
    assert.equal(st.zone.now_playing.line1, laterItems[1].title);
    const q = await call("GET", "/api/queue?zone=" + zoneId);
    assert.deepEqual(q.items.map(i => i.title), laterItems.slice(1).map(i => i.title));
    // The app loads it and reports from it as the server's queue.
    await call("POST", "/api/phone/state", { index: 1, position: 31, duration: 60, state: "paused", volume: 40 });
    assert.equal((await call("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.line1, laterItems[1].title);
  });

  await t.test("a list the server can't name (the phone's own music): nothing is handed back", async () => {
    await play(older);
    await call("POST", "/api/phone/state", { index: 0, position: 3, duration: 60, state: "playing", volume: 40 });
    const music = [
      { title: "Opening", artist: "Someone", album: "A Purchase", image_key: "phone-abc123", album_key: "abc123", duration: 200, ext: "flac" },
      { title: "Closing", artist: "Someone", album: "A Purchase", image_key: "phone-abc123", album_key: "abc123", duration: 180, ext: "flac" }
    ];
    await call("POST", "/api/phone/state", { index: 1, position: 12, duration: 180, state: "playing", volume: 40, local: true, local_rev: 2, local_items: music });
    const h = await hello();
    assert.equal(h.resume, null, "not the older album: " + JSON.stringify(h.resume && h.resume.items.map(i => i.title)));
    seq = h.seq;
    const st = await call("GET", "/api/zone-state?zone=" + zoneId);
    assert.notEqual(st.zone.now_playing && st.zone.now_playing.line3, older.title);
  });

  await t.test("the server restarted while the phone played its own list: that list is what it keeps", async () => {
    await play(older);
    await call("POST", "/api/phone/state", { index: 0, position: 3, duration: 60, state: "playing", volume: 40 });
    await call("POST", "/api/phone/state", { index: 1, position: 20, duration: 60, state: "playing", volume: 40, local: true, local_rev: 3, local_items: own });
    // The store writes after a moment: what it kept, before the server goes.
    await until(async () => {
      const r = ctx.db.raw.prepare("SELECT value FROM settings WHERE key = ?").get("queue:" + zoneId);
      const k = r && JSON.parse(r.value);
      return k && k.index === 1 && k.state === "playing";
    }, 15000, "the store to keep the phone's list");
    await srv.stop();
    await srv.start();
    await until(async () => (await call("GET", "/api/status")).status === 200, 30000, "the server back");
    const h = await hello();
    assert.ok(h.resume, "a list handed back");
    assert.deepEqual(h.resume.items.map(i => i.track_id), laterItems.map(i => i.track_id), "the phone's list, not the older album");
    assert.equal(h.resume.index, 1);
  });
});
