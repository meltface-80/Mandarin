"use strict";
/*
 * Identification, item 414c: an album still unsure once its files, its lengths, the search by name and the edition
 * have had their say is matched by sound — each track's Chromaprint fingerprint (Identify/Chromaprint.cs, held to
 * fpcalc's by test/Mandarin.Tests/ChromaprintTests.cs) looked up on AcoustID, a fake one here on loopback
 * (test/fake-acoustid.js) beside the fake MusicBrainz:
 *   - a mis-tagged album no search by name can place: matched by sound, applied, its reasons and its confidence;
 *   - a split vote: the release most of the tracks are on, proposed (too few agree to apply it unasked);
 *   - an album applied by name, one matched by hand, one edited by hand: never fingerprinted, never asked about;
 *   - a release turned down stays turned down; the fingerprints are kept and used again on a retry, and a file
 *     changed since is fingerprinted again;
 *   - no more than three requests a second;
 *   - no key, a key AcoustID refuses, AcoustID busy or not reached: the step skipped quietly, the readout saying why.
 * And the key itself, kept through a sealed backup and its restore (no page asks for it since item 491).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
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

// Each track a chord of its own (three notes of the scale, no two tracks alike), so each has a fingerprint of its own.
let voice = 0;
function track(dir, i, tags, seconds) {
  const n = voice++;
  const hz = k => (220 * Math.pow(2, k / 12)).toFixed(3);
  const [a, b, c] = [n % 12, 12 + (n * 5 + 3) % 12, 24 + (n * 7 + 1 + 2 * Math.floor(n / 12)) % 12];
  const expr = `0.35*sin(2*PI*${hz(a)}*t)+0.25*sin(2*PI*${hz(b)}*t)+0.15*sin(2*PI*${hz(c)}*t)`;
  const file = path.join(dir, `0${i}.flac`);
  gen(file, { seconds, expr, tags: Object.assign({ track: i }, tags) });
  return file;
}
/* An album's files: [lengths] in seconds; the tracks named "Track n" unless [names]. */
function album(music, artist, title, lengths, names) {
  const dir = path.join(music, artist, title);
  return lengths.map((s, i) => track(dir, i + 1, { title: names ? names[i] : "Track " + (i + 1), artist, album: title }, s));
}
/* Each file's fingerprint, as the server makes it (`mandarin-server score`, the scan's own decoding). */
const prints = files => score({ fn: "scorecall", calls: files.map(file => ["fingerprint", { file }]) }).results;

async function started(lib, mb, aid, itunes, more = {}) {
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer(Object.assign({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl, acoustidBaseUrl: aid ? aid.baseUrl : "http://127.0.0.1:9/v2" }, more));
  const ctx = await srv.start();
  const token = await signIn(base);
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) }
      : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const printed = () => { try { return ctx.db.raw.prepare("SELECT path, fingerprint, made_at FROM track_fingerprints ORDER BY path").all(); } catch (e) { return []; } };
  const row = t => ctx.db.raw.prepare("SELECT m.status, m.mbid, m.checked_at, m.candidate FROM album_matches m JOIN albums a ON a.key = m.key WHERE a.title = ?").get(t);
  return { srv, ctx, base, token, api, printed, row };
}

