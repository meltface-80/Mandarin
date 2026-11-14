"use strict";
/*
 * Identification, item 414b: one confidence (0–100) with reasons in plain words for every verdict, built from all its
 * evidence — how it was found, the tracks' count and lengths, the names; deciding only where it adds evidence (found by
 * what the files carry with every track and length agreeing: applied; a near miss whose every track and length agree:
 * proposed), every verdict of the existing fixtures what it was. Then the review: To confirm's Apply and Not this, a
 * release turned down never proposed again, the kind of edition chosen for an artist preferred for its others, and a
 * new MusicBrainz pack re-queueing what is unidentified (never what was declined or matched by hand). The rules through
 * `mandarin-server score` (Identify/ScoreCalls.cs), the rest against a fake MusicBrainz on loopback.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const http = require("http");
const zlib = require("zlib");
const crypto = require("crypto");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { FakeITunes } = require("./fake-itunes");
const { createServer, built } = require("./server");
const { score } = require("./score");

const rules = built();
const skip = rules || (!haveFfmpeg() && "ffmpeg is not installed");

function ask(calls) {
  const names = Object.keys(calls);
  const { results } = score({ fn: "scorecall", calls: names.map(k => calls[k]) });
  return Object.fromEntries(names.map((k, i) => [k, results[i]]));
}

async function until(fn, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 50));
  }
}

const album = (over = {}) => Object.assign({
  title: "Kid A", artist: "Radiohead", year: 2000,
  tracks: [["Everything in Its Right Place", 251], ["Kid A", 284], ["The National Anthem", 351], ["How to Disappear Completely", 356]].map(([title, length]) => ({ title, length }))
}, over);
const cand = (over = {}) => Object.assign({ mbid: "x" }, album(), over);
// The copy's tracks under a ripper's names: the release's lengths, none of its names.
const ripped = (over = {}) => album(Object.assign({ title: "Unknown Disc", tracks: album().tracks.map((t, i) => ({ title: "Track " + (i + 1), length: t.length })) }, over));

test("confidence and its reasons, for each way of finding a match", { skip: rules }, () => {
  const r = ask({
    id: ["confidence", album(), cand({ matched_by: "musicbrainz-id" }), false, "musicbrainz-id"],
    barcode: ["confidence", album(), cand({ matched_by: "barcode", from_pack: true }), false, "barcode"],
    catno: ["confidence", album(), cand({ matched_by: "catalogue-number" }), false, "catalogue-number"],
    isrc: ["confidence", album(), cand({ matched_by: "isrc", isrc_of: "2/3" }), false, "isrc"],
    disc: ["confidence", album(), cand({ matched_by: "disc-lengths", release_year: 1997 }), false, "disc-lengths"],
    name: ["confidence", album(), cand(), false, null],
    itunes: ["confidence", album(), cand({ source: "itunes" }), false, null],
    chosen: ["confidence", album(), cand({ manual: "edition" }), false, null],
    // A pressing with a track the copy hasn't, one length off, another release as near, a misspelt artist.
    bigger: ["confidence", album(), cand({ tracks: album().tracks.concat([{ title: "Bonus", length: 200 }]) }), false, null],
    off: ["confidence", album(), cand({ tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + 60 } : t) }), false, null],
    twin: ["confidence", album(), cand(), true, null],
    spelt: ["confidence", album(), cand({ artist: "Radiohed" }), false, null],
    // The ripper's names: by name 60 % alike; found by the barcode, every length agreeing, 92 and applied.
    ripName: ["confidence", ripped(), cand(), false, null],
    ripBarcode: ["confidence", ripped(), cand({ matched_by: "barcode" }), false, "barcode"],
    ripOneOff: ["confidence", ripped(), cand({ matched_by: "barcode", tracks: album().tracks.map((t, i) => i === 0 ? { title: t.title, length: t.length + 60 } : t) }), false, "barcode"]
  });
  const first = k => r[k].reasons[0];
  assert.equal(first("id"), "found by the MusicBrainz ID in its files");
  assert.equal(first("barcode"), "found by its barcode, in the MusicBrainz pack");
  assert.equal(first("catno"), "found by its catalogue number");
  assert.equal(first("isrc"), "found by its ISRCs (2 of 3)");
  assert.equal(first("disc"), "the tracks' lengths match the 1997 CD");
  assert.equal(first("name"), "found by name only");
  assert.equal(first("itunes"), "found on iTunes by name");
  assert.equal(first("chosen"), "you chose this edition");
  assert.deepEqual(r.name.reasons, ["found by name only", "4 of 4 tracks' lengths agree", "title and artist agree"]);
  assert.deepEqual([r.id, r.name, r.disc].map(x => x.confidence), [100, 100, 100], "identical: 100 however found");
  assert.ok(r.bigger.reasons.includes("one track fewer than this edition"), JSON.stringify(r.bigger.reasons));
  assert.ok(r.off.reasons.includes("3 of 4 tracks' lengths agree"), JSON.stringify(r.off.reasons));
  assert.ok(r.twin.reasons.includes("another release fits as well"));
  assert.equal(r.twin.confidence, 90, "ten less when another fits as well");
  assert.ok(r.spelt.reasons.includes("the title agrees, the artist is spelt differently"), JSON.stringify(r.spelt.reasons));
  // The ripper's names: what the name alone says, and what the barcode with every length adds.
  assert.ok(r.ripName.similarity < 85, String(r.ripName.similarity));
  assert.equal(r.ripName.confidence, r.ripName.similarity);
  assert.deepEqual([r.ripName.agrees, r.ripName.strong], [true, false]);
  assert.ok(r.ripName.reasons.includes("track names differ") && r.ripName.reasons.includes("the artist agrees, the title differs"), JSON.stringify(r.ripName.reasons));
  assert.deepEqual([r.ripBarcode.confidence, r.ripBarcode.strong], [92, true]);
  assert.deepEqual(r.ripBarcode.reasons.slice(0, 2), ["found by its barcode", "4 of 4 tracks' lengths agree"]);
  // One length off: no longer every track agreeing, five more than the names alone, not applied for it.
  assert.equal(r.ripOneOff.strong, false);
  assert.equal(r.ripOneOff.confidence, Math.min(100, r.ripOneOff.similarity + 5));
});

test("judged: the existing fixtures' verdicts unchanged; a near miss whose every length agrees proposed; one turned down never", { skip: rules }, () => {
  const off = cand({ tracks: album().tracks.map((t, i) => i === 1 ? { title: t.title, length: t.length + 40 } : t) });
  const other = cand({ mbid: "ok", title: "OK Computer", tracks: [["Airbag", 284], ["Paranoid Android", 383], ["Subterranean Homesick Alien", 267], ["Exit Music", 264]].map(([title, length]) => ({ title, length })) });
  const twin = cand({ mbid: "y", title: "Kid A", artist: "Radio Head" });
  const blank = cand({ tracks: album().tracks.map(t => ({ title: t.title, length: null })) });
  const g = { group_mbid: "g1" };
  const bonus = cand(Object.assign({ mbid: "y", tracks: album().tracks.concat([{ title: "Bonus", length: 180 }]) }, g));
  // identify.test.js's own: what each was decided, it still is.
  const fixtures = {
    same: [album(), [cand()]], off: [album(), [off]], other: [album(), [other]], amb: [album({ artist: "Various Artists" }), [cand(), twin]],
    countries: [album(), [cand(), cand({ mbid: "y" })]], none: [album(), []], blank: [album(), [blank]], bonus: [album(), [cand(g), bonus]],
    wrongArtist: [album({ artist: "Coldplay" }), [cand()]]
  };
  const r = ask(Object.assign(Object.fromEntries(Object.entries(fixtures).map(([k, [a, cs]]) => [k, ["judge", a, cs]])), {
    // The ripper's names, found by name: every track and length agreeing, proposed with the other release kept to pick.
    rip: ["judge", ripped(), [cand(), other]],
    // Turned down: never proposed again; the other one, unlike, left unidentified.
    declined: ["judge", Object.assign(ripped(), { declined: ["x"] }), [cand(), other]],
    // Turned down another for it: what fits is proposed, not applied unasked.
    after: ["judge", Object.assign(album(), { declined: ["z"] }), [cand()]]
  }));
  for (const k of Object.keys(fixtures)) assert.equal(r[k].status, r[k].decided, k + ": " + r[k].decided + " → " + r[k].status);
  assert.deepEqual(Object.keys(fixtures).map(k => r[k].status), ["applied", "applied", "unidentified", "applied", "applied", "unidentified", "applied", "applied", "applied"]);
  assert.ok(r.same.best.confidence === 100 && r.same.best.reasons[0] === "found by name only", JSON.stringify(r.same.best));
  assert.equal(r.same.best.others, undefined, "applied: nothing kept to pick instead");
  assert.deepEqual([r.rip.decided, r.rip.status, r.rip.best.mbid], ["unidentified", "proposed", "x"]);
  assert.ok(r.rip.best.confidence >= 60 && r.rip.best.confidence < 85, String(r.rip.best.confidence));
  assert.deepEqual(r.rip.best.others.map(o => o.title), ["OK Computer"]);
  assert.deepEqual([r.declined.status, r.declined.best.title], ["unidentified", "OK Computer"]);
  assert.ok(r.declined.best.reasons.includes("you turned down another release for it"), JSON.stringify(r.declined.best.reasons));
  assert.deepEqual([r.after.decided, r.after.status], ["applied", "proposed"]);
});

/* A pack of one release, as the pack builder writes it (test/Mandarin.Tests/IdentifyPackTests.cs's WritePack). */
function writePack(file) {
  const Database = require("better-sqlite3");
  const db = new Database(file);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE groups (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, title TEXT, note TEXT, type TEXT, first INTEGER);
    CREATE TABLE releases (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, grp INTEGER, title TEXT, artist TEXT, note TEXT,
      status TEXT, barcode TEXT, code TEXT, date INTEGER, country TEXT, format TEXT, tracks TEXT);
    CREATE INDEX releases_code ON releases (code); CREATE INDEX releases_gid ON releases (gid);`);
  const blob = g => Buffer.from(g.replace(/-/g, ""), "hex");
  for (const [k, v] of [["format", "1"], ["releases", "1"], ["built", "2026-10-04T00:00:00Z"]]) db.prepare("INSERT INTO meta VALUES (?, ?)").run(k, v);
  db.prepare("INSERT INTO groups VALUES (1, ?, 'The Bar Album', '', 'Album', 20010000)").run(blob("7a0f0c3e-0000-4222-8333-944455556666"));
  db.prepare("INSERT INTO releases VALUES (1, ?, 1, 'The Bar Album', 'Tagger', '', 'Official', '0602537000016', '602537000016', 20010000, 'GB', 'CD', ?)")
    .run(blob("7a0f0c3e-1111-4222-8333-944455556666"), JSON.stringify([[1, 1, "Bar Album 1", 3], [1, 2, "Bar Album 2", 3], [1, 3, "Bar Album 3", 3]]));
  db.close();
}

test("item 414b end to end: applied by the barcode, To confirm's Apply and Not this, never again, the edition kind learnt, a new pack", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const flac = (dir, i, tags, seconds) => gen(path.join(lib.music, dir, `0${i}.flac`), { freq: 200 + 40 * i, seconds, tags });
  const rip = (dir, artist, title, lengths, extra = {}) => lengths.forEach((s, i) => flac(dir, i + 1, Object.assign({ title: "Track " + (i + 1), artist, album: title, track: i + 1 }, extra), s));
  // A rip under the ripper's names with the release's barcode: found by it, every length agreeing.
  rip("Artist M/Coded Rip", "Artist M", "Coded Rip", [3, 4, 5, 6], { BARCODE: "5099902987729" });
  // Rips with their names but not their tracks' names: found by name, every length agreeing, proposed.
  rip("Artist N/Near Miss", "Artist N", "Near Miss", [4, 5, 6]);
  rip("Artist N/Near Two", "Artist N", "Near Two", [5, 6, 7]);
  rip("Artist N/Near Three", "Artist N", "Near Three", [6, 7, 8]);
  // Two records of one act, each pressed in Britain first and in Japan later, the pressings alike to the second.
  for (const t of ["First P", "Second P"]) for (const i of [1, 2]) flac("Artist P/" + t, i, { title: `${t} ${i}`, artist: "Artist P", album: t, track: i }, 3 + i);
  // What only the pack knows, by its barcode.
  for (const i of [1, 2, 3]) flac("Tagger/Bar Album", i, { title: `Bar Album ${i}`, artist: "Tagger", album: "Bar Album", track: i, BARCODE: "0602537000016" }, 3);
  const pressed = (t, c, date) => ({ id: `${t.toLowerCase().replace(" ", "-")}-${c.toLowerCase()}`, title: t, artist: "Artist P", country: c, date,
    group: { id: "g-" + t.toLowerCase().replace(" ", "-"), title: t, date: "2001-01-01" }, tracks: [[`${t} 1`, 4], [`${t} 2`, 5]] });
  const mb = await new FakeMusicBrainz([
    { id: "coded", title: "Proper Title", artist: "Artist M", date: "1997-01-01", barcode: "5099902987729", tracks: [["Alpha", 3], ["Beta", 4], ["Gamma", 5], ["Delta", 6]] },
    { id: "near-miss", title: "Near Miss", artist: "Artist N", date: "2003-01-01", tracks: [["Uno", 4], ["Dos", 5], ["Tres", 6]] },
    { id: "near-miss-other", title: "Near Miss", artist: "Someone Else", date: "1980-01-01", tracks: [["Uno", 100], ["Dos", 200], ["Tres", 300]] },
    { id: "near-two", title: "Near Two", artist: "Artist N", date: "2004-01-01", tracks: [["Eins", 5], ["Zwei", 6], ["Drei", 7]] },
    { id: "near-three", title: "Near Three", artist: "Artist N", date: "2005-01-01", tracks: [["Un", 6], ["Deux", 7], ["Trois", 8]] },
    pressed("First P", "GB", "2001-01-01"), pressed("First P", "JP", "2005-01-01"), pressed("Second P", "GB", "2001-01-01"), pressed("Second P", "JP", "2005-01-01")
  ]).start();
  const itunes = await new FakeITunes([]).start();
  // The pack, published where the server looks for it.
  const packDir = fs.mkdtempSync(path.join(lib.data, "..", "pack-"));
  writePack(path.join(packDir, "built.sqlite"));
  const gz = zlib.gzipSync(fs.readFileSync(path.join(packDir, "built.sqlite")));
  const desc = { format: 1, built: "2026-10-05T00:00:00Z", releases: "1", file: "mbpack-1.sqlite.gz", gz_size: gz.length,
    size: fs.statSync(path.join(packDir, "built.sqlite")).size, sha256: crypto.createHash("sha256").update(gz).digest("hex") };
  const pub = http.createServer((req, res) => req.url.endsWith(".json") ? res.end(JSON.stringify(desc)) : req.url.endsWith(".gz") ? res.end(gz) : (res.statusCode = 404, res.end()));
  await new Promise(r => pub.listen(0, "127.0.0.1", r));
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl, mbpackUrl: `http://127.0.0.1:${pub.address().port}` });
  const ctx = await srv.start();
  const token = await signIn(base);
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const row = title => ctx.db.raw.prepare("SELECT m.status, m.checked_at, m.mbid FROM album_matches m JOIN albums a ON a.key = m.key WHERE a.title = ?").get(title);
  try {
    await until(async () => (await api("status")).index_count >= 7);
    await api("identify/settings", { schedule: false });
    let r = await until(async () => { const j = await api("identify"); return j.progress.eligible === 7 && j.progress.checked === 7 && j; });
    const named = (list, t) => r[list].find(x => x.album.title === t);

    // Applied by the barcode, though its names alone are 60 % alike: every track and length agreeing.
    const coded = named("applied", "Proper Title");
    assert.ok(coded, JSON.stringify(r.applied.map(x => x.album.title)));
    assert.ok(coded.similarity < 85, String(coded.similarity));
    assert.deepEqual([coded.candidate.matched_by, coded.confidence], ["barcode", 92]);
    assert.deepEqual(coded.reasons.slice(0, 2), ["found by its barcode", "4 of 4 tracks' lengths agree"]);
    const codedEdit = (await api("album/edit?offset=" + coded.album.offset)).match;
    assert.deepEqual([codedEdit.confidence, codedEdit.reasons[0]], [92, "found by its barcode"]);

    // To confirm: the near misses, each with its confidence, its reasons, and the other release kept to pick.
    assert.deepEqual(r.proposed.map(x => x.album.title).sort(), ["Near Miss", "Near Three", "Near Two"]);
    assert.equal(r.counts.proposed, 3);
    const miss = named("proposed", "Near Miss");
    assert.ok(miss.confidence >= 60 && miss.confidence < 85, String(miss.confidence));
    assert.deepEqual(miss.reasons.slice(0, 2), ["found by name only", "3 of 3 tracks' lengths agree"]);
    assert.ok(miss.reasons.includes("track names differ"));
    assert.deepEqual(miss.candidate.others.map(o => [o.mbid, o.artist]), [["near-miss-other", "Someone Else"]]);
    assert.equal((await api("album-scanner")).proposed, 3);

    // Apply: written, the row gone from the list, the folder's count down at once.
    r = await api("identify/accept", { offset: named("proposed", "Near Two").album.offset });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual([r.counts.proposed, r.proposed.some(x => x.album.title === "Near Two")], [2, false]);
    assert.deepEqual((await api("album?offset=" + r.applied.find(x => x.candidate.mbid === "near-two").album.offset)).tracks.map(t => t.title), ["Eins", "Zwei", "Drei"]);
    assert.equal((await api("album-scanner")).proposed, 2);
    // Not this: declined, gone from the list; Near Three stays declined.
    r = await api("identify/reject", { offset: named("proposed", "Near Three").album.offset });
    assert.deepEqual([r.status, r.counts.proposed], [200, 1]);
    r = await api("identify/reject", { offset: miss.album.offset });
    assert.deepEqual([r.counts.proposed, r.proposed.length], [0, 0]);
    assert.equal((await api("album-scanner")).proposed, 0);
    // Looked at again: never proposed again — the other release, unlike, left unidentified.
    await api("identify/recheck", { offset: miss.album.offset });
    r = await until(async () => { const j = await api("identify"); return j.progress.checked === 7 && j.unidentified.some(x => x.album.title === "Near Miss") && j; });
    const again = named("unidentified", "Near Miss");
    assert.equal(again.candidate.mbid, "near-miss-other");
    assert.ok(again.reasons.includes("you turned down another release for it"), JSON.stringify(again.reasons));
    assert.equal(r.counts.proposed, 0);

    // The edition: both records' British pressings applied (the earlier); the Japanese chosen for the first, by hand.
    const first = named("applied", "First P"), second = named("applied", "Second P");
    assert.deepEqual([first.candidate.mbid, second.candidate.mbid], ["first-p-gb", "second-p-gb"]);
    assert.deepEqual(first.candidate.editions.map(e => e.mbid), ["first-p-jp"]);
    r = await api("identify/match", { offset: first.album.offset, query: "first-p-jp", how: "edition" });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.ok(r.applied.find(x => x.album.offset === first.album.offset).reasons.includes("you chose this edition"));
    // The second looked at again: the same kind, and why.
    await api("identify/recheck", { offset: second.album.offset });
    r = await until(async () => { const j = await api("identify"); const x = j.applied.find(a => a.album.title === "Second P"); return x && x.candidate.mbid === "second-p-jp" && j; });
    assert.ok(named("applied", "Second P").reasons.includes("you chose this kind of edition for Artist P before"), JSON.stringify(named("applied", "Second P").reasons));

    // A new pack: the unidentified looked at again (the Bar Album placed from it), never the declined nor the hand-matched.
    assert.ok(named("unidentified", "Bar Album"));
    const before = { three: row("Near Three"), first: row("First P"), miss: row("Near Miss") };
    assert.deepEqual([before.three.status, before.first.status], ["rejected", "applied"]);
    await api("identify/pack/download", {});
    r = await until(async () => { const j = await api("identify"); return j.applied.some(x => x.album.title === "The Bar Album") && j; });
    const bar = named("applied", "The Bar Album");
    assert.deepEqual([bar.candidate.matched_by, bar.candidate.from_pack, bar.reasons[0]], ["barcode", true, "found by its barcode, in the MusicBrainz pack"]);
    assert.ok(ctx.logs.some(l => /a new MusicBrainz pack: \d+ albums? looked at again/.test(l)), "said in the log");
    assert.deepEqual(row("Near Three"), before.three, "declined: not looked at again");
    assert.deepEqual(row("First P"), before.first, "matched by hand: not looked at again");
    await until(() => row("Near Miss").checked_at > before.miss.checked_at);
    assert.equal(row("Near Miss").mbid, "near-miss-other", "looked at again, still not the one turned down");
  } finally {
    await srv.stop();
    await mb.stop();
    await itunes.stop();
    await new Promise(r => pub.close(r));
  }
});
