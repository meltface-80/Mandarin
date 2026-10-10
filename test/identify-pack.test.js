"use strict";
/*
 * The scan with the MusicBrainz pack (v0.6.8): the albums whose barcode the
 * pack has come first, and while musicbrainz.org isn't answering the scan
 * carries on with them from the pack alone. An album the pack can't place is
 * left for musicbrainz.org, not marked unidentified. Here musicbrainz.org is
 * a closed port: down for the whole test.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const GID = "7a0f0c3e-1111-4222-8333-944455556666";

/* A pack of one release, as tools/mbpack/build.js writes it. */
function writePack(file) {
  const db = new Database(file);
  db.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE groups (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, title TEXT, note TEXT, type TEXT, first INTEGER);
    CREATE TABLE releases (id INTEGER PRIMARY KEY, gid BLOB NOT NULL, grp INTEGER, title TEXT, artist TEXT, note TEXT,
      status TEXT, barcode TEXT, code TEXT, date INTEGER, country TEXT, format TEXT, tracks TEXT);
    CREATE INDEX releases_code ON releases (code); CREATE INDEX releases_gid ON releases (gid);`);
  const blob = g => Buffer.from(g.replace(/-/g, ""), "hex");
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("format", "1");
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("releases", "1");
  db.prepare("INSERT INTO meta VALUES (?, ?)").run("built", "2026-10-04T00:00:00Z");
  db.prepare("INSERT INTO groups VALUES (1, ?, 'The Bar Album', '', 'Album', 20010000)").run(blob("7a0f0c3e-0000-4222-8333-944455556666"));
  db.prepare("INSERT INTO releases VALUES (1, ?, 1, 'The Bar Album', 'Tagger', '', 'Official', '0602537000016', '602537000016', 20010000, 'GB', 'CD', ?)")
    .run(blob(GID), JSON.stringify([[1, 1, "Bar Album 1", 3], [1, 2, "Bar Album 2", 3], [1, 3, "Bar Album 3", 3]]));
  db.close();
}

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, 100)); }
}

test("the pack places what it can while musicbrainz.org is down; the rest waits", { skip, timeout: 90000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const album = (dir, name, tags) => {
    for (let i = 1; i <= 3; i++) gen(path.join(lib.music, dir, `0${i}.flac`), { freq: 200 + 50 * i, seconds: 3,
      tags: Object.assign({ title: `${name} ${i}`, artist: "Tagger", album: name, track: i, date: "2001" }, tags) });
  };
  album("Barcode", "Bar Album", { BARCODE: "0602537000016" });   // the pack has it
  album("Plain", "Plain Album", {});                             // only a search by name would find it
  fs.mkdirSync(lib.data, { recursive: true });
  writePack(path.join(lib.data, "mbpack.sqlite"));
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: true, identifyTickMs: 100, mbBaseUrl: "http://127.0.0.1:9", itunesBaseUrl: "http://127.0.0.1:9" });
  const ctx = await srv.start();
  const token = await signIn(base);
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return r.json();
  };
  try {
    await until(async () => (await api("status")).index_count === 2);
    if (process.env.MANDARIN_FRONT === "1") {
      const h = await fetch(base + "/api/identify?lists=0", { headers: { Authorization: "Bearer " + token } });
      assert.equal(h.headers.get("x-mandarin-answered"), "C#", "the scan is the C# server's");
    }
    await api("identify/settings", { schedule: false, itunes: false });
    // The barcoded album first, from the pack, though musicbrainz.org never answers.
    const r = await until(async () => { const j = await api("identify"); return j.applied.length === 1 && j; });
    assert.ok(r, "applied from the pack");
    const c = r.applied[0].candidate;
    assert.deepEqual([c.mbid, c.title, c.matched_by, c.from_pack], [GID, "The Bar Album", "barcode", true]);
    // musicbrainz.org fails for the plain album, the scan pauses, and with
    // nothing left the pack can answer it waits: the plain album is not
    // marked unidentified.
    const paused = await until(async () => { const j = await api("identify"); return j.reason === "unreachable" && j; });
    assert.ok(paused, "paused once musicbrainz.org failed");
    assert.equal(paused.progress.unidentified, 0);
    assert.equal(paused.progress.checked, 1);

    // During that pause an album the pack can answer is still matched from
    // it (the pack mode, not the pause, decides): "Check again" undoes the
    // match and forgets the verdict, and the pack places the album again.
    const bar = r.applied[0].album.offset;
    const first = r.applied[0].checked_at;
    await api("identify/recheck", { offset: bar });
    const again = await until(async () => {
      const j = await api("identify");
      return j.applied.length === 1 && j.applied[0].checked_at > first && j.reason === "unreachable" && j;
    });
    assert.ok(again, "matched from the pack again, then nothing more it can answer");
    assert.equal(again.applied[0].album.offset, bar);
    assert.equal(again.applied[0].candidate.from_pack, true);
    assert.equal(again.progress.unidentified, 0);
  } finally {
    await srv.stop();
  }
});