test("item 414c end to end: matched by sound, a split vote, never what's applied or yours, a decline kept, fingerprints kept, three a second", { skip, timeout: 280000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const rip = album(lib.music, "Unknown Artist", "Rip 1", [4, 5, 6, 7]);
  const split = album(lib.music, "Artist S", "Split Rip", [4, 5, 6, 7, 8]);
  const named = album(lib.music, "Artist N", "Named Right", [5, 6, 7], ["Uno", "Dos", "Tres"]);
  const hand = album(path.join(lib.root, "later"), "Artist H", "Hand Rip", [4, 5, 6]);
  const edited = album(path.join(lib.root, "later"), "Artist E", "Edited Rip", [5, 6, 7]);
  const late = album(path.join(lib.root, "later"), "Artist L", "Late Rip", [6, 7, 8]);
  const fp = prints([...rip, ...split, ...named, ...hand, ...edited, ...late]);
  assert.equal(new Set(fp).size, fp.length, "each track a fingerprint of its own");
  const [fpRip, fpSplit, fpNamed, fpHand, fpEdited, fpLate] = [fp.slice(0, 4), fp.slice(4, 9), fp.slice(9, 12), fp.slice(12, 15), fp.slice(15, 18), fp.slice(18, 21)];

  const d = {
    gem: { id: "hidden-gem", title: "Hidden Gem", artist: "Real Artist", date: "1999-01-01", tracks: [["Opening", 4], ["Second", 5], ["Third", 6], ["Closing", 7]] },
    major: { id: "split-major", title: "Major Work", artist: "Artist S", date: "2004-01-01", tracks: [["Alpha", 4], ["Beta", 5], ["Gamma", 6], ["Delta", 7], ["Epsilon", 8]] },
    minor: { id: "split-minor", title: "Minor Comp", artist: "Various Artists", date: "2010-01-01", tracks: [["Delta", 7], ["Epsilon", 8], ["Other", 200]] },
    named: { id: "named-right", title: "Named Right", artist: "Artist N", date: "2001-01-01", tracks: [["Uno", 5], ["Dos", 6], ["Tres", 7]] },
    hand: { id: "hand-chosen", title: "Hand Chosen", artist: "Artist H", date: "2002-01-01", tracks: [["H1", 4], ["H2", 5], ["H3", 6]] },
    edited: { id: "edited-real", title: "Edited Real", artist: "Artist E", date: "2003-01-01", tracks: [["E1", 5], ["E2", 6], ["E3", 7]] },
    late: { id: "late-real", title: "Late Real", artist: "Artist L", date: "2005-01-01", tracks: [["L1", 6], ["L2", 7], ["L3", 8]] }
  };
  const mb = await new FakeMusicBrainz(Object.values(d)).start();
  const r = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, release(v)]));
  const aid = await new FakeAcoustId().start();
  fpRip.forEach((f, i) => aid.know(f, [[r.gem, i + 1]]));
  // The split: three tracks on the major work only, the last two on the compilation only.
  fpSplit.forEach((f, i) => aid.know(f, i < 3 ? [[r.major, i + 1]] : [[r.minor, i - 2]]));
  for (const [list, rel] of [[fpNamed, r.named], [fpHand, r.hand], [fpEdited, r.edited], [fpLate, r.late]]) list.forEach((f, i) => aid.know(f, [[rel, i + 1]]));
  const itunes = await new FakeITunes([]).start();
  const s = await started(lib, mb, aid, itunes);
  const { api, printed, row, ctx } = s;
  try {
    await until(async () => (await api("status")).index_count >= 3);
    await api("identify/settings", { schedule: false });
    assert.equal((await api("settings/acoustid-key", { key: "good-key" })).check, "ok");
    let j = await until(async () => { const x = await api("identify?lists=50"); return x.progress.eligible === 3 && x.progress.checked === 3 && x; }, 120000);
    const named1 = (list, t) => j[list].find(x => x.album.title === t);

    // Matched by sound: applied, though no search by name could place it.
    const gem = named1("applied", "Hidden Gem");
    assert.ok(gem, JSON.stringify(Object.fromEntries(["applied", "proposed", "unidentified"].map(k => [k, j[k].map(x => x.album.title)]))) + "\n" + ctx.logs.filter(l => l.includes("[identify]")).join("\n"));
    assert.deepEqual([gem.candidate.mbid, gem.candidate.matched_by, JSON.parse(row("Rip 1").candidate).sound_of], ["hidden-gem", "acoustid", "4/4"]);
    assert.deepEqual(gem.reasons.slice(0, 2), ["matched by sound: 4 of 4 tracks", "4 of 4 tracks' lengths agree"]);
    assert.equal(gem.confidence, 95, "every track agreeing, every length: 85 and ten for the share");
    assert.ok(ctx.logs.some(l => /Rip 1: matched by sound \(4 of 4 tracks\) → Real Artist — Hidden Gem/.test(l)), "said in the log");

    // The split vote: the release most of the tracks are on, three of five, proposed (too few to apply it unasked).
    const sp = named1("proposed", "Split Rip") || named1("unidentified", "Split Rip");
    assert.ok(sp, JSON.stringify(j.proposed.map(x => x.album.title)));
    assert.deepEqual([sp.candidate.mbid, sp.reasons[0]], ["split-major", "matched by sound: 3 of 5 tracks"]);
    assert.equal(row("Split Rip").status, "proposed", "every track and length agreeing: proposed");

    // Applied by name: never fingerprinted, never asked about.
    assert.equal(named1("applied", "Named Right").candidate.matched_by, null);
    const asked = () => new Set(aid.lookups().map(x => x.fingerprint));
    const madeFor = files => printed().filter(p => files.includes(p.path));
    assert.deepEqual([madeFor(named).length, fpNamed.filter(f => asked().has(f)).length], [0, 0]);
    assert.deepEqual(madeFor(rip).map(p => p.fingerprint), fpRip, "kept as made");
    assert.ok(aid.lookups().every(x => x.client === "good-key" && /recordings/.test(x.meta) && /releasegroups/.test(x.meta) && Number(x.duration) >= 4));

    // Not this: turned down; looked at again, the fingerprints kept are used again and the release stays turned down.
    const before = madeFor(split);
    assert.equal(before.length, 5);
    assert.equal((await api("identify/reject", { offset: sp.album.offset })).status, 200);
    // One file touched since: fingerprinted again, the rest not.
    const at = new Date(Date.now() + 5000);
    fs.utimesSync(split[0], at, at);
    await fetch(s.base + "/api/library/rescan", { method: "POST", headers: { Authorization: "Bearer " + s.token } });
    await until(() => ctx.db.raw.prepare("SELECT mtime FROM tracks WHERE path = ?").get(split[0]).mtime >= Math.floor(at.getTime() / 1000) - 1, 30000);
    const lookups = aid.lookups().length;
    await api("identify/recheck", { offset: sp.album.offset });
    await until(() => aid.lookups().length >= lookups + 5 && row("Split Rip").checked_at > 0 && row("Split Rip").status !== "rejected", 60000);
    await until(() => row("Split Rip").status === "unidentified", 30000);
    assert.notEqual(row("Split Rip").mbid, "split-major", "turned down, never proposed again");
    const after = madeFor(split);
    assert.notEqual(after[0].made_at, before[0].made_at, "the file touched: fingerprinted again");
    assert.deepEqual(after.slice(1).map(p => p.made_at), before.slice(1).map(p => p.made_at), "the rest: kept, not made again");

    // Matched and edited by hand: never fingerprinted. The scanner off while they come, a third album as the control.
    assert.equal((await api("album-scanner", { on: false })).on, false);
    fs.renameSync(path.join(lib.root, "later", "Artist H"), path.join(lib.music, "Artist H"));
    fs.renameSync(path.join(lib.root, "later", "Artist E"), path.join(lib.music, "Artist E"));
    fs.renameSync(path.join(lib.root, "later", "Artist L"), path.join(lib.music, "Artist L"));
    const moved = list => list.map(f => f.replace(path.join(lib.root, "later"), lib.music));
    await fetch(s.base + "/api/library/rescan", { method: "POST", headers: { Authorization: "Bearer " + s.token } });
    const albums = await until(async () => { const x = await api("library/albums"); const a = (x.albums || x).filter ? (x.albums || x) : []; return a.length >= 6 && a; }, 30000);
    const offset = t => albums.find(a => a.title === t).offset;
    assert.equal((await api("identify/match", { offset: offset("Hand Rip"), query: "hand-chosen", how: "pick" })).status, 200);
    assert.equal((await api("album/edit", { offset: offset("Edited Rip"), title: "Edited By Me" })).status, 200);
    assert.equal((await api("album-scanner", { on: true })).on, true);
    await until(() => { const x = row("Late Rip"); return x && x.status === "applied" && x; }, 60000);
    assert.equal(row("Late Rip").mbid, "late-real", "the control: matched by sound");
    assert.deepEqual([madeFor(moved(hand)).length, madeFor(moved(edited)).length, madeFor(moved(late)).length], [0, 0, 3]);
    assert.deepEqual([...fpHand, ...fpEdited].filter(f => asked().has(f)), [], "never asked about");
    assert.equal(row("Hand Rip").mbid, "hand-chosen", "still the one you chose");

    // Never more than three a second: four requests in a row span a second at least.
    const times = aid.requests.map(x => x.at);
    assert.ok(times.length >= 15, String(times.length));
    for (let i = 3; i < times.length; i++) assert.ok(times[i] - times[i - 3] >= 950, `requests ${i - 3}–${i}: ${times[i] - times[i - 3]} ms`);
  } finally {
    await s.srv.stop();
    await Promise.all([mb.stop(), aid.stop(), itunes.stop()]);
  }
});

