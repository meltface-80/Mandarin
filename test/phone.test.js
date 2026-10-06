"use strict";
/*
 * The Android app as a player: it says hello, shows up as a zone ("This
 * phone") to itself only, and everything its interface does to a room —
 * play an album, pause, skip, queue, volume, move what's playing — reaches it
 * as commands. What it reports back drives now playing and the play history.
 * No other device (the iPhone home-screen app, a browser) sees it or reaches it.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3603;
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 8000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 100));
  }
}

test("the phone is a zone", { skip, timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const options = { port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: ["127.0.0.11"] };
  let srv = createServer(options);
  let ctx = await srv.start();
  const phoneToken = await signIn(B);                 // kind "android"
  const otherToken = await (async () => {           // a browser on another device
    const SRP = require("../public/srp");
    const { post } = require("./auth-helper");
    const ch = await post(B, "/api/auth/challenge", { username: "tester" });
    const s = SRP.clientStart();
    const p = SRP.clientProof("tester", "correct horse battery staple", ch.salt, ch.iterations, s, ch.B);
    return (await post(B, "/api/auth/verify", { id: ch.id, A: s.A, M1: p.M1, want_token: true, kind: "browser", device_name: "iPad" })).token;
  })();
  const call = async (token, method, p, body) => {
    const r = await fetch(B + p, { method, headers: Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ status: r.status }, await r.json().catch(() => ({})));
  };
  const phone = (m, p, b) => call(phoneToken, m, p, b);
  const other = (m, p, b) => call(otherToken, m, p, b);

  try {
    await until(async () => (await other("GET", "/api/status")).index_count === 3);
    await until(async () => (await other("GET", "/api/zones")).zones.filter(z => !z.is_phone).length === 2);

    let zoneId, seq = 0;
    await t.test("only the Android app can be a phone, and it says hello", async () => {
      assert.equal((await other("POST", "/api/phone/hello", { name: "iPad" })).status, 403);
      const h = await phone("POST", "/api/phone/hello", { name: "Pixel 8" });
      assert.deepEqual(h.dsp, { enabled: false, headphone: null, peq: null, headroom: "auto" }, "the phone's DSP, off to begin with");
      zoneId = h.zone_id;
      assert.match(zoneId, /^PHONE_/);
      seq = h.seq;
    });

    await t.test("'This phone' to itself; to another device at home, a player under its own name", async () => {
      const mine = (await phone("GET", "/api/zones")).zones.find(z => z.zone_id === zoneId);
      assert.equal(mine.display_name, "This phone");
      assert.equal(mine.is_phone, true);
      const seen = (await other("GET", "/api/zones")).zones.find(z => z.zone_id === zoneId);
      assert.ok(seen, "listed for another device at home");
      assert.equal(seen.display_name, "Pixel 8");
      assert.equal(seen.outputs[0].display_name, "Pixel 8");
      assert.ok((await other("GET", "/api/shortcut/zones")).zones.some(z => z.zone_id === zoneId && z.display_name === "Pixel 8"));
      assert.ok(!(await phone("GET", "/api/outputs")).outputs.some(o => o.output_id === zoneId), "not offered for Sonos grouping");
      assert.equal((await other("GET", "/api/zone-state?zone=" + zoneId)).status, 200);
      // Played to from the other device: the phone's player is handed the album.
      const cd0 = (await other("GET", "/api/library/albums?sort=album")).albums[0];
      assert.equal((await other("POST", "/api/play", { offset: cd0.offset, zone_or_output_id: zoneId, kind: "play_now" })).status, 200);
      assert.equal((await other("POST", "/api/control", { zone_or_output_id: zoneId, command: "pause" })).status, 200);
      const got = await phone("GET", `/api/phone/commands?after=${seq}`);
      assert.deepEqual(got.commands.map(c => c.op), ["load", "pause"]);
      seq = got.seq;
    });

    await t.test("hidden from others while the phone is away, or while its switch is off", async () => {
      const TAILNET = { "X-Forwarded-For": "100.101.102.103" };
      const awayCall = (m, p) => fetch(B + p, { method: m, headers: Object.assign({ Authorization: "Bearer " + phoneToken }, TAILNET) }).then(r => r.json());
      // The phone checks in from away: others no longer see it, nor reach it.
      await awayCall("GET", `/api/phone/commands?after=${seq}`);
      assert.ok(!(await other("GET", "/api/zones")).zones.some(z => z.zone_id === zoneId), "away: hidden");
      assert.equal((await other("POST", "/api/control", { zone_or_output_id: zoneId, command: "play" })).status, 403);
      // Home again: back on the list.
      await phone("GET", `/api/phone/commands?after=${seq}`);
      assert.ok((await other("GET", "/api/zones")).zones.some(z => z.zone_id === zoneId), "home: listed again");
      // Its switch off (Audio Devices → the phone): only the phone sees itself.
      ctx.devices.syncKnown();
      const off = await other("PATCH", "/api/audio-devices/" + zoneId, { shared: false });
      assert.equal(off.status, 200);
      assert.equal(off.shared, false);
      assert.ok(!(await other("GET", "/api/zones")).zones.some(z => z.zone_id === zoneId), "switched off: hidden");
      assert.equal((await other("POST", "/api/control", { zone_or_output_id: zoneId, command: "play" })).status, 403);
      assert.ok((await phone("GET", "/api/zones")).zones.some(z => z.zone_id === zoneId && z.display_name === "This phone"), "itself, always");
      assert.equal((await other("PATCH", "/api/audio-devices/" + zoneId, { shared: true })).shared, true);
      assert.ok((await other("GET", "/api/zones")).zones.some(z => z.zone_id === zoneId));
      // Only a phone has the switch.
      const room = (await other("GET", "/api/audio-devices")).devices.find(d => d.kind === "sonos");
      assert.equal((await other("PATCH", "/api/audio-devices/" + room.id, { shared: false })).status, 400);
    });

    const albums = (await other("GET", "/api/library/albums?sort=album")).albums;
    const cd = albums.find(a => a.title === "Album One");

    await t.test("Play Now on the phone reaches its player as a load", async () => {
      const waiting = phone("GET", `/api/phone/commands?after=${seq}&wait=5000`);
      const r = await phone("POST", "/api/play", { offset: cd.offset, zone_or_output_id: zoneId, kind: "play_now" });
      assert.equal(r.status, 200);
      const got = await waiting;
      const load = got.commands.find(c => c.op === "load");
      assert.ok(load, JSON.stringify(got));
      assert.equal(load.items.length, 3);
      assert.equal(load.items[0].title, "Song 1");
      assert.match(load.items[0].url, /\/stream\/t\d+\.flac\?s=/);
      assert.match(load.items[0].art_url, /\/api\/image\/.*s=/);
      seq = got.seq;
      // The phone can fetch it (signed, and with its token anyway).
      const audio = await fetch(load.items[0].url, { headers: { Authorization: "Bearer " + phoneToken } });
      assert.equal(audio.status, 200);
      assert.equal(audio.headers.get("content-type"), "audio/flac");
    });

    await t.test("Play something unheard plays on the zone, however the page names it", async () => {
      // The page sent { zone } while the server read only zone_or_output_id (v0.6.0-RC1's bug).
      for (const body of [{ zone: zoneId }, { zone_or_output_id: zoneId }]) {
        const waiting = phone("GET", `/api/phone/commands?after=${seq}&wait=5000`);
        const r = await phone("POST", "/api/play-unheard", body);
        assert.equal(r.status, 200, JSON.stringify(r));
        assert.ok(r.album && r.album.title, JSON.stringify(r));
        const got = await waiting;
        assert.ok(got.commands.some(c => c.op === "load"), JSON.stringify(got));
        seq = got.seq;
      }
      assert.equal((await phone("POST", "/api/play-unheard", {})).status, 400);
      // The queue the next steps expect, back as it was.
      const waiting = phone("GET", `/api/phone/commands?after=${seq}&wait=5000`);
      await phone("POST", "/api/play", { offset: cd.offset, zone_or_output_id: zoneId, kind: "play_now" });
      seq = (await waiting).seq;
    });

    await t.test("what the phone reports is now playing, and becomes history", async () => {
      await phone("POST", "/api/phone/state", { index: 1, position: 31, duration: 60, state: "playing", volume: 40 });
      const st = await phone("GET", "/api/zone-state?zone=" + zoneId);
      assert.equal(st.zone.state, "playing");
      assert.equal(st.zone.now_playing.line1, "Song 2");
      assert.equal(st.zone.now_playing.line3, "Album One");
      assert.equal(st.zone.outputs[0].volume.value, 40);
      // The format badge: the file as it is (lossless) until the phone says Opus.
      assert.deepEqual(st.zone.now_playing.format, { kind: "lossless", text: "Lossless" });
      await phone("POST", "/api/phone/state", { index: 1, position: 32, duration: 60, state: "playing", volume: 40, format: "opus" });
      const opus = await phone("GET", "/api/zone-state?zone=" + zoneId);
      assert.deepEqual(opus.zone.now_playing.format, { kind: "opus", text: "256kbps" });
      const played = ctx.db.raw.prepare("SELECT * FROM plays WHERE zone = ? OR title = 'Song 2'").all("Pixel 8");
      assert.ok(played.length >= 1, "the play was recorded");
      const q = await phone("GET", "/api/queue?zone=" + zoneId);
      assert.deepEqual(q.items.map(i => i.title), ["Song 2", "Song 3"]);
      assert.deepEqual(q.history.map(i => i.track), ["Song 1"]);
    });

    await t.test("transport, queue and volume become commands", async () => {
      await phone("POST", "/api/control", { zone_or_output_id: zoneId, command: "pause" });
      await phone("POST", "/api/seek", { zone_or_output_id: zoneId, how: "absolute", seconds: 1 });
      await phone("POST", "/api/volume", { output_id: zoneId, how: "absolute", value: 25 });
      await phone("POST", "/api/play", { offset: cd.offset, zone_or_output_id: zoneId, kind: "queue" });
      const got = await phone("GET", `/api/phone/commands?after=${seq}`);
      const ops = got.commands.map(c => c.op);
      assert.deepEqual(ops, ["pause", "seek", "volume", "insert"]);
      assert.equal(got.commands[3].at, 3);
      assert.equal(got.commands[3].items.length, 3);
      seq = got.seq;
      assert.equal((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.state, "paused");
    });

    await t.test("the phone's DSP: saved on its page, sent to the app, shown on the badge", async () => {
      // The register learns of the phone within ten seconds of its hello;
      // its page in Audio Devices takes the setting like a renderer's.
      const dev = await until(async () => { const j = await phone("GET", "/api/audio-devices/" + zoneId); return j.status === 200 && j; }, 15000);
      assert.equal(dev.kind, "phone");
      assert.equal(dev.dsp.enabled, false);
      const r = await phone("PATCH", "/api/audio-devices/" + zoneId, { dsp: { enabled: true, peq: { bands: [{ type: "low_shelf", freq: 100, gain: 3, q: 0.707 }] } } });
      assert.equal(r.status, 200, JSON.stringify(r));
      assert.equal(r.dsp_info.active, true);
      // The app hears of it as a command carrying the whole setting.
      const got = await phone("GET", `/api/phone/commands?after=${seq}`);
      const cmd = got.commands.find(c => c.op === "dsp");
      assert.ok(cmd, JSON.stringify(got));
      assert.equal(cmd.dsp.enabled, true);
      assert.equal(cmd.dsp.peq.bands[0].freq, 100);
      seq = got.seq;
      // Volume Levelling is the phone's own too (v0.6.0-RC7): the app is told, and the hello carries it.
      assert.deepEqual(dev.levelling, { mode: "off", target: -14, unknown: -5 });
      const lv = await phone("PATCH", "/api/audio-devices/" + zoneId, { levelling: { mode: "auto", target: -16 } });
      assert.equal(lv.status, 200, JSON.stringify(lv));
      const got2 = await phone("GET", `/api/phone/commands?after=${seq}`);
      const rg = got2.commands.find(c => c.op === "replaygain");
      assert.deepEqual(rg && rg.replaygain, { mode: "auto", target: -16, unknown: -5 }, JSON.stringify(got2));
      seq = got2.seq;
      assert.deepEqual((await phone("POST", "/api/phone/hello", { name: "Pixel 8" })).replaygain, { mode: "auto", target: -16, unknown: -5 });
      // And a fresh hello carries it too.
      assert.equal((await phone("POST", "/api/phone/hello", { name: "Pixel 8" })).dsp.peq.bands.length, 1);
      // Changed on the phone while offline: the hello brings it, and the server keeps it.
      const offline = await phone("POST", "/api/phone/hello", { name: "Pixel 8", dsp: { enabled: true, peq: { bands: [
        { type: "peak", freq: 1000, gain: -2, q: 1 }, { type: "high_shelf", freq: 8000, gain: 1, q: 0.707 }] } } });
      assert.equal(offline.dsp.peq.bands.length, 2, JSON.stringify(offline.dsp));
      assert.equal((await phone("GET", "/api/audio-devices/" + zoneId)).dsp.peq.bands[0].freq, 1000);
      seq = (await phone("GET", `/api/phone/commands?after=${seq}`)).seq;
      // The app says its engine is on: the badge says so.
      await phone("POST", "/api/phone/state", { index: 0, position: 5, duration: 60, state: "playing", volume: 40, format: "opus24", dsp: true });
      assert.deepEqual((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.format, { kind: "opus", text: "256 · 24/48 · DSP" });
      await phone("POST", "/api/phone/state", { index: 0, position: 6, duration: 60, state: "playing", volume: 40, format: "original", dsp: true });
      assert.deepEqual((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.format, { kind: "lossless", text: "Lossless · DSP" });
      // Through the app's USB driver (Stage 9.2): the depth and rate the DAC is fed; the tick only with the DSP off.
      await phone("POST", "/api/phone/state", { index: 0, position: 7, duration: 60, state: "playing", volume: 40, format: "original", dsp: true, usb: "44100/24" });
      assert.deepEqual((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.format, { kind: "lossless", text: "Lossless · DSP · USB 24/44.1" });
      await phone("POST", "/api/phone/state", { index: 0, position: 8, duration: 60, state: "playing", volume: 40, format: "original", dsp: false, usb: "96000/24" });
      assert.deepEqual((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.format, { kind: "lossless", text: "Lossless · USB 24/96 ✓" });
      await phone("POST", "/api/phone/state", { index: 0, position: 9, duration: 60, state: "playing", volume: 40, format: "original", dsp: false, usb: "nonsense" });
      assert.deepEqual((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.format, { kind: "lossless", text: "Lossless" });
      // Native DSD and DoP (Stage 9.3).
      await phone("POST", "/api/phone/state", { index: 0, position: 9, duration: 60, state: "playing", volume: 40, format: "original", dsp: false, usb: "dsd64" });
      assert.deepEqual((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.format, { kind: "lossless", text: "Lossless · USB DSD64 ✓" });
      await phone("POST", "/api/phone/state", { index: 0, position: 9, duration: 60, state: "playing", volume: 40, format: "original", dsp: false, usb: "dop128" });
      assert.deepEqual((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.format, { kind: "lossless", text: "Lossless · USB DoP DSD128 ✓" });
      await phone("PATCH", "/api/audio-devices/" + zoneId, { dsp: { enabled: false } });
      seq = (await phone("GET", `/api/phone/commands?after=${seq}`)).seq;
    });

    await t.test("the phone's own music: the app sends its list, the page sees it as the queue", async () => {
      const items = [
        { title: "Opening", artist: "Someone", album: "A Purchase", image_key: "phone-abc123", album_key: "abc123", duration: 200, ext: "flac" },
        { title: "Closing", artist: "Someone", album: "A Purchase", image_key: "phone-abc123", album_key: "abc123", duration: 180, ext: "flac" }
      ];
      await phone("POST", "/api/phone/state", { index: 1, position: 12, duration: 180, state: "playing", volume: 40, local: true, local_rev: 3, local_items: items, dsp: true });
      const st = await phone("GET", "/api/zone-state?zone=" + zoneId);
      assert.equal(st.zone.state, "playing");
      assert.equal(st.zone.now_playing.line1, "Closing");
      assert.equal(st.zone.now_playing.line3, "A Purchase");
      assert.equal(st.zone.now_playing.image_key, "phone-abc123");
      assert.equal(st.zone.now_playing.album_offset, "phone:abc123");
      assert.deepEqual(st.zone.now_playing.format, { kind: "lossless", text: "Lossless · DSP" });
      // Reported again without the list (unchanged): still there.
      await phone("POST", "/api/phone/state", { index: 1, position: 13, duration: 180, state: "playing", volume: 40, local: true, local_rev: 3 });
      const q = await phone("GET", "/api/queue?zone=" + zoneId);
      assert.deepEqual(q.items.map(i => i.title), ["Closing"]);
      assert.deepEqual(q.history.map(i => i.track), ["Opening"]);
      assert.equal(q.items[0].image_key, "phone-abc123");
      // An album queued while the phone plays its own list goes into that list,
      // where the phone is — not into the server's queue it isn't playing.
      let got = await phone("GET", `/api/phone/commands?after=${seq}`);
      seq = got.seq;
      await phone("POST", "/api/play", { offset: cd.offset, zone_or_output_id: zoneId, kind: "queue" });
      got = await phone("GET", `/api/phone/commands?after=${seq}`);
      const ins = got.commands.find(c => c.op === "insert");
      assert.ok(ins, JSON.stringify(got.commands));
      assert.equal(ins.local, true);
      assert.equal(ins.at, 2);                       // after the phone's two tracks
      assert.equal(ins.items.length, 3);
      seq = got.seq;
      let lq = await phone("GET", "/api/queue?zone=" + zoneId);
      assert.deepEqual(lq.items.map(i => i.title), ["Closing", "Song 1", "Song 2", "Song 3"]);
      assert.ok(lq.items[1].image_key, "the server's album shows its cover");
      // Play next: straight after the track playing.
      await phone("POST", "/api/play", { offset: cd.offset, zone_or_output_id: zoneId, kind: "play_next" });
      got = await phone("GET", `/api/phone/commands?after=${seq}`);
      const nx = got.commands.find(c => c.op === "insert");
      assert.equal(nx.local, true);
      assert.equal(nx.at, 2);                        // index 1 is playing: next is 2
      seq = got.seq;
      // The app reports its list with the server's tracks named by id: their covers stay.
      const tid = ins.items[0].track_id;
      await phone("POST", "/api/phone/state", { index: 1, position: 20, duration: 180, state: "playing", volume: 40, local: true, local_rev: 4,
        local_items: items.concat([{ title: "Song 1", artist: "Artist A", album: "Album One", duration: 3, track_id: tid }]) });
      lq = await phone("GET", "/api/queue?zone=" + zoneId);
      assert.deepEqual(lq.items.map(i => i.title), ["Closing", "Song 1"]);
      assert.ok(lq.items[1].image_key, "a reported server track keeps its cover");
      // The server's track reached in the phone's own list (v0.7.4): Now
      // playing has its cover and its album, by its id — or, the id not
      // reported, by the cover address the server gave the track.
      await phone("POST", "/api/phone/state", { index: 2, position: 1, duration: 3, state: "playing", volume: 40, local: true, local_rev: 4 });
      let np = (await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing;
      assert.equal(np.line1, "Song 1");
      assert.equal(np.image_key, cd.image_key, "its cover, by its id");
      assert.equal(np.album_offset, cd.offset, "its album, by its id");
      await phone("POST", "/api/phone/state", { index: 2, position: 2, duration: 3, state: "playing", volume: 40, local: true, local_rev: 5,
        local_items: items.concat([{ title: "Song 1", artist: "Artist A", album: "Album One", duration: 3, art_url: ins.items[0].art_url }]) });
      np = (await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing;
      assert.equal(np.image_key, cd.image_key, "its cover, by the address the server gave it: " + ins.items[0].art_url);
      // Play Now leaves the phone's list at once: an album queued straight after,
      // before the phone has reported, goes to the server's queue.
      await phone("POST", "/api/play", { offset: cd.offset, zone_or_output_id: zoneId, kind: "play_now" });
      await phone("POST", "/api/play", { offset: cd.offset, zone_or_output_id: zoneId, kind: "queue" });
      got = await phone("GET", `/api/phone/commands?after=${seq}`);
      const after = got.commands.filter(c => c.op === "load" || c.op === "insert");
      assert.deepEqual(after.map(c => [c.op, c.local || false, c.at || 0]), [["load", false, 0], ["insert", false, 3]]);
      seq = got.seq;
      // Back to the server's queue: the list is left behind.
      await phone("POST", "/api/phone/state", { index: 0, position: 1, duration: 60, state: "playing", volume: 40 });
      assert.equal((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.now_playing.line1, "Song 1");
    });

    await t.test("the app's player restarted: its queue comes back, paused where it was", async () => {
      // Android stopped the idle player (deep sleep); the app says hello again.
      await phone("POST", "/api/phone/state", { index: 1, position: 40, duration: 60, state: "paused", volume: 25 });
      const h = await phone("POST", "/api/phone/hello", { name: "Pixel 8" });
      assert.equal(h.zone_id, zoneId);
      assert.ok(h.resume, "the queue is handed back");
      assert.equal(h.resume.op, "load");
      assert.equal(h.resume.play, false);
      assert.equal(h.resume.index, 1);
      assert.ok(Math.abs(h.resume.seconds - 40) < 2, String(h.resume.seconds));
      assert.deepEqual(h.resume.items.map(i => i.title), ["Song 1", "Song 2", "Song 3", "Song 1", "Song 2", "Song 3"]);
      seq = h.seq;
      // Meanwhile the zone shows the paused track, not "nothing playing".
      const st = await phone("GET", "/api/zone-state?zone=" + zoneId);
      assert.equal(st.zone.state, "paused");
      assert.equal(st.zone.now_playing.line1, "Song 2");
      assert.equal(st.zone.outputs[0].volume.value, 25);
      assert.deepEqual((await phone("GET", "/api/queue?zone=" + zoneId)).items.map(i => i.title).slice(0, 2), ["Song 2", "Song 3"]);
    });

    await t.test("what's playing moves from the phone to a Sonos room and back", async () => {
      const kitchen = (await phone("GET", "/api/zones")).zones.find(z => z.display_name === "Kitchen");
      await phone("POST", "/api/phone/state", { index: 1, position: 1, duration: 3, state: "playing" });
      const r = await phone("POST", "/api/transfer-zone", { from: zoneId, to: kitchen.zone_id });
      assert.equal(r.status, 200, JSON.stringify(r));
      const room = house.room("Kitchen");
      await until(async () => room.queue.length === 6);
      const got = await phone("GET", `/api/phone/commands?after=${seq}`);
      assert.ok(got.commands.some(c => c.op === "stop"));
      seq = got.seq;
      const back = await phone("POST", "/api/transfer-zone", { from: kitchen.zone_id, to: zoneId });
      assert.equal(back.status, 200, JSON.stringify(back));
      const load = (await phone("GET", `/api/phone/commands?after=${seq}`)).commands.find(c => c.op === "load");
      assert.equal(load.items.length, 6);
    });

    await t.test("a phone can't be grouped with Sonos rooms", async () => {
      const kitchen = (await phone("GET", "/api/zones")).zones.find(z => z.display_name === "Kitchen");
      const r = await phone("POST", "/api/group-outputs", { output_ids: [kitchen.zone_id, zoneId] });
      assert.equal(r.status, 500);
      assert.match(r.error, /can't be grouped/);
      // Moving music to a phone from another device needs the phone's switch on.
      await other("PATCH", "/api/audio-devices/" + zoneId, { shared: false });
      assert.equal((await other("POST", "/api/transfer-zone", { from: kitchen.zone_id, to: zoneId })).status, 403, "switched off: no moving music to it");
      await other("PATCH", "/api/audio-devices/" + zoneId, { shared: true });
    });

    await t.test("the server restarted (an update): the phone's queue and place are kept", async () => {
      await phone("POST", "/api/phone/state", { index: 2, position: 12, duration: 60, state: "playing", volume: 40 });
      await new Promise(r => setTimeout(r, 600));            // the store writes after a moment
      await srv.stop();
      srv = createServer(options);
      ctx = await srv.start();
      // (A kept-alive connection to the old server fails once; the app retries as any client does.)
      await until(async () => (await phone("GET", "/api/status")).status === 200);
      // The app is still running: it asks for commands as before, no hello.
      const got = await phone("GET", `/api/phone/commands?after=${seq}`);
      assert.equal(got.status, 200, JSON.stringify(got));
      seq = got.seq;
      const st = await phone("GET", "/api/zone-state?zone=" + zoneId);
      assert.equal(st.status, 200, JSON.stringify(st));
      assert.equal(st.zone.now_playing.line1, "Song 3");
      assert.equal(st.zone.state, "paused", "paused until the app says otherwise");
      assert.ok(Math.abs(st.zone.now_playing.seek_position - 12) < 3, String(st.zone.now_playing.seek_position));
      const q = await phone("GET", "/api/queue?zone=" + zoneId);
      assert.equal(q.items.length + q.history.length, 6, "all six tracks are back");
      assert.deepEqual(q.items.slice(0, 2).map(i => i.title), ["Song 3", "Song 1"]);
      // The app reports playing on: so it shows.
      await phone("POST", "/api/phone/state", { index: 2, position: 14, duration: 60, state: "playing", volume: 40 });
      assert.equal((await phone("GET", "/api/zone-state?zone=" + zoneId)).zone.state, "playing");
      // And a new command still reaches the app, whatever sequence it counted to before.
      await phone("POST", "/api/control", { zone_or_output_id: zoneId, command: "pause" });
      const got2 = await phone("GET", `/api/phone/commands?after=${seq}`);
      assert.ok(got2.commands.some(c => c.op === "pause"), JSON.stringify(got2));
      seq = got2.seq;
      // An app that was restarted too gets the queue back with its hello.
      const h = await phone("POST", "/api/phone/hello", { name: "Pixel 8" });
      assert.equal(h.resume.items.length, 6);
      assert.equal(h.resume.index, 2);
    });
    await t.test("a USB DAC's ceiling (Stage 9.3): the queue is planned for it, and planned back without it", async () => {
      // Hi-res to a phone goes as 24/48 FLAC (the Sonos rule) until the app
      // says what its DAC takes; then the file as it is, and the app is
      // handed the same queue again at the same place.
      const hi = albums.find(a => a.title === "Hi Res");
      await phone("POST", "/api/play", { offset: hi.offset, zone_or_output_id: zoneId, kind: "play_now" });
      let got = await phone("GET", `/api/phone/commands?after=${seq}`);
      let load = got.commands.find(c => c.op === "load");
      assert.match(load.items[0].url, /\/stream\/t\d+\.flac\?/, "24/48 by the Sonos rule: " + load.items[0].url);
      seq = got.seq;
      await phone("POST", "/api/phone/state", { index: 0, position: 3, duration: 60, state: "playing", volume: 40 });
      await phone("POST", "/api/phone/state", { index: 0, position: 4, duration: 60, state: "playing", volume: 40,
        usb_caps: { rates: [44100, 48000, 88200, 96000], bits: [16, 24], dsd: [64] } });
      got = await phone("GET", `/api/phone/commands?after=${seq}`);
      load = got.commands.find(c => c.op === "load");
      assert.ok(load, JSON.stringify(got));
      assert.match(load.items[0].url, /\.orig\.flac\?/, "the 96 kHz file as it is");
      assert.equal(load.index, 0);
      assert.ok(load.seconds >= 4, "from where it was");
      assert.equal(load.play, true);
      seq = got.seq;
      // The same report again: nothing new. The DAC gone: back to the Sonos rule.
      await phone("POST", "/api/phone/state", { index: 0, position: 5, duration: 60, state: "playing", volume: 40,
        usb_caps: { rates: [44100, 48000, 88200, 96000], bits: [16, 24], dsd: [64] } });
      assert.equal((await phone("GET", `/api/phone/commands?after=${seq}`)).commands.filter(c => c.op === "load").length, 0);
      await phone("POST", "/api/phone/state", { index: 0, position: 6, duration: 60, state: "paused", volume: 40, usb_caps: null });
      got = await phone("GET", `/api/phone/commands?after=${seq}`);
      load = got.commands.find(c => c.op === "load");
      assert.ok(load);
      assert.match(load.items[0].url, /\/stream\/t\d+\.flac\?/);
      assert.equal(load.play, false);
      seq = got.seq;
    });

  } finally {
    await srv.stop();
    await house.stop();
  }
});
