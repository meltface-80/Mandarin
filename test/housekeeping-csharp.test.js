"use strict";
/*
 * Library housekeeping answered by the C# server (v0.8.48, stage 5 part 2 of
 * docs/specs/csharp-migration.md; HousekeepingRoutes.cs, Scans.cs):
 *
 *   - /api/status: the library's part and the rooms', the scan as it went;
 *   - Clean up (Settings → Library Scanner): what could go counted, and the
 *     albums whose folder has gone from the disk removed; each refusal in the
 *     Node server's words; a service's kind still the services' own;
 *   - the wall display's content: nothing playing, a room playing (its track
 *     from the hub), switched off.
 *
 * Held to the Node server's own answers until v0.8.50, when it went; on the
 * program alone (test/server.js) since.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");

const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 20000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting " + what);
    await new Promise(r => setTimeout(r, 100));
  }
}

/* The program, with these environment variables while it starts. */
async function serve(t, lib, env = {}, overrides = {}) {
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const was = {};
  for (const [k, v] of Object.entries(env)) { was[k] = process.env[k]; process.env[k] = v; }
  const srv = createServer(Object.assign({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false }, overrides));
  let ctx;
  try { ctx = await srv.start(); } finally { for (const [k, v] of Object.entries(was)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const call = async (method, p, body) => {
    const r = await fetch(B + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, by: r.headers.get("x-mandarin-answered"), j: await r.json().catch(() => null) };
  };
  return { ctx, B, get: (p) => call("GET", p), post: (p, body) => call("POST", p, body || {}) };
}

const albums = async (s) => (await s.get("/api/library-stats")).j.albums;
const idle = async (s) => { const st = (await s.get("/api/status")).j; return !st.library_importing && st.scan && st.scan.last && st; };
/* Answered by the C# server. */
const same = async (s, p, what, body) => {
  const mine = body ? await s.post(p, body) : await s.get(p);
  assert.equal(mine.by, "C#", what + ": answered by the C# server");
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

  await t.test("/api/status: the library, the scan and the rooms", async () => {
    const st = await same(s, "/api/status", "/api/status");
    assert.equal(st.j.index_count, 3);
    assert.equal(st.j.scan.last.status, "updated", JSON.stringify(st.j.scan));
    assert.equal(st.j.scan.files_seen, 7);
    assert.deepEqual(st.j.music_dirs, [lib.music]);
    assert.equal(st.j.music_dir_exists, true);
    assert.equal(st.j.data_persistent, null, "not in Docker: can't be told");
    assert.equal(st.j.zone_count, 2, "the rooms, as the server that holds playback counts them");
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
    // Refused in the Node server's words.
    for (const body of [{ kind: "x" }, {}]) {
      r = await same(s, "/api/library/cleanup", JSON.stringify(body), body);
      assert.deepEqual([r.status, r.j], [400, { error: "kind must be files, qobuz or tidal" }]);
    }
    // A service's kind: the services' own, as before (v0.8.44).
    r = await s.post("/api/library/cleanup", { kind: "qobuz" });
    assert.deepEqual([r.by, r.status, r.j.ok, r.j.kind, r.j.removed], ["C#", 200, true, "qobuz", 0]);
    // Cleaned: the album goes with its folder, nothing left to clean.
    r = await s.post("/api/library/cleanup", { kind: "files" });
    assert.deepEqual([r.by, r.status, r.j], ["C#", 200, { ok: true, kind: "files", removed: tracks, albums: 1, count: 2 }]);
    assert.equal(await albums(s), 2);
    assert.deepEqual((await s.get("/api/status")).j.scan.last.offline_dirs, []);
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
    // A room playing an album: its track from the hub, the rest made here (no write-up, no photos: nothing off this machine is asked).
    const one = (await s.get("/api/library/albums?sort=album")).j.albums.find(a => a.title === "Album One");
    r = await s.post("/api/play", { offset: one.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    const playing = "/api/display/content?zone=" + encodeURIComponent(kitchen.zone_id);
    await until(async () => { const z = (await s.get("/api/zone-state?zone=" + encodeURIComponent(kitchen.zone_id))).j.zone; return z && z.now_playing && z.now_playing.line1; }, 30000, "the room to play");
    r = await same(s, playing, "a room playing: its track from the hub");
    assert.deepEqual(r.j, { artistPhotos: [], review: null, bio: null, bios: [], moreAlbums: { artist: null, label: null } });
    s.ctx.db.setSetting("displayEnabled", false);
    r = await same(s, "/api/display/content?zone=x", "switched off");
    assert.deepEqual([r.status, r.j], [403, { error: "Wall display is turned off in Settings" }]);
    s.ctx.db.setSetting("displayEnabled", true);
  });
});