test("no key, a key refused, AcoustID busy or not reached: skipped quietly, the readout saying why", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const rip = album(lib.music, "Unknown Artist", "Lost Rip", [4, 5, 6]);
  const gem = { id: "lost-gem", title: "Lost Gem", artist: "Real Artist", date: "1999-01-01", tracks: [["One", 4], ["Two", 5], ["Three", 6]] };
  const mb = await new FakeMusicBrainz([gem]).start();
  const aid = await new FakeAcoustId({ keys: ["good-key", "good-key-2"] }).start();
  prints(rip).forEach((f, i) => aid.know(f, [[release(gem), i + 1]]));
  const itunes = await new FakeITunes([]).start();
  const s = await started(lib, mb, aid, itunes);
  const { api, printed, row } = s;
  const scanner = () => api("album-scanner");
  try {
    await until(async () => (await api("status")).index_count >= 1);
    await api("identify/settings", { schedule: false });
    // No key: looked at by name alone, nothing fingerprinted, nothing asked; the readout says what it needs.
    await until(() => row("Lost Rip"));
    assert.equal(row("Lost Rip").status, "unidentified");
    assert.deepEqual([printed().length, aid.requests.length], [0, 0]);
    assert.equal((await scanner()).sound, "needs-key");
    assert.deepEqual(await api("settings/acoustid-key"), { status: 200, set: false, configured: false, masked: "", check: null });

    // A key AcoustID refuses: said so on the row and in the readout; nothing fingerprinted.
    const bad = await api("settings/acoustid-key", { key: "wrong-key" });
    assert.deepEqual([bad.ok, bad.set, bad.masked, bad.check], [true, true, "••••-key", "invalid"]);
    assert.equal((await scanner()).sound, "refused");
    assert.equal(printed().length, 0);

    // AcoustID busy: the key's check can't tell; the album looked at again (a new key), its lookups refused, skipped.
    aid.limited = true;
    const busy = await api("settings/acoustid-key", { key: "good-key" });
    assert.equal(busy.check, "unknown", "no answer either way is no verdict on the key");
    await until(async () => (await scanner()).sound === "limited", 60000);
    await until(() => row("Lost Rip").checked_at > 0);
    assert.equal(row("Lost Rip").status, "unidentified");
    assert.equal(printed().length, 3, "fingerprinted, then the lookups refused");
    assert.ok(s.ctx.logs.some(l => /matching by sound skipped: AcoustID asks to wait/.test(l)));

    // Not reached: the same.
    aid.limited = false;
    await aid.stop();
    const away = await api("settings/acoustid-key", { key: "good-key-2" });
    assert.equal(away.check, "unknown");
    await until(async () => (await scanner()).sound === "unreachable", 60000);
    assert.equal(row("Lost Rip").status, "unidentified");
    assert.equal(printed().length, 3, "the fingerprints kept, not made again");
  } finally {
    await s.srv.stop();
    await Promise.all([mb.stop(), itunes.stop(), aid.stop()]);   // stopped twice is stopped: a failure before it is let go too
  }
});

