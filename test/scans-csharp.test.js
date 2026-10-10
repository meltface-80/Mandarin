"use strict";
/*
 * The library scans made by the C# server (v0.8.34, stage 1e;
 * server/Mandarin.Server/Scans.cs and ScanRoutes.cs):
 *
 *   - Settings → Music folders, the folder picker, the music mount and how
 *     far the library has been read: answered there, held to the Node
 *     server's own answers to the same requests (asked of it directly);
 *   - Rescan, Reindex, a folder added, removed or let go: made there, the
 *     Node server's copy of the library (playback's) told, and /api/status
 *     (still the Node server's) saying how the scan went;
 *   - the scan on the timer, and on a change in the music folders.
 *
 * Through the C# server only (MANDARIN_FRONT=1): the Node server's own scans
 * are test/music-folders', test/watch's and the rest, unchanged.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg, gen } = require("./fixtures");
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

/* A server behind the C# one, with these environment variables for the C# server while it starts. */
async function serve(t, lib, env = {}, overrides = {}) {
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const was = {};
  for (const [k, v] of Object.entries(env)) { was[k] = process.env[k]; process.env[k] = v; }
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
    // The Node server's own answer to the same request.
    node: (method, p, body) => call(NODE, method, p, body)
  };
}

const albums = async (s) => (await s.get("/api/library-stats")).j.albums;
const idle = async (s) => { const st = (await s.get("/api/status")).j; return !st.library_importing && st.scan && st.scan.last && st; };

test("Music folders, Rescan and the rest, answered by the C# server", { skip, timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const other = path.join(lib.root, "nas", "Music");
  fs.mkdirSync(other, { recursive: true });
  fs.renameSync(path.join(lib.music, "Comp"), path.join(other, "Comp"));
  // Not watched here (a quiet longer than the test): each scan is the one asked for.
  const s = await serve(t, lib, { MANDARIN_WATCH_QUIET_MS: "600000" });
  // The first scan, made there as the work is taken over: the Node server told how it went.
  await until(async () => (await albums(s)) === 2 && idle(s), 30000, "the first scan");
  assert.equal(s.ctx.ownScanTimers, null, "nothing scanned on the Node server's own timer");
  assert.ok(s.ctx.frontRuns.has("scan"));
  const st = (await s.get("/api/status")).j;
  assert.equal(st.index_count, 2);
  assert.equal(st.scan.last.status, "updated", JSON.stringify(st.scan));
  assert.equal(st.scan.files_seen, 5);

  await t.test("what's read: the Node server's own answers, word for word", async () => {
    for (const p of ["/api/library/folders", "/api/music-mount", "/api/search-status",
      "/api/library/browse?path=" + encodeURIComponent(lib.root), "/api/library/browse?path=" + encodeURIComponent(path.join(lib.root, "nas")),
      "/api/library/browse?path=/", "/api/library/browse?path=" + encodeURIComponent(path.join(lib.root, "nowhere")), "/api/library/browse"]) {
      const mine = await s.get(p), theirs = await s.node("GET", p);
      assert.equal(mine.by, "C#", p);
      assert.equal(mine.status, theirs.status, p);
      assert.deepEqual(mine.j, theirs.j, p);
    }
    const f = (await s.get("/api/library/folders")).j;
    assert.deepEqual(f.folders.map(x => [x.path, x.tracks, x.default]), [[lib.music, 5, true]]);
  });

  await t.test("a folder that can't be added or removed: said why, as the Node server says it", async () => {
    for (const body of [{ add: path.join(lib.music, "Artist A") }, { add: lib.data }, { add: path.join(lib.root, "nowhere") }, { add: "/proc" }, { add: "/" },
      { remove: other }, { remove: lib.music }, {}, { add: "" }]) {
      const mine = await s.post("/api/library/folders", body), theirs = await s.node("POST", "/api/library/folders", body);
      assert.equal(mine.by, "C#", JSON.stringify(body));
      assert.deepEqual([mine.status, mine.j], [theirs.status, theirs.j], JSON.stringify(body));
    }
    const mine = await s.post("/api/library/forget-folder", { dir: other }), theirs = await s.node("POST", "/api/library/forget-folder", { dir: other });
    assert.deepEqual([mine.by, mine.status, mine.j], ["C#", 400, theirs.j]);
    assert.deepEqual(mine.j, { error: "Not one of the music folders" });
  });

  await t.test("a folder added: read at once, its albums join; removed: they leave with it", async () => {
    let r = await s.post("/api/library/folders", { add: other });
    assert.deepEqual([r.by, r.status, r.j.scanning], ["C#", 200, true], JSON.stringify(r.j));
    await until(async () => (await albums(s)) === 3, 20000, "the added folder's albums");
    await until(() => idle(s));
    const f = (await s.get("/api/library/folders")).j;
    assert.deepEqual(f.folders.map(x => [x.path, x.tracks]), [[lib.music, 5], [other, 2]].sort());
    assert.deepEqual((await s.get("/api/status")).j.music_dirs, [lib.music, other].sort(), "the Node server reads the same folders");
    r = await s.post("/api/library/folders", { remove: other });
    assert.deepEqual([r.by, r.status, r.j.removed, r.j.count], ["C#", 200, 2, 2], JSON.stringify(r.j));
    assert.equal(await albums(s), 2, "gone at once");
    assert.equal(s.ctx.library.count, 2, "from the Node server's copy too");
  });

  await t.test("Rescan: 'fresh' when nothing changed, 'rebuilt' when something did; Reindex reads every file", async () => {
    let r = await s.post("/api/library/rescan");
    assert.equal(r.by, "C#");
    assert.deepEqual([r.status, r.j.status, r.j.scan_status, r.j.count, r.j.services], [200, "fresh", "unchanged", 2, []], JSON.stringify(r.j));
    gen(path.join(lib.music, "Artist C", "New One", "01 N1.flac"), { freq: 330, tags: { title: "N1", artist: "Artist C", album: "New One", track: 1 } });
    r = await s.post("/api/library/rescan", { force: false });
    assert.deepEqual([r.j.status, r.j.count], ["rebuilt", 3], JSON.stringify(r.j));
    assert.equal(s.ctx.library.count, 3, "the Node server's copy read again");
    assert.equal((await s.get("/api/status")).j.scan.last.status, "updated");
    r = await s.post("/api/reindex");
    assert.deepEqual([r.by, r.status, r.j.ok, r.j.indexed, r.j.status, r.j.services], ["C#", 200, true, 3, "updated", []], JSON.stringify(r.j));
    assert.equal(r.j.changed, 6, "every file read again: " + JSON.stringify(r.j));
  });

  await t.test("a folder gone from the music folder: kept until let go, then its albums go", async () => {
    fs.rmSync(path.join(lib.music, "Artist C"), { recursive: true });
    let r = await s.post("/api/library/rescan");
    assert.equal(r.j.count, 3, "kept: " + JSON.stringify(r.j));
    const gone = path.join(lib.music, "Artist C");
    let last = (await s.get("/api/status")).j.scan.last;
    assert.deepEqual(last.offline_dirs.map(d => [d.dir, d.reason]), [[gone, "missing"]], JSON.stringify(last));
    r = await s.post("/api/library/forget-folder", { dir: gone });
    assert.deepEqual([r.by, r.status, r.j], ["C#", 200, { ok: true, removed: 1, count: 2 }]);
    last = (await s.get("/api/status")).j.scan.last;
    assert.deepEqual(last.offline_dirs, [], "no longer offered");
    assert.equal(await albums(s), 2);
  });
});

