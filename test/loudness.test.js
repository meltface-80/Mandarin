"use strict";
/*
 * ReplayGain (v0.6.0-RC5): the files' own gains kept and used; Track, Album
 * and Auto; the peak keeping a gain from clipping; the stream carrying the
 * gain; files without tags measured in the background — in the schedule's
 * hours, never while the library is scanned, album by album, newest first,
 * after identification, with options ffmpeg 5.1 knows (v0.8.24).
 *
 * The C# server's (Playback/Gain.cs, StreamPlans.cs, Identify/Loudness.cs;
 * lib/loudness.js until v0.8.50): its rules asked through `mandarin-server
 * score` { fn: "gain" } and { fn: "plans" }, the measuring through the server.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { haveFfmpeg, makeLibrary, gen, probe, FFMPEG } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { createServer, built } = require("./server");
const { signIn } = require("./auth-helper");
const { score } = require("./score");

const rules = built();
const skip = rules || (!haveFfmpeg() && "ffmpeg is not installed");
const gains = job => score(Object.assign({ fn: "gain" }, job));
const plans = job => score(Object.assign({ fn: "plans" }, job));
/* A file's integrated loudness, as ffmpeg's ebur128 sums it up (its last "I:" line). */
function lufs(file) {
  const r = require("child_process").spawnSync(FFMPEG, ["-nostats", "-hide_banner", "-i", file, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" });
  const all = [...String(r.stderr).matchAll(/I:\s+(-?[\d.]+) LUFS/g)];
  assert.ok(all.length, "ebur128 said nothing of " + file + ": " + String(r.stderr).slice(-400));
  return Number(all[all.length - 1][1]);
}
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 50));
  }
}

test("ebur128's summary read; tracks' loudness combined by length", { skip: rules }, () => {
  const out = `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.5 LUFS\n\n  True peak:\n    Peak:       -6.0 dBFS\n`;
  const r = gains({ ebur: [out, "I: -inf LUFS\nPeak: -inf dBFS"],
    // Two equal halves: the same loudness; a quiet short track barely moves a long loud one.
    combine: [[{ lufs: -10, seconds: 100 }, { lufs: -10, seconds: 100 }], [{ lufs: -10, seconds: 300 }, { lufs: -30, seconds: 10 }]] });
  assert.equal(r.ebur[0].lufs, -14.2);
  assert.ok(Math.abs(r.ebur[0].peak - 0.501) < 0.001, String(r.ebur[0].peak));
  assert.deepEqual(r.ebur[1], { lufs: null, peak: null });
  assert.ok(Math.abs(r.combine[0] + 10) < 1e-9);
  assert.ok(r.combine[1] > -10.2);
});

test("which gain, and the peak's cap", { skip: rules }, () => {
  const info = { track_gain: -6, track_peak: 0.5, album_gain: -4, album_peak: 0.9 };
  const g = gains({ gain_of: [[info, "track"], [info, "album"],
    [{ track_gain: null, album_gain: -4, album_peak: 0.9 }, "track"],          // the album's when the track has none
    [{ track_gain: -6, track_peak: 0.5, album_gain: null }, "album"],
    [{ track_gain: 10, track_peak: 0.5 }, "track"],                            // +10 dB asked, but the peak at 0.5 leaves room for 6.0 only
    // A -14 LUFS target is 4 dB above ReplayGain's -18; -25 is 7 below.
    [{ track_gain: -6, track_peak: 0.5 }, "track", 4], [{ track_gain: -6, track_peak: 0.5 }, "track", -7],
    [{ track_gain: null, album_gain: null }, "track"],
    [{ track_gain: null, album_gain: null }, "track", 4, -5],                  // loudness unknown: the fixed adjustment
    [{ track_gain: 0.02 }, "track"]] }).gain_of;                               // nothing to do
  assert.deepEqual(g, [-6, -4, -4, -6, 6, -2, -13, null, -5, null]);
});

