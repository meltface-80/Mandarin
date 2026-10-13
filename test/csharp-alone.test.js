"use strict";
/*
 * csharp-alone.test.js — the C# server with no Node server anywhere (v0.8.50,
 * stage 7 part 1 of docs/specs/csharp-migration.md): started by test/server.js
 * as the image will start it, it stands on its own — the account and the
 * sign-in, the scan made at the start and the library read from it, the
 * pages, the rooms and devices (none here), a heart (the library's state its
 * own: the version moves and the copy is read again), /api/health — every
 * answer its own. Runs wherever the program is built, through the C# server
 * or not: nothing here is a Node server's.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { start, built, BIN } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

async function until(fn, ms = 30000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await new Promise(r => setTimeout(r, 100));
  }
}

test("the C# server alone: the account, the scan, the library, the pages, the rooms, a heart, health", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const PORT = ports.port();
  const srv = await start({ port: PORT, musicDir: lib.music, dataDir: lib.data });
  const B = srv.base;
  try {
    const ask = async (p, init = {}) => {
      const r = await fetch(B + p, init);
      return { status: r.status, by: r.headers.get("x-mandarin-answered") || "nobody", json: await r.clone().json().catch(() => null), text: await r.text() };
    };
    // Before the account: the sign-in state, the gate, the sign-in page.
    let x = await ask("/api/auth/status");
    assert.deepEqual([x.status, x.by, x.json.setup_required], [200, "C#", true]);
    x = await ask("/api/library/albums");
    assert.deepEqual([x.status, x.json.setup_required], [401, true]);
    x = await ask("/", { redirect: "manual" });
    assert.equal(x.status, 302, "to the sign-in page");
    x = await ask("/login");
    assert.deepEqual([x.status, x.by], [200, "C#"]);
    assert.match(x.text, /<html/i);
    // The account made, the sign-in (SRP, against this server alone).
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    // The scan made at the start: the three albums, read by this server from its own database.
    const st = await until(async () => { const s = (await ask("/api/status", { headers: H })).json; return s && s.index_count === 3 && !s.scanning && s; }, 60000, "the library");
    assert.equal(st.zone_count, 0, "no rooms here");
    x = await ask("/api/library/albums?sort=album", { headers: H });
    assert.deepEqual([x.status, x.by, x.json.total, x.json.albums.map(a => a.title)], [200, "C#", 3, ["Album One", "Best Of", "Hi Res"]]);
    const one = x.json.albums[0];
    x = await ask("/api/album?offset=" + one.offset, { headers: H });
    assert.deepEqual([x.status, x.json.tracks.length], [200, 3]);
    // The page and its files, Home's rows, the search: answered here.
    for (const p of ["/", "/app.js", "/api/home/history", "/api/home/unplayed", "/api/home/genre-groups", "/api/search?q=song", "/api/artists", "/api/library/facets",
      "/api/zones", "/api/outputs", "/api/audio-devices", "/api/filters/labels", "/api/filters/genres", "/api/library/folders"]) {
      x = await ask(p, { headers: H });
      assert.deepEqual([p, x.status, x.by], [p, 200, "C#"]);
    }
    assert.deepEqual((await ask("/api/zones", { headers: H })).json.zones, [], "no rooms, no phones");
    // A heart: written here, and the library's state moved by this server (the copy read again).
    x = await ask("/api/favourites", { method: "POST", headers: H, body: JSON.stringify({ offset: one.offset, on: true }) });
    assert.deepEqual([x.status, x.by, x.json.favourite], [200, "C#", true]);
    x = await ask("/api/library/albums?sort=album", { headers: H });
    assert.deepEqual(x.json.albums.map(a => [a.title, !!a.favourite]), [["Album One", true], ["Best Of", false], ["Hi Res", false]], "the heart shown at once");
    x = await ask("/api/favourites", { method: "POST", headers: H, body: JSON.stringify({ offset: one.offset, on: false }) });
    assert.equal((await ask("/api/library/albums?sort=album", { headers: H })).json.albums.some(a => a.favourite), false, "and taken off at once");
    // The day's album and the week's label: this clock's day and week.
    x = await ask("/api/home/album-of-the-day", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "C#"]);
    assert.match(String(x.json.day), /^\d{4}-\d{1,2}-\d{1,2}$/);
    // Health, open: this version, the rooms, the engines; nothing of a Node server to match.
    x = await ask("/api/health");
    assert.deepEqual([x.status, x.by, x.json.version, x.json.rooms, "csharp" in x.json], [200, "C#", require("../package.json").version, 0, false]);
    // The image's health check: the program asking itself on its port (0, the answer printed), and on one nothing holds (1).
    const health = (port) => spawnSync(BIN, ["--health"], { env: Object.assign({}, process.env, { PORT: String(port) }), encoding: "utf8", timeout: 20000 });
    let h = health(PORT);
    assert.deepEqual([h.status, JSON.parse(h.stdout).ok], [0, true], "--health on the server's port: " + h.stderr);
    h = health(ports.port());
    assert.deepEqual([h.status, h.stdout], [1, ""], "--health on an empty port: " + h.stderr);
    // The Node server's private addresses: nothing there to ask, 404 at the door as before.
    assert.equal((await ask("/internal/library", { headers: H })).status, 404);
  } finally { await srv.stop(); }
});
