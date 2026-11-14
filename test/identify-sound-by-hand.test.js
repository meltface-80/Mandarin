"use strict";
/*
 * Edit album's Match by sound, item 419: the step of item 414c run on one album when you ask (POST
 * /api/identify/sound, GET for where it is), whatever the Album Scanner is doing — here it is off. Against a fake
 * AcoustID (test/fake-acoustid.js) and the fake MusicBrainz:
 *   - no key, a key refused: said at once, nothing fingerprinted;
 *   - a fingerprint kept for a file is used, not made again; the rest made now;
 *   - one album at a time: another asked meanwhile is told which album is being matched;
 *   - a rip no search by name can place is offered its release by sound ("matched by sound: 4 of 4 tracks"), and
 *     applying it writes the names and the reason, as yours; Settings → API Keys' tally counts it;
 *   - AcoustID knowing none of the tracks: "no-match"; AcoustID busy: "limited".
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeMusicBrainz, release } = require("./fake-musicbrainz");
const { FakeAcoustId } = require("./fake-acoustid");
const { FakeITunes } = require("./fake-itunes");
const { createServer, built } = require("./server");
const { score } = require("./score");

const rules = built();
const skip = rules || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 60000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 100));
  }
}

// Each track a chord of its own, so each has a fingerprint of its own (as test/identify-sound.test.js makes them).
let voice = 40;
function album(music, artist, title, lengths) {
  const dir = path.join(music, artist, title);
  return lengths.map((seconds, i) => {
    const n = voice++;
    const hz = k => (220 * Math.pow(2, k / 12)).toFixed(3);
    const [a, b, c] = [n % 12, 12 + (n * 5 + 3) % 12, 24 + (n * 7 + 1 + 2 * Math.floor(n / 12)) % 12];
    const file = path.join(dir, `0${i + 1}.flac`);
    gen(file, { seconds, expr: `0.35*sin(2*PI*${hz(a)}*t)+0.25*sin(2*PI*${hz(b)}*t)+0.15*sin(2*PI*${hz(c)}*t)`,
      tags: { track: i + 1, title: "Track " + (i + 1), artist, album: title } });
    return file;
  });
}
const prints = files => score({ fn: "scorecall", calls: files.map(file => ["fingerprint", { file }]) }).results;

test("item 419: Match by sound by hand — answers, kept fingerprints, one at a time, a release offered and applied as yours", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const rip = album(lib.music, "Unknown Artist", "Rip 1", [4, 5, 6, 7]);
  const other = album(lib.music, "Unknown Artist", "Rip 2", [5, 6, 7]);
  const fpRip = prints(rip);
  const fpOther = prints(other);
  const gemSpec = { id: "hidden-gem", title: "Hidden Gem", artist: "Real Artist", date: "1999-01-01", tracks: [["Opening", 4], ["Second", 5], ["Third", 6], ["Closing", 7]] };
  const mb = await new FakeMusicBrainz([gemSpec]).start();
  const gem = release(gemSpec);
  const aid = await new FakeAcoustId().start();
  // The first track's fingerprint is kept already, as a print of its own (the server must send it, not make one).
  aid.know("kept-print-1", [[gem, 1]]);
  fpRip.forEach((f, i) => aid.know(f, [[gem, i + 1]]));
  const itunes = await new FakeITunes([]).start();
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl, acoustidBaseUrl: aid.baseUrl });
  const ctx = await srv.start();
  try {
    const token = await signIn(base);
    const api = async (p, body) => {
      const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) }
        : { headers: { Authorization: "Bearer " + token } });
      return { status: r.status, ...(await r.json().catch(() => ({}))) };
    };
    const row = t => ctx.db.raw.prepare("SELECT m.status, m.mbid, m.candidate FROM album_matches m JOIN albums a ON a.key = m.key WHERE a.title = ?").get(t);
    const printed = () => { try { return ctx.db.raw.prepare("SELECT path, fingerprint, made_at FROM track_fingerprints ORDER BY path").all(); } catch (e) { return []; } };
    await until(async () => (await api("status")).index_count >= 2);
    await api("identify/settings", { schedule: false });
    // Looked at by name alone (no key yet): no search places it. Then the Album Scanner off: by hand only from here.
    await until(() => row("Rip 1") && row("Rip 2"));
    assert.equal(row("Rip 1").status, "unidentified");
    assert.equal((await api("album-scanner", { on: false })).on, false);
    const albums = await until(async () => { const x = await api("library/albums"); const a = x.albums || []; return a.length >= 2 && a; });
    const offset = t => albums.find(a => a.title === t).offset;
    const done = async t => until(async () => { const j = await api("identify/sound?offset=" + offset(t)); return j.state === "done" && j; }, 90000);

    // No key: said at once, nothing fingerprinted, nothing asked.
    assert.equal((await api("identify/sound?offset=" + offset("Rip 1"))).state, "none");
    assert.equal((await api("identify/sound", { offset: offset("Rip 1") })).status, 200);
    assert.deepEqual([(await done("Rip 1")).answer, printed().length, aid.requests.length], ["needs-key", 0, 0]);

    // A key refused: said, nothing fingerprinted.
    assert.equal((await api("settings/acoustid-key", { key: "wrong-key" })).check, "invalid");
    await api("identify/sound", { offset: offset("Rip 1") });
    assert.deepEqual([(await done("Rip 1")).answer, printed().length], ["refused", 0]);

    // A key that works: the albums left unsure wait for the scanner, which is off; the tally says so.
    const saved = await api("settings/acoustid-key", { key: "good-key" });
    assert.equal(saved.check, "ok");
    assert.deepEqual((await api("settings/acoustid-key")).sound, { matched: 0, waiting: 2, held: "off" });

    // The first track's fingerprint kept for the file as it is: sent as kept, never made again.
    const t1 = ctx.db.raw.prepare("SELECT path, size, mtime FROM tracks WHERE path = ?").get(rip[0]);
    ctx.db.raw.exec("CREATE TABLE IF NOT EXISTS track_fingerprints (path TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL, fingerprint TEXT, error TEXT, made_at INTEGER NOT NULL)");
    ctx.db.raw.prepare("INSERT INTO track_fingerprints(path, size, mtime, fingerprint, error, made_at) VALUES(?, ?, ?, 'kept-print-1', NULL, 1)").run(t1.path, t1.size, t1.mtime);

    // One at a time: a slow AcoustID keeps Rip 1's job under way; Rip 2 asked meanwhile is told which album; Rip 1 asked again is the same job.
    aid.delayMs = 700;
    const first = await api("identify/sound", { offset: offset("Rip 1") });
    assert.equal(first.status, 200);
    assert.ok(["fingerprinting", "asking"].includes(first.state), first.state);
    const busy = await api("identify/sound", { offset: offset("Rip 2") });
    assert.equal(busy.status, 409);
    assert.match(busy.error, /Already matching “Rip 1” by sound/);
    assert.equal((await api("identify/sound?offset=" + offset("Rip 2"))).state, "busy");
    assert.equal((await api("identify/sound", { offset: offset("Rip 1") })).status, 200, "the same album: the job under way");
    // Its progress: the tracks fingerprinted, then AcoustID asked track by track.
    const asking = await until(async () => { const j = await api("identify/sound?offset=" + offset("Rip 1")); return j.state === "asking" && j; }, 60000);
    assert.equal(asking.of, 4);
    const j = await done("Rip 1");
    aid.delayMs = 0;
    assert.equal(j.answer, null, JSON.stringify(j));
    const fps = aid.lookups().slice(-4).map(x => x.fingerprint);
    assert.deepEqual(fps, ["kept-print-1", ...fpRip.slice(1)], "the kept fingerprint sent, the rest made now");
    assert.deepEqual(printed().map(p => [p.path, p.fingerprint]), rip.map((p, i) => [p, i === 0 ? "kept-print-1" : fpRip[i]]));
    assert.equal(printed()[0].made_at, 1, "the kept one not made again");

    // The release offered by sound, as 414b words it.
    const r = j.releases[0];
    assert.deepEqual([r.mbid, r.title, r.artist, r.year, r.heard, r.tracks_heard], ["hidden-gem", "Hidden Gem", "Real Artist", 1999, 4, 4]);
    assert.deepEqual(r.reasons.slice(0, 2), ["matched by sound: 4 of 4 tracks", "4 of 4 tracks' lengths agree"]);
    assert.equal(r.confidence, 95);
    assert.equal(row("Rip 1").status, "unidentified", "nothing written until one is chosen");

    // Applied as any match chosen by hand: the names written, the reason kept, Undo ready; the tally counts it.
    assert.equal((await api("identify/match", { offset: offset("Rip 1"), query: "hidden-gem", how: "sound" })).status, 200);
    const m = row("Rip 1");
    const cand = JSON.parse(m.candidate);
    assert.deepEqual([m.status, m.mbid, cand.manual, cand.sound_of], ["applied", "hidden-gem", "sound", "4/4"]);
    const ed = await api("album/edit?offset=" + offset("Rip 1"));
    assert.deepEqual([ed.title, ed.artist, ed.year], ["Hidden Gem", "Real Artist", "1999"]);
    assert.equal(ed.match.reasons[0], "matched by sound: 4 of 4 tracks, chosen by you");
    assert.equal(ed.match.manual, "sound");
    assert.equal(ed.match.confidence, 95, "as sure as it was offered: the evidence is the scan's own");
    assert.ok(ctx.logs.some(l => /Rip 1 → Real Artist — Hidden Gem \(by sound/.test(l)), "said in the log");
    assert.deepEqual((await api("settings/acoustid-key")).sound, { matched: 1, waiting: 1, held: "off" });

    // AcoustID knowing none of Rip 2's tracks: no match; its fingerprints kept, not made again when asked again, busy.
    await api("identify/sound", { offset: offset("Rip 2") });
    assert.equal((await done("Rip 2")).answer, "no-match");
    const made = printed().filter(p => other.includes(p.path));
    assert.deepEqual(made.map(p => p.fingerprint), fpOther);
    aid.limited = true;
    await api("identify/sound", { offset: offset("Rip 2") });
    const limited = await done("Rip 2");
    assert.equal(limited.answer, "limited");
    assert.match(limited.error, /AcoustID asks to wait/);
    assert.deepEqual(printed().filter(p => other.includes(p.path)).map(p => p.made_at), made.map(p => p.made_at), "kept, not made again");
  } finally {
    await srv.stop();
    await Promise.all([mb.stop(), aid.stop(), itunes.stop()]);
  }
});
