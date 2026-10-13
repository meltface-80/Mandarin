"use strict";
/*
 * library-server.js — a library behind the C# program, for the tests of the
 * library itself (v0.8.50, stage 7 part 5: they read lib/library's copy
 * before, and scanned with lib/library/scanner.js): the program started on a
 * music folder (test/server.js), its first scan waited for; then its albums
 * as every list shows them, an album's page, a scan asked for (Rescan) and
 * its result, the database to hand, and the program started again.
 */
const ports = require("./ports");
const { createServer } = require("./server");
const { signIn } = require("./auth-helper");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {import("node:test").TestContext} t
 * @param {{ music: string, data: string }} lib
 * @param {Record<string, any>} [overrides]  createServer's options
 */
async function libraryServer(t, lib, overrides = {}) {
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = createServer(Object.assign({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false }, overrides));
  const ctx = await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const getJ = async (p) => { const r = await fetch(B + p, { headers: H }); if (r.status !== 200) throw new Error(p + ": " + r.status + " " + await r.text()); return r.json(); };
  const postJ = async (p, body) => { const r = await fetch(B + p, { method: "POST", headers: H, body: JSON.stringify(body || {}) }); return { status: r.status, j: await r.json().catch(() => null) }; };
  const status = () => getJ("/api/status");
  // The first scan, made as the program starts.
  const settled = async () => {
    for (let i = 0; i < 600; i++) { const s = await status().catch(() => null); if (s && s.scan && s.scan.last && !s.scan.running && !s.library_importing) return s.scan.last; await sleep(100); }
    throw new Error("the scan didn't end");
  };
  await settled();
  return {
    ctx, B, H, getJ, postJ, db: ctx.db,
    /** Every album as the lists show it (offset, title, subtitle, favourite, year, discs, box…). */
    async albums() { return (await getJ("/api/library/albums?count=100000")).albums; },
    /** An album's page: { album, tracks, box_albums, … }. */
    album(id) { return getJ("/api/album?offset=" + id); },
    /** A scan asked for (Settings → Rescan), its result once made (scan.last). */
    async scan({ force = false } = {}) {
      const r = await postJ("/api/library/rescan", { force });
      if (r.status !== 200) throw new Error("rescan: " + r.status + " " + JSON.stringify(r.j));
      if (r.j && r.j.scan_status) return Object.assign({}, r.j, { status: r.j.scan_status });
      return settled();
    },
    /** The program started again (Settings → Restart), its first scan made. */
    restart() { return ctx.restart(token); },
    /** The library read again after the database was changed by hand. */
    reload() { return ctx.library.reload(); },
    /** The program stopped (another to start on the same folders). */
    stop: () => srv.stop(),
    status
  };
}

module.exports = { libraryServer };