test("the library read on the C# server's timer, and when the music folders change", { skip, timeout: 120000 }, async (t) => {
  await t.test("a change in the music folders: read once it has been quiet", async (t) => {
    const lib = makeLibrary();
    const s = await serve(t, lib, { MANDARIN_WATCH_QUIET_MS: "500", MANDARIN_WATCH_GAP_MS: "1000" });
    await until(async () => (await albums(s)) === 3 && idle(s), 30000, "the first scan");
    for (let i = 1; i <= 2; i++) gen(path.join(lib.music, "Artist W", "Watched", `0${i} W${i}.flac`), { freq: 300 + 50 * i, tags: { title: `W${i}`, artist: "Artist W", album: "Watched", track: i } });
    await until(async () => (await albums(s)) === 4, 20000, "the new album, unasked");
    assert.equal(s.ctx.library.count, 4);
    // Into a hidden folder: not a change.
    // Any scan still to follow the album's files done with (the watch's quiet and gap, and more).
    await new Promise(r => setTimeout(r, 2000));
    await until(() => idle(s));
    // When the last scan started, as the C# server told the Node server.
    const started = s.ctx.scanner.state.startedAt;
    assert.ok(started > 0);
    gen(path.join(lib.music, ".hidden", "x.flac"), { freq: 500, tags: { title: "X", artist: "X", album: "X" } });
    await new Promise(r => setTimeout(r, 2500));
    assert.equal(s.ctx.scanner.state.startedAt, started, "nothing read for a hidden folder");
  });

  await t.test("the timer: every SCAN_INTERVAL_HOURS, as the Node server was started with", async (t) => {
    const lib = makeLibrary();
    // Not watched (a quiet longer than the test), so only the timer can find it: two seconds.
    const s = await serve(t, lib, { MANDARIN_WATCH_QUIET_MS: "600000" }, { scanHours: 2 / 3600 });
    await until(async () => (await albums(s)) === 3 && idle(s), 30000, "the first scan");
    gen(path.join(lib.music, "Artist T", "Timed", "01 T1.flac"), { freq: 410, tags: { title: "T1", artist: "Artist T", album: "Timed", track: 1 } });
    await until(async () => (await albums(s)) === 4, 15000, "the new album, on the timer");
  });
});
