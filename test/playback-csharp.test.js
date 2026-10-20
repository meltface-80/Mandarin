"use strict";
/*
 * playback-csharp.test.js — playback by the C# server (v0.8.49, stage 6 of
 * old/csharp-migration.md), held to the Node server's own. The same
 * requests go to two servers at once: this suite's, behind the C# server,
 * which holds playback (test/setup.js hands it over), and a Node server alone
 * in a child process, with its own hub, as an install before the move ran;
 * each with a fresh copy of the fixture library. Every answer and refusal is
 * compared as JSON, with what can't be the same taken out (the phone's zone
 * id, the row ids, the signed addresses, the clock), and every answer here
 * is checked to be the C# server's. The phone first (part 1), the one player
 * that tests the hub end to end without a speaker; then the Sonos rooms (part
 * 2): a fake household for each server, and after each scenario the commands
 * each speaker was sent, in order, compared as well as the answers. Renderers
 * (part 3) have their own suites.
 *
 * Since v0.8.50 (stage 7) the C# server here is the program alone
 * (test/server.js), and the Node server's side is a recording: made
 * while index.js was still there (both servers asked, live,
 * as before), its answers, commands and rows normalised and kept in
 * test/golden/playback-node.json; every run since holds the C# server to it,
 * step for step.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn, post } = require("./auth-helper");
const fs = require("fs");
const { createServer, built } = require("./server");

const GOLDEN = path.join(__dirname, "golden", "playback-node.json");
const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!fs.existsSync(GOLDEN) && "no recording of the Node server's answers");

async function until(fn, ms = 10000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await new Promise(r => setTimeout(r, 100));
  }
}

/*
 * One answer, as compared: the phone's zone id, the base address, the track
 * and album ids (by their titles: the two libraries were scanned apart), the
 * signatures and the clock taken out.
 */
function norm(v, S) {
  if (v === undefined) return undefined;
  return JSON.parse(JSON.stringify(v, function (k, val) {
    if (typeof val === "string") {
      return (S.zone ? val.split(S.zone).join("<zone>") : val)
        .replace(/^http:\/\/127\.0\.0\.1:\d+/, "<base>")
        .replace(/\/stream\/t(\d+)/, (m, id) => "/stream/t<" + (S.tracks.get(Number(id)) || id) + ">")
        .replace(/\/api\/image\/(al-[^?&/]+)/, (m, key) => "/api/image/<" + (S.covers.get(key) || key) + ">")
        .replace(/^al-\d+-\w+$/, (key) => "<" + (S.covers.get(key) || key) + ">")
        .replace(/([?&])s=[^&]+/g, "$1s=<sig>");
    }
    if (typeof val === "number") {
      if (k === "track_id") return "<" + (S.tracks.get(val) || val) + ">";
      if (k === "album_offset" || k === "offset") return "<" + (S.albums.get(val) || val) + ">";
      if (k === "seek_position" || k === "at" || k === "seconds") return "<clock>";
      // The change counter the long poll waits on: how often each hub bumped it is its own affair.
      if (k === "revision") return "<revision>";
    }
    return val;
  }));
}

