"use strict";
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Database = require("better-sqlite3");
const DB = require("../lib/library/db");
const { Library, releaseDate, dateKey } = require("../lib/library");
const { dateOf, releaseDateOf, albumDateOf } = require("../lib/library/scanner");
const { ReleaseDays, matchDays } = require("../lib/library/dates");

const quiet = () => {};

test("a date tag is kept as precisely as it's stated, and never as a date that can't exist", () => {
  assert.equal(dateOf("2024-03-15"), "2024-03-15");
  assert.equal(dateOf("2024/03/15"), "2024-03-15");
  assert.equal(dateOf("20240315"), "2024-03-15");
  assert.equal(dateOf("2024-03-15T00:00:00Z"), "2024-03-15");
  assert.equal(dateOf("2024-03"), "2024-03");
  assert.equal(dateOf("2024"), "2024");
  assert.equal(dateOf(2024), "2024");
  assert.equal(dateOf("2023-02-29"), "2023-02");      // no such day
  assert.equal(dateOf("2024-02-29"), "2024-02-29");   // a leap year
  assert.equal(dateOf("2024-13-01"), "2024");         // no such month
  assert.equal(dateOf("March 2024"), "2024");
  assert.equal(dateOf(""), null);
  assert.equal(dateOf(undefined), null);
});

test("a track's date: the original release's year, refined only by a tag of that same year", () => {
  assert.deepEqual(releaseDateOf({ date: "2019-05-03" }), { year: 2019, date: "2019-05-03" });
  assert.deepEqual(releaseDateOf({ originaldate: "1977", date: "1977-02-04" }), { year: 1977, date: "1977-02-04" });
  // A 2011 remaster's day never lands on the 1977 original.
  assert.deepEqual(releaseDateOf({ originaldate: "1977", date: "2011-09-26" }), { year: 1977, date: "1977" });
  assert.deepEqual(releaseDateOf({ originalyear: 1977, date: "2011-09-26" }), { year: 1977, date: "1977" });
  assert.deepEqual(releaseDateOf({ year: 2001 }), { year: 2001, date: "2001" });
  assert.deepEqual(releaseDateOf({}), { year: null, date: null });
});

test("an album's date is the most precise its tracks agree on, of the album's year", () => {
  assert.equal(albumDateOf(["2020", "2020-06-12", "2020-06-12"], 2020), "2020-06-12");
  assert.equal(albumDateOf(["2020-06", "2020"], 2020), "2020-06");
  assert.equal(albumDateOf(["2019-01-01", "2020"], 2020), "2020");
  assert.equal(albumDateOf([null, null], 2020), "2020");
  assert.equal(albumDateOf(["2020-01-01"], null), null);
});

test("a looked-up day refines the year it agrees with, and nothing else", () => {
  assert.equal(releaseDate(2024, "2024", JSON.stringify({ date: "2024-03-15" })), "2024-03-15");
  assert.equal(releaseDate(2024, "2024-03-15", JSON.stringify({ date: "2024-03-01" })), "2024-03-15");  // the tags' day stands
  assert.equal(releaseDate(2024, "2024", JSON.stringify({ date: "2011-09-26" })), "2024");
  assert.equal(releaseDate(1999, "2024-03-15", null), "1999");       // a hand-edited year drops the tags' day
  assert.equal(releaseDate(null, "2024-03-15", null), null);
  assert.equal(dateKey("2024"), "2024-00-00");
  assert.equal(dateKey("2024-03"), "2024-03-00");
  assert.ok(dateKey("2024") < dateKey("2024-01-05"));
});

// A library of albums with the given release dates, as a scan would leave it.
function libraryOf(albums) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-dates-"));
  const db = DB.open(dir, { log: quiet });
  const ins = db.raw.prepare(`INSERT INTO albums(key, title, artist, sort_title, sort_artist, year, date, added_at, updated_at)
                              VALUES(?, ?, ?, ?, ?, ?, ?, 0, 0)`);
  for (const a of albums) ins.run(a.title.toLowerCase(), a.title, a.artist || "Someone", a.title.toLowerCase(), "someone", a.year || null, a.date || null);
  const library = new Library(db, { musicRoot: dir, log: quiet });
  library.reload();
  return { db, library };
}

