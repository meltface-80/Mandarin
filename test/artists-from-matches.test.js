"use strict";
/*
 * Two acts of one name told apart by Mandarin's own MusicBrainz matches (item 333). Albums whose files carry no
 * MusicBrainz id, identified before item 330 (their applied match keeps the release, not the act's id): each match's
 * release is asked of MusicBrainz once, the act's id and MusicBrainz's word for it kept, and the album filed under that
 * act, so the two Airbags are two artists on the Artists wall with no file touched. A name with one album is never
 * asked: it can't be two acts. A match that isn't MusicBrainz's (one of iTunes's, "itunes:…") is never asked of it, and one
 * MusicBrainz refuses or doesn't know is asked once, not again at every turn (item 341: each refusal counted as
 * MusicBrainz not answering, and identification stopped ten minutes at a time, over and over).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { gen, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { FakeITunes } = require("./fake-itunes");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const NORWAY = "0ec8e7b7-5c26-4444-ac17-64670cf32609", ARGENTINA = "b2fa8093-6058-45ad-bdf1-e8d11c1ab2f2";
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 60000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await new Promise(r => setTimeout(r, 150));
  }
}

function album(music, artist, title, year) {
  for (let i = 1; i <= 2; i++)
    gen(path.join(music, artist, title, `0${i}.flac`), { seconds: 1, freq: 300 + i * 50, tags: { title: `${title} ${i}`, artist, album_artist: artist, album: title, track: i, date: String(year) } });
}

test("acts of one name told apart by their MusicBrainz matches, with no file touched", { skip, timeout: 150000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-airbag-mb-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const music = path.join(root, "music");
  album(music, "Airbag", "Disconnected", 2016);
  album(music, "Airbag", "Libre", 2011);
  album(music, "Solo Act", "Alone", 2001);
  album(music, "Duo", "One", 2000);
  album(music, "Duo", "Two", 2002);
  // MusicBrainz's releases, under titles a search won't find: only their ids reach them, as a match keeps them.
  const mb = await new FakeMusicBrainz([
    { id: "11111111-0000-4000-8000-000000000001", title: "Release Norway", artist: "Airbag", artistId: NORWAY, artistNote: "Norwegian progressive rock band", tracks: [["a", 1], ["b", 1]] },
    { id: "11111111-0000-4000-8000-000000000002", title: "Release Argentina", artist: "Airbag", artistId: ARGENTINA, artistNote: "Argentine rock band", tracks: [["a", 1], ["b", 1]] },
    { id: "11111111-0000-4000-8000-000000000003", title: "Release Solo", artist: "Solo Act", artistId: "22222222-0000-4000-8000-000000000003", tracks: [["a", 1], ["b", 1]] },
  ]).start();
  t.after(() => mb.stop && mb.stop());
  const itunes = await new FakeITunes([]).start();
  t.after(() => itunes.stop && itunes.stop());
  const srv = createServer({ port: PORT, musicDir: music, dataDir: path.join(root, "data"), serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(B), "Content-Type": "application/json" };
  const get = async p => (await fetch(B + "/api/" + p, { headers: H })).json();
  await until(async () => (await get("status")).index_count === 5, 60000, "the library");
  await fetch(B + "/api/identify/settings", { method: "POST", headers: H, body: JSON.stringify({ schedule: false }) });
  // Identified before item 330, as the scan found them: unidentified now (the search finds nothing), then each given
  // the match it had then, the release alone in it.
  await until(async () => (await get("identify")).progress.checked === 5, 60000, "the identification scan");
  const wallOf = async () => (await get("artists?limit=50")).artists.filter(a => a.name === "Airbag");
  assert.equal((await wallOf()).length, 1, "one Airbag before: nothing tells them apart");
  const editsFile = () => { try { return fs.readFileSync(path.join(root, "data", "album-edits.json"), "utf8"); } catch (e) { return null; } };
  const editsBefore = editsFile();
  const asked = mb.requests.length;
  const now = Date.now();
  const UNKNOWN = "33333333-0000-4000-8000-000000000009";
  for (const [title, rel, artist] of [["Disconnected", 1, "Airbag"], ["Libre", 2, "Airbag"], ["Alone", 3, "Solo Act"], ["One", "itunes:999", "Duo"], ["Two", UNKNOWN, "Duo"]]) {
    const key = ctx.db.raw.prepare("SELECT key FROM albums WHERE title = ?").get(title).key;
    const mbid = typeof rel === "string" ? rel : "11111111-0000-4000-8000-00000000000" + rel;
    ctx.db.raw.prepare(`INSERT INTO album_matches(key, mbid, distance, status, candidate, checked_at, applied_at) VALUES(?, ?, 0.01, 'applied', ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET mbid = excluded.mbid, status = 'applied', candidate = excluded.candidate, applied_at = excluded.applied_at`)
      .run(key, mbid, JSON.stringify({ mbid, title, artist, tracks: [] }), now, now);
  }

  // Each Airbag match asked of MusicBrainz, and each album filed under its act: two Airbags, told apart by MusicBrainz's word.
  const two = await until(async () => { const w = await wallOf(); return w.length === 2 && w.every(a => a.note) && w; }, 60000, "two Airbags");
  assert.deepEqual(two.map(a => a.note).sort(), ["Argentine rock band", "Norwegian progressive rock band"]);
  const norway = two.find(a => a.note.startsWith("Norwegian"));
  assert.deepEqual((await get("artist-albums?artist=Airbag&artist_id=" + norway.artist_id)).primary.map(a => a.title), ["Disconnected"]);
  const lookups = mb.requests.slice(asked).filter(r => r.startsWith("/ws/2/release/1111"));
  assert.deepEqual(lookups.map(r => r.split("?")[0]).sort(), ["/ws/2/release/11111111-0000-4000-8000-000000000001", "/ws/2/release/11111111-0000-4000-8000-000000000002"],
    "each Airbag release asked once; the one-album name never");
  // Each match keeps what it was told: never asked again.
  const kept = ctx.db.raw.prepare("SELECT candidate FROM album_matches WHERE mbid = ?").get("11111111-0000-4000-8000-000000000002").candidate;
  assert.deepEqual([JSON.parse(kept).artist_mbid, JSON.parse(kept).artist_note], [ARGENTINA, "Argentine rock band"]);
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(mb.requests.slice(asked).filter(r => r.startsWith("/ws/2/release/1111")).length, 2, "never asked again");
  // An iTunes match never asked of MusicBrainz; one it doesn't know asked once, kept as asked, and nothing paused (item 341).
  const told = () => JSON.parse(ctx.db.raw.prepare("SELECT candidate FROM album_matches WHERE mbid = ?").get(UNKNOWN).candidate);
  await until(() => "artist_mbid" in told(), 30000, "the unknown release kept as asked");
  assert.equal(told().artist_mbid, null);
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(mb.requests.slice(asked).filter(r => r.startsWith("/ws/2/release/" + UNKNOWN)).length, 1, "asked once, not at every turn");
  assert.deepEqual(mb.requests.slice(asked).filter(r => r.startsWith("/ws/2/release/itunes")), [], "an iTunes match is not MusicBrainz's to ask");
  assert.equal((await get("identify")).reason === "unreachable", false, "MusicBrainz not taken for away");
  // Filing an album under its act is no edit (item 335): the album edits' backup is never written again for it.
  assert.equal(editsFile(), editsBefore, "album-edits.json not written again: no edit was made");
});
