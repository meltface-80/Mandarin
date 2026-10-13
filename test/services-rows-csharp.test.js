"use strict";
/*
 * Qobuz's and Tidal's albums as library rows, written by the C# server
 * (v0.8.44, stage 4.2; server/Mandarin.Server/Services/Rows.cs and
 * ServiceRoutes.cs), against the fakes on loopback (test/fake-qobuz.js,
 * test/fake-tidal.js), each held to what the Node server writes and answers
 * for the same request (asked of it directly, the state put back between):
 *
 *   - an album opened: its albums and tracks rows, every column and the type
 *     SQLite keeps it as (the ids and the two times aside, said below), its
 *     cover and the address beside it, and the answer;
 *   - favourited and taken away: the answer, the rows, the kept mark ({ why,
 *     at }), the favourite on the service, and the Node server's own kept
 *     answers forgotten;
 *   - a streamed album's page: the service's fields word for word and in the
 *     Node server's order, a favourite let go or kept as the page opens;
 *   - Tidal's token about to expire, or refused: refreshed by the C# server
 *     (v0.8.47), the write made once, the Node server never asked;
 *   - Clean up, signed in and signed out;
 *   - the month's prune: albums a month old, unplayed, neither kept nor held,
 *     go; the others stay.
 *
 * test/qobuz.test.js and test/tidal.test.js are the services' own.
 *
 * Since v0.8.50 (stage 7) the Node server's side is a recording
 * (test/golden/services-rows-node.json, test/golden.js): made with
 * RECORD_SERVICES_ROWS=1 through the C# server with the Node server behind it
 * (MANDARIN_FRONT=1, while index.js was still there); every run since starts
 * the program alone and holds it to the recording. An album and a track are
 * named there by their key and path, not the ids SQLite gave them that run;
 * the data folder and the fakes' ports by name.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeQobuz } = require("./fake-qobuz");
const { FakeTidal } = require("./fake-tidal");
const { signIn } = require("./auth-helper");
const { built } = require("./server");
const { recording } = require("./golden");

const RECORD = process.env.RECORD_SERVICES_ROWS === "1";
const rec = recording("services-rows-node", RECORD);
const skip = (RECORD ? process.env.MANDARIN_FRONT !== "1" && "recording goes through the C# server with the Node server behind it (MANDARIN_FRONT=1)"
  : built() || (!rec.exists() && "no recording of the Node server's answers (RECORD_SERVICES_ROWS=1 makes one)")) || (!haveFfmpeg() && "ffmpeg is not installed");
const DAY = 86400e3;

async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

test("Qobuz's and Tidal's library rows, written by the C# server as the Node server writes them", { skip, timeout: 300000 }, async (t) => {
  const lib = makeLibrary();
  const file = path.join(lib.music, "Artist A", "Album One", "01 Song 1.flac");
  const track = (id, title, extra) => Object.assign({ id, title, file, duration: 3 }, extra || {});
  const qobuz = new FakeQobuz({ albums: [
    { id: "q100", title: "Q Album", artist: "Q Artist", rate: 44100, bits: 16, year: 2021, tracks: [track(5001, "Q One"), track(5002, "Q Two", { duration: 4.5 })] },
    { id: "q150", title: "Q Together", artist: "Various Artists", rate: 44100, bits: 16, year: 2019, label: "Comp Label", tracks: [track(5051, "Q Mixed")] },
    // Sorted as JavaScript reads it: "." stops at the \r, so it is "B, The" that sorts, as "b the".
    { id: "q170", title: "A\rB, The", artist: "The Q Band", rate: 44100, bits: 16, year: 2017, tracks: [track(5071, "Q Sorted")] },
    { id: "q200", title: "Q Hi-Res", artist: "Q Artist", rate: 96000, bits: 24, year: 2023, tracks: [track(5101, "Q Hi"), track(5102, "Q Hi Two", { rate: 192000, bits: 24 })] },
    { id: "q300", title: "Q Future", artist: "Q Artist", rate: 44100, bits: 16, year: 2099, tracks: [track(5201, "Q Soon")] },
    ...[4, 5, 6, 7, 8, 9].map(n => ({ id: "q" + n + "00", title: "Q Old " + n, artist: "Q Artist", rate: 44100, bits: 16, year: 2001, tracks: [track(5000 + n * 100, "Q Old " + n)] }))
  ] });
  const tidal = new FakeTidal({ albums: [
    { id: 2001, title: "T Album", artist: "T Artist", year: 2021, hires: false, tracks: [track(8001, "T One"), track(8002, "T Two")] },
    { id: 2002, title: "T Hi-Res", artist: "T Artist", year: 2022, hires: true, tracks: [track(9001, "T Hi")] },
    { id: 2003, title: "T Other", artist: "Somebody", year: 2020, hires: false, tracks: [track(9501, "T Other 1")] },
    { id: 2004, title: "T Fourth", artist: "Somebody", year: 2018, hires: false, tracks: [track(9601, "T Four 1")] }
  ] });
  t.after(() => Promise.all([qobuz.stop(), tidal.stop()]));
  await qobuz.start();
  await tidal.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = RECORD ? require("../index.js") : require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/",
    // The Node server's import and favourites' watch (still its own) kept out of the way.
    qobuzSyncDelayMs: 1e9, serviceWatchMs: 1e9 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  // The Node server behind the C# server (recording only), asked straight.
  const NODE = RECORD ? "http://127.0.0.1:" + ctx.listeningOn : "";
  const raw = ctx.db.raw;
  /* An album's id said as its key, a track's as its path; the data folder and any port on loopback by name. */
  const keyOf = (id) => { const r = raw.prepare("SELECT key FROM albums WHERE id = ?").get(Number(id)); return r ? r.key : "gone " + id; };
  const pathOf = (id) => { const r = raw.prepare("SELECT path FROM tracks WHERE id = ?").get(Number(id)); return r ? r.path : "gone " + id; };
  const named = (text) => String(text).split(lib.data).join("<data>").replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
    .replace(/"offset":(\d+)/g, (m, id) => `"offset":"<${keyOf(id)}>"`).replace(/\bal-(\d+)-/g, (m, id) => `al-<${keyOf(id)}>-`)
    .replace(/"track_id":(\d+)/g, (m, id) => `"track_id":"<${pathOf(id)}>"`)
    // A cover's hash is of its address, which has the fake's port in it: held to that rule where the cover is kept, named here.
    .replace(/"art_hash":"[0-9a-f]{12}"/g, `"art_hash":"<its address's>"`).replace(/(al-<[^>]+>-)[0-9a-f]{12}/g, "$1<its address's>")
    // A time written as the test ran (a play a day ago, kept since now): said in days from now.
    .replace(/(":)(1\d{12})\b/g, (m, pre, t) => { const d = (Number(t) - Date.now()) / DAY; return Math.abs(d) < 3 ? `${pre}"<now ${Math.round(d)} d>"` : m; });
  const steady = (v) => JSON.parse(named(JSON.stringify(v === undefined ? null : v)));
  const call = async (base, p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j, text };
  };
  const get = (p) => call(B, p);
  const post = (p, body) => call(B, p, body || {});
  /* The Node server's answer to the same request, asked now (recording, after `before`) or as recorded, under a name with no ids in it. */
  const theirs = (label, p, body, { before = null, fix = named } = {}) => rec.want(label, async () => {
    if (before) await before();
    const n = await call(NODE, p, body);
    assert.equal(n.by, null, p + ": the Node server's own");
    return { status: n.status, text: fix(n.text) };
  });
  const step = (p, body) => named(p).replace(/offset=(\d+)/, (m, id) => "offset=<" + keyOf(id) + ">") + (body ? " " + JSON.stringify(body) : "");
  // The same request of each: answered by C#, and the Node server's own the same, word for word.
  const same = async (p, body) => {
    const c = await call(B, p, body);
    assert.equal(c.by, "C#", p + ": answered by the C# server");
    const n = await theirs("same: " + step(p, body), p, body);
    assert.equal(c.status, n.status, p + ": " + c.text + " against " + n.text);
    assert.equal(named(c.text), n.text, p);
    return c;
  };

  // ---------------------------------------------------------------- the database, read

  const columns = (table) => raw.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  // Every column, and the type SQLite keeps it as (better-sqlite3 binds every number as a double:
  // a whole one in a column of integers is kept as an integer, as it is from C#).
  const typed = (table, where, ...args) => {
    const cs = columns(table);
    return raw.prepare(`SELECT ${cs.map(c => `${c}, typeof(${c}) AS "${c}:type"`).join(", ")} FROM ${table} WHERE ${where}`).all(...args);
  };
  const albumRow = (key) => typed("albums", "key = ?", key)[0] || null;
  const trackRows = (id) => typed("tracks", "album_id = ? ORDER BY path", id);
  const cacheRow = (ns, key) => raw.prepare("SELECT value, ts FROM cache WHERE ns = ? AND key = ?").get(ns, key) || null;
  /*
   * A written album as it can be compared: its id and the time it was written
   * left out (the ids are SQLite's to give; added_at and updated_at are the
   * moment of writing, each checked against the request's own time), the
   * tracks' ids and album ids too (album_id checked against the album's id).
   */
  const written = (key, t0, t1) => {
    const a = albumRow(key);
    assert.ok(a, key + ": written");
    for (const c of ["added_at", "updated_at"]) {
      assert.equal(a[c + ":type"], "integer", c);
      assert.ok(a[c] >= t0 && a[c] <= t1, `${key}: ${c} ${a[c]} is when it was written (${t0}…${t1})`);
    }
    const tracks = trackRows(a.id);
    for (const tr of tracks) assert.equal(tr.album_id, a.id, "a track's album");
    const strip = (o, keys) => { const x = Object.assign({}, o); for (const k of keys) { delete x[k]; delete x[k + ":type"]; } return x; };
    return { id: a.id, album: strip(a, ["id", "added_at", "updated_at"]), tracks: tracks.map(tr => strip(tr, ["id", "album_id"])), added: a.added_at };
  };
  // An album's rows taken away again, its cover with them, so the next writer starts as the first did.
  const forget = (key) => {
    const a = albumRow(key);
    if (a && a.art_path) for (const f of [a.art_path, a.art_path + ".url"]) fs.rmSync(f, { force: true });
    raw.prepare("DELETE FROM albums WHERE key = ?").run(key);
    for (const ns of ["qobuz-kept", "tidal-kept", "qobuz-held", "tidal-held"]) raw.prepare("DELETE FROM cache WHERE ns = ? AND key = ?").run(ns, key);
    return ctx.library.reload();
  };

  await until(() => ctx.frontRuns, 30000, "the work handed over");

  await t.test("signed out: refused as the Node server refuses", async () => {
    for (const [s, id] of [["qobuz", "q100"], ["tidal", "2001"]]) {
      for (const w of ["open", "favorite", "unfavorite"]) {
        const r = await same(`${s}/${w}`, { album_id: id });
        assert.equal(r.status, 401);
        assert.deepEqual(r.j, { error: "Not signed in to " + (s === "qobuz" ? "Qobuz" : "Tidal"), connected: false });
      }
    }
  });

  // Signed in on the Node server, as from Settings → Services.
  assert.equal((await post("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
  assert.equal((await post("settings/tidal/signin", {})).status, 200);
  tidal.approve();
  await until(async () => (await get("settings/tidal")).j.connected, 20000, "Tidal signed in");
  // Their albums in the library (the import's switch on), the import itself not run: switched on
  // once the sign-in's own look (every second until signed in) has stopped, so it brings nothing in.
  await new Promise(r => setTimeout(r, 1500));
  ctx.db.setSetting("qobuzSettings", { quality: "hires192", import: true });
  ctx.db.setSetting("tidalSettings", { quality: "hires", import: true });
  await ctx.library.reload();

  await t.test("an album opened: the rows, the cover and the answer as the Node server's", async () => {
    // Tidal's albums listed first, as the browser lists them: opened, only their tracks are asked of Tidal.
    assert.equal((await get("tidal/featured?type=recommended")).by, "C#");
    for (const [s, id] of [["qobuz", "q100"], ["qobuz", "q150"], ["qobuz", "q170"], ["qobuz", "q200"], ["qobuz", "q300"], ["tidal", "2001"], ["tidal", "2002"]]) {
      const key = s + ":" + id;
      await forget(key);
      const asked = tidal.albumCalls;
      let t0 = Date.now();
      const c = await post(`${s}/open`, { album_id: id });
      let t1 = Date.now();
      assert.deepEqual([c.status, c.by], [200, "C#"], key + ": " + c.text);
      if (s === "tidal") assert.equal(tidal.albumCalls, asked, key + ": an album a list gave, not asked for again");
      const mine = written(key, t0, t1);
      assert.equal(c.j.offset, mine.id, "its place in the library");
      assert.ok(c.j.album && c.j.album.offset === mine.id, "the album as the tiles carry it: " + c.text);
      const cover = mine.album.art_path;
      assert.ok(cover && fs.existsSync(cover), key + ": its cover kept beside the database");
      assert.equal(cover, path.join(lib.data, s, "art", id + ".jpg"));
      const coverBytes = fs.readFileSync(cover), marker = fs.readFileSync(cover + ".url", "utf8");
      assert.equal(mine.album.art_hash, require("crypto").createHash("md5").update(marker).digest("hex").slice(0, 12), key + ": its hash, of the cover's address");
      const answer = named(c.text);
      // The Node server's own, from the same start.
      const want = await rec.want("opened: " + key, async () => {
        await forget(key);
        const t2 = Date.now();
        const n = await call(NODE, `${s}/open`, { album_id: id });
        const t3 = Date.now();
        assert.deepEqual([n.status, n.by], [200, null], n.text);
        const w = written(key, t2, t3);
        return { album: steady(w.album), tracks: steady(w.tracks), cover: fs.readFileSync(cover).toString("hex"), marker: named(fs.readFileSync(cover + ".url", "utf8")), text: named(n.text) };
      });
      assert.deepEqual(steady(mine.album), want.album, key + ": the album's row");
      assert.deepEqual(steady(mine.tracks), want.tracks, key + ": its tracks' rows");
      assert.deepEqual([coverBytes.toString("hex"), named(marker)], [want.cover, want.marker], key + ": the same cover");
      assert.equal(answer, want.text, key + ": the same answer");
    }
    // What the rows say, beyond agreeing.
    const comp = albumRow("qobuz:q150"), hi = albumRow("qobuz:q200"), td = albumRow("tidal:2002");
    assert.deepEqual([comp.compilation, comp.label, comp.dir, comp.lossless, comp.container], [1, "Comp Label", "qobuz://album/q150", 1, "flac"]);
    assert.deepEqual([hi.max_rate, hi.max_bits, hi.barcode, hi.track_count, hi.duration], [192000, 24, "000q200", 2, 6]);
    assert.deepEqual([td.max_rate, td.max_bits, td.sort_title, td.genres], [96000, 24, "t hi res", "[]"]);
    assert.deepEqual([albumRow("qobuz:q170").sort_title, albumRow("qobuz:q170").sort_artist], ["b the", "q band"]);
    assert.deepEqual(trackRows(albumRow("qobuz:q100").id).map(x => [x.path, x.duration, x["duration:type"], x.isrc]),
      [["qobuz://track/5001", 3, "real", "ISRC5001"], ["qobuz://track/5002", 4.5, "real", "ISRC5002"]]);
    // Known already: answered as it is, the service not asked, by each the same.
    const before = qobuz.server.listenerCount("request");
    let asked = 0;
    const count = () => { asked++; };
    qobuz.server.on("request", count);
    try {
      const r = await same("qobuz/open", { album_id: "q100" });
      assert.equal(r.j.offset, albumRow("qobuz:q100").id);
      assert.equal(asked, 0, "Qobuz not asked for an album already here");
    } finally { qobuz.server.off("request", count); }
    assert.equal(qobuz.server.listenerCount("request"), before);
    // Refused, in the same words.
    for (const [p, b] of [["qobuz/open", {}], ["qobuz/open", { album_id: "" }], ["qobuz/open", { album_id: "nope" }], ["tidal/open", { album_id: "999" }], ["tidal/favorite", {}]]) {
      const r = await same(p, b);
      assert.ok(r.status >= 400, p + " " + JSON.stringify(b));
    }
    assert.deepEqual((await post("qobuz/open", { album_id: "nope" })).j, { error: "No such album" });
    // A body Express would refuse: the Node server's to refuse while it was there; refused here alone (Pages.NotThere.cs).
    const bad = await fetch(B + "/api/qobuz/open", { method: "POST", headers: H, body: "{nope" });
    assert.deepEqual([bad.status, bad.headers.get("x-mandarin-answered")], [400, RECORD ? null : "C#"]);
  });

  await t.test("favourited and taken away: the answer, the rows and the kept mark as the Node server's", async () => {
    for (const [s, id] of [["qobuz", "q200"], ["tidal", "2003"]]) {
      const fake = s === "qobuz" ? qobuz : tidal, key = s + ":" + id, ns = s + "-kept";
      // The Node server's own answer kept a minute: told of the change, it asks again.
      if (RECORD) assert.equal((await call(NODE, `${s}/state?album_id=${id}`)).j.favourite, false);
      await forget(key);
      let t0 = Date.now();
      const c = await post(`${s}/favorite`, { album_id: id });
      let t1 = Date.now();
      assert.deepEqual([c.status, c.by, c.j], [200, "C#", { ok: true, album_id: id, favourite: true }], c.text);
      assert.ok(fake.favourites.has(id), key + ": a favourite on the service");
      const mine = written(key, t0, t1);
      const kept = cacheRow(ns, key);
      assert.ok(kept, key + ": kept");
      const v = JSON.parse(kept.value);
      assert.deepEqual(Object.keys(v), ["why", "at"]);
      assert.equal(v.why, "favourite");
      assert.ok(v.at >= t0 && v.at <= t1 && kept.ts >= t0 && kept.ts <= t1, "since now");
      if (RECORD) assert.equal((await call(NODE, `${s}/state?album_id=${id}`)).j.favourite, true, "the Node server's kept answer forgotten");
      assert.equal((await same(`${s}/state?album_id=${id}`)).j.favourite, true);
      assert.ok((await get("library/albums?sort=album")).j.albums.some(a => a.offset === mine.id), "on the walls");
      if (RECORD) assert.ok(ctx.library.album(mine.id) && !ctx.library.album(mine.id).transient, "and the Node server's own library read again");
      // Taken away: let go, the rows kept (transient), the service told.
      const off = await post(`${s}/unfavorite`, { album_id: id });
      assert.deepEqual([off.status, off.by, off.j], [200, "C#", { ok: true, album_id: id, favourite: false }]);
      assert.equal(fake.favourites.has(id), false);
      assert.equal(cacheRow(ns, key), null, "no longer kept");
      assert.ok(albumRow(key), "its rows stay");
      assert.ok(!(await get("library/albums?sort=album")).j.albums.some(a => a.offset === mine.id), "off the walls");
      if (RECORD) assert.equal(ctx.library.album(mine.id).transient, true, "the Node server's own library: off the walls");
      // The Node server's own, from the same start.
      const want = await rec.want("favourited: " + key, async () => {
        await forget(key);
        const t2 = Date.now();
        const n = await call(NODE, `${s}/favorite`, { album_id: id });
        const t3 = Date.now();
        const w = written(key, t2, t3);
        const kept = JSON.parse(cacheRow(ns, key).value);
        const nOff = await call(NODE, `${s}/unfavorite`, { album_id: id });
        return { text: named(n.text), album: steady(w.album), tracks: steady(w.tracks), kept: Object.keys(kept), why: kept.why, off: named(nOff.text) };
      });
      assert.equal(named(c.text), want.text, "the same answer");
      assert.deepEqual(steady(mine.album), want.album, key + ": the album's row");
      assert.deepEqual(steady(mine.tracks), want.tracks, key + ": its tracks' rows");
      assert.deepEqual([Object.keys(v), v.why], [want.kept, want.why], key + ": kept as the Node server keeps it");
      assert.equal(named(off.text), want.off, "taken away: the same answer");
      // An album opened before, favourited: its rows brought up to date (the same columns, the same values).
      await forget(key);
      await post(`${s}/open`, { album_id: id });
      const opened = written(key, 0, Date.now());
      t0 = Date.now();
      await post(`${s}/favorite`, { album_id: id });
      const updated = written(key, opened.added, Date.now());
      assert.equal(updated.id, opened.id, "the same row");
      assert.equal(updated.added, opened.added, "added when first written");
      assert.ok(albumRow(key).updated_at >= t0, "brought up to date");
      assert.deepEqual(updated.album, opened.album);
      assert.deepEqual(updated.tracks, opened.tracks);
      await post(`${s}/unfavorite`, { album_id: id });
    }
    // Refused by the service: in its words, nothing written.
    const r = await same("tidal/unfavorite", { album_id: "2004" });
    assert.equal(r.status, 200, "Tidal lets go of what isn't there: " + r.text);
  });

  await t.test("a streamed album's page: the service's fields, as the Node server gives them", async () => {
    const page = async (key) => (await same("album?offset=" + albumRow(key).id)).j.album;
    // Kept as a favourite, played, and an album still to come.
    await post("qobuz/favorite", { album_id: "q100" });
    raw.prepare("INSERT INTO plays(album_id, track_id, title, artist, album, zone, ts) VALUES(?, NULL, 'Q One', 'Q Artist', 'Q Album', 'x', ?)").run(albumRow("qobuz:q100").id, Date.now() - DAY);
    await post("qobuz/open", { album_id: "q300" });
    raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('qobuz-held', 'qobuz:q300', '1', ?)").run(Date.now());
    await ctx.library.reload();
    const fav = await page("qobuz:q100");
    assert.deepEqual(Object.keys(fav).slice(-3), ["service_favourite", "qobuz_favourite", "service_why"], "in the Node server's order: " + Object.keys(fav).join(", "));
    assert.equal(fav.service_favourite, true);
    assert.equal(fav.service_why.kept, "favourite");
    assert.ok(fav.service_why.last_played > 0, "when it was last played");
    const soon = await page("qobuz:q300");
    assert.deepEqual([soon.service_favourite, soon.service_why.kept, soon.service_why.held, soon.service_why.releases], [false, null, true, "2099-01-01"]);
    const td = await page("tidal:2001");
    assert.equal(td.tidal_favourite, false);
    // A row from before v0.7.3: kept, reason unknown.
    raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('tidal-kept', 'tidal:2001', '1', ?) ON CONFLICT(ns, key) DO UPDATE SET value = excluded.value").run(Date.now());
    tidal.favourites.add("2001");
    if (RECORD) ctx.tidal.api.cache.clear();   // the Node server's kept answers
    await ctx.library.reload();   // the C# server's kept answers go with the library's version
    assert.equal((await page("tidal:2001")).service_why.kept, "unknown");
    // No longer a favourite on the service: the page lets it go, and says so, as the Node server's would.
    qobuz.favourites.delete("q100");
    const was = cacheRow("qobuz-kept", "qobuz:q100");
    const stale = async () => { if (RECORD) ctx.qobuz.api.cache.clear(); await ctx.library.reload(); };
    await stale();
    const c = await get("album?offset=" + albumRow("qobuz:q100").id);
    assert.equal(c.by, "C#");
    assert.deepEqual([c.j.album.service_favourite, c.j.album.service_why.kept], [false, null]);
    assert.equal(cacheRow("qobuz-kept", "qobuz:q100"), null, "let go");
    assert.equal((await get("library/albums?sort=album")).j.albums.some(a => a.title === "Q Album"), false, "off the walls");
    const n = await theirs("a favourite let go as the page opens", "album?offset=" + albumRow("qobuz:q100").id, undefined, { before: async () => {
      raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('qobuz-kept', 'qobuz:q100', ?, ?)").run(was.value, was.ts);
      await stale();
    } });
    assert.equal(named(c.text), n.text, "the same page");
    assert.equal(cacheRow("qobuz-kept", "qobuz:q100"), null);
    // A favourite on the service not kept here: kept as the page opens.
    qobuz.favourites.add("q100");
    await stale();
    const k = await get("album?offset=" + albumRow("qobuz:q100").id);
    assert.equal(k.j.album.service_why.kept, "favourite");
    assert.ok(cacheRow("qobuz-kept", "qobuz:q100"), "kept");
    assert.ok((await get("library/albums?sort=album")).j.albums.some(a => a.title === "Q Album"), "on the walls");
    const kn = await theirs("a favourite kept as the page opens", "album?offset=" + albumRow("qobuz:q100").id, undefined, { before: async () => {
      raw.prepare("DELETE FROM cache WHERE ns = 'qobuz-kept' AND key = 'qobuz:q100'").run();
      await stale();
    }, fix: (t) => sansSince(named(t)) });
    assert.equal(sansSince(named(k.text)), kn.text, "the same page");
    // A purchase stays, whatever the favourite.
    qobuz.favourites.delete("q100");
    qobuz.purchases.add("q100");
    raw.prepare("UPDATE cache SET value = ? WHERE ns = 'qobuz-kept' AND key = 'qobuz:q100'").run(JSON.stringify({ why: "purchase", at: 1700000000000 }));
    await stale();
    const bought = await page("qobuz:q100");
    assert.deepEqual([bought.service_favourite, bought.service_why.kept, bought.service_why.since], [false, "purchase", 1700000000000]);
    qobuz.purchases.delete("q100");
    raw.prepare("UPDATE cache SET value = ? WHERE ns = 'qobuz-kept' AND key = 'qobuz:q100'").run(JSON.stringify({ why: "favourite", at: 1700000000000 }));
    qobuz.favourites.add("q100");
    await stale();
  });

  await t.test("Tidal's token about to expire, or refused: refreshed by the C# server, the write made once", async () => {
    let accepted = 0, posts = 0, asked = 0;
    const seen = (req) => {
      if (req.method !== "POST" || !/\/favorites\/albums$/.test(req.url.split("?")[0])) return;
      posts++;
      const bearer = String(req.headers.authorization || "").replace(/^Bearer /, "");
      if (bearer === tidal.access && !tidal.expiredTokens.has(bearer)) accepted++;
    };
    tidal.server.on("request", seen);
    // The Node server's own refresh, counted (recording): never asked (v0.8.47).
    const own = RECORD ? ctx.tidal.api.refresh : null;
    if (RECORD) ctx.tidal.api.refresh = (...a) => { asked++; return own(...a); };
    try {
      // About to expire: refreshed here first, then written.
      const before = tidal.refreshes;
      const due = () => { const acc = ctx.db.setting("tidal", null); acc.token.expires = Date.now() + 1000; ctx.db.setSetting("tidal", acc); };
      due();
      await forget("tidal:2004");
      let r = await post("tidal/favorite", { album_id: "2004" });
      assert.deepEqual([r.status, r.by, r.j], [200, "C#", { ok: true, album_id: "2004", favourite: true }], r.text);
      assert.equal(tidal.refreshes, before + 1, "refreshed by the C# server");
      assert.deepEqual([posts, accepted], [1, 1], "asked of Tidal once");
      assert.ok(tidal.favourites.has("2004") && cacheRow("tidal-kept", "tidal:2004") && albumRow("tidal:2004"), "made");
      r = await post("tidal/unfavorite", { album_id: "2004" });
      assert.deepEqual([r.status, r.by], [200, "C#"]);
      // Refused: Tidal makes nothing of it; refreshed, and asked again, so made once.
      posts = accepted = 0;
      tidal.expireAccess();
      r = await post("tidal/favorite", { album_id: "2004" });
      assert.deepEqual([r.status, r.by], [200, "C#"], r.text);
      assert.equal(tidal.refreshes, before + 2);
      assert.deepEqual([posts, accepted], [2, 1], "made once (the refused ask made nothing)");
      assert.ok(tidal.favourites.has("2004"));
      await post("tidal/unfavorite", { album_id: "2004" });
      // An album opened, and a page, likewise.
      due();
      await forget("tidal:2004");
      r = await post("tidal/open", { album_id: "2004" });
      assert.deepEqual([r.status, r.by], [200, "C#"], r.text);
      assert.equal(r.j.offset, albumRow("tidal:2004").id, "written");
      assert.equal(tidal.refreshes, before + 3);
      due();
      await ctx.library.reload();
      r = await get("album?offset=" + albumRow("tidal:2003").id);
      assert.deepEqual([r.status, r.by], [200, "C#"], "the page asks Tidal, the token refreshed first");
      assert.equal(r.j.album.service_favourite, false);
      assert.equal(tidal.refreshes, before + 4);
      assert.equal(asked, 0, "the Node server never asked to refresh it");
    } finally { tidal.server.off("request", seen); if (RECORD) ctx.tidal.api.refresh = own; }
  });

  await t.test("Clean up, signed in and signed out, as the Node server's", async () => {
    // Signed in: the transient albums go, with their edits, hearts and Listen later; kept and held ones stay.
    const setUp = async () => {
      for (const id of ["q150", "q170", "q200", "q400", "q500", "q600"]) { await forget("qobuz:" + id); await post("qobuz/open", { album_id: id }); }
      await post("qobuz/favorite", { album_id: "q500" });
      raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('qobuz-held', 'qobuz:q600', '1', 0) ON CONFLICT(ns, key) DO NOTHING").run();
      raw.prepare("INSERT INTO favourites(key, added_at) VALUES('qobuz:q400', 1) ON CONFLICT(key) DO NOTHING").run();
      raw.prepare("INSERT INTO listen_later(key, added_at) VALUES('qobuz:q400', 1) ON CONFLICT(key) DO NOTHING").run();
      raw.prepare("INSERT INTO album_edits(key, title, updated_at) VALUES('qobuz:q400', 'Mine', 1) ON CONFLICT(key) DO NOTHING").run();
      raw.prepare("INSERT INTO track_edits(key, pos, title) VALUES('qobuz:q400', '1-1', 'Mine') ON CONFLICT(key, pos) DO NOTHING").run();
      await ctx.library.reload();
    };
    const left = () => raw.prepare("SELECT key FROM albums WHERE key LIKE 'qobuz:%' ORDER BY key").all().map(r => r.key);
    const edits = () => ["album_edits", "favourites", "listen_later", "track_edits"].map(t => raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE key = 'qobuz:q400'`).get().n);
    await setUp();
    const stale = (await get("library/cleanup")).j.qobuz.albums;
    assert.ok(stale >= 1, "something to clean up");
    const c = await post("library/cleanup", { kind: "qobuz" });
    assert.deepEqual([c.status, c.by], [200, "C#"], c.text);
    assert.deepEqual(Object.keys(c.j), ["ok", "kind", "removed", "count"]);
    assert.deepEqual([c.j.ok, c.j.kind, c.j.removed], [true, "qobuz", stale]);
    const afterC = left();
    assert.ok(!afterC.includes("qobuz:q400") && afterC.includes("qobuz:q500") && afterC.includes("qobuz:q600"), afterC.join(", "));
    assert.deepEqual(edits(), [0, 0, 0, 0], "its edits, heart and Listen later gone");
    assert.equal(c.j.count, (await get("library-stats")).j.albums, "the library's count after");
    const n = await rec.want("Clean up, signed in", async () => {
      await setUp();
      const x = await call(NODE, "library/cleanup", { kind: "qobuz" });
      assert.deepEqual(edits(), [0, 0, 0, 0]);
      return { text: x.text, left: left() };
    });
    assert.equal(c.text, n.text, "the same answer");
    assert.deepEqual(afterC, n.left, "the same albums left");
    // Nothing stale: nothing removed, the Node server not told.
    assert.equal((await same("library/cleanup", { kind: "qobuz" })).j.removed, 0);
    // The music folders' kind, and one it refuses: the C# server's too (v0.8.48), word for word
    // the Node server's.
    const files = await same("library/cleanup", { kind: "files" });
    assert.deepEqual([files.status, files.j.ok, files.j.kind, files.j.removed], [200, true, "files", 0], files.text);
    assert.equal((await same("library/cleanup", { kind: "nope" })).status, 400);
    // Signed out of Tidal: every Tidal album goes, the kept and held marks, and Tidal's playlists.
    const lists = [{ id: "mine", name: "Mine", tracks: [] }, { id: "tidal-pl-x", name: "Long drive", service: "tidal", tracks: [] }, { id: "qobuz-pl-1", name: "Road trip", qobuz: true, tracks: [] }, { id: "", name: "Nameless" }];
    const signedOut = () => {
      raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('tidal-held', 'tidal:2002', '1', 0) ON CONFLICT(ns, key) DO NOTHING").run();
      ctx.db.setSetting("userPlaylists", lists);
      return ctx.library.reload();
    };
    const tidalAccount = ctx.db.setting("tidal");
    assert.equal((await post("settings/tidal/signout", {})).j.connected, false);
    await signedOut();
    const tidalRows = () => raw.prepare("SELECT key FROM albums WHERE key LIKE 'tidal:%' ORDER BY key").all().map(r => r.key);
    const had = tidalRows();
    assert.ok(had.length >= 3, had.join(", "));
    const so = await post("library/cleanup", { kind: "tidal" });
    assert.deepEqual([so.status, so.by, so.j.removed], [200, "C#", had.length], so.text);
    assert.deepEqual(tidalRows(), []);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM cache WHERE ns LIKE 'tidal-%'").get().n, 0, "the kept and held marks gone");
    const playlists = raw.prepare("SELECT value FROM settings WHERE key = 'userPlaylists'").get().value;
    assert.equal(playlists, JSON.stringify(lists.filter(x => x.id && x.name && x.service !== "tidal")), "Tidal's playlists gone, the rest as they were");
    // The Node server's, from the same start (the rows written again as they were).
    const sn = await rec.want("Clean up, signed out", async () => {
      ctx.db.setSetting("tidal", tidalAccount);
      for (const id of had) await post("tidal/open", { album_id: id.slice(6) });
      await post("tidal/favorite", { album_id: "2001" });
      await post("settings/tidal/signout", {});
      await signedOut();
      const x = await call(NODE, "library/cleanup", { kind: "tidal" });
      return { text: x.text, playlists: raw.prepare("SELECT value FROM settings WHERE key = 'userPlaylists'").get().value };
    });
    assert.deepEqual([so.text, playlists], [sn.text, sn.playlists], "the same answer, the same playlists left");
    // Signed out with nothing left: the marks and playlists still go, nothing removed.
    await signedOut();
    const empty = await same("library/cleanup", { kind: "tidal" });
    assert.equal(empty.j.removed, 0);
    // Signed in again for what follows.
    ctx.db.setSetting("tidal", tidalAccount);
    await ctx.library.reload();
  });

  await t.test("the month's prune: a month unplayed, neither kept nor held, goes; the rest stays", async () => {
    if (RECORD) {
      assert.ok(ctx.frontRuns.has("prune"), "handed over");
      assert.equal(ctx.madeByFront("prune"), true, "the Node server's own timer does nothing");
    }
    const K = { "X-Mandarin-Front-Key": ctx.frontKey };
    assert.equal((await fetch(B + "/internal/jobs/prune", { method: "POST" })).status, 404, "not without the key");
    const old = Date.now() - 40 * DAY;
    const setUp = async () => {
      raw.prepare("DELETE FROM albums WHERE key LIKE 'qobuz:%'").run();
      raw.prepare("DELETE FROM cache WHERE ns LIKE 'qobuz-%'").run();
      // The plays of earlier albums too: SQLite gives a removed album's id to the next one.
      raw.prepare("DELETE FROM plays").run();
      for (const id of ["q400", "q500", "q600", "q700", "q800", "q900"]) await post("qobuz/open", { album_id: id });
      const idOf = (id) => albumRow("qobuz:" + id).id;
      // q400: a month old, never played: goes. q500: played ten days ago: stays. q600: kept: stays.
      // q700: held: stays. q800: read today: stays. q900: last played forty days ago: goes.
      for (const id of ["q400", "q500", "q600", "q700", "q900"]) raw.prepare("UPDATE albums SET updated_at = ? WHERE key = ?").run(old, "qobuz:" + id);
      raw.prepare("INSERT INTO plays(album_id, title, ts) VALUES(?, 'x', ?)").run(idOf("q500"), Date.now() - 10 * DAY);
      raw.prepare("INSERT INTO plays(album_id, title, ts) VALUES(?, 'x', ?)").run(idOf("q900"), old);
      raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('qobuz-kept', 'qobuz:q600', ?, 0)").run(JSON.stringify({ why: "favourite", at: 1 }));
      raw.prepare("INSERT INTO cache(ns, key, value, ts) VALUES('qobuz-held', 'qobuz:q700', '1', 0)").run();
      await ctx.library.reload();
      return idOf("q400");
    };
    const left = () => raw.prepare("SELECT key FROM albums WHERE key LIKE 'qobuz:%' ORDER BY key").all().map(r => r.key);
    const gone = await setUp();
    const r = await fetch(B + "/internal/jobs/prune", { method: "POST", headers: K });
    assert.deepEqual([r.status, await r.json()], [200, { ok: true, removed: { qobuz: 2, tidal: 0 } }]);
    const mine = left();
    assert.deepEqual(mine, ["qobuz:q500", "qobuz:q600", "qobuz:q700", "qobuz:q800"]);
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM tracks WHERE album_id = ?").get(gone).n, 0, "its tracks with it");
    if (RECORD) assert.equal(ctx.library.album(gone), null, "the Node server told");
    const theirPrune = await rec.want("the month's prune", async () => {
      await setUp();
      return { removed: ctx.services.qobuz.pruneTransient(), left: left() };
    });
    assert.deepEqual([2, mine], [theirPrune.removed, theirPrune.left], "the Node server's own: the same albums left");
    // Nothing more to prune.
    assert.deepEqual(await (await fetch(B + "/internal/jobs/prune", { method: "POST", headers: K })).json(), { ok: true, removed: { qobuz: 0, tidal: 0 } });
    rec.done();
  });
});

/* The page's "since" for an album kept as the page opened: that moment, each its own. */
function sansSince(text) { return text.replace(/"since":\d+/, `"since":"now"`); }
