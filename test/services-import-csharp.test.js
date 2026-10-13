"use strict";
/*
 * Qobuz's and Tidal's import, the favourites' watch and the service
 * playlists, made by the C# server (v0.8.45, stage 4.3;
 * server/Mandarin.Server/Services/Import.cs and ServiceRoutes.cs), against
 * the fakes on loopback (test/fake-qobuz.js, test/fake-tidal.js), each held
 * to what the Node server writes and answers for the same request (its own
 * import or watch, asked of it directly, the state put back between):
 *
 *   - Settings → Services' state (GET /api/settings/<s>), the quality and the
 *     import's switch, word for word; switched on, the import made;
 *   - Update library now: every album's and track's row, each column and the
 *     type SQLite keeps it as (the ids and the two times aside, said below),
 *     the kept marks ({ why, at }), the held marks, the playlists
 *     (userPlaylists, yours and the other service's kept as they were), what
 *     it made (<s>LastImport) and the answer; again with everything here
 *     (nothing asked again); a favourite removed on the service, and a
 *     playlist gone there;
 *   - the watch: an album favourited on the service brought in, one removed
 *     let go; the page's POST /api/services/watch, and its 15 seconds;
 *   - Tidal's token due, or refused partway: refreshed by the C# server
 *     (v0.8.47), the import made here whole, the same rows as the Node
 *     server's own run makes; refused even so, the album it was asked for
 *     failed, what was brought in before told; the Node server never asked;
 *   - an import after a Rescan (the Node server asks) or a sign-in (the C#
 *     server's own since v0.8.47) made by the C# server, and the timers: the
 *     first import after the hand-over and the watch, the Node server's own idle.
 *
 * test/qobuz.test.js and test/tidal.test.js are the services' own.
 *
 * Since v0.8.50 (stage 7) the Node server's side is a recording
 * (test/golden/services-import-node.json, test/golden.js): made
 * through the C# server with the Node server behind
 * it (MANDARIN_FRONT=1, while index.js was still there); every run since starts
 * the program alone and holds it to the recording. The data folder, the fakes'
 * ports and times written as the test ran are said by name or in days from
 * now; a cover's hash is held to its rule (md5 of its address).
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

const rec = recording("services-import-node");
const skip = built() || (!rec.exists() && "no recording of the Node server's answers") || (!haveFfmpeg() && "ffmpeg is not installed");
const DAY = 86400e3;
const md5 = (s) => require("crypto").createHash("md5").update(s).digest("hex").slice(0, 12);

/* Where two values first differ ("albums.1.tracks.0.title: a | b"), or null: the message a failure names. */
function differ(a, b, at = "") {
  if (Object.is(a, b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const d = differ(a[k], b[k], at ? at + "." + k : k);
      if (d) return d;
    }
    return Array.isArray(a) === Array.isArray(b) ? null : at + ": a list against an object";
  }
  return `${at}: ${JSON.stringify(a)} | ${JSON.stringify(b)}`;
}
/* The same, or the first place they differ said. */
function same(a, b, what) { const d = differ(a, b); assert.equal(d, null, (what ? what + ": " : "") + d); }

async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