test("the Release date sort orders by the day, a year alone at the start of its year, undated last", () => {
  const { db, library } = libraryOf([
    { title: "Yesterday", year: 2026, date: "2026-09-27" },
    { title: "January", year: 2026, date: "2026-01-09" },
    { title: "Year Only", year: 2026, date: "2026" },
    { title: "March", year: 2026, date: "2026-03" },
    { title: "Old", year: 1977, date: "1977-02-04" },
    { title: "No Date" }
  ]);
  const titles = dir => library.view({ sort: "year", dir }).map(a => a.title);
  assert.deepEqual(titles("desc"), ["Yesterday", "March", "January", "Year Only", "Old", "No Date"]);
  assert.deepEqual(titles("asc"), ["Old", "Year Only", "January", "March", "Yesterday", "No Date"]);

  // A day found later moves the album straight away.
  library.setLookedUpDay("year only", "2026-12-01");
  assert.deepEqual(titles("desc").slice(0, 2), ["Year Only", "Yesterday"]);
  db.close();
});

test("MusicBrainz days: title, artist and year must all match; the earliest qualifying day wins", () => {
  const albums = [
    { key: "a", title: "Blue Rev", artist: "Alvvays", year: 2022, date: "2022" },
    { key: "b", title: "Rumours", artist: "Fleetwood Mac", year: 1977, date: "1977" },
    { key: "c", title: "Nothing Here", artist: "Nobody", year: 2020, date: "2020" }
  ];
  const rgs = [
    { title: "Blue Rev", "first-release-date": "2022-10-07", "artist-credit": [{ name: "Alvvays" }] },
    { title: "Blue Rev", "first-release-date": "2022-10-07", "artist-credit": [{ name: "Someone Else" }] },
    { title: "Rumours (Super Deluxe)", "first-release-date": "2013-01-28", "artist-credit": [{ name: "Fleetwood Mac" }] },
    { title: "Rumours", "first-release-date": "1977-02-04", "artist-credit": [{ name: "Fleetwood Mac" }] },
    { title: "Nothing Here", "first-release-date": "2021-01-01", "artist-credit": [{ name: "Nobody" }] }
  ];
  const days = matchDays(albums, rgs);
  assert.equal(days.get("a"), "2022-10-07");
  assert.equal(days.get("b"), "1977-02-04");
  assert.equal(days.get("c"), null);            // another year's: not this album's day
});

test("the day lookup asks about albums in batches, keeps what it finds, and doesn't ask again", async () => {
  const albums = [];
  for (let i = 0; i < 25; i++) albums.push({ title: "Album " + i, year: 2000 + i, date: String(2000 + i) });
  albums.push({ title: "Dated", year: 2010, date: "2010-05-05" });
  const { db, library } = libraryOf(albums);
  const asked = [];
  const days = new ReleaseDays({
    db, library,
    fetchJson: async url => {
      const q = decodeURIComponent(url.split("query=")[1].split("&")[0]);
      asked.push(q);
      return { "release-groups": q.includes('"Album 24"')
        ? [{ title: "Album 24", "first-release-date": "2024-06-01", "artist-credit": [{ name: "Someone" }] }] : [] };
    }
  });
  await days.run();
  assert.equal(asked.length, 2);                               // 25 albums, 20 a request
  assert.ok(asked[0].includes('"Album 24"'), "newest year first");
  assert.ok(!asked.join(" ").includes('"Dated"'), "an album with a day isn't asked about");
  assert.equal(library.view({ sort: "year", dir: "desc" })[0].title, "Album 24");
  assert.equal(library.albums.find(a => a.title === "Album 24").date, "2024-06-01");
  await days.run();
  assert.equal(asked.length, 2, "nothing asked twice within a month");

  // Kept across a reload (a rescan, a restart).
  library.reload();
  assert.equal(library.albums.find(a => a.title === "Album 24").date, "2024-06-01");
  db.close();
});

