"use strict";
/*
 * Settings → Music folders: the library read from any number of folders,
 * added and removed in the app (as Roon does) rather than only through the
 * container's -v lines.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const PORT = 3611;
const B = "http://127.0.0.1:" + PORT;

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting");
    await new Promise(r => setTimeout(r, 150));
  }
}

test("music folders are added, browsed and removed in Settings", { skip }, async () => {
  const lib = makeLibrary();
  // Artist B lives somewhere else, not in the server's own music folder.
  const other = path.join(lib.root, "nas", "Music");
  fs.mkdirSync(other, { recursive: true });
  fs.renameSync(path.join(lib.music, "Artist B"), path.join(other, "Artist B"));

  delete require.cache[require.resolve("../index.js")];
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [] });
  await srv.start();
  try {
    const token = await signIn(B);
    const h = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const get = async p => (await fetch(B + p, { headers: h })).json();
    const post = async (p, body) => { const r = await fetch(B + p, { method: "POST", headers: h, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };

    const count = async () => (await get("/api/library-stats")).albums;

    await until(async () => (await count()) === 2 && !(await get("/api/status")).library_importing);
    // Away from home (over Tailscale) the folders are still yours to see and change.
    const away = await fetch(B + "/api/library/folders", { headers: Object.assign({ "X-Forwarded-For": "100.101.102.103" }, h) });
    assert.equal(away.status, 200);
    assert.equal((await away.json()).folders.length, 1);

    let f = await get("/api/library/folders");
    assert.deepEqual(f.folders.map(x => [x.path, x.default]), [[lib.music, true]]);

    // Browse to it, as the folder picker does.
    const up = await get("/api/library/browse?path=" + encodeURIComponent(path.join(lib.root, "nas")));
    assert.deepEqual(up.dirs.map(d => d.name), ["Music"]);
    assert.equal(up.parent, lib.root);

    // Added: read at once, its albums join the library.
    let r = await post("/api/library/folders", { add: other });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    await until(async () => (await count()) === 3);
    f = await get("/api/library/folders");
    assert.deepEqual(f.folders.map(x => x.path), [lib.music, other].sort());
    assert.equal(f.folders.find(x => x.path === other).tracks, 2);
    assert.deepEqual((await get("/api/status")).music_dirs, [lib.music, other].sort());

    // Inside one already there, the data folder, somewhere unreadable: said why.
    r = await post("/api/library/folders", { add: path.join(other, "Artist B") });
    assert.equal(r.status, 400); assert.match(r.j.error, /Already in the library/);
    r = await post("/api/library/folders", { add: lib.data });
    assert.equal(r.status, 400); assert.match(r.j.error, /data folder/);
    r = await post("/api/library/folders", { add: path.join(lib.root, "nowhere") });
    assert.equal(r.status, 400); assert.match(r.j.error, /Can't read/);
    r = await post("/api/library/folders", { add: "/proc" });
    assert.equal(r.status, 400);

    // Removed: its albums leave with it. The last one can't be.
    await until(async () => !(await get("/api/status")).library_importing);
    r = await post("/api/library/folders", { remove: other });
    assert.equal(r.status, 200, JSON.stringify(r.j));
    assert.equal(r.j.removed, 2);
    assert.equal(await count(), 2);
    r = await post("/api/library/folders", { remove: lib.music });
    assert.equal(r.status, 400); assert.match(r.j.error, /only music folder/);

  } finally {
    await srv.stop();
  }
});