/* The fakes, the same for each test: favourites, a purchase, playlists and favourite tracks. */
function fakes(lib) {
  const file = path.join(lib.music, "Artist A", "Album One", "01 Song 1.flac");
  const track = (id, title, extra) => Object.assign({ id, title, file, duration: 3 }, extra || {});
  const qobuz = new FakeQobuz({ albums: [
    { id: "q100", title: "Q Album", artist: "Q Artist", rate: 44100, bits: 16, year: 2021, tracks: [track(5001, "Q One"), track(5002, "Q Two", { duration: 4.5 })] },
    { id: "q200", title: "Q Hi-Res", artist: "Q Artist", rate: 96000, bits: 24, year: 2023, tracks: [track(5101, "Q Hi"), track(5102, "Q Hi Two", { rate: 192000 })] },
    { id: "q300", title: "Q Bought", artist: "Various Artists", rate: 44100, bits: 16, year: 2019, tracks: [track(5201, "Q Bought One")] },
    { id: "q400", title: "Q Listed", artist: "Somebody", rate: 44100, bits: 16, year: 2018, tracks: [track(5401, "Q Listed One"), track(5402, "Q Listed Two")] },
    { id: "q500", title: "Q Loved Track", artist: "Somebody", rate: 44100, bits: 16, year: 2017, tracks: [track(5501, "Q Loved")] },
    { id: "q600", title: "Q Later", artist: "Q Artist", rate: 44100, bits: 16, year: 2024, tracks: [track(5601, "Q Later One")] }
  ], playlists: [
    { id: 77, name: "Road trip", tracks: [5401, 5001, 5999] },
    { id: 78, name: "A list whose name runs on and on, far longer than the eighty characters a name is cut to here", tracks: [5402] }
  ] });
  qobuz.favourites.add("q100");
  qobuz.favourites.add("q200");
  qobuz.purchases.add("q300");
  qobuz.dates.set("q100", 1700000000);
  qobuz.dates.set("q300", 1600000000);
  qobuz.favouriteTracks.add("5501");
  const tidal = new FakeTidal({ albums: [
    { id: 2001, title: "T Album", artist: "T Artist", year: 2021, hires: false, tracks: [track(8001, "T One"), track(8002, "T Two")] },
    { id: 2002, title: "T Other", artist: "T Artist", year: 2022, hires: false, tracks: [track(8101, "T Other One")] },
    { id: 2003, title: "T Listed", artist: "Somebody", year: 2020, hires: false, tracks: [track(8201, "T Listed One")] },
    { id: 2004, title: "T Loved Track", artist: "Somebody", year: 2019, hires: false, tracks: [track(8301, "T Loved")] },
    { id: 2005, title: "T Later", artist: "T Artist", year: 2024, hires: false, tracks: [track(8401, "T Later One")] },
    { id: 2006, title: "T Last", artist: "T Artist", year: 2025, hires: false, tracks: [track(8501, "T Last One")] }
  ], playlists: [{ uuid: "aaaa-bbbb", name: "Long drive", tracks: [8201, 8002] }] });
  tidal.favourites.add("2001");
  tidal.favourites.add("2002");
  tidal.favouriteTracks.add("8301");
  return { qobuz, tidal };
}

