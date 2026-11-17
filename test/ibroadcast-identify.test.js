"use strict";
/*
 * The Album Scanner identifies iBroadcast's albums by what iBroadcast says of them (item 459), as it does the
 * library's own: its title, artist, track titles, numbers and lengths, matched on MusicBrainz; the match applied as an
 * edit of Mandarin's (the artist's name as MusicBrainz writes it), and nothing fetched from iBroadcast for it: not
 * matched by sound in the background (ibroadcast-sound.test.js), never measured (the library's reading of each file's rate and depth, its first 64 KB, the only ask).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeIBroadcast } = require("./fake-ibroadcast");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { FakeITunes } = require("./fake-itunes");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}

const TRACKS = [["Everything in Its Right Place", 251], ["Kid A", 284], ["The National Anthem", 351], ["How to Disappear Completely", 356]];
const MBID = "44444444-0000-4000-8000-000000000001";

test("item 459: an iBroadcast album identified by its details, the match applied, nothing fetched from iBroadcast", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const mb = await new FakeMusicBrainz([{ id: MBID, title: "Kid A", artist: "Radiohead", date: "2000-10-02", tracks: TRACKS }]).start();
  t.after(() => mb.stop && mb.stop());
  const itunes = await new FakeITunes([]).start();
  t.after(() => itunes.stop && itunes.stop());
  const ib = await new FakeIBroadcast({ albums: [{ id: 901, name: "Kid A", artist: { id: 90, name: "radiohead" }, year: 2000,
    tracks: TRACKS.map(([title, length], i) => ({ id: 9001 + i, title, track: i + 1, length, type: "audio/flac" })) }] }).start();
  ib.slowOnce = false;
  t.after(() => ib.stop());
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: mb.baseUrl, itunesBaseUrl: itunes.baseUrl, ibroadcastBaseUrl: ib.base, ibroadcastWatchMs: 100000000 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(base);
  const call = async (method, p, body) => {
    const r = await fetch(base + "/api/" + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return Object.assign({ http: r.status }, await r.json().catch(() => ({})));
  };
  await until(async () => (await call("GET", "status")).index_count >= 3, 60000, "the library");
  await call("POST", "identify/settings", { schedule: false });
  await call("POST", "settings/ibroadcast/signin");
  ib.approve();
  const db = ctx.db.raw;
  const offset = await until(() => (db.prepare("SELECT id FROM albums WHERE key = 'ibroadcast:901'").get() || {}).id, 30000, "the iBroadcast album");

  const row = await until(() => db.prepare("SELECT mbid, status FROM album_matches WHERE key = 'ibroadcast:901'").get(), 90000, "the iBroadcast album identified");
  assert.deepEqual([row.mbid, row.status], [MBID, "applied"], JSON.stringify(row));
  const a = await until(async () => { const x = (await call("GET", "album?offset=" + offset)).album; return x && x.subtitle === "Radiohead" && x; }, 15000, "the match applied");
  assert.equal(a.title, "Kid A");
  assert.ok(mb.requests.some(r => r.startsWith("/ws/2/release")), "MusicBrainz asked");
  // Asked of iBroadcast's files: only the first 64 KB of each, the library's own reading of its rate and depth (item
  // 445); nothing more to identify it: no sound matched, nothing measured.
  await sleep(2000);
  assert.ok(ib.streamAsks.every(x => x.range === "bytes=0-65535"), JSON.stringify(ib.streamAsks.map(x => [x.path, x.range])));
  assert.ok(ib.streamAsks.length <= TRACKS.length, "a header read a track at most");
});