test("a device's Volume Levelling: checked, with its defaults", { skip: rules }, () => {
  const r = gains({ levelling: [null, { mode: "auto", target: -30, unknown: 3 }],
    patch: [[null, { mode: "album", target: -20 }], [null, { target: -13 }], [null, { target: -26 }], [null, { unknown: 2 }], [null, { mode: "loud" }]] });
  assert.deepEqual(r.levelling, [{ mode: "off", target: -14, unknown: -5 }, { mode: "auto", target: -14, unknown: -5 }]);
  assert.deepEqual(r.patch[0], { mode: "album", target: -20, unknown: -5 });
  for (const refused of r.patch.slice(1)) assert.equal(refused.status, 400, JSON.stringify(refused));
});

test("the plan: a gain means a conversion, never on DSD sent as DSD", { skip: rules }, () => {
  const flac = { path: "/m/a.flac", codec: "FLAC", sampleRate: 44100, bitsPerSample: 16, channels: 2 };
  const hi = { path: "/m/a.flac", codec: "FLAC", sampleRate: 96000, bitsPerSample: 24, channels: 2 };
  const dsd = { transcode: false, dsd: 64, ext: "dsf" };
  const [sonos, sonosHi] = plans({ plan: [[flac], [hi]] }).plan;
  const [p, q, none, d] = plans({ with_gain: [[sonos, flac, null, -6.04], [sonosHi, hi, null, -3], [sonos, flac, null, 0], [dsd, {}, {}, -6]] }).with_gain;
  assert.deepEqual([p.transcode, p.ext, p.rate, p.bits, p.gain], [true, "flac", 44100, 24, -6]);
  assert.deepEqual([q.rate, q.bits, q.gain], [48000, 24, -3]);
  assert.equal(none.transcode, false);
  assert.deepEqual(d, dsd);
  // The gain is in the conversion and its cache name.
  const r = plans({ args: [["/in", p, "/out", true]], keys: [[{ id: 1, mtime: 1 }, p], [{ id: 1, mtime: 1 }, Object.assign({}, p, { gain: -3 })]] });
  assert.ok(r.args[0].join(" ").includes("volume=volume=-6dB:precision=double,aresample"));
  assert.notEqual(r.keys[0], r.keys[1]);
});

test("ebur128's options are ones ffmpeg 5.1 knows (v0.8.24)", () => {
  // framelog=quiet came with ffmpeg 6.0; Debian 12's 5.1 refused it and every file failed.
  const cs = fs.readFileSync(path.join(__dirname, "../server/Mandarin.Server/Identify/Loudness.cs"), "utf8");
  assert.equal(/const string Filter = "([^"]*)"/.exec(cs)[1], "ebur128=peak=true:framelog=verbose");
  assert.match(cs, /"-af", Filter,/);
  assert.doesNotMatch(cs, /"[^"\n]*framelog=quiet[^"\n]*"/, "no ffmpeg argument asks for framelog=quiet");
});