test("Qobuz's and Tidal's import, watch and playlists, made by the C# server as the Node server makes them", { skip, timeout: 300000 }, async (t) => {
  const lib = makeLibrary();
  const { qobuz, tidal } = fakes(lib);
  t.after(() => Promise.all([qobuz.stop(), tidal.stop()]));
  await qobuz.start();
  await tidal.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/",
    // The timers out of the way: each import and watch here is asked for.
    qobuzSyncDelayMs: 1e9, serviceWatchMs: 1e9 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  // The server's private addresses (the front key), and its database read straight.
  const K = { "X-Mandarin-Front-Key": ctx.frontKey };
  const raw = ctx.db.raw;
  /* The data folder and any port on loopback by name, a cover's hash as its rule's, a time written as the test ran in days from now. */
  const named = (text) => String(text).split(lib.data).join("<data>").replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
    .replace(/"art_hash":"[0-9a-f]{12}"/g, `"art_hash":"<its address's>"`).replace(/(al-[^-"]+-)[0-9a-f]{12}\b/g, "$1<its address's>")
    .replace(/(":)(1\d{12})\b/g, (m, pre, t) => { const d = (Number(t) - Date.now()) / DAY; return Math.abs(d) < 3 ? `${pre}"<now ${Math.round(d)} d>"` : m; });
  const steady = (v) => JSON.parse(named(JSON.stringify(v === undefined ? null : v)));
  /* The Node server's answer to the same request: asked now (recording) or as recorded. */
  const theirs = (label) => rec.want(label);
  const call = async (base, p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j, text };
  };
  const get = (p) => call(B, p);
  const post = (p, body) => call(B, p, body || {});

  await until(() => ctx.frontRuns, 30000, "the work handed over");

  // ---------------------------------------------------------------- the database, read

  const columns = (table) => raw.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  const typed = (table, where, ...args) => {
    const cs = columns(table);
    return raw.prepare(`SELECT ${cs.map(c => `${c}, typeof(${c}) AS "${c}:type"`).join(", ")} FROM ${table} WHERE ${where}`).all(...args);
  };
  const strip = (o, keys) => { const x = Object.assign({}, o); for (const k of keys) { delete x[k]; delete x[k + ":type"]; } return x; };
  /*
   * A service's part of the library as it can be compared: every album and
   * track row (the ids SQLite gives left out, an album's two times checked to
   * be the run's own), the kept marks (a time the service gave as it is, one
   * stamped then as "now"), the held marks, the playlists (an album named by
   * its key, the times stamped then as "now") and what the import made.
   */
  const state = (s, t0, t1) => {
    const now = (v) => typeof v === "number" && v >= t0 && v <= t1 ? "now" : v;
    const keys = new Map(raw.prepare("SELECT id, key FROM albums").all().map(r => [r.id, r.key]));
    const albums = typed("albums", "key LIKE ? ORDER BY key", s + ":%").map(a => {
      assert.equal(a["added_at:type"], "integer");
      if (a.art_path) assert.equal(a.art_hash, md5(fs.readFileSync(a.art_path + ".url", "utf8")), a.key + ": its cover's hash, of its address");
      assert.ok(a.updated_at >= t0 && a.updated_at <= t1 && a.added_at >= t0, `${a.key}: written by the run`);
      return Object.assign(strip(a, ["id", "added_at", "updated_at"]), { tracks: typed("tracks", "album_id = ? ORDER BY path", a.id).map(tr => strip(tr, ["id", "album_id"])) });
    });
    const kept = raw.prepare("SELECT key, value FROM cache WHERE ns = ? ORDER BY key").all(s + "-kept").map(r => {
      const v = JSON.parse(r.value);
      return { key: r.key, fields: Object.keys(v), why: v.why, at: now(v.at) };
    });
    const held = raw.prepare("SELECT key, value FROM cache WHERE ns = ? ORDER BY key").all(s + "-held");
    const lists = JSON.parse((raw.prepare("SELECT value FROM settings WHERE key = 'userPlaylists'").get() || { value: "null" }).value);
    const named = (lists || []).map(p => Object.assign({}, p, p.created_at ? { created_at: now(p.created_at) } : {}, p.updated_at ? { updated_at: now(p.updated_at) } : {},
      Array.isArray(p.tracks) ? { tracks: p.tracks.map(x => Object.assign({}, x, { album_offset: keys.get(x.album_offset), image_key: String(x.image_key).replace(/^al-(\d+)-/, (m, id) => `al-${keys.get(Number(id))}-`) })) } : {}));
    const last = ctx.db.setting(s + "LastImport", null);
    // The playlists as text too: each entry's fields in the Node server's order.
    return { albums, kept, held, lists: named, text: JSON.stringify(named), last: last && Object.assign({}, last, { at: now(last.at), seconds: "s" }) };
  };
  // The playlists to begin with: yours, an older Qobuz one (v0.6.23's mark), one gone from Qobuz, Tidal's, and one nameless.
  const LISTS = [
    { id: "mine", name: "Mine", tracks: [], created_at: 1, updated_at: 2 },
    { id: "qobuz-pl-77", name: "Road trip before", qobuz: true, tracks: [], created_at: 3, updated_at: 4 },
    { id: "qobuz-pl-99", name: "Gone from Qobuz", qobuz: true, tracks: [] },
    { id: "tidal-pl-gone", name: "Gone from Tidal", service: "tidal", tracks: [] },
    { id: "", name: "Nameless" }
  ];
  // A service's albums, marks, playlists and what it made taken away, covers too, so the next run starts as the first did.
  const reset = (s) => {
    for (const a of raw.prepare("SELECT art_path FROM albums WHERE key LIKE ?").all(s + ":%")) if (a.art_path) for (const f of [a.art_path, a.art_path + ".url"]) fs.rmSync(f, { force: true });
    raw.prepare("DELETE FROM albums WHERE key LIKE ?").run(s + ":%");
    raw.prepare("DELETE FROM cache WHERE ns IN (?, ?)").run(s + "-kept", s + "-held");
    raw.prepare("DELETE FROM settings WHERE key = ?").run(s + "LastImport");
    ctx.db.setSetting("userPlaylists", LISTS);
    return ctx.library.reload();
  };
  // Qobuz's lists are kept a minute by each server, as api.js keeps them: a run starts with neither's
  // (the account's token turned, as a sign-in turns it), so each asks Qobuz as it is then.
  let turn = 0;
  const cold = () => { qobuz.token = "tok-cold-" + (++turn); const acc = ctx.db.setting("qobuz"); acc.token = qobuz.token; ctx.db.setSetting("qobuz", acc); };
  const sansNow = (text) => text.replace(/"at":\d+/g, `"at":"now"`).replace(/"seconds":\d+/g, `"seconds":"s"`);
  /*
   * The same run on each server from the same start ([before]: what to do first, the same each time): the answers and
   * the state after, the Node server's as recorded under [label]. An answer's text and the state as named() says them.
   */
  const both = async (label, s, before, mine) => {
    const run = async (fn) => {
      // Stamped "now": anything written from here, the run or what it starts from.
      const t0 = Date.now();
      await reset(s);
      if (s === "qobuz") cold();
      if (before) await before();
      if (s === "qobuz") cold();
      const r = await fn();
      return { r: r && typeof r.text === "string" ? Object.assign({}, r, { text: named(r.text) }) : r, st: steady(state(s, t0, Date.now())) };
    };
    const a = await run(mine);
    const b = await rec.want(label);
    return [a, b];
  };
  const importOn = (s, on) => { ctx.db.setSetting(s + "Settings", { quality: s === "qobuz" ? "hires192" : "hires", import: on }); return ctx.library.reload(); };

  // Signed out, Settings → Services is the C# server's since v0.8.47 (test/services-signin-csharp.test.js holds it word for word).
  await t.test("signed out: Settings → Services by C#, as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const r = await get("settings/" + s);
      assert.deepEqual([r.status, r.by, r.j.connected], [200, "C#", false]);
      assert.equal(named(r.text), (await theirs("signed out: settings/" + s, "settings/" + s)).text);
      assert.deepEqual([(await post("settings/" + s, { import: true })).by, (await post("settings/" + s, { import: false })).by], ["C#", "C#"]);
      const n = await post(`settings/${s}/import`);
      assert.deepEqual([n.status, n.by, n.j], [401, "C#", { error: "Not signed in to " + (s === "qobuz" ? "Qobuz" : "Tidal"), connected: false }]);
    }
  });

  // Signed in, as from Settings → Services (the import's switch off: nothing brought in).
  assert.equal((await post("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
  assert.equal((await post("settings/tidal/signin", {})).status, 200);
  tidal.approve();
  await until(async () => (await get("settings/tidal")).j.connected, 20000, "Tidal signed in");
  await new Promise(r => setTimeout(r, 1500));
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM albums WHERE key LIKE 'qobuz:%' OR key LIKE 'tidal:%'").get().n, 0, "nothing brought in");

  await t.test("Settings → Services: the state, the quality and the switch, as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const c = await get("settings/" + s), n = await theirs("signed in: settings/" + s, "settings/" + s);
      assert.deepEqual([c.status, c.by], [200, "C#"]);
      assert.equal(named(c.text), n.text, s + ": the same state");
      assert.equal(c.j.importing, false);
      // The quality: written, and answered, as the Node server's; one not offered refused in its words.
      for (const q of s === "qobuz" ? ["cd", "hires96", "hires192"] : ["cd", "hires"]) {
        const mine = await post("settings/" + s, { quality: q });
        const written = raw.prepare("SELECT value FROM settings WHERE key = ?").get(s + "Settings").value;
        const n = await rec.want("the quality: " + s + " " + q);
        assert.deepEqual([mine.status, mine.by], [200, "C#"]);
        assert.equal(named(mine.text), n.text, s + ": the quality " + q);
        assert.equal(written, n.written, s + ": written as the Node server writes it");
      }
      for (const body of [{ quality: "nope" }, { quality: null }, { quality: 5 }]) {
        const mine = await post("settings/" + s, body), n = await theirs("a quality refused: " + s + " " + JSON.stringify(body), "settings/" + s, body);
        assert.deepEqual([mine.status, mine.by, named(mine.text)], [400, "C#", n.text], JSON.stringify(body));
      }
      // Off, as it is: written, nothing to bring in.
      const off = await post("settings/" + s, { import: false }), offN = await theirs("off: " + s, "settings/" + s, { import: false });
      assert.equal(named(off.text), offN.text);
    }
    // Tidal's: a setting written forgets what the Node server learnt from the old (hi-res asked for again; recording).
    assert.equal((await post("settings/tidal", { quality: "hires" })).by, "C#");
  });

  await t.test("the switch on: the albums back at once and the import made, as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const other = s === "qobuz" ? "tidal" : "qobuz";
      await importOn(other, false);
      const [mine, nodes] = await both("the switch on: " + s, s, () => importOn(s, false), async () => {
        const r = await post("settings/" + s, { import: true });
        await until(async () => !(await get("settings/" + s)).j.importing, 20000, s + "'s import");
        return r;
      });
      assert.deepEqual([mine.r.status, mine.r.by, mine.r.j.importing], [200, "C#", true], mine.r.text);
      assert.equal(mine.r.text, nodes.r.text, s + ": the same answer, importing");
      same(mine.st, nodes.st, s + ": the same library after");
      assert.ok(mine.st.albums.length >= 3 && mine.st.kept.length >= 2, s + ": brought in");
      // Off again: in the Node server's words, and off the walls at once.
      const off = await post("settings/" + s, { import: false });
      assert.equal(off.j.import, false);
      assert.equal((await get("library/albums?sort=album")).j.albums.some(a => a.source === s), false, s + ": off the walls");
      await importOn(s, true);
      await importOn(other, true);
    }
  });

  await t.test("Update library now: the rows, the marks, the playlists and the answer as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const other = s === "qobuz" ? "tidal" : "qobuz";
      await importOn(other, false);
      const now = () => post(`settings/${s}/import`);
      // From nothing: every album asked for and written.
      let [a, b] = await both("Update library now, from nothing: " + s, s, null, now);
      assert.deepEqual([a.r.status, a.r.by, b.r.by], [200, "C#", null], a.r.text);
      assert.equal(sansNow(a.r.text), sansNow(b.r.text), s + ": the same answer");
      same(a.st, b.st, s + ": the same library");
      const fake = s === "qobuz" ? qobuz : tidal;
      // What the rows and marks say, beyond agreeing.
      if (s === "qobuz") {
        assert.deepEqual(a.r.j.result.albums, 3, "two favourites and a purchase");
        assert.deepEqual(a.st.kept.map(k => [k.key, k.why, k.at]), [["qobuz:q100", "favourite", 1700000000000], ["qobuz:q200", "favourite", "now"], ["qobuz:q300", "purchase", 1600000000000]]);
        assert.deepEqual(a.st.held.map(h => [h.key, h.value]), [["qobuz:q100", "1"], ["qobuz:q400", "1"], ["qobuz:q500", "1"]], "the playlists' and favourite tracks' albums held");
        const road = a.st.lists.find(p => p.id === "qobuz-pl-77");
        assert.deepEqual([road.name, road.qobuz, road.created_at, road.updated_at, road.tracks.map(x => [x.title, x.album_offset, x.track_index])],
          ["Road trip", true, 3, "now", [["Q Listed One", "qobuz:q400", 0], ["Q One", "qobuz:q100", 0]]], "brought up to date in place; a track not there left out");
        assert.equal(a.st.lists.find(p => p.id === "qobuz-pl-78").name.length, 80, "a long name cut to 80");
        assert.ok(a.st.lists.some(p => p.id === "qobuz-favourite-tracks" && p.name === "Qobuz favourite tracks"));
        assert.ok(!a.st.lists.some(p => p.id === "qobuz-pl-99" || p.id === ""), "gone from Qobuz, and the nameless, gone");
        assert.ok(a.st.lists.some(p => p.id === "mine") && a.st.lists.some(p => p.id === "tidal-pl-gone"), "yours and Tidal's as they were");
      } else {
        assert.deepEqual(a.st.kept.map(k => [k.key, k.why, k.at]), [["tidal:2001", "favourite", Date.parse("2026-01-01T00:00:00.000Z")], ["tidal:2002", "favourite", Date.parse("2026-01-01T00:00:00.000Z")]],
          "since Tidal's own date (+0000)");
        assert.deepEqual(a.st.lists.filter(p => p.service === "tidal").map(p => p.id).sort(), ["tidal-favourite-tracks", "tidal-pl-aaaa-bbbb"], "Tidal's own, the one gone from it gone");
      }
      // Again, everything here and read this week: nothing asked of the service again.
      [a, b] = await both("Update library now, again: " + s, s, () => post(`settings/${s}/import`), now);
      assert.equal(sansNow(a.r.text), sansNow(b.r.text), s + ": the same answer again");
      same(a.st, b.st);
      assert.equal(a.r.j.result.fetched, 0, "none asked again");
      // A favourite removed on the service: let go (its rows kept, off the walls); as the Node server's.
      const gone = s === "qobuz" ? "q200" : "2002";
      [a, b] = await both("Update library now, a favourite gone: " + s, s, async () => { fake.favourites.add(gone); await post(`settings/${s}/import`); fake.favourites.delete(gone); }, now);
      fake.favourites.add(gone);
      assert.equal(a.r.j.result.dropped, 1, a.r.text);
      assert.equal(sansNow(a.r.text), sansNow(b.r.text));
      same(a.st, b.st);
      // A playlist gone from the service: gone from here.
      const lists = fake.playlists;
      try { [a, b] = await both("Update library now, a playlist gone: " + s, s, async () => { fake.playlists = lists; await post(`settings/${s}/import`); fake.playlists = []; }, now); }
      finally { fake.playlists = lists; }
      same(a.st, b.st);
      assert.ok(!a.st.lists.some(p => p.id && p.id.startsWith(s + "-pl-")), "its playlists gone");
      // Switched off: refused, in the same words.
      await importOn(s, false);
      const c = await post(`settings/${s}/import`), n = await theirs("switched off: " + s, `settings/${s}/import`, {});
      assert.deepEqual([c.status, c.by, named(c.text)], [409, "C#", n.text]);
      await importOn(s, true);
      await importOn(other, true);
    }
  });

  await t.test("the page's quick look (POST /api/services/watch), and its 15 seconds, as the Node server's", async () => {
    const before = async () => {
      qobuz.favourites.delete("q600");
      for (const s of ["qobuz", "tidal"]) await post(`settings/${s}/import`);
      qobuz.favourites.add("q600");
    };
    const [a, b] = await both("the page's quick look", "qobuz", before, () => post("services/watch"));
    qobuz.favourites.delete("q600");
    assert.deepEqual([a.r.status, a.r.by, b.r.by], [200, "C#", null]);
    assert.equal(a.r.text, b.r.text, "the same answer");
    assert.deepEqual(a.r.j.services.qobuz, { added: 1, dropped: 0, failed: 0, changed: true });
    same(a.st, b.st);
    // Looked at again within 15 seconds: nothing done, by each.
    const c = await post("services/watch"), n = await theirs("the quick look again", "services/watch", {});
    assert.deepEqual([c.by, named(c.text)], ["C#", n.text]);
    assert.deepEqual(c.j, { changed: false, services: {} });
  });

  await t.test("the watch: favourites changed on the service followed as the Node server's watch follows them", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const other = s === "qobuz" ? "tidal" : "qobuz", fake = s === "qobuz" ? qobuz : tidal;
      const [added, removed] = s === "qobuz" ? ["q600", "q200"] : ["2005", "2002"];
      await importOn(other, false);
      const before = async () => {
        fake.favourites.delete(added);
        fake.favourites.add(removed);
        await post(`settings/${s}/import`);
        fake.favourites.add(added);
        fake.favourites.delete(removed);
      };
      const [a, b] = await both("the watch: " + s, s, before, async () => {
        const r = await fetch(B + "/internal/jobs/watch", { method: "POST", headers: K });
        return (await r.json()).services[s];
      });
      fake.favourites.delete(added);
      fake.favourites.add(removed);
      assert.deepEqual(a.r, { added: 1, dropped: 1, failed: 0, changed: true });
      assert.deepEqual(a.r, b.r);
      same(a.st, b.st, s + ": the same library");
      assert.deepEqual(a.st.kept.find(k => k.key === s + ":" + added), { key: s + ":" + added, fields: ["why", "at"], why: "favourite", at: "now" });
      assert.ok(!a.st.kept.some(k => k.key === s + ":" + removed));
      await importOn(other, true);
    }
    assert.equal((await fetch(B + "/internal/jobs/watch", { method: "POST" })).status, 404, "not without the key");
  });

  await t.test("Tidal's token due, or refused partway: refreshed by the C# server, the same library as the Node server's run", async () => {
    await importOn("qobuz", false);
    const due = () => { const acc = ctx.db.setting("tidal", null); acc.token.expires = Date.now() + 1000; ctx.db.setSetting("tidal", acc); };
    // Due: Update library now refreshes it first, here; the same as the Node server's own run from the same start.
    let refreshes = tidal.refreshes;
    let [a, b] = await both("Tidal's token due", "tidal", due, async () => {
      const r = await post("settings/tidal/import");
      return Object.assign(r, { refreshes: tidal.refreshes - refreshes });
    });
    assert.deepEqual([a.r.status, a.r.by, a.r.j.ok, a.r.refreshes], [200, "C#", true, 1], a.r.text);
    assert.equal(a.r.j.result.albums, 2);
    assert.equal(sansNow(a.r.text), sansNow(b.r.text), "the same answer");
    same(a.st, b.st, "the same library");
    assert.equal(ctx.db.setting("tidal").token.access, tidal.access, "the new token kept");
    assert.ok(ctx.db.setting("tidal").token.expires > Date.now() + 3000e3, "good for the hour again");
    // The watch likewise.
    due();
    tidal.favourites.add("2005");
    refreshes = tidal.refreshes;
    const w = await (await fetch(B + "/internal/jobs/watch", { method: "POST", headers: K })).json();
    tidal.favourites.delete("2005");
    assert.deepEqual(w.services.tidal, { added: 1, dropped: 0, failed: 0, changed: true });
    assert.equal(tidal.refreshes, refreshes + 1, "refreshed here");
    // Refused partway (the token revoked meanwhile): refreshed, asked again, the import made whole; as the Node server's own run.
    tidal.favourites.add("2005");
    tidal.favourites.add("2006");
    let tripped = false;
    const trip = (req) => { if (!tripped && /\/v1\/albums\/2006\/tracks/.test(req.url)) { tripped = true; tidal.expireAccess(); } };
    const tripping = (fn) => async () => { tripped = false; tidal.server.on("request", trip); try { return await fn(); } finally { tidal.server.off("request", trip); } };
    [a, b] = await both("Tidal's token refused partway", "tidal", null, tripping(async () => {
      const x = await post("settings/tidal/import");
      return Object.assign(x, { tripped });
    }));
    tidal.favourites.delete("2005");
    tidal.favourites.delete("2006");
    assert.deepEqual([a.r.status, a.r.by, a.r.tripped, b.r.tripped], [200, "C#", true, true], a.r.text);
    assert.deepEqual([a.r.j.result.albums, a.r.j.result.added, a.r.j.result.failed], [4, 4, 0], "every album brought in");
    assert.equal(sansNow(a.r.text), sansNow(b.r.text), "the same answer");
    same(a.st, b.st, "the same library in the end");
    await importOn("qobuz", true);
  });

  await t.test("an import the Node server would start, made here: after a Rescan, after signing in", async () => {
    const at = (s) => (ctx.db.setting(s + "LastImport", null) || {}).at || 0;
    const was = { qobuz: at("qobuz"), tidal: at("tidal") };
    const r = await post("library/rescan", {});
    assert.deepEqual(r.j.services, ["Qobuz", "Tidal"], "the answer names what follows");
    await until(() => at("qobuz") > was.qobuz && at("tidal") > was.tidal, 30000, "both brought up to date");
    // Signed in with the switch on: brought in at once, by the C# server (signing in its own since v0.8.47).
    await post("settings/qobuz/signout", {});
    await reset("qobuz");
    await importOn("qobuz", true);
    const t0 = Date.now();
    assert.equal((await post("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).by, "C#", "signing in, the C# server's");
    await until(() => at("qobuz") >= t0, 20000, "the import after signing in");
    assert.equal((await get("library/albums?sort=album")).j.albums.filter(a => a.source === "qobuz").length, 3);
  });

  // The Node server's step (v0.8.45) is gone with v0.8.47: Tidal's token is the C# server's alone, nothing left to it.

  await t.test("a refresh Tidal refuses partway: the album it was asked for failed, what was brought in before told, as the Node server's watch", async () => {
    await importOn("qobuz", false);
    // Two albums new to both servers (nothing of them kept a minute), favourited on Tidal; refused
    // at the second, and no new token to be had either.
    const file = tidal.albums[0].tracks[0].file;
    tidal.albums.push({ id: 2007, title: "T Seventh", artist: "T Artist", year: 2025, hires: false, tracks: [{ id: 8601, title: "T Seventh One", file, duration: 3 }] },
      { id: 2008, title: "T Eighth", artist: "T Artist", year: 2025, hires: false, tracks: [{ id: 8701, title: "T Eighth One", file, duration: 3 }] });
    const refresh = tidal.refreshToken;
    const tripping = (fn) => async () => {
      const asked = [];
      let tripped = false;
      const trip = (req) => {
        const m = /\/v1\/albums\/(2007|2008)\b/.exec(req.url);
        if (!m || tripped) return;
        if (!asked.includes(m[1])) asked.push(m[1]);
        if (asked.length === 2) { tripped = true; tidal.expireAccess(); tidal.refreshToken = "rt-refused"; }
      };
      tidal.server.on("request", trip);
      let out;
      try { out = await fn(); } finally { tidal.server.off("request", trip); tidal.refreshToken = refresh; }
      return Object.assign(out, { tripped, first: asked[0] === "2007" ? "T Seventh" : "T Eighth" });
    };
    const start = async () => {
      tidal.favourites.delete("2007"); tidal.favourites.delete("2008");
      await post("settings/tidal/import");
      tidal.favourites.add("2007"); tidal.favourites.add("2008");
    };
    const [a, b] = await both("a refresh Tidal refuses partway", "tidal", start, tripping(async () => {
      const w = (await (await fetch(B + "/internal/jobs/watch", { method: "POST", headers: K })).json()).services.tidal;
      const titles = (await get("library/albums?sort=album")).j.albums.filter(x => x.source === "tidal").map(x => x.title);
      return { w, titles };
    }));
    tidal.favourites.delete("2007");
    tidal.favourites.delete("2008");
    assert.ok(a.r.tripped && b.r.tripped, "refused partway");
    assert.deepEqual(a.r.w, { added: 1, dropped: 0, failed: 1, changed: true }, JSON.stringify(a.r.w));
    assert.deepEqual(a.r.w, b.r.w, "as the Node server's watch");
    same(a.st, b.st, "the same library");
    assert.ok(a.r.titles.includes(a.r.first), `${a.r.first}, brought in before, on the walls: ${JSON.stringify(a.r.titles)}`);
    await importOn("qobuz", true);
    rec.done();
  });
});

test("the import's timers: the first import after the hand-over and the watch, by the C# server", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const { qobuz, tidal } = fakes(lib);
  t.after(() => Promise.all([qobuz.stop(), tidal.stop()]));
  await qobuz.start();
  await tidal.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("./server").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/",
    qobuzSyncDelayMs: 4000, serviceWatchMs: 1500 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  // Signed in to Qobuz with the switch on, as before a restart (the account written as signing in writes it).
  ctx.db.setSetting("qobuz", { token: qobuz.token, user: { id: 4242, login: "tester@example.com" }, since: Date.now() });
  ctx.db.setSetting("qobuzSettings", { quality: "hires192", import: true });
  await ctx.library.reload();
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token };
  await until(() => ctx.frontRuns && ctx.frontRuns.has("import"), 30000, "the import handed over");
  // The first import, a few seconds after the hand-over.
  const done = await until(() => ctx.db.setting("qobuzLastImport", null), 30000, "the first import");
  assert.equal(done.albums, 3);
  const st = await (await fetch(B + "/api/settings/qobuz", { headers: H })).json();
  assert.equal(st.last_import.at, done.at);
  // The watch: a favourite added on Qobuz kept within a couple of looks.
  qobuz.favourites.add("q600");
  await until(() => ctx.db.raw.prepare("SELECT 1 FROM cache WHERE ns = 'qobuz-kept' AND key = 'qobuz:q600'").get(), 15000, "the watch");
});
