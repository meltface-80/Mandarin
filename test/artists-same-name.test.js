"use strict";
/*
 * Two acts of the same name (item 330): albums by Airbag from Norway and by Airbag from Argentina, their files tagged
 * with each act's MusicBrainz Album Artist Id (MUSICBRAINZ_ALBUMARTISTID, as Picard writes it), are two artists, not
 * one with both bands' albums: two on the Artists wall and in search, each its own page (/api/artist-albums with
 * artist_id), each album saying whose it is, each told apart (the years of its albums, MusicBrainz's word not asked
 * here). A name only one act has stays one artist, its tagged and untagged albums together, by its name as ever.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { gen, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { start, built } = require("./server");
const fs = require("fs");
const os = require("os");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const NORWAY = "0ec8e7b7-5c26-4444-ac17-64670cf32609", ARGENTINA = "b2fa8093-6058-45ad-bdf1-e8d11c1ab2f2", SOLO = "aaaaaaaa-1111-4222-8333-444444444444";

async function until(fn, ms = 60000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await new Promise(r => setTimeout(r, 150));
  }
}

function album(music, folder, { artist, title, year, mbid }) {
  for (let i = 1; i <= 2; i++) {
    const tags = { title: `${title} ${i}`, artist, album_artist: artist, album: title, track: i, date: String(year) };
    if (mbid) tags.MUSICBRAINZ_ALBUMARTISTID = mbid;
    gen(path.join(music, folder, title, `0${i}.flac`), { seconds: 1, freq: 300 + i * 50, tags });
  }
}

test("two acts called Airbag are two artists; a name one act has stays one", { skip, timeout: 120000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-test-airbag-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const music = path.join(root, "music");
  album(music, "Airbag (NO)", { artist: "Airbag", title: "Disconnected", year: 2016, mbid: NORWAY });
  album(music, "Airbag (NO)", { artist: "Airbag", title: "Identity", year: 2004, mbid: NORWAY });
  album(music, "Airbag (AR)", { artist: "Airbag", title: "Libre", year: 2011, mbid: ARGENTINA });
  album(music, "Solo", { artist: "Solo Act", title: "Tagged", year: 2001, mbid: SOLO });
  album(music, "Solo", { artist: "Solo Act", title: "Untagged", year: 2003 });
  const srv = await start({ port: ports.port(), musicDir: music, dataDir: path.join(root, "data") });
  t.after(() => srv.stop());
  const H = { Authorization: "Bearer " + await signIn(srv.base) };
  const get = async p => (await fetch(srv.base + p, { headers: H })).json();
  await until(async () => { const s = await get("/api/status"); return s && s.index_count === 5 && !s.scanning; }, 60000, "the library");

  // The Artists wall: two Airbags, each with its own albums and its own id, told apart by their years; one Solo Act.
  const wall = (await get("/api/artists?limit=50")).artists;
  const airbags = wall.filter(a => a.name === "Airbag").sort((a, b) => b.albumCount - a.albumCount);
  assert.equal(airbags.length, 2, JSON.stringify(wall));
  assert.deepEqual(airbags.map(a => [a.albumCount, a.note]), [[2, "2004–2016"], [1, "2011"]]);
  assert.ok(airbags[0].artist_id > 0 && airbags[1].artist_id > 0 && airbags[0].artist_id !== airbags[1].artist_id);
  const solo = wall.filter(a => a.name === "Solo Act");
  assert.deepEqual(solo.map(a => [a.albumCount, a.artist_id, a.note]), [[2, undefined, undefined]], "one act of its name: one artist, as ever");

  // Each its own page.
  const titles = j => j.primary.map(a => a.title).sort();
  const norway = await get("/api/artist-albums?artist=Airbag&artist_id=" + airbags[0].artist_id);
  assert.deepEqual(titles(norway), ["Disconnected", "Identity"]);
  assert.deepEqual([norway.artist_id, norway.note], [airbags[0].artist_id, "2004–2016"]);
  const argentina = await get("/api/artist-albums?artist=Airbag&artist_id=" + airbags[1].artist_id);
  assert.deepEqual(titles(argentina), ["Libre"]);
  assert.deepEqual(titles(await get("/api/artist-albums?artist=Airbag")), ["Disconnected", "Identity", "Libre"], "asked by name alone: every act of it");
  assert.deepEqual(titles(await get("/api/artist-albums?artist=Solo%20Act")), ["Tagged", "Untagged"]);

  // Each album says whose it is, for its page's link to its artist.
  assert.deepEqual(argentina.primary.map(a => [a.artist_id, a.artist_note]), [[airbags[1].artist_id, "2011"]]);
  const libre = (await get("/api/library/albums?sort=album&count=50")).albums.find(a => a.title === "Libre");
  assert.deepEqual([libre.artist_id, libre.artist_note], [airbags[1].artist_id, "2011"]);

  // "More by" from an album: its own act's other albums only.
  const more = await get("/api/album/more?title=Disconnected&artist=Airbag&artist_id=" + airbags[0].artist_id);
  assert.deepEqual(more.by.map(a => a.title), ["Identity"]);

  // Search: both acts, each with its id.
  const found = (await get("/api/search?q=airbag")).artists;
  assert.deepEqual(found.map(a => a.artist_id).sort(), [airbags[0].artist_id, airbags[1].artist_id].sort(), JSON.stringify(found));

  // An untagged album of the name, and its applied MusicBrainz match: the act the match names, with MusicBrainz's word
  // for it, once a scan has been (identification applies a match without touching the files).
  album(music, "Airbag (AR)", { artist: "Airbag", title: "Mundo Quimica", year: 2008 });
  const scanned = async n => until(async () => { const s = await get("/api/status"); return s && s.index_count === n && !s.scanning; }, 60000, "the scan");
  await fetch(srv.base + "/api/library/rescan", { method: "POST", headers: H });
  await scanned(6);
  const db = new (require("better-sqlite3"))(path.join(root, "data", "musicd.db"));
  t.after(() => db.close());
  const key = db.prepare("SELECT key FROM albums WHERE title = 'Mundo Quimica'").get().key;
  db.prepare("INSERT INTO album_matches(key, mbid, distance, status, candidate, checked_at, applied_at) VALUES(?, ?, 0.01, 'applied', ?, ?, ?)")
    .run(key, "11111111-2222-4333-8444-555555555555", JSON.stringify({ artist: "Airbag", artist_mbid: ARGENTINA, artist_note: "Argentine rock band", title: "Mundo Quimica" }), Date.now(), Date.now());
  await fetch(srv.base + "/api/library/rescan", { method: "POST", headers: H });
  const after = await until(async () => {
    const w = (await get("/api/artists?limit=50")).artists.filter(a => a.name === "Airbag");
    return w.some(a => a.note === "Argentine rock band" && a.albumCount === 2) && w;
  }, 60000, "the matched album under its act");
  assert.deepEqual(after.map(a => [a.albumCount, a.note]).sort(), [[2, "2004–2016"], [2, "Argentine rock band"]]);
  const quimica = await get("/api/artist-albums?artist=Airbag&artist_id=" + airbags[1].artist_id);
  assert.deepEqual(titles(quimica), ["Libre", "Mundo Quimica"]);
});