test("measuring keeps to the hours and the order (v0.8.24): the schedule's window, never while the library is scanned, album by album, newest first, after identification", { skip: skip || (process.platform === "win32" && "a named pipe holds the scan open"), timeout: 180000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rg-order-"));
  const music = path.join(root, "music"), data = path.join(root, "data");
  // Five albums: Middle with one track tagged (never measured), Single with one track (identification never looks at it).
  const album = (title, n, tagged) => { for (let i = 1; i <= n; i++) gen(path.join(music, "Someone", title, `0${i}.flac`), { seconds: 1, freq: 300 + 50 * i,
    tags: Object.assign({ title: `${title} ${i}`, artist: "Someone", album: title, track: i }, tagged && i === 1 ? { REPLAYGAIN_TRACK_GAIN: "-5.00 dB", REPLAYGAIN_TRACK_PEAK: "0.500000" } : {}) }); };
  // How long ago each was added — when its files were last written: New today, then Middle, Unseen, Old, Single.
  const DAY = 24 * 60 * 60 * 1000, now = Date.now();
  const ages = [["New", 0], ["Middle", 1], ["Unseen", 2], ["Old", 3], ["Single", 5]];
  album("New", 2); album("Middle", 2, true); album("Unseen", 2); album("Old", 2); album("Single", 1);
  for (const [title, ago] of ages) for (const f of fs.readdirSync(path.join(music, "Someone", title))) {
    const when = new Date(now - ago * DAY);
    fs.utimesSync(path.join(music, "Someone", title, f), when, when);
  }
  // MusicBrainz, holding every question until told, then not answering (503).
  let held = true;
  const waiting = [];
  const mb = http.createServer((req, res) => {
    const answer = () => { res.writeHead(503, { "Content-Type": "application/json" }); res.end('{"error":"busy"}'); };
    if (held) waiting.push(answer); else answer();
  });
  await new Promise(r => mb.listen(0, "127.0.0.1", r));
  t.after(() => { held = false; waiting.splice(0).forEach(a => a()); mb.closeAllConnections(); mb.close(); });
  // The order files are measured in, as the server starts ffmpeg on them: a stand-in that notes each
  // measuring's process and file, then runs ffmpeg itself. Files started together (one per free core)
  // reach the note in any order, so the order is the processes' (nice, ionice and taskset each exec,
  // so the stand-in has the id the server's start gave it, and ids are given out in turn).
  const started = path.join(root, "started.log"), stand = path.join(root, "ffmpeg");
  const real = require("child_process").execFileSync("sh", ["-c", 'command -v "$0"', FFMPEG]).toString().trim();
  fs.writeFileSync(stand, `#!/bin/sh\ncase "$*" in *ebur128*) echo "$$ $*" >> '${started}';; esac\nexec '${real}' "$@"\n`, { mode: 0o755 });
  const before = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = stand;
  t.after(() => { if (before === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = before; });
  const srv = createServer({ port: PORT, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, loudnessTickMs: 100, mbBaseUrl: "http://127.0.0.1:" + mb.address().port + "/ws/2" });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const api = async (p, body) => {
    const r = await fetch(B + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const raw = ctx.db.raw;
  // Identification's hours never come while the test runs (an empty window), so nothing moves until it says.
  assert.equal((await api("identify/settings", { schedule: true, start: "01:00", end: "01:00" })).status, 200);
  await until(async () => (await api("status")).index_count === 5);
  const ids = Object.fromEntries(ages.map(([title]) => [title, raw.prepare("SELECT id FROM albums WHERE title = ?").get(title).id]));
  // A Qobuz and a Tidal track: no file here, never measured nor waiting.
  raw.prepare("INSERT INTO albums(id, key, title, artist, added_at, updated_at) VALUES(900, 'k-streamed', 'Streamed', 'Someone', ?, ?)").run(now + DAY, now);
  raw.prepare("INSERT INTO tracks(id, album_id, path, mtime, size, title, track_no) VALUES(901, 900, 'qobuz://track/41', 0, 0, 'Q', 1), (902, 900, 'tidal://track/42', 0, 0, 'T', 2)").run();
  // Measured before v0.8.24: failed, as every file did on ffmpeg 5.1 (and never retried: a database from then).
  const single = raw.prepare("SELECT id FROM tracks WHERE album_id = ?").get(ids.Single).id;
  raw.prepare("INSERT INTO track_loudness(track_id, lufs, peak, measured_at, error) VALUES(?, NULL, NULL, 1, 'ffmpeg exited with 234')").run(single);
  raw.prepare("DELETE FROM settings WHERE key = 'loudnessRetried'").run();
  await ctx.library.reload();

  // The counts are the files here: the Qobuz and Tidal tracks apart.
  let r = await api("loudness");
  assert.deepEqual([r.tracks, r.tagged, r.measured, r.failed, r.left, r.streamed, r.reason], [9, 1, 0, 1, 7, 2, "off"]);
  // What failed before is measured again — once, from the next start on.
  await ctx.restart(token);
  assert.equal((await api("loudness")).failed, 0);
  assert.equal(ctx.db.setting("loudnessRetried", null), 1);
  raw.prepare("INSERT INTO track_loudness(track_id, lufs, peak, measured_at, error) VALUES(?, NULL, NULL, 2, 'unreadable')").run(single);
  await ctx.restart(token);
  assert.equal((await api("loudness")).failed, 1, "a file that fails now stays failed");
  raw.prepare("DELETE FROM track_loudness").run();
  // Switched on outside the hours: nothing measured.
  r = await api("loudness", { measure: true });
  assert.equal(r.settings.measure, true);
  await new Promise(res => setTimeout(res, 1000));
  r = await api("loudness");
  assert.deepEqual([r.reason, r.measured, r.failed], ["waiting", 0, 0]);

  // Old you edited by hand, so identification will never look at it.
  const old = (await api("library/albums?sort=album")).albums.find(a => a.title === "Old");
  assert.equal((await api("album/edit", { offset: old.offset, year: 1999 })).status, 200);
  // In the hours, identification at work (MusicBrainz holding its answer): only the albums it won't
  // look at — Old, edited; Single, one track — newest first, then nothing until it has looked.
  assert.equal((await api("identify/settings", { schedule: false })).status, 200);
  // Each album once, in the order its first file was started on.
  const order = () => [...new Set((fs.existsSync(started) ? fs.readFileSync(started, "utf8") : "").split("\n").filter(Boolean)
    .map(l => [Number(l.split(" ", 1)[0]), (/\/Someone\/([^/]+)\//.exec(l) || [])[1]]).sort((a, b) => a[0] - b[0]).map(([, title]) => title).filter(Boolean))];
  // Identification says "starting" before its first ask, and measuring waits from then on: both
  // seen before anything is read (CI's runner saw "identifying" with MusicBrainz not yet asked).
  await until(async () => waiting.length > 0 && (await api("loudness")).reason === "identifying", 30000);
  assert.ok(waiting.length > 0, "identification is asking MusicBrainz");
  assert.deepEqual(order(), ["Old", "Single"]);
  assert.equal((await api("loudness")).measuring, false);

  // The library being scanned (held at its first write: the test keeps the database's write lock;
  // the device's last sight written just now, so no request here needs to write): MusicBrainz stops
  // answering meanwhile, and still nothing is measured.
  raw.prepare("UPDATE devices SET last_seen = ?").run(Date.now());
  raw.prepare("BEGIN IMMEDIATE").run();
  let locked = true;
  t.after(() => { if (locked) raw.prepare("ROLLBACK").run(); });
  const rescan = api("library/rescan", { force: true });
  await until(async () => (await api("status")).scan.running);
  held = false;
  waiting.splice(0).forEach(a => a());
  const seen = new Set();
  for (const t0 = Date.now(); Date.now() - t0 < 1500;) { seen.add((await api("loudness")).reason); await new Promise(res => setTimeout(res, 100)); }
  assert.deepEqual([...seen], ["scanning"], "nothing measured while the library is scanned");
  assert.ok((await api("status")).scan.running, "the scan held all along");
  raw.prepare("COMMIT").run();
  locked = false;
  await rescan;
  await until(async () => !(await api("status")).scan.running, 30000);

  // MusicBrainz not answering: identification can't go on, so measuring does — New, Middle, Unseen.
  r = await until(async () => { const j = await api("loudness"); return j.reason === "done" && j; }, 90000);
  assert.deepEqual(order(), ["Old", "Single", "New", "Middle", "Unseen"]);
  assert.deepEqual([r.left, r.measured, r.failed, r.current], [0, 8, 0, null]);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.path LIKE '%://%' OR t.rg_track_gain IS NOT NULL").get().n, 0,
    "Qobuz, Tidal and tagged tracks are never measured");
});

test("ReplayGain end to end: tags kept, Track/Album/Auto, the stream turned down, untagged files measured", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  // An album with ReplayGain tags: tracks at -6 and -8 dB, the album at -7.
  const dir = path.join(lib.music, "Loud", "Loud Record");
  [["-6.00 dB", "0.500000"], ["-8.00 dB", "0.400000"]].forEach(([g, pk], i) => gen(path.join(dir, `0${i + 1}.flac`), {
    freq: 440 + 100 * i, seconds: 4,
    tags: { title: `Loud ${i + 1}`, artist: "Loud", album: "Loud Record", track: i + 1,
      REPLAYGAIN_TRACK_GAIN: g, REPLAYGAIN_TRACK_PEAK: pk, REPLAYGAIN_ALBUM_GAIN: "-7.00 dB", REPLAYGAIN_ALBUM_PEAK: "0.500000" }
  }));
  // Two Sonos rooms, each with its own Volume Levelling: what they are handed is what is heard.
  const house = new FakeHousehold();
  await house.start();
  const X = "RINCON_KITCHEN01400", Y = "RINCON_STUDY001400";
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, loudnessTickMs: 100 });
  const ctx = await srv.start();
  const token = await signIn(B);
  const api = async (p, body, method) => {
    const r = await fetch(B + "/api/" + p, body ? { method: method || "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  // A room's levelling changed while it holds a queue: the hub plans that queue again (Hub.SonosCommands.cs ReplanSonos),
  // alongside whatever is played next. Emptied first, each play here is the only one.
  const level = (id, lv) => {
    const r = house.rooms.find(x => x.uid === id);
    if (r) Object.assign(r, { queue: [], currentUri: "", track: 0, state: "STOPPED" });
    return api("audio-devices/" + id, { levelling: lv }, "PATCH");
  };
  try {
    await until(async () => (await api("status")).index_count === 4);
    await until(async () => (await api("zones")).zones.filter(z => !z.is_phone).length === 2);
    const al = (await api("library/albums?sort=album")).albums.find(a => a.title === "Loud Record");
    const rows = ctx.db.raw.prepare("SELECT t.rg_track_gain, t.rg_album_gain FROM tracks t JOIN albums a ON a.id = t.album_id WHERE a.title = 'Loud Record' ORDER BY t.track_no").all();
    assert.deepEqual(rows.map(t => t.rg_track_gain), [-6, -8]);
    assert.deepEqual(rows.map(t => t.rg_album_gain), [-7, -7]);
    // What a room is handed for the album (or one track of it, alone): each address's gain, null where there is none.
    const handed = async (room, play = { offset: al.offset }) => {
      const r = house.rooms.find(x => x.uid === room);
      r.queue = [];
      const res = play.track != null ? await api("play-track", Object.assign({ zone_or_output_id: room, kind: "play_now", only: true }, play))
        : await api("play", Object.assign({ zone_or_output_id: room, kind: "play_now" }, play));
      assert.equal(res.status, 200, JSON.stringify(res));
      await until(() => r.queue.length === (play.track != null ? 1 : 2));
      return r.queue.map(q => { const g = new URL(q.uri).searchParams.get("g"); return g == null ? null : Number(g); });
    };

    // Off by default: every file goes as it is.
    let r = await until(async () => { const d = await api("audio-devices/" + X); return d.levelling && d; }).catch(async () => { throw new Error(JSON.stringify(await api("audio-devices/" + X))); });
    assert.deepEqual(r.levelling, { mode: "off", target: -14, unknown: -5 });
    r = await api("loudness");
    assert.equal(r.settings.measure, false);
    assert.deepEqual(await handed(X), [null, null]);

    // Track: each its own; Album: the record's; Auto: the record's in order, each its own shuffled.
    // At -18 LUFS the gains are the tags' own.
    r = await level(X, { mode: "track", target: -18 });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual(r.levelling, { mode: "track", target: -18, unknown: -5 });
    assert.deepEqual(await handed(X), [-6, -8]);
    await level(X, { mode: "album" });
    assert.deepEqual(await handed(X), [-7, -7]);
    await level(X, { mode: "auto" });
    assert.deepEqual(await handed(X), [-7, -7]);
    assert.deepEqual(await handed(X, { offset: al.offset, track: 0 }), [-6], "alone: its own");
    const kitchen = house.rooms.find(x => x.uid === X);
    kitchen.playMode = "SHUFFLE_NOREPEAT";
    await until(async () => (await api("zone-state?zone=" + X)).zone.settings.shuffle === true);
    assert.deepEqual(await handed(X), [-6, -8], "shuffled: each its own");
    kitchen.playMode = "NORMAL";
    await until(async () => (await api("zone-state?zone=" + X)).zone.settings.shuffle === false);
    // The target moves them: -14 LUFS is 4 dB up (the peaks allow it here).
    await level(X, { mode: "track", target: -14 });
    assert.deepEqual(await handed(X), [-2, -4]);
    assert.equal((await level(X, { mode: "loud" })).status, 400);
    assert.equal((await level(X, { target: -10 })).status, 400);
    // The other room is untouched: each device is its own.
    assert.equal((await api("audio-devices/" + Y)).levelling.mode, "off");
    assert.deepEqual(await handed(Y), [null, null]);

    // Sonos is handed a conversion with the gain in it, 24 bits, and the stream is that much quieter.
    await level(X, { mode: "track", target: -18 });
    await handed(X);
    const uri = kitchen.queue[0].uri;
    assert.match(uri, /\/stream\/t\d+\.flac\?g=-6/);
    const down = Buffer.from(await (await fetch(uri)).arrayBuffer());
    assert.equal(probe(down).bits, 24);
    const f = path.join(lib.data, "down.flac");
    fs.writeFileSync(f, down);
    const orig = lufs(path.join(dir, "01.flac")), quieter = lufs(f);
    assert.ok(Math.abs((orig - quieter) - 6) < 0.3, `${orig} → ${quieter}`);
    // A gain the URL makes up is refused.
    assert.equal((await fetch(uri.replace("g=-6", "g=99"))).status, 400);

    // The phone is handed the gain to apply itself, and its stream is untouched.
    const phone = await api("phone/hello", { name: "Pixel 8" });
    await level(phone.zone_id, { mode: "track", target: -18 });
    assert.equal((await api("play", { offset: al.offset, zone_or_output_id: phone.zone_id, kind: "play_now" })).status, 200);
    const load = await until(async () => (await api(`phone/commands?after=${phone.seq}`)).commands.find(c => c.op === "load"));
    assert.deepEqual(load.items.map(x => x.gain_db), [-6, -8]);
    assert.ok(load.items.every(x => !x.url.includes("g=")), load.items.map(x => x.url).join(" "));
    const dl = await api("download/album?offset=" + al.offset);
    assert.equal(dl.tracks[0].replaygain.track_gain, -6);
    assert.equal(dl.tracks[0].replaygain.album_gain, -7);

    // Files without tags are measured, one at a time, when asked: by the C# server (v0.8.19).
    const h = await fetch(B + "/api/loudness", { headers: { Authorization: "Bearer " + token } });
    assert.equal(h.headers.get("x-mandarin-answered"), "C#", "measuring is the C# server's");
    // Scheduling on, its window not now: switched on, nothing is measured (v0.8.24).
    const hhmm = (h) => { const d = new Date(Date.now() + h * 3600000); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
    r = await api("identify/settings", { schedule: true, start: hhmm(2), end: hhmm(3) });
    assert.equal(r.status, 200, JSON.stringify(r));
    r = await api("loudness", { measure: true });
    assert.equal(r.settings.measure, true);
    await new Promise(res => setTimeout(res, 1500));
    r = await api("loudness");
    assert.deepEqual([r.reason, r.measured, r.failed, r.measuring, r.streamed], ["waiting", 0, 0, false, 0], JSON.stringify(r));
    // Scheduling off: measured until done, album by album, the newest first
    // (one scan added them all: the higher id first).
    await api("identify/settings", { schedule: false });
    const seen = [];
    r = await until(async () => {
      const j = await api("loudness");
      const t = j.current && j.current.title;
      if (t && seen[seen.length - 1] !== t) seen.push(t);
      return j.left === 0 && j.reason === "done" && j;
    }, 60000);
    const albums = ctx.db.raw.prepare("SELECT id, title, added_at FROM albums").all();
    const rank = new Map(albums.sort((a, b) => (b.added_at || 0) - (a.added_at || 0) || b.id - a.id).map((a, i) => [a.title, i]));
    assert.ok(seen.every((t, i) => rank.has(t) && (i === 0 || rank.get(t) > rank.get(seen[i - 1]))), "measured out of order: " + JSON.stringify(seen));
    assert.equal(r.tagged, 2);
    assert.equal(r.measured + r.failed, 7);
    assert.ok(r.measured >= 5, JSON.stringify(r));
    // Album One's first track measured, and every track of it known: its album gain worked out from them.
    const one = (await api("library/albums?sort=album")).albums.find(a => a.title === "Album One");
    const info = (await api("download/album?offset=" + one.offset)).tracks[0].replaygain;
    assert.ok(info && info.track_gain != null && info.track_peak > 0, JSON.stringify(info));
    assert.ok(info.album_gain != null, JSON.stringify(info));
    r = await api("loudness", { measure: false });
    assert.equal(r.measuring, false);
  } finally {
    await srv.stop();
    await house.stop();
  }
});
