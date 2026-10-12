"use strict";
/*
 * Library housekeeping answered by the C# server (v0.8.48, stage 5 part 2 of
 * docs/specs/csharp-migration.md; HousekeepingRoutes.cs, Scans.cs):
 *
 *   - /api/status: the library's part from there, the rooms' part as the Node
 *     server says it with its state — the Node server's own answer, word for word;
 *   - Clean up (Settings → Library Scanner): what could go counted, and the
 *     albums whose folder has gone from the disk removed there, the Node
 *     server's copy read again; each refusal in its words; a service's kind
 *     still the services' own;
 *   - the wall display's content: the zone's track asked of the Node server,
 *     the rest from there, as the Node server answers it;
 *   - the scans where the C# program isn't trusted with the tags (TAG_READER=
 *     node): still started by the C# server, made by the Node server's own
 *     scanner at its ask, the library the same as its own scan makes.
 *
 * Through the C# server only (MANDARIN_FRONT=1).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");

const skip = (process.env.MANDARIN_FRONT !== "1" && "the C# server's: MANDARIN_FRONT=1") || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

/* A server behind the C# one, with these environment variables while it starts. */
async function serve(t, lib, env = {}, overrides = {}) {
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const was = {};
  for (const [k, v] of Object.entries(env)) { was[k] = process.env[k]; process.env[k] = v; }
  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const srv = createServer(Object.assign({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false }, overrides));
  let ctx;
  try { ctx = await srv.start(); } finally { for (const [k, v] of Object.entries(was)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const NODE = "http://127.0.0.1:" + ctx.listeningOn;
  const call = async (base, method, p, body) => {
    const r = await fetch(base + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j: await r.json().catch(() => null) };
  };
  return {
    ctx, B, NODE,
    get: (p) => call(B, "GET", p), post: (p, body) => call(B, "POST", p, body || {}),
    node: (method, p, body) => call(NODE, method, p, body)
  };
}

const albums = async (s) => (await s.get("/api/library-stats")).j.albums;
const idle = async (s) => { const st = (await s.get("/api/status")).j; return !st.library_importing && st.scan && st.scan.last && st; };
/* The same request of each: answered by the C# server, the Node server's own answer the same. */
const same = async (s, p, what, body) => {
  const mine = body ? await s.post(p, body) : await s.get(p), theirs = await s.node(body ? "POST" : "GET", p, body);
  assert.equal(mine.by, "C#", what + ": answered by the C# server");
  assert.equal(theirs.by, null, what + ": the Node server's own");
  assert.equal(mine.status, theirs.status, what);
  assert.deepEqual(mine.j, theirs.j, what);
  return mine;
};

test("/api/status, Clean up and the wall display's content, answered by the C# server", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  t.after(() => house.stop());
  // Not watched here (a quiet longer than the test): each scan is the one asked for.
  const s = await serve(t, lib, { MANDARIN_WATCH_QUIET_MS: "600000" }, { sonosHosts: [ports.host(0)] });
  await until(async () => (await albums(s)) === 3 && idle(s), 30000, "the first scan");
  const kitchen = await until(async () => (await s.get("/api/zones")).j.zones.find(z => z.display_name === "Kitchen"), 30000, "the rooms");

  await t.test("/api/status: the Node server's own answer, word for word", async () => {
    const st = await same(s, "/api/status", "/api/status");
    assert.equal(st.j.index_count, 3);
    assert.equal(st.j.scan.last.status, "updated", JSON.stringify(st.j.scan));
    assert.equal(st.j.scan.files_seen, 7);
    assert.deepEqual(st.j.music_dirs, [lib.music]);
    assert.equal(st.j.music_dir_exists, true);
    assert.equal(st.j.data_persistent, null, "not in Docker: can't be told");
    assert.equal(st.j.zone_count, 2, "the rooms, as the Node server counts them");
    assert.equal(st.j.sonos.rooms, 2);
    assert.equal(st.j.version, require("../package.json").version);
    assert.equal(st.j.server, true);
  });

  await t.test("Clean up: nothing to clean; a folder gone from the disk counted, then its album removed", async () => {
    let c = await same(s, "/api/library/cleanup", "the counts");
    assert.deepEqual(c.j, { files: { albums: 0, tracks: 0, folders: 0 }, qobuz: { albums: 0, signed_in: false }, tidal: { albums: 0, signed_in: false } });
    // A folder taken away (out of the music folder, not moved within it): the scanner keeps its album as missing, for Clean up to remove.
    const gone = path.join(lib.music, "Artist B"), away = path.join(lib.root, "away", "Artist B");
    const tracks = s.ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path LIKE ?").get(gone + "/%").n;
    assert.ok(tracks >= 1);
    fs.mkdirSync(path.dirname(away), { recursive: true });
    fs.renameSync(gone, away);
    let r = await s.post("/api/library/rescan", {});
    assert.equal(r.by, "C#");
    await until(async () => { const st = await idle(s); return st && st.scan.last.offline_dirs && st.scan.last.offline_dirs.length === 1 && st; }, 30000, "the rescan, with the folder kept as missing");
    c = await same(s, "/api/library/cleanup", "the counts with a folder gone");
    assert.deepEqual(c.j.files, { albums: 1, tracks, folders: 1 });
    // Refused as the Node server refuses it.
    for (const body of [{ kind: "x" }, {}]) {
      r = await same(s, "/api/library/cleanup", JSON.stringify(body), body);
      assert.deepEqual([r.status, r.j], [400, { error: "kind must be files, qobuz or tidal" }]);
    }
    // A service's kind: the services' own, as before (v0.8.44).
    r = await s.post("/api/library/cleanup", { kind: "qobuz" });
    assert.deepEqual([r.by, r.status, r.j.ok, r.j.kind, r.j.removed], ["C#", 200, true, "qobuz", 0]);
    // Cleaned: the album goes with its folder; the Node server's copy of the library read again, nothing left to clean.
    r = await s.post("/api/library/cleanup", { kind: "files" });
    assert.deepEqual([r.by, r.status, r.j], ["C#", 200, { ok: true, kind: "files", removed: tracks, albums: 1, count: 2 }]);
    assert.equal(await albums(s), 2);
    assert.deepEqual((await s.get("/api/status")).j.scan.last.offline_dirs, []);
    assert.deepEqual(s.ctx.scanner.state.lastResult.offline_dirs, [], "the Node server's own copy too");
    c = await same(s, "/api/library/cleanup", "after");
    assert.deepEqual(c.j.files, { albums: 0, tracks: 0, folders: 0 });
    // The folder back: its album with it.
    fs.renameSync(away, gone);
    r = await s.post("/api/library/rescan", {});
    await until(async () => (await albums(s)) === 3 && idle(s), 30000, "the folder back");
  });

  await t.test("the wall display's content: nothing playing, a room playing, and the display switched off", async () => {
    let r = await same(s, "/api/display/content?zone=RINCON_NOTHING", "nothing playing");
    assert.deepEqual(r.j, { artistPhotos: [], review: null, video: null });
    // A room playing an album: its track asked of the Node server, the rest from the C# server (no write-up, no photos here: nothing off this machine is asked).
    const one = (await s.get("/api/library/albums?sort=album")).j.albums.find(a => a.title === "Album One");
    r = await s.post("/api/play", { offset: one.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    await until(() => { const z = s.ctx.zones.zone(kitchen.zone_id); return z && z._state && z._state.title; }, 30000, "the room to play");
    r = await same(s, "/api/display/content?zone=" + encodeURIComponent(kitchen.zone_id), "a room playing");
    assert.deepEqual(r.j, { artistPhotos: [], review: null, bio: null, bios: [], moreAlbums: { artist: null, label: null } });
    s.ctx.db.setSetting("displayEnabled", false);
    r = await same(s, "/api/display/content?zone=x", "switched off");
    assert.deepEqual([r.status, r.j], [403, { error: "Wall display is turned off in Settings" }]);
    s.ctx.db.setSetting("displayEnabled", true);
  });
});

test("the scans where the C# program isn't trusted with the tags: started by the C# server, made by the Node server's scanner at its ask", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const s = await serve(t, lib, { MANDARIN_WATCH_QUIET_MS: "600000", TAG_READER: "node" });
  await until(async () => (await albums(s)) === 3 && idle(s), 30000, "the first scan");
  assert.ok(s.ctx.frontRuns.has("scan"), "handed over all the same");
  assert.equal(s.ctx.ownScanTimers, null, "nothing scanned on the Node server's own timer");
  assert.equal(s.ctx.scanner.programNow(), null, "the program isn't the Node server's scanner here");
  // The Node server's own scanner made it: its state is its own, and what the C# server says of the scan is the same.
  const own = s.ctx.scanner.state;
  assert.equal(own.running, false);
  assert.ok(own.lastResult && own.startedAt && own.finishedAt, "the Node server's own scan: " + JSON.stringify(own));
  const st = (await s.get("/api/status")).j;
  assert.deepEqual(st.scan, { running: false, progress: own.progress, files_seen: own.files, last: own.lastResult });
  assert.equal(st.scan.last.status, "updated");
  assert.equal(st.scan.files_seen, 7);
  // Rescan from the side menu: made by the Node server's scanner at the C# server's ask.
  let asked = 0;
  const scan = s.ctx.scanner.scan.bind(s.ctx.scanner);
  s.ctx.scanner.scan = (...a) => { asked++; return scan(...a); };
  let r = await s.post("/api/library/rescan", {});
  assert.deepEqual([r.by, r.status, r.j.status, r.j.count], ["C#", 200, "fresh", 3], JSON.stringify(r.j));
  assert.equal(asked, 1, "the Node server's scanner asked once");
  await until(() => idle(s));
  // Its library is what the Node server's own scan makes: the same rows.
  const rows = (db, music) => ({
    albums: db.prepare("SELECT key, title, artist, year, track_count FROM albums ORDER BY key").all(),
    tracks: db.prepare("SELECT path, title, artist, album, track_no, disc_no FROM tracks ORDER BY path").all().map(x => Object.assign(x, { path: path.relative(music, x.path) }))
  });
  const made = rows(s.ctx.db.raw, lib.music);
  assert.equal(made.albums.length, 3);
  assert.equal(made.tracks.length, 7);
  const alone = makeLibrary();
  const DB = require("../lib/library/db");
  const db = DB.open(alone.data, { log: () => {} });
  const { Scanner } = require("../lib/library/scanner");
  const sc = new Scanner({ db, root: alone.music, log: () => {} });
  const own2 = await sc.scanHere({});
  assert.equal(own2.status, "updated");
  assert.deepEqual(made, rows(db.raw, alone.music));
  db.close();
  r = await s.post("/api/reindex", {});
  assert.deepEqual([r.by, r.status, r.j.ok, r.j.indexed], ["C#", 200, true, 3]);
  assert.equal(asked, 2);
});
