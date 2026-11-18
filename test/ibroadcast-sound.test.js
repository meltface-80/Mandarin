"use strict";
/*
 * iBroadcast albums matched by sound when the owner chooses them (item 459): never by the Album Scanner in the
 * background (it identifies them by their details only, nothing fetched); an album its details leave unsure is matched
 * by sound when it is chosen to play, its tracks' starts read from iBroadcast's stream, whatever the hour and the music
 * playing (its own); once; and Match by sound in Edit album reads them the same way. Chosen while MusicBrainz turns
 * lookups away, it is said and tried again when next chosen (item 478: the error went unhandled, a "[crash]" line).
 * Against fakes of iBroadcast (its tracks' files real, chords a fingerprint each), MusicBrainz and AcoustID.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { FakeMusicBrainz, release } = require("./fake-musicbrainz");
const { FakeAcoustId } = require("./fake-acoustid");
const { FakeITunes } = require("./fake-itunes");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { score } = require("./score");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 60000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}

// Each track a chord of its own, so each has a fingerprint of its own.
let voice = 0;
function chord(file) {
  const n = voice++;
  const hz = k => (220 * Math.pow(2, k / 12)).toFixed(3);
  const [a, b, c] = [n % 12, 12 + (n * 5 + 3) % 12, 24 + (n * 7 + 1 + 2 * Math.floor(n / 12)) % 12];
  gen(file, { seconds: 8, expr: `0.35*sin(2*PI*${hz(a)}*t)+0.25*sin(2*PI*${hz(b)}*t)+0.15*sin(2*PI*${hz(c)}*t)` });
  return file;
}
const prints = files => score({ fn: "scorecall", calls: files.map(file => ["fingerprint", { file }]) }).results;

test("item 459: iBroadcast albums matched by sound when chosen to play, and by hand; never in the background", { skip, timeout: 280000 }, async (t) => {
  const lib = makeLibrary();
  const dir = path.join(lib.root, "ib-files");
  fs.mkdirSync(dir, { recursive: true });
  const playedFiles = [1, 2, 3, 4].map(i => chord(path.join(dir, `p${i}.flac`)));
  const handFiles = [1, 2, 3, 4].map(i => chord(path.join(dir, `h${i}.flac`)));
  const lostFiles = [1, 2, 3, 4].map(i => chord(path.join(dir, `l${i}.flac`)));   // AcoustID knows nothing of these
  const fpPlayed = prints(playedFiles), fpHand = prints(handFiles), fpLost = prints(lostFiles);
  const relPlayed = { id: "played-gem", title: "Hidden Gem", artist: "Real Artist", date: "1999", tracks: [["One", 8], ["Two", 8], ["Three", 8], ["Four", 8]] };
  const relHand = { id: "hand-gem", title: "Other Gem", artist: "Real Artist", date: "2001", tracks: [["Uno", 8], ["Dos", 8], ["Tres", 8], ["Cuatro", 8]] };
  const mb = await new FakeMusicBrainz([relPlayed, relHand]).start();
  t.after(() => mb.stop && mb.stop());
  const itunes = await new FakeITunes([]).start();
  t.after(() => itunes.stop && itunes.stop());
  const aid = await new FakeAcoustId().start();
  t.after(() => aid.stop && aid.stop());
  fpPlayed.forEach((f, i) => aid.know(f, [[release(relPlayed), i + 1]]));
  fpHand.forEach((f, i) => aid.know(f, [[release(relHand), i + 1]]));
  // Named as a ripper names what it can't place: their details tell nothing.
  const albumOf = (id, title, files) => ({ id, name: title, artist: { id: id + 1000, name: "Unknown Artist" }, year: 0,
    tracks: files.map((src, i) => ({ id: id * 10 + i + 1, title: "Track " + (i + 1), track: i + 1, length: 8, type: "audio/flac", src })) });
  const ib = await new FakeIBroadcast({ albums: [albumOf(951, "Unknown Disc", playedFiles), albumOf(961, "Unknown Disc 2", handFiles),
    albumOf(971, "Unknown Disc 3", lostFiles)] }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, mbRestMs: 300, itunesBaseUrl: itunes.baseUrl, acoustidBaseUrl: aid.baseUrl,
    ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 100000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ http: r.status }, await r.json().catch(() => ({})));
  };
  const db = ctx.db.raw;
  const row = key => db.prepare("SELECT status, mbid, candidate FROM album_matches WHERE key = ?").get(key);
  const offsetOf = key => (db.prepare("SELECT id FROM albums WHERE key = ?").get(key) || {}).id;
  const fetched = () => ib.streamAsks.filter(x => x.range !== "bytes=0-65535").length;   // beyond the library's 64 KB header reads
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "identify/settings", { schedule: false });
  assert.equal((await call("POST", "settings/acoustid-key", { key: "good-key" })).check, "ok");
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  await until(() => offsetOf("ibroadcast:951") && offsetOf("ibroadcast:961") && offsetOf("ibroadcast:971"), 30000, "the iBroadcast albums");

  await t.test("the scanner in the background: their details tried, left unidentified, nothing fetched, never asked of AcoustID", async () => {
    await until(() => (row("ibroadcast:951") || {}).status === "unidentified" && (row("ibroadcast:961") || {}).status === "unidentified", 90000, "both looked at");
    await sleep(2000);
    assert.equal(fetched(), 0, "nothing fetched from iBroadcast");
    const ours = new Set([...fpPlayed, ...fpHand, ...fpLost]);
    assert.equal(aid.lookups().filter(x => ours.has(x.fingerprint)).length, 0, "AcoustID never asked of theirs (the library's own files are)");
  });

  await t.test("chosen while MusicBrainz turns lookups away: said, left as it was, to be tried when next chosen", async () => {
    mb.busy = true;
    try {
      const h = await call("POST", "phone/hello", { name: "Pixel 8" });
      assert.equal((await call("POST", "play", { offset: offsetOf("ibroadcast:951"), zone_or_output_id: h.zone_id, kind: "play_now" })).http, 200);
      await until(() => ctx.logs.some(l => /Unknown Disc: not matched by sound now \(.*503.*\); tried again when next chosen/.test(l)), 60000, "said");
    } finally { mb.busy = false; }
    assert.ok(!ctx.logs.some(l => /\[crash\]/.test(l)), "no task left failing unwatched");
    assert.equal((row("ibroadcast:951") || {}).status, "unidentified");
    await sleep(1000);   // MusicBrainz's rest (300 ms here) over
  });

  await t.test("chosen to play: matched by sound from iBroadcast's stream, applied", async () => {
    const h = await call("POST", "phone/hello", { name: "Pixel 8" });
    assert.equal((await call("POST", "play", { offset: offsetOf("ibroadcast:951"), zone_or_output_id: h.zone_id, kind: "play_now" })).http, 200);
    const r = await until(() => { const x = row("ibroadcast:951"); return x && x.status === "applied" && x; }, 90000, "matched by sound");
    assert.equal(r.mbid, "played-gem");
    assert.equal(JSON.parse(r.candidate).sound_of, "4/4");
    assert.ok(fetched() >= 4, "its tracks read from iBroadcast");
    assert.equal((row("ibroadcast:961") || {}).status, "unidentified", "the other, not chosen, left as it was");
    assert.ok(ctx.logs.every(l => !l.includes(ib.access)), "the sign-in's token never in the log");
  });

  await t.test("one sound can't place, chosen twice: matched by sound once, left as it was", async () => {
    const lostAsked = () => aid.lookups().filter(x => fpLost.includes(x.fingerprint)).length;
    const h = await call("POST", "phone/hello", { name: "Pixel 8" });
    await call("POST", "play", { offset: offsetOf("ibroadcast:971"), zone_or_output_id: h.zone_id, kind: "play_now" });
    await until(() => lostAsked() === 4, 60000, "its four tracks asked of AcoustID");
    await sleep(2000);
    assert.equal((row("ibroadcast:971") || {}).status, "unidentified");
    await call("POST", "play", { offset: offsetOf("ibroadcast:971"), zone_or_output_id: h.zone_id, kind: "play_now" });
    await sleep(4000);
    assert.equal(lostAsked(), 4, "chosen again: not asked again");
  });

  await t.test("Match by sound in Edit album: an iBroadcast album read from its stream", async () => {
    const offset = offsetOf("ibroadcast:961");
    assert.equal((await call("POST", "identify/sound", { offset })).http, 200);
    const j = await until(async () => { const x = await call("GET", "identify/sound?offset=" + offset); return x.state === "done" && x; }, 90000, "the match by sound");
    assert.equal(j.answer, null, JSON.stringify(j));
    assert.deepEqual([j.releases[0].mbid, j.releases[0].heard], ["hand-gem", 4]);
  });
});