test("a database from before release dates gains the columns and keeps everything", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-dates-"));
  let db = DB.open(dir, { log: quiet });
  db.raw.prepare("INSERT INTO albums(key, title, artist, year, added_at, updated_at) VALUES('k', 'T', 'A', 1999, 0, 0)").run();
  db.close();
  // Take the columns away again, as a v0.3.12 database had it.
  const raw = new Database(path.join(dir, "musicd.db"));
  raw.exec("ALTER TABLE albums DROP COLUMN date; ALTER TABLE tracks DROP COLUMN date;");
  raw.close();
  db = DB.open(dir, { log: quiet });
  const cols = t => db.raw.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  assert.ok(cols("albums").includes("date"));
  assert.ok(cols("tracks").includes("date"));
  assert.equal(db.raw.prepare("SELECT year FROM albums WHERE key = 'k'").get().year, 1999);
  db.close();
});

test("the days found after a library scan, through the server (behind the C# server, made there)", { timeout: 60000 }, async (t) => {
  const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
  if (!haveFfmpeg()) return t.skip("ffmpeg is not installed");
  const { signIn } = require("./auth-helper");
  const { FakeMusicBrainz } = require("./fake-musicbrainz");
  const FRONT = process.env.MANDARIN_FRONT === "1";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Album One (1997) and Hi Res (2020) are tagged to the year; Dated to the day.
  const lib = makeLibrary();
  gen(path.join(lib.music, "Artist F", "Dated", "01 One.flac"), { tags: { title: "One", artist: "Artist F", album: "Dated", track: 1, date: "2020-06-01" } });
  const mb = new FakeMusicBrainz([
    { id: "r1", title: "Hi Res", artist: "Artist B", date: "2020-11-20", tracks: [["Hi 1", 4], ["Hi 2", 4]] },
    // A reissue's group, of another year: never Album One's day.
    { id: "r2", title: "Album One", artist: "Artist A", date: "2011-01-01", tracks: [["Song 1", 2]] }
  ]);
  await mb.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, mbBaseUrl: mb.baseUrl });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const order = async () => ((await (await fetch(B + "/api/library/albums?sort=year&dir=asc", { headers: { Authorization: "Bearer " + token } })).json()).albums || []).map(a => a.title);
    const t0 = Date.now();
    let titles = [];
    while ((titles = await order()).join() !== "Album One,Dated,Hi Res,Best Of") {
      if (Date.now() - t0 > 20000) assert.fail("Hi Res never got its day: " + titles);
      await sleep(100);
    }
    const asked = mb.requests.map((u, i) => [decodeURIComponent(u), mb.agents[i]]).filter(([u]) => u.startsWith("/ws/2/release-group/?query="));
    assert.ok(asked.some(([u]) => u.includes('releasegroup:"Hi Res" AND artist:"Artist B"') && u.includes('releasegroup:"Album One"')), JSON.stringify(asked));
    assert.ok(!asked.some(([u]) => u.includes('"Dated"')), "an album with its day isn't asked about");
    if (FRONT) {
      assert.ok(asked.every(([, ua]) => /^Mandarin\//.test(ua)), "asked by the C# server: " + JSON.stringify(asked));
      assert.equal(ctx.releaseDays.handedOver, true);
    }
    // Kept across a reload, and not asked again within the month.
    const n = mb.requests.length;
    ctx.library.reload();
    assert.deepEqual(await order(), ["Album One", "Dated", "Hi Res", "Best Of"]);
    if (FRONT) {
      assert.equal((await fetch(B + "/internal/jobs/after-scan", { method: "POST" })).status, 404, "not without the key");
      assert.equal((await fetch(B + "/internal/jobs/after-scan", { method: "POST", headers: { "X-Mandarin-Front-Key": ctx.frontKey } })).status, 200);
    } else await ctx.releaseDays.run();
    await sleep(300);
    assert.equal(mb.requests.length, n, "nothing asked twice");
  } finally { await srv.stop(); await mb.stop(); }
});