test("no API Keys page, on the web or in the app (item 494); a key saved kept through a sealed backup", { skip: rules, timeout: 120000 }, async () => {
  // AcoustID's and FanArt.tv's keys Mandarin's own since item 491, Discogs gone with the labels (item 492), Last.fm's
  // shared secret with scrobbling (item 493) and its key with the similar lists (item 494): nothing left to ask for.
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  for (const gone of ['data-pane="metadata"', "settings-keys", "lastfm-key", "API Keys"]) assert.ok(!html.includes(gone), gone);
  const kt = fs.readFileSync(path.join(root, "android", "core", "src", "main", "kotlin", "com", "musicd", "server", "client", "Settings.kt"), "utf8");
  assert.doesNotMatch(kt, /ApiKeySpec|API Keys/);

  // The key in a backup sealed with a passphrase: in no part of the file in the clear; back with the passphrase.
  const lib = makeLibrary();
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    const token = await signIn(base);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    ctx.db.setSetting("acoustidKey", "secret-acoustid-414c");
    const boot = async () => { try { return (await (await fetch(base + "/server-info")).json()).boot; } catch (e) { return null; } };
    const boot0 = await boot();
    const pass = "a long enough passphrase";
    const r = await fetch(base + "/api/backup/file", { method: "POST", headers: H, body: JSON.stringify({ include: ["settings", "keys"], passphrase: pass }) });
    assert.equal(r.status, 200);
    const file = Buffer.from(await r.arrayBuffer());
    assert.ok(!zlib.gunzipSync(file).toString("latin1").includes("secret-acoustid-414c"), "sealed: not in the file in the clear");
    ctx.db.setSetting("acoustidKey", "other");
    const back = await fetch(base + "/api/backup/restore?parts=keys", { method: "POST", body: file,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/gzip", "X-Mandarin-Passphrase": Buffer.from(pass, "utf8").toString("base64") } });
    assert.equal(back.status, 200, await back.clone().text());
    assert.deepEqual((await back.json()).restored, ["keys"]);
    assert.equal(ctx.db.setting("acoustidKey"), "secret-acoustid-414c");
    for (let i = 0; i < 300; i++) { const b = await boot(); if (b && b !== boot0) break; await new Promise(x => setTimeout(x, 100)); }
  } finally { await srv.stop(); }
});