test("v0.8.49 (stage 6, parts 1 and 2): a phone zone and the Sonos rooms by C#, every answer and every command the Node server's own", { skip, timeout: 300000 }, async (t) => {
  // The C# program alone, held to the Node server's answers as recorded.
  const libF = makeLibrary();
  const PORT = ports.port();
  /* The Node server's side of each comparison, as it answered when recorded, in the same order. */
  const golden = { list: JSON.parse(fs.readFileSync(GOLDEN, "utf8")), at: 0 };
  const peek = (label) => {
    const g = golden.list[golden.at];
    assert.ok(g, "the recording ends before " + label);
    assert.equal(g.label, label, "the recording in step");
    return g.v;
  };
  const kept = () => { golden.at++; };
  // A fake household (part 2).
  const houseF = new FakeHousehold();
  const houses = [houseF];
  for (const h of houses) await h.start();
  const options = { port: PORT, musicDir: libF.music, dataDir: libF.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false };
  let srv = createServer(options);
  let ctx = await srv.start();
  const F = { name: "C#", base: "http://127.0.0.1:" + PORT, zone: "", tracks: new Map(), albums: new Map(), covers: new Map() };
  const both = [F];

  const call = async (S, token, method, p, body, headers) => {
    const h = Object.assign({ Authorization: "Bearer " + token }, body ? { "Content-Type": "application/json" } : {}, headers || {});
    const r = await fetch(S.base + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, by: r.headers.get("x-mandarin-answered") || "Node", json: await r.json().catch(() => null) };
  };
  /*
   * The same request to both (a body may be made per server: it names that
   * server's album ids), the answers compared; the C# server's answer first.
   */
  const same = async (who, method, p, body, opts = {}) => {
    const answers = await Promise.all(both.map(S => call(S, S[who], method, typeof p === "function" ? p(S) : p,
      typeof body === "function" ? body(S) : body, opts.headers)));
    const [f] = answers;
    if (opts.zoneOf) both.forEach((S, i) => { S.zone = opts.zoneOf(answers[i].json); });
    const label = norm(`${method} ${typeof p === "function" ? p(F) : p}`, F);
    assert.equal(f.by, "C#", label + ": answered by C#");
    const want = peek(label);
    assert.equal(f.status, want.status, label + ": the status\n  C#: " + JSON.stringify(f.json) + "\n  Node: " + JSON.stringify(want.json));
    if (!opts.statusOnly) assert.deepEqual(norm(f.json, F), want.json, label + ": the answer");
    kept();
    return [f, want];
  };
  // A read that shows the rooms: each hub reads its room on a timer of its own, so after a command one
  // may have read it and the other not yet. Compared until the two agree (ten seconds at most), never once.
  const sameSoon = async (who, method, p) => {
    const t0 = Date.now();
    for (;;) {
      try { return await same(who, method, p); }
      catch (e) {
        if (!(e instanceof assert.AssertionError) || Date.now() - t0 > 10000) throw e;
        await new Promise(r => setTimeout(r, 150));
      }
    }
  };
  // What the app does: say hello, poll for commands, report.
  let seq = 0;
  const drain = async (S) => { const got = await call(S, S.phone, "GET", `/api/phone/commands?after=${seq}`); return got.json; };
  const commands = async (expectOps) => {
    const [f] = await Promise.all(both.map(drain));
    const want = peek("commands");
    assert.deepEqual(norm(f, F), want, "the commands, in order");
    if (expectOps) assert.deepEqual(f.commands.map(c => c.op), expectOps);
    assert.equal(f.seq, want.seq, "the one sequence, counted alike");
    kept();
    seq = f.seq;
    return f;
  };
  /* Each server's own pick (Random Album, the radio): not compared, but counted alike. */
  const sameSeq = (what, f) => {
    const want = peek(what);
    assert.equal(f.seq, want, what + ": the one sequence, counted alike");
    kept();
  };
  const report = (body) => same("phone", "POST", "/api/phone/state", body);
  const zoneState = (who = "phone") => same(who, "GET", S => "/api/zone-state?zone=" + S.zone);
  const queue = () => same("phone", "GET", S => "/api/queue?zone=" + S.zone);

  try {
    for (const S of both) {
      S.phone = await until(() => signIn(S.base), 60000, S.name + " to answer");   // kind "android"
      const SRP = require("../public/srp");
      const ch = await post(S.base, "/api/auth/challenge", { username: "tester" });
      const s = SRP.clientStart();
      const pr = SRP.clientProof("tester", "correct horse battery staple", ch.salt, ch.iterations, s, ch.B);
      S.other = (await post(S.base, "/api/auth/verify", { id: ch.id, A: s.A, M1: pr.M1, want_token: true, kind: "browser", device_name: "iPad" })).token;
    }
    await Promise.all(both.map(S => until(async () => (await call(S, S.other, "GET", "/api/status")).json.index_count === 3, 60000, S.name + "'s library")));
    for (const S of both) {
      const albums = (await call(S, S.other, "GET", "/api/library/albums?sort=album")).json.albums;
      for (const al of albums) {
        S.albums.set(al.offset, al.title);
        S.covers.set(al.image_key, al.title);
        for (const tr of (await call(S, S.other, "GET", "/api/album?offset=" + al.offset)).json.tracks) S.tracks.set(tr.track_id, tr.title);
      }
      S.album = (title) => albums.find(a => a.title === title).offset;
    }
    assert.ok(F.tracks.size >= 6, "the tracks' ids known, by their titles");
    // Both households read, each room with its model, before anything is compared.
    await Promise.all(both.map(S => until(async () => {
      const zones = (await call(S, S.other, "GET", "/api/zones")).json.zones.filter(z => !z.is_phone);
      return zones.length === 2 && zones.every(z => z.outputs.every(o => o.model && o.volume.value != null)) && zones;
    }, 30000, S.name + "'s rooms")));

    await t.test("hello: a zone of its own", async () => {
      assert.equal((await call(F, F.other, "POST", "/api/phone/hello", { name: "iPad" })).status, 403, "only the Android app");
      const [f] = await same("phone", "POST", "/api/phone/hello", { name: "Pixel 8" }, { zoneOf: j => j.zone_id });
      assert.match(F.zone, /^PHONE_/);
      assert.deepEqual(f.json.dsp, { enabled: false, headphone: null, peq: null, headroom: "auto" });
      seq = f.json.seq;
    });

    await t.test("the lists: itself to the phone, under its name to another device", async () => {
      await same("phone", "GET", "/api/zones");
      await sameSoon("other", "GET", "/api/zones");
      await same("other", "GET", "/api/shortcut/zones");
      await same("phone", "GET", "/api/outputs");
      await same("phone", "GET", "/api/shortcut/zones");
      await zoneState("other");
      const [f] = await sameSoon("other", "GET", "/api/zones");
      assert.deepEqual(f.json.zones.filter(z => z.is_phone).map(z => [z.display_name, z.is_phone]), [["Pixel 8", true]]);
      assert.deepEqual((await same("phone", "GET", "/api/zones"))[0].json.zones.filter(z => z.is_phone).map(z => z.display_name), ["This phone"]);
    });

    await t.test("played to, controlled: the app's commands, in order", async () => {
      await same("other", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_now" }));
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: S.zone, command: "pause" }));
      const got = await commands(["load", "pause"]);
      assert.equal(got.commands[0].items.length, 3);
      assert.match(got.commands[0].items[0].url, /\/stream\/t\d+\.flac\?s=/);
      // The refusals, word for word.
      await same("other", "POST", "/api/play", S => ({ offset: 999999, zone_or_output_id: S.zone, kind: "play_now" }));
      await same("other", "POST", "/api/play", S => ({ zone_or_output_id: S.zone, kind: "play_now" }));
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: S.zone, command: "dance" }));
      await same("other", "POST", "/api/control", { zone_or_output_id: "RINCON_nowhere", command: "play" });
      await same("other", "GET", "/api/queue?zone=RINCON_nowhere");
      await same("other", "GET", "/api/zone-state?zone=RINCON_nowhere");
      await same("phone", "POST", "/api/play-unheard", {});
      await same("phone", "POST", "/api/play-unheard", S => ({ zone: S.zone }), { statusOnly: true });
      // Random Album: each server's own pick, loaded.
      const [uf, un] = await Promise.all(both.map(drain));
      for (const got of [uf, un].filter(Boolean)) assert.deepEqual(got.commands.map(c => c.op), ["load"]);
      sameSeq("random album", uf, un);
      seq = uf.seq;
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_now" }));
      await commands(["load"]);
    });

    await t.test("what the phone reports is now playing, and becomes history", async () => {
      await report({ index: 1, position: 31, duration: 60, state: "playing", volume: 40 });
      const [f] = await zoneState();
      assert.equal(f.json.zone.state, "playing");
      assert.equal(f.json.zone.now_playing.line1, "Song 2");
      assert.ok(Math.abs(f.json.zone.now_playing.seek_position - 31) < 3);
      assert.deepEqual(f.json.zone.now_playing.format, { kind: "lossless", text: "Lossless" });
      await queue();
      const [q] = await queue();
      assert.deepEqual(q.json.items.map(i => i.title), ["Song 2", "Song 3"]);
      assert.deepEqual(q.json.history.map(i => i.track), ["Song 1"]);
      // The play recorded, the same row in both databases (the album by its id, the zone by its id).
      const rows = (db) => db.prepare("SELECT title, artist, album, zone, album_id IS NOT NULL AS has_album FROM plays ORDER BY ts").all();
      const played = await until(async () => { const r = rows(ctx.db.raw); return r.length ? r : null; }, 5000, "the play");
      assert.deepEqual(norm(played, F), peek("plays"));
      kept();
      assert.deepEqual(norm(played, F), [{ title: "Song 2", artist: "Artist A", album: "Album One", zone: "<zone>", has_album: 1 }]);
      await same("other", "GET", S => "/api/album/now-playing?zone=" + S.zone);
    });

    await t.test("the badge: every word the phone's report can put on it", async () => {
      const badges = [];
      for (const r of [
        { format: "opus" }, { format: "opus24", dsp: true }, { format: "original", dsp: true },
        { format: "original", dsp: true, usb: "44100/24" }, { format: "original", dsp: false, usb: "96000/24" },
        { format: "original", usb: "nonsense" }, { format: "original", usb: "dsd64" }, { format: "original", usb: "dop128" }
      ]) {
        await report(Object.assign({ index: 1, position: 32, duration: 60, state: "playing", volume: 40 }, r));
        badges.push((await zoneState())[0].json.zone.now_playing.format.text);
      }
      assert.deepEqual(badges, ["256kbps", "256 · 24/48 · DSP", "Lossless · DSP", "Lossless · DSP · USB 24/44.1", "Lossless · USB 24/96 ✓", "Lossless", "Lossless · USB DSD64 ✓", "Lossless · USB DoP DSD128 ✓"]);
    });

    await t.test("transport, queue and volume become commands", async () => {
      await same("phone", "POST", "/api/control", S => ({ zone_or_output_id: S.zone, command: "pause" }));
      await same("phone", "POST", "/api/seek", S => ({ zone_or_output_id: S.zone, how: "absolute", seconds: 1 }));
      await same("phone", "POST", "/api/volume", S => ({ output_id: S.zone, how: "absolute", value: 25 }));
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "queue" }));
      const got = await commands(["pause", "seek", "volume", "insert"]);
      assert.equal(got.commands[3].at, 3);
      assert.equal(got.commands[3].items.length, 3);
      assert.equal((await zoneState())[0].json.zone.state, "paused");
      await queue();
      // Play next, from the end, from here; picks moved; removed; cleared.
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Hi Res"), zone_or_output_id: S.zone, kind: "play_next" }));
      await commands(["insert"]);
      await queue();
      await same("phone", "POST", "/api/queue/move", S => ({ zone_or_output_id: S.zone, queue_item_ids: [6] }));
      await commands();
      await queue();
      await same("phone", "POST", "/api/play-from-here", S => ({ zone_or_output_id: S.zone, queue_item_id: 3 }));
      await same("phone", "POST", "/api/play-from-here", S => ({ zone_or_output_id: S.zone, queue_item_id: 0 }));
      await same("phone", "POST", "/api/queue/remove", S => ({ zone_or_output_id: S.zone, queue_item_ids: [5, 4] }));
      await same("phone", "POST", "/api/queue/remove", S => ({ zone_or_output_id: S.zone }));
      await commands();
      await queue();
      await same("phone", "POST", "/api/zone-settings", S => ({ zone_or_output_id: S.zone, shuffle: true, loop: "loop_one" }));
      await commands(["mode"]);
      await same("phone", "GET", "/api/zones");
      await same("phone", "POST", "/api/zone-settings", S => ({ zone_or_output_id: S.zone, shuffle: false, loop: "disabled" }));
      await commands(["mode"]);
      await same("phone", "POST", "/api/mute-all", {});
      await same("phone", "POST", "/api/pause-all", {});
      await commands();
      await same("phone", "POST", "/api/queue/clear", S => ({ zone_or_output_id: S.zone }));
      await commands(["clear"]);
      await queue();
      await zoneState();
      // The queue the next steps expect.
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_now" }));
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "queue" }));
      await commands(["load", "insert"]);
    });

    await t.test("volume in the phone's own steps", async () => {
      await report({ index: 1, position: 40, duration: 60, state: "paused", volume: 40, volume_steps: 15 });
      const [st] = await zoneState();
      assert.ok(Math.abs(st.json.zone.outputs[0].volume.step - 100 / 15) < 1e-9);
      await same("phone", "POST", "/api/volume", S => ({ output_id: S.zone, how: "absolute", value: 51 }));
      let got = await commands(["volume"]);
      assert.equal(got.commands[0].value, 53);
      await zoneState();
      await report({ index: 1, position: 40, duration: 60, state: "paused", volume: 53, volume_steps: 15 });
      await same("phone", "POST", "/api/volume", S => ({ output_id: S.zone, how: "relative", value: 1 }));
      got = await commands(["volume"]);
      assert.equal(got.commands[0].value, 60);
      await report({ index: 1, position: 40, duration: 60, state: "paused", volume: 60 });
      await same("phone", "POST", "/api/volume", S => ({ output_id: S.zone, how: "absolute", value: 51 }));
      got = await commands(["volume"]);
      assert.equal(got.commands[0].value, 51);
      await same("phone", "POST", "/api/volume", S => ({ output_id: S.zone, how: "mute", value: 1 }));
      await same("phone", "POST", "/api/volume", S => ({ zone_or_output_id: S.zone, how: "absolute", value: 30 }));
      await commands();
      await zoneState();
    });

    await t.test("Random Album Radio: switched on, said so, and the memory of what it played", async () => {
      await same("phone", "GET", S => "/api/radio?zone=" + S.zone);
      await same("phone", "POST", "/api/radio", S => ({ zone: S.zone, enabled: true }));
      await same("phone", "GET", S => "/api/radio?zone=" + S.zone);
      await same("phone", "GET", "/api/radio");
      await same("phone", "POST", "/api/radio", {});
      // Switched on in a silent room, it starts: a whole album on the end of the queue — each server's own pick.
      const [f, n] = await Promise.all(both.map(S => until(async () => { const got = await drain(S); return got.commands.some(c => c.op === "insert") && got; }, 10000, S.name + "'s radio")));
      for (const got of [f, n].filter(Boolean)) {
        assert.deepEqual(got.commands.map(c => c.op), ["insert"]);
        assert.equal(new Set(got.commands[0].items.map(i => i.album)).size, 1, "one whole album");
        assert.equal(got.commands[0].at, 6, "on the end");
      }
      sameSeq("the radio", f, n);
      seq = f.seq;
      // And remembered: the album is in radio_played, never to be picked again for six months.
      const memory = (db) => db.prepare("SELECT COUNT(*) AS n FROM radio_played").get().n;
      await until(async () => memory(ctx.db.raw) === 1, 5000, "the radio's memory written");
      await same("phone", "POST", "/api/radio", S => ({ zone: S.zone, enabled: false }));
      await same("phone", "GET", S => "/api/radio?zone=" + S.zone);
      // The queue the next steps expect: the radio's album off again.
      await same("phone", "POST", "/api/queue/remove", S => ({ zone_or_output_id: S.zone, queue_item_ids: [7, 8, 9] }));
      await commands();
      await queue();
    });

    await t.test("away from home: hidden from others, their requests refused in the same words", async () => {
      const TAILNET = { "X-Forwarded-For": "100.101.102.103" };
      await same("phone", "GET", () => `/api/phone/commands?after=${seq}`, null, { headers: TAILNET });
      const [f] = await sameSoon("other", "GET", "/api/zones");
      assert.ok(!f.json.zones.some(z => z.is_phone), "away: hidden");
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: S.zone, command: "play" }));
      await same("other", "GET", S => "/api/zone-state?zone=" + S.zone);
      await same("other", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_now" }));
      // The phone itself, away: only itself; the shortcuts say so.
      await same("phone", "GET", "/api/zones", null, { headers: TAILNET });
      await same("phone", "GET", "/api/outputs", null, { headers: TAILNET });
      await same("phone", "GET", "/api/shortcut/zones", null, { headers: TAILNET });
      await same("phone", "GET", "/api/shortcut/play-random", null, { headers: TAILNET, statusOnly: true });
      // Its own zone is the one it may play to: a random album loaded, each server's own pick.
      const [lf, ln] = await Promise.all(both.map(drain));
      for (const got of [lf, ln].filter(Boolean)) assert.deepEqual(got.commands.map(c => c.op), ["load"]);
      sameSeq("away: a random album", lf, ln);
      seq = lf.seq;
      // Home again.
      await same("phone", "GET", () => `/api/phone/commands?after=${seq}`);
      assert.equal((await same("other", "GET", "/api/zones"))[0].json.zones.filter(z => z.is_phone).length, 1, "home: listed again");
      // The queue the next steps expect: the same album on both again.
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_now" }));
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "queue" }));
      await commands(["load", "insert"]);
    });

    await t.test("the phone's own music: the app's list is the queue the page sees", async () => {
      const items = [
        { title: "Opening", artist: "Someone", album: "A Purchase", image_key: "phone-abc123", album_key: "abc123", duration: 200, ext: "flac" },
        { title: "Closing", artist: "Someone", album: "A Purchase", image_key: "phone-abc123", album_key: "abc123", duration: 180, ext: "flac" }
      ];
      await report({ index: 1, position: 12, duration: 180, state: "playing", volume: 40, local: true, local_rev: 3, local_items: items, dsp: true });
      const [st] = await zoneState();
      assert.equal(st.json.zone.now_playing.line1, "Closing");
      assert.equal(st.json.zone.now_playing.album_offset, "phone:abc123");
      await report({ index: 1, position: 13, duration: 180, state: "playing", volume: 40, local: true, local_rev: 3 });
      await queue();
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "queue" }));
      const got = await commands(["insert"]);
      assert.deepEqual([got.commands[0].local, got.commands[0].at], [true, 2]);
      await queue();
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_next" }));
      await commands(["insert"]);
      // The server's track reached in the phone's own list: its cover and album by its id.
      await Promise.all(both.map(S => call(S, S.phone, "POST", "/api/phone/state", { index: 2, position: 20, duration: 180, state: "playing", volume: 40, local: true, local_rev: 4,
        local_items: items.concat([{ title: "Song 1", artist: "Artist A", album: "Album One", duration: 3, track_id: [...S.tracks].find(([, title]) => title === "Song 1")[0] }]) })));
      await zoneState();
      await queue();
      // Play Now leaves the list: back to the server's queue.
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_now" }));
      await commands(["load"]);
      await report({ index: 0, position: 1, duration: 60, state: "playing", volume: 40 });
      await zoneState();
    });

    await t.test("the app's player restarted: its queue handed back with the hello; the kept row the same", async () => {
      await report({ index: 1, position: 40, duration: 60, state: "paused", volume: 25 });
      const [h] = await same("phone", "POST", "/api/phone/hello", { name: "Pixel 8" });
      assert.deepEqual([h.json.resume.op, h.json.resume.play, h.json.resume.index], ["load", false, 1]);
      seq = h.json.seq;
      await zoneState();
      await queue();
      // The queue kept in the database (queue-store.js): the same row, key for key, once the store has written it.
      const row = (db, S) => {
        const k = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = ?").get("queue:" + S.zone).value);
        k.deviceId = "<device>"; k.at = "<clock>"; k.ids = k.ids.map(id => "<" + S.tracks.get(id) + ">");
        return k;
      };
      await until(async () => require("util").isDeepStrictEqual(row(ctx.db.raw, F), peek("the kept queue")), 10000, "the queue kept");
      const mine = row(ctx.db.raw, F);
      assert.deepEqual(mine, peek("the kept queue"));
      kept();
      assert.deepEqual(Object.keys(mine).sort(), ["at", "deviceId", "ids", "index", "kind", "loop", "name", "seconds", "shuffle", "state", "volume"]);
      assert.deepEqual([mine.kind, mine.name, mine.index, mine.state], ["phone", "Pixel 8", 1, "paused"]);
    });

    // The rooms (part 2): the same requests, the same answers, and the same commands to the speaker, action for action.
    const WRITES = new Set(["SetAVTransportURI", "Seek", "Play", "Pause", "Stop", "Next", "Previous", "RemoveAllTracksFromQueue", "AddMultipleURIsToQueue",
      "AddURIToQueue", "ReorderTracksInQueue", "RemoveTrackFromQueue", "SetPlayMode", "SetVolume", "SetMute", "BecomeCoordinatorOfStandaloneGroup"]);
    const writes = (room) => room.log.filter(a => WRITES.has(a));
    const sameLog = (name, expected) => {
      const f = writes(houseF.room(name)), n = peek("the speaker: " + name);
      for (const h of houses) h.room(name).log.length = 0;
      assert.deepEqual(f, n, name + ": the commands to the speaker, in order");
      kept();
      if (expected) assert.deepEqual(f, expected, name + ": the commands expected");
    };
    const rooms = (S) => ({ kitchen: "RINCON_KITCHEN01400", study: "RINCON_STUDY001400" });
    const settled = (name, fn) => Promise.all(houses.map(h => until(async () => fn(h.room(name)), 10000, name + " to settle")));
    const roomState = (who = "other") => sameSoon(who, "GET", S => "/api/zone-state?zone=" + rooms(S).kitchen);
    const roomQueue = () => sameSoon("other", "GET", S => "/api/queue?zone=" + rooms(S).kitchen);
    // Both hubs have read the room back since the last command (a command that builds on the room's
    // state — a mode from the other setting, a volume relative to the one there — counts from what
    // was last read, as the page does between two taps).
    const bothSee = (what, fn) => Promise.all(both.map(S => until(async () => fn((await call(S, S.other, "GET", "/api/zone-state?zone=" + rooms(S).kitchen)).json.zone), 10000, S.name + " to read " + what)));

    await t.test("a Sonos room played to: the speaker told the same things in the same order", async () => {
      await sameSoon("other", "GET", "/api/outputs");
      for (const h of houses) for (const r of h.rooms) r.log.length = 0;
      await same("other", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: rooms(S).kitchen, kind: "play_now" }));
      await settled("Kitchen", r => r.queue.length === 3 && r.state === "PLAYING");
      sameLog("Kitchen", ["RemoveAllTracksFromQueue", "AddMultipleURIsToQueue", "SetAVTransportURI", "Seek", "Play", "AddMultipleURIsToQueue"]);
      await Promise.all(both.map(S => until(async () => (await call(S, S.other, "GET", "/api/zone-state?zone=" + rooms(S).kitchen)).json.zone.state === "playing", 10000, S.name + " playing")));
      await roomState();
      await roomQueue();
      await sameSoon("other", "GET", S => "/api/album/now-playing?zone=" + rooms(S).kitchen);
      // Transport.
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "pause" }));
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "play" }));
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "next" }));
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "previous" }));
      // "playpause" goes by the state last read from the room: each one after the room has been read again, so the first pauses and the second plays, on any machine.
      const seen = (state) => Promise.all(both.map(S => until(async () => (await call(S, S.other, "GET", "/api/zone-state?zone=" + rooms(S).kitchen)).json.zone.state === state, 10000, S.name + " " + state)));
      await seen("playing");
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "playpause" }));
      await seen("paused");
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "playpause" }));
      await seen("playing");
      await same("other", "POST", "/api/seek", S => ({ zone_or_output_id: rooms(S).kitchen, how: "absolute", seconds: 2 }));
      await same("other", "POST", "/api/seek", S => ({ zone_or_output_id: rooms(S).kitchen, how: "relative", seconds: 1 }));
      // "previous" within the first seconds goes back a track.
      sameLog("Kitchen", ["Pause", "Play", "Next", "Previous", "Pause", "Play", "Seek", "Seek"]);
      await settled("Kitchen", r => r.state === "PLAYING");
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "pause" }));
      sameLog("Kitchen", ["Pause"]);
      await settled("Kitchen", r => r.state === "PAUSED_PLAYBACK");
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "play" }));
      sameLog("Kitchen", ["Play"]);
      await settled("Kitchen", r => r.state === "PLAYING");
      await roomState();
    });

    await t.test("a Sonos room's queue: added to, moved, played from, cut and cleared alike", async () => {
      await same("other", "POST", "/api/play", S => ({ offset: S.album("Hi Res"), zone_or_output_id: rooms(S).kitchen, kind: "play_next" }));
      await same("other", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: rooms(S).kitchen, kind: "queue" }));
      await settled("Kitchen", r => r.queue.length === 8);
      sameLog("Kitchen", ["AddMultipleURIsToQueue", "AddMultipleURIsToQueue"]);
      await roomQueue();
      await same("other", "POST", "/api/play-from-here", S => ({ zone_or_output_id: rooms(S).kitchen, queue_item_id: 4 }));
      await settled("Kitchen", r => r.track === 4);
      sameLog("Kitchen", ["Seek", "Play"]);
      await roomQueue();
      await same("other", "POST", "/api/queue/move", S => ({ zone_or_output_id: rooms(S).kitchen, queue_item_ids: [7, 6] }));
      sameLog("Kitchen", ["ReorderTracksInQueue", "ReorderTracksInQueue"]);
      await roomQueue();
      await same("other", "POST", "/api/queue/remove", S => ({ zone_or_output_id: rooms(S).kitchen, queue_item_ids: [8, 1] }));
      sameLog("Kitchen", ["RemoveTrackFromQueue", "RemoveTrackFromQueue"]);
      await roomQueue();
      await same("other", "POST", "/api/zone-settings", S => ({ zone_or_output_id: rooms(S).kitchen, shuffle: true, loop: "loop" }));
      await bothSee("shuffle and loop", z => z.settings.shuffle === true && z.settings.loop === "loop");
      await same("other", "POST", "/api/zone-settings", S => ({ zone_or_output_id: rooms(S).kitchen, loop: "disabled" }));
      await bothSee("loop off", z => z.settings.shuffle === true && z.settings.loop === "disabled");
      await same("other", "POST", "/api/zone-settings", S => ({ zone_or_output_id: rooms(S).kitchen, shuffle: false }));
      sameLog("Kitchen", ["SetPlayMode", "SetPlayMode", "SetPlayMode"]);
      await settled("Kitchen", r => r.playMode === "NORMAL");
      await bothSee("shuffle off", z => z.settings.shuffle === false && z.settings.loop === "disabled");
      await sameSoon("other", "GET", "/api/zones");
      // Volume and mute belong to the room.
      await same("other", "POST", "/api/volume", S => ({ output_id: rooms(S).kitchen, how: "absolute", value: 33 }));
      await bothSee("the volume", z => z.outputs[0].volume.value === 33);
      await same("other", "POST", "/api/volume", S => ({ output_id: rooms(S).kitchen, how: "relative", value: -3 }));
      await bothSee("the volume down", z => z.outputs[0].volume.value === 30);
      await same("other", "POST", "/api/volume", S => ({ zone_or_output_id: rooms(S).kitchen, mute: true }));
      await bothSee("muted", z => z.outputs[0].is_muted === true);
      await same("other", "POST", "/api/volume", S => ({ output_id: rooms(S).kitchen, mute: false }));
      sameLog("Kitchen", ["SetVolume", "SetVolume", "SetMute", "SetMute"]);
      await settled("Kitchen", r => r.volume === 30 && !r.muted);
      await bothSee("unmuted", z => z.outputs[0].is_muted === false);
      await roomState();
      // Stopped with music in its queue: what's added joins it, nothing is started; cleared, it is empty.
      await same("other", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "stop" }));
      await settled("Kitchen", r => r.state === "STOPPED");
      await Promise.all(both.map(S => until(async () => (await call(S, S.other, "GET", "/api/zone-state?zone=" + rooms(S).kitchen)).json.zone.state === "stopped", 10000, S.name + " stopped")));
      sameLog("Kitchen", ["Stop"]);
      await same("other", "POST", "/api/play", S => ({ offset: S.album("Hi Res"), zone_or_output_id: rooms(S).kitchen, kind: "queue" }));
      await settled("Kitchen", r => r.queue.length === 8);
      sameLog("Kitchen", ["AddMultipleURIsToQueue"]);
      await same("other", "POST", "/api/queue/clear", S => ({ zone_or_output_id: rooms(S).kitchen }));
      await settled("Kitchen", r => r.queue.length === 0);
      sameLog("Kitchen", ["RemoveAllTracksFromQueue"]);
      await roomQueue();
      // An empty room queued to: started.
      await same("other", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: rooms(S).kitchen, kind: "queue" }));
      await settled("Kitchen", r => r.queue.length === 3 && r.state === "PLAYING");
      sameLog("Kitchen", ["AddMultipleURIsToQueue", "SetAVTransportURI", "Seek", "Play"]);
      await same("other", "POST", "/api/pause-all", {});
      await settled("Kitchen", r => r.state === "PAUSED_PLAYBACK");
      sameLog("Kitchen", ["Pause"]);
      await commands(["pause"]);
    });

    await t.test("grouping and moving music: the rooms joined and freed, the queue carried across", async () => {
      for (const h of houses) for (const r of h.rooms) r.log.length = 0;
      await same("other", "POST", "/api/group-outputs", S => ({ output_ids: [rooms(S).kitchen, rooms(S).study] }));
      await Promise.all(both.map(S => until(async () => (await call(S, S.other, "GET", "/api/zones")).json.zones.some(z => z.display_name === "Kitchen + Study"), 15000, S.name + " grouped")));
      sameLog("Study", ["SetAVTransportURI"]);
      await sameSoon("other", "GET", "/api/zones");
      await sameSoon("other", "GET", "/api/outputs");
      await same("other", "POST", "/api/ungroup-outputs", S => ({ output_ids: [rooms(S).study] }));
      await Promise.all(both.map(S => until(async () => (await call(S, S.other, "GET", "/api/zones")).json.zones.filter(z => !z.is_phone).length === 2, 15000, S.name + " ungrouped")));
      sameLog("Study", ["BecomeCoordinatorOfStandaloneGroup"]);
      await same("other", "POST", "/api/group-outputs", S => ({ output_ids: [rooms(S).kitchen, S.zone] }));
      // From the phone to the room and back: the same queue, the same place.
      await same("phone", "POST", "/api/play", S => ({ offset: S.album("Album One"), zone_or_output_id: S.zone, kind: "play_now" }));
      await commands(["load"]);
      await report({ index: 1, position: 1, duration: 3, state: "playing", volume: 40 });
      for (const h of houses) h.room("Kitchen").log.length = 0;
      await same("phone", "POST", "/api/transfer-zone", S => ({ from: S.zone, to: rooms(S).kitchen }));
      await settled("Kitchen", r => r.queue.length === 3 && r.state === "PLAYING" && r.track === 2);
      sameLog("Kitchen", ["RemoveAllTracksFromQueue", "AddMultipleURIsToQueue", "SetAVTransportURI", "Seek", "Seek", "Play", "AddMultipleURIsToQueue"]);
      await commands(["stop"]);
      // Paused, and read back (the second track) before it moves again: the fixture's tracks are three
      // seconds long, so a room left playing runs past the place it would be picked up from.
      await same("phone", "POST", "/api/control", S => ({ zone_or_output_id: rooms(S).kitchen, command: "pause" }));
      await settled("Kitchen", r => r.state === "PAUSED_PLAYBACK" && r.track === 2);
      await Promise.all(both.map(S => until(async () => {
        const z = (await call(S, S.other, "GET", "/api/zone-state?zone=" + rooms(S).kitchen)).json.zone;
        return z.state === "paused" && z.now_playing.line1 === "Song 2";
      }, 10000, S.name + " paused on the second track")));
      await same("phone", "POST", "/api/transfer-zone", S => ({ from: rooms(S).kitchen, to: S.zone }));
      const got = await commands(["load"]);
      assert.deepEqual([got.commands[0].items.length, got.commands[0].index], [3, houseF.room("Kitchen").track - 1], "the same place: the room's own track");
      assert.equal(got.commands[0].index, 1);
      await settled("Kitchen", r => r.state === "STOPPED");
      sameLog("Kitchen", ["Pause", "Stop"]);
      await same("phone", "POST", "/api/transfer-zone", S => ({ from: "RINCON_nowhere", to: S.zone }));
      await report({ index: 1, position: 40, duration: 60, state: "paused", volume: 25 });
    });

    await t.test("the C# server restarted (an update): the phone's queue and place are kept", async () => {
      await report({ index: 2, position: 12, duration: 60, state: "playing", volume: 40 });
      // The store writes after a moment: what it kept, before the server goes.
      await until(async () => { const r = ctx.db.raw.prepare("SELECT value FROM settings WHERE key = ?").get("queue:" + F.zone); const k = r && JSON.parse(r.value); return k && k.index === 2 && k.state === "playing"; }, 10000, "the queue kept");
      await srv.stop();
      srv = createServer(options);
      ctx = await srv.start();
      await until(async () => (await call(F, F.phone, "GET", "/api/status")).status === 200, 30000, "the server");
      const got = await call(F, F.phone, "GET", `/api/phone/commands?after=${seq}`);
      assert.equal(got.status, 200, JSON.stringify(got.json));
      assert.equal(got.by, "C#");
      const st = (await call(F, F.phone, "GET", "/api/zone-state?zone=" + F.zone)).json;
      assert.equal(st.zone.now_playing.line1, "Song 3");
      assert.equal(st.zone.state, "paused", "paused until the app says otherwise");
      assert.ok(Math.abs(st.zone.now_playing.seek_position - 12) < 3, String(st.zone.now_playing.seek_position));
      const q = (await call(F, F.phone, "GET", "/api/queue?zone=" + F.zone)).json;
      assert.equal(q.items.length + q.history.length, 3, "all three tracks are back");
      const h = (await call(F, F.phone, "POST", "/api/phone/hello", { name: "Pixel 8" })).json;
      assert.deepEqual([h.resume.items.length, h.resume.index], [3, 2]);
    });

    // Every step of the recording compared.
    assert.equal(golden.at, golden.list.length, "every recorded step compared");
  } finally {
    await srv.stop();
    for (const h of houses) await h.stop();
  }
});
