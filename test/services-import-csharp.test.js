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
 *   - Tidal's token due, or refused partway: left to the Node server, which
 *     refreshes it, the step made once, and the same rows in the end;
 *   - an import the Node server would have started itself (a sign-in, a
 *     Rescan) made by the C# server, and the timers: the first import after
 *     the hand-over and the watch, the Node server's own idle.
 *
 * Through the C# server only (MANDARIN_FRONT=1): test/qobuz.test.js and
 * test/tidal.test.js are the services' own, both ways.
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

const skip = (process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1") || (!haveFfmpeg() && "ffmpeg is not installed");

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
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/",
    // The timers out of the way: each import and watch here is asked for.
    qobuzSyncDelayMs: 1e9, serviceWatchMs: 1e9 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const NODE = "http://127.0.0.1:" + ctx.listeningOn;
  const K = { "X-Mandarin-Front-Key": ctx.frontKey };
  const raw = ctx.db.raw;
  const call = async (base, p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j, text };
  };
  const get = (p) => call(B, p);
  const post = (p, body) => call(B, p, body || {});
  // The Node server's own import and watch, counted: made there only when asked of it.
  const made = { import: 0, watch: 0 };
  for (const id of ["qobuz", "tidal"]) {
    const s = ctx.services[id], imp = s.importLibrary.bind(s), watch = s.watch.bind(s);
    s.importLibrary = (...a) => { made.import++; return imp(...a); };
    s.watch = (...a) => { made.watch++; return watch(...a); };
  }
  // The Node server's own for one request: the import, its to make for that moment.
  const own = async (fn) => { ctx.frontRuns.delete("import"); try { return await fn(); } finally { ctx.frontRuns.add("import"); } };

  await until(() => ctx.frontRuns, 30000, "the work handed over");
  assert.ok(ctx.frontRuns.has("import"), "the import handed over");
  assert.equal(ctx.madeByFront("import"), true, "the Node server's own timers do nothing");

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
    ctx.library.reload();
  };
  // Qobuz's lists are kept a minute by each server, as api.js keeps them: a run starts with neither's
  // (the account's token turned, as a sign-in turns it), so each asks Qobuz as it is then.
  let turn = 0;
  const cold = () => { qobuz.token = "tok-cold-" + (++turn); const acc = ctx.db.setting("qobuz"); acc.token = qobuz.token; ctx.db.setSetting("qobuz", acc); };
  const sansNow = (text) => text.replace(/"at":\d+/g, `"at":"now"`).replace(/"seconds":\d+/g, `"seconds":"s"`);
  /* The same run on each server from the same start ([before]: what to do first, the same each time): the answers and the state after. */
  const both = async (s, before, mine, theirs) => {
    const out = [];
    for (const run of [mine, theirs]) {
      // Stamped "now": anything written from here, the run or what it starts from.
      const t0 = Date.now();
      reset(s);
      if (s === "qobuz") cold();
      if (before) await before();
      if (s === "qobuz") cold();
      const r = await run();
      out.push({ r, st: state(s, t0, Date.now()) });
    }
    return out;
  };
  const importOn = (s, on) => { ctx.db.setSetting(s + "Settings", { quality: s === "qobuz" ? "hires192" : "hires", import: on }); ctx.library.reload(); };

  await t.test("signed out: Settings → Services the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const r = await get("settings/" + s);
      assert.deepEqual([r.status, r.by, r.j.connected], [200, null, false]);
      assert.deepEqual([(await post("settings/" + s, { import: true })).by, (await post("settings/" + s, { import: false })).by], [null, null]);
      const n = await post(`settings/${s}/import`);
      assert.deepEqual([n.status, n.by, n.j], [401, "C#", { error: "Not signed in to " + (s === "qobuz" ? "Qobuz" : "Tidal"), connected: false }]);
    }
  });

  // Signed in on the Node server, as from Settings → Services (the import's switch off: nothing brought in).
  assert.equal((await post("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).status, 200);
  assert.equal((await post("settings/tidal/signin", {})).status, 200);
  tidal.approve();
  await until(async () => (await get("settings/tidal")).j.connected, 20000, "Tidal signed in");
  await new Promise(r => setTimeout(r, 1500));
  assert.deepEqual(made, { import: 0, watch: 0 }, "nothing imported on signing in, the switch off");

  await t.test("Settings → Services: the state, the quality and the switch, as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const c = await get("settings/" + s), n = await call(NODE, "settings/" + s);
      assert.deepEqual([c.status, c.by, n.by], [200, "C#", null]);
      assert.equal(c.text, n.text, s + ": the same state");
      assert.equal(c.j.importing, false);
      // The quality: written, and answered, as the Node server's; one not offered refused in its words.
      for (const q of s === "qobuz" ? ["cd", "hires96", "hires192"] : ["cd", "hires"]) {
        const mine = await post("settings/" + s, { quality: q });
        const written = raw.prepare("SELECT value FROM settings WHERE key = ?").get(s + "Settings").value;
        const theirs = await call(NODE, "settings/" + s, { quality: q });
        assert.deepEqual([mine.status, mine.by], [200, "C#"]);
        assert.equal(mine.text, theirs.text, s + ": the quality " + q);
        assert.equal(raw.prepare("SELECT value FROM settings WHERE key = ?").get(s + "Settings").value, written);
      }
      for (const body of [{ quality: "nope" }, { quality: null }, { quality: 5 }]) {
        const mine = await post("settings/" + s, body), theirs = await call(NODE, "settings/" + s, body);
        assert.deepEqual([mine.status, mine.by, mine.text], [400, "C#", theirs.text], JSON.stringify(body));
      }
      // Off, as it is: written, nothing to bring in.
      const off = await post("settings/" + s, { import: false }), offN = await call(NODE, "settings/" + s, { import: false });
      assert.equal(off.text, offN.text);
    }
    // Tidal's: a setting written forgets what the Node server learnt from the old (hi-res asked for again).
    ctx.tidal.hiresDenied = true;
    assert.equal((await post("settings/tidal", { quality: "hires" })).by, "C#");
    assert.equal(ctx.tidal.hiresDenied, false, "the Node server told");
  });

  await t.test("the switch on: the albums back at once and the import made, as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const other = s === "qobuz" ? "tidal" : "qobuz";
      importOn(other, false);
      const [mine, theirs] = await both(s, () => importOn(s, false), async () => {
        const r = await post("settings/" + s, { import: true });
        await until(async () => !(await get("settings/" + s)).j.importing, 20000, s + "'s import");
        return r;
      }, async () => {
        const r = await own(() => call(NODE, "settings/" + s, { import: true }));
        await until(() => !ctx.services[s].importing, 20000, s + "'s import there");
        return r;
      });
      assert.deepEqual([mine.r.status, mine.r.by, mine.r.j.importing], [200, "C#", true], mine.r.text);
      assert.equal(mine.r.text, theirs.r.text, s + ": the same answer, importing");
      same(mine.st, theirs.st, s + ": the same library after");
      assert.ok(mine.st.albums.length >= 3 && mine.st.kept.length >= 2, s + ": brought in");
      // Off again: in the Node server's words, and off the walls at once.
      const off = await post("settings/" + s, { import: false });
      assert.equal(off.j.import, false);
      assert.equal((await get("library/albums?sort=album")).j.albums.some(a => a.source === s), false, s + ": off the walls");
      importOn(s, true);
      importOn(other, true);
    }
  });

  await t.test("Update library now: the rows, the marks, the playlists and the answer as the Node server's", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const other = s === "qobuz" ? "tidal" : "qobuz";
      importOn(other, false);
      const now = () => post(`settings/${s}/import`), theirs = () => call(NODE, `settings/${s}/import`, {});
      // From nothing: every album asked for and written.
      let [a, b] = await both(s, null, now, theirs);
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
      [a, b] = await both(s, () => post(`settings/${s}/import`), now, theirs);
      assert.equal(sansNow(a.r.text), sansNow(b.r.text), s + ": the same answer again");
      same(a.st, b.st);
      assert.equal(a.r.j.result.fetched, 0, "none asked again");
      // A favourite removed on the service: let go (its rows kept, off the walls); as the Node server's.
      const gone = s === "qobuz" ? "q200" : "2002";
      [a, b] = await both(s, async () => { fake.favourites.add(gone); await post(`settings/${s}/import`); fake.favourites.delete(gone); }, now, theirs);
      fake.favourites.add(gone);
      assert.equal(a.r.j.result.dropped, 1, a.r.text);
      assert.equal(sansNow(a.r.text), sansNow(b.r.text));
      same(a.st, b.st);
      // A playlist gone from the service: gone from here.
      const lists = fake.playlists;
      try { [a, b] = await both(s, async () => { fake.playlists = lists; await post(`settings/${s}/import`); fake.playlists = []; }, now, theirs); }
      finally { fake.playlists = lists; }
      same(a.st, b.st);
      assert.ok(!a.st.lists.some(p => p.id && p.id.startsWith(s + "-pl-")), "its playlists gone");
      // Switched off: refused, in the same words.
      importOn(s, false);
      const c = await post(`settings/${s}/import`), n = await call(NODE, `settings/${s}/import`, {});
      assert.deepEqual([c.status, c.by, c.text], [409, "C#", n.text]);
      importOn(s, true);
      importOn(other, true);
    }
    assert.ok(made.import > 0, "the Node server's own, asked of it");
  });

  await t.test("the page's quick look (POST /api/services/watch), and its 15 seconds, as the Node server's", async () => {
    const before = async () => {
      qobuz.favourites.delete("q600");
      for (const s of ["qobuz", "tidal"]) await post(`settings/${s}/import`);
      qobuz.favourites.add("q600");
    };
    const [a, b] = await both("qobuz", before, () => post("services/watch"), () => call(NODE, "services/watch", {}));
    qobuz.favourites.delete("q600");
    assert.deepEqual([a.r.status, a.r.by, b.r.by], [200, "C#", null]);
    assert.equal(a.r.text, b.r.text, "the same answer");
    assert.deepEqual(a.r.j.services.qobuz, { added: 1, dropped: 0, failed: 0, changed: true });
    same(a.st, b.st);
    // Looked at again within 15 seconds: nothing done, by each.
    const c = await post("services/watch"), n = await call(NODE, "services/watch", {});
    assert.deepEqual([c.by, c.text], ["C#", n.text]);
    assert.deepEqual(c.j, { changed: false, services: {} });
  });

  await t.test("the watch: favourites changed on the service followed as the Node server's watch follows them", async () => {
    for (const s of ["qobuz", "tidal"]) {
      const other = s === "qobuz" ? "tidal" : "qobuz", fake = s === "qobuz" ? qobuz : tidal;
      const [added, removed] = s === "qobuz" ? ["q600", "q200"] : ["2005", "2002"];
      importOn(other, false);
      const before = async () => {
        fake.favourites.delete(added);
        fake.favourites.add(removed);
        await post(`settings/${s}/import`);
        fake.favourites.add(added);
        fake.favourites.delete(removed);
      };
      const [a, b] = await both(s, before, async () => {
        const r = await fetch(B + "/internal/jobs/watch", { method: "POST", headers: K });
        return (await r.json()).services[s];
      }, () => ctx.services[s].watch());
      fake.favourites.delete(added);
      fake.favourites.add(removed);
      assert.deepEqual(a.r, { added: 1, dropped: 1, failed: 0, changed: true });
      assert.deepEqual(a.r, b.r);
      same(a.st, b.st, s + ": the same library");
      assert.deepEqual(a.st.kept.find(k => k.key === s + ":" + added), { key: s + ":" + added, fields: ["why", "at"], why: "favourite", at: "now" });
      assert.ok(!a.st.kept.some(k => k.key === s + ":" + removed));
      importOn(other, true);
    }
    assert.equal((await fetch(B + "/internal/jobs/watch", { method: "POST" })).status, 404, "not without the key");
  });

  await t.test("Tidal's token due, or refused partway: the step the Node server's, made once, the same library", async () => {
    importOn("qobuz", false);
    const due = () => { const acc = ctx.tidal.account(); acc.token.expires = Date.now() + 1000; ctx.db.setSetting("tidal", acc); };
    // Due: Update library now left to the Node server, which refreshes it; answered here with what it made.
    reset("tidal");
    due();
    let refreshes = tidal.refreshes, before = made.import;
    const r = await post("settings/tidal/import");
    assert.deepEqual([r.status, r.by, r.j.ok], [200, "C#", true], r.text);
    assert.equal(tidal.refreshes, refreshes + 1, "refreshed by the Node server");
    assert.equal(made.import, before + 1, "made once, by the Node server");
    assert.equal(r.j.result.albums, 2);
    assert.equal(ctx.db.setting("tidal").token.access, tidal.access, "the new token kept");
    // The watch likewise.
    due();
    tidal.favourites.add("2005");
    refreshes = tidal.refreshes;
    before = made.watch;
    const w = await (await fetch(B + "/internal/jobs/watch", { method: "POST", headers: K })).json();
    tidal.favourites.delete("2005");
    assert.deepEqual(w.services.tidal, { added: 1, dropped: 0, failed: 0, changed: true });
    assert.deepEqual([tidal.refreshes, made.watch], [refreshes + 1, before + 1], "the watch the Node server's");
    // Then the C# server's again, with the new token.
    before = made.import;
    assert.equal((await post("settings/tidal/import")).by, "C#");
    assert.equal(made.import, before, "made here");
    // Refused partway (the token revoked meanwhile): what was brought in here stays whole, the Node server makes the rest.
    tidal.favourites.add("2005");
    tidal.favourites.add("2006");
    let tripped = false;
    const trip = (req) => { if (!tripped && /\/v1\/albums\/2006\/tracks/.test(req.url)) { tripped = true; tidal.expireAccess(); } };
    const [a, b] = await both("tidal", null, async () => {
      tidal.server.on("request", trip);
      try { before = made.import; const x = await post("settings/tidal/import"); return Object.assign(x, { node: made.import - before }); }
      finally { tidal.server.off("request", trip); }
    }, () => call(NODE, "settings/tidal/import", {}));
    tidal.favourites.delete("2005");
    tidal.favourites.delete("2006");
    assert.ok(tripped, "refused partway");
    assert.deepEqual([a.r.status, a.r.by, a.r.node], [200, "C#", 1], a.r.text);
    assert.deepEqual([a.r.j.result.albums, a.r.j.result.added], [4, 1], "the Node server's run from there: what it brought in");
    same(a.st, Object.assign({}, b.st, { last: a.st.last }), "the same library in the end");
    assert.deepEqual([a.st.last.albums, b.st.last.albums], [4, 4]);
    importOn("qobuz", true);
  });

  await t.test("an import the Node server would start, made here: after a Rescan, after signing in", async () => {
    const at = (s) => (ctx.db.setting(s + "LastImport", null) || {}).at || 0;
    let before = made.import;
    const was = { qobuz: at("qobuz"), tidal: at("tidal") };
    const r = await post("library/rescan", {});
    assert.deepEqual(r.j.services, ["Qobuz", "Tidal"], "the answer names what follows");
    await until(() => at("qobuz") > was.qobuz && at("tidal") > was.tidal, 30000, "both brought up to date");
    assert.equal(made.import, before, "by the C# server");
    // Signed in with the switch on: brought in at once, by the C# server.
    await post("settings/qobuz/signout", {});
    reset("qobuz");
    importOn("qobuz", true);
    const t0 = Date.now();
    assert.equal((await post("settings/qobuz/signin", { username: "tester@example.com", password: "pw" })).by, null, "signing in, the Node server's");
    await until(() => at("qobuz") >= t0, 20000, "the import after signing in");
    assert.equal(made.import, before, "by the C# server");
    assert.equal((await get("library/albums?sort=album")).j.albums.filter(a => a.source === "qobuz").length, 3);
  });

  await t.test("the Node server's step: from the C# server only", async () => {
    assert.equal((await fetch(NODE + "/internal/services/step", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 403);
    const r = await fetch(NODE + "/internal/services/step", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, K), body: JSON.stringify({ service: "nope" }) });
    assert.deepEqual([r.status, await r.json()], [400, { error: "service required" }]);
  });
});

test("the import's timers: the first import after the hand-over and the watch, by the C# server", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const { qobuz, tidal } = fakes(lib);
  t.after(() => Promise.all([qobuz.stop(), tidal.stop()]));
  await qobuz.start();
  await tidal.start();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    qobuzBaseUrl: qobuz.base, tidalBaseUrl: tidal.base, tidalAuthUrl: tidal.authBase, tidalImagesUrl: tidal.authBase + "/images/",
    qobuzSyncDelayMs: 4000, serviceWatchMs: 1500 });
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const made = { import: 0, watch: 0 };
  const s = ctx.services.qobuz, imp = s.importLibrary.bind(s), watch = s.watch.bind(s);
  s.importLibrary = (...a) => { made.import++; return imp(...a); };
  s.watch = (...a) => { made.watch++; return watch(...a); };
  // Signed in to Qobuz with the switch on, as before a restart (the account written as signing in writes it).
  ctx.db.setSetting("qobuz", { token: qobuz.token, user: { id: 4242, login: "tester@example.com" }, since: Date.now() });
  ctx.db.setSetting("qobuzSettings", { quality: "hires192", import: true });
  ctx.library.reload();
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
  assert.deepEqual(made, { import: 0, watch: 0 }, "the Node server's own timers idle");
});
