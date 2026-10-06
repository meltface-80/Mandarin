"use strict";
/*
 * api-backup.js: Backup & restore (v0.6.14). See lib/backup.js for what a
 * backup holds.
 *
 *   GET    /api/backup                 the parts, the database's size, and the backups kept here
 *   POST   /api/backup/file            a backup, streamed back as a file (the Android app saves it)
 *   POST   /api/backup/save            a backup kept on the server (a browser's)
 *   GET    /api/backup/download/:id    one kept here, as a file
 *   DELETE /api/backup/:id             one kept here, deleted
 *   POST   /api/backup/restore         restore from a backup file sent as the body
 *   POST   /api/backup/restore/:id     restore from one kept here
 *
 * Restoring keeps a backup of how things were first (kept here, "Before
 * restore"), then the server restarts so everything reads its settings afresh.
 * From home or away (v0.6.17): over Tailscale the server and the app reach
 * each other again after the restart.
 */
const fs = require("fs");
const path = require("path");
const B = require("../backup");

const SERVER_PARTS = ["settings", "devices", "collection", "keys"];

// The request's parts: { settings: true, … } from a list, an object or a query string.
function partsOf(x) {
  const out = {};
  if (typeof x === "string") x = x.split(",");
  if (Array.isArray(x)) for (const p of x) out[String(p).trim()] = true;
  else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) out[k] = !!v;
  for (const k of Object.keys(out)) if (!B.PARTS.includes(k) && k !== "app" && k !== "page") delete out[k];
  return out;
}

// "0.6.14" > "0.6.9", RC builds below their release.
function newer(a, b) {
  const p = v => String(v || "0").split(/[.-]/).map(x => /^\d+$/.test(x) ? Number(x) : x);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const m = x[i], n = y[i];
    if (m === undefined) return typeof n === "string";   // 0.6.0 vs 0.6.0-RC1
    if (n === undefined) return typeof m !== "string";
    if (m === n) continue;
    if (typeof m === "number" && typeof n === "number") return m > n;
    return typeof m === "number";
  }
  return false;
}

module.exports = function (app, ctx) {
  const store = new B.Store(ctx.config.dataDir);
  const dataDir = ctx.config.dataDir;
  const raw = ctx.db.raw;
  const log = ctx.log || console.log;
  const tmpDir = () => { const d = path.join(dataDir, "backups", "tmp"); fs.mkdirSync(d, { recursive: true }); return d; };
  const tmpFile = (ext) => path.join(tmpDir(), `${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}${ext}`);
  const rm = f => { try { if (f) fs.rmSync(f, { force: true }); } catch (e) { /* gone */ } };
  let busy = false;

  // The player this request's phone is (the Android app), or null.
  function phoneOf(req) {
    const dev = ctx.auth && ctx.auth.deviceOf(req);
    return dev && dev.kind === "android" ? "PHONE_" + dev.id : null;
  }
  function deviceName(req) {
    const dev = ctx.auth && ctx.auth.deviceOf(req);
    return (dev && dev.name) || "A browser";
  }

  // Write a backup of `include` (+ the page's and app's parts sent along) to `out`.
  async function build(out, include, extra, req) {
    const parts = SERVER_PARTS.filter(p => include[p]);
    const manifest = {
      app: "mandarin", format: B.FORMAT, version: ctx.version, created: (extra && extra.created) || Date.now(),
      from: { name: deviceName(req), kind: phoneOf(req) ? "android" : "browser" },
      phone: phoneOf(req), parts: parts.slice()
    };
    const entries = [];
    let dbCopy = null;
    if (parts.length) entries.push({ name: "server.json", data: B.snapshot(raw, include) });
    // The server's Tailscale identity with the keys (v0.7.2): restored onto a
    // fresh install, the server is the same node on your tailnet — the same
    // address, the same name, no signing in again, and the phone's learnt
    // address still right. Before, every reinstall was a new node.
    if (include.keys) {
      const state = tailscaleState();
      if (state) { entries.push({ name: "tailscale.json", data: { state: state.toString("base64") } }); manifest.tailscale = true; }
    }
    if (extra && extra.app && typeof extra.app === "object") { entries.push({ name: "app.json", data: extra.app }); manifest.parts.push("app"); }
    if (extra && extra.page && typeof extra.page === "object") { entries.push({ name: "page.json", data: extra.page }); manifest.parts.push("page"); }
    try {
      if (include.database) {
        dbCopy = await B.copyDatabase(raw, tmpFile(".db"));
        entries.push({ name: "musicd.db", file: dbCopy });
        manifest.parts.push("database");
      }
      entries.unshift({ name: "manifest.json", data: manifest });
      await B.writeBackup(out, entries);
    } finally { rm(dbCopy); }
    return manifest;
  }

  // The engine's state file (its node and machine keys), or null.
  const stateFile = () => ctx.tailscale && ctx.tailscale.dir ? path.join(ctx.tailscale.dir, "tailscaled.state") : null;
  function tailscaleState() {
    const f = stateFile();
    try { return f ? fs.readFileSync(f) : null; } catch (e) { return null; }
  }
  function putTailscaleState(buf) {
    const f = stateFile();
    if (!f || !buf.length) return false;
    try {
      if (ctx.tailscale.stop) ctx.tailscale.stop();   // the engine lets go of the file; the restart brings it back
      fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
      fs.writeFileSync(f, buf, { mode: 0o600 });
      return true;
    } catch (e) { ctx.log && ctx.log(`[backup] tailscale identity: ${e.message}`); return false; }
  }

  // Keep a backup on the server; returns its record.
  async function saveHere(include, extra, req, kind, label) {
    const id = store.newId(kind);
    const file = store.pathFor(id);
    const manifest = await build(fs.createWriteStream(file), include, extra, req);
    return store.record({ id, kind, label: label || manifest.from.name, created: manifest.created,
      version: manifest.version, parts: manifest.parts, bytes: fs.statSync(file).size });
  }

  /*
   * Restore from a backup file on disk. `include`: the parts wanted. Returns
   * what was restored, and the page's and app's parts for the device to apply.
   */
  async function restoreFile(file, include, req) {
    const dbFile = tmpFile(".db");
    try {
      const { parts, hasDb } = await B.readBackup(fs.createReadStream(file), { dbFile });
      const m = parts.manifest;
      if (m.format > B.FORMAT || newer(m.version, ctx.version)) {
        const e = new Error(`That backup was made by Mandarin v${m.version}; update this server first`); e.status = 409; throw e;
      }
      const map = {};
      const phone = phoneOf(req);
      if (m.phone && phone && m.phone !== phone) map[m.phone] = phone;
      const restored = [];
      const wantServer = SERVER_PARTS.some(p => include[p] && parts.server) || (include.database && hasDb);
      if (wantServer) {
        // How things are now, first: Undo is restoring this one.
        await saveHere({ settings: true, devices: true, collection: true, keys: true }, null, req, "auto", "Before restore");
      }
      if (include.database && hasDb) {
        B.stageDatabase(dbFile, path.join(dataDir, "musicd.db"), dataDir, { map });
        restored.push("database");
      } else if (parts.server) {
        restored.push(...B.apply(raw, parts.server, include, { map }));
        if (ctx.db.backupEdits) ctx.db.backupEdits();
      }
      // The Tailscale identity, with the keys or the whole database: written
      // for the engine to take up when the server starts again (it does, after
      // either). The node the backup was made on, not a new one.
      if ((include.keys || (include.database && hasDb)) && parts.tailscale && typeof parts.tailscale.state === "string") {
        if (putTailscaleState(Buffer.from(parts.tailscale.state, "base64"))) restored.push("tailscale");
      }
      const out = { ok: true, restored, version: m.version, created: m.created };
      if (include.page && parts.page) { out.page = parts.page; restored.push("page"); }
      if (include.app && parts.app) { out.app = parts.app; restored.push("app"); }
      out.restarting = restored.some(p => p !== "page" && p !== "app");
      return out;
    } finally { rm(dbFile); }
  }

  const finish = (res, out) => {
    res.json(out);
    if (out.restarting && ctx.restartServer) {
      log(`[backup] restored ${out.restored.join(", ")}; restarting`);
      setTimeout(() => ctx.restartServer(), 500);
    }
  };
  const fail = (res, e) => res.status(e.status || 400).json({ error: e.message || String(e) });

  app.get("/api/backup", (req, res) => {
    let dbBytes = 0;
    try { dbBytes = fs.statSync(path.join(dataDir, "musicd.db")).size; } catch (e) { /* none */ }
    res.json({ version: ctx.version, parts: B.PARTS, db_bytes: dbBytes, backups: store.list() });
  });

  app.post("/api/backup/file", async (req, res) => {
    const b = req.body || {};
    const include = partsOf(b.include);
    const name = `mandarin-backup-${B.stamp()}.tar.gz`;
    const created = Date.now();
    // What the file will hold, up front (v0.6.18): the app lists the file with it.
    const parts = SERVER_PARTS.filter(p => include[p]);
    if (b.app && typeof b.app === "object") parts.push("app");
    if (b.page && typeof b.page === "object") parts.push("page");
    if (include.database) parts.push("database");
    res.set("Content-Type", "application/gzip");
    res.set("Content-Disposition", `attachment; filename="${name}"`);
    res.set("X-Mandarin-Backup", JSON.stringify({ version: ctx.version, created, parts, from: deviceName(req) }));
    try { await build(res, include, { app: b.app, page: b.page, created }, req); }
    catch (e) { log(`[backup] ${e.message}`); if (!res.headersSent) fail(res, e); else res.destroy(e); }
  });

  app.post("/api/backup/save", async (req, res) => {
    if (busy) return res.status(409).json({ error: "A backup or restore is already running" });
    busy = true;
    try {
      const b = req.body || {};
      const meta = await saveHere(partsOf(b.include), { page: b.page, app: b.app }, req, "manual", b.label);
      res.json({ ok: true, backup: meta });
    } catch (e) { fail(res, e); } finally { busy = false; }
  });

  app.get("/api/backup/download/:id", (req, res) => {
    const f = store.file(req.params.id);
    if (!f) return res.status(404).json({ error: "No such backup" });
    res.download(f, `mandarin-backup-${req.params.id.replace(/-[0-9a-f]{6}$/, "")}.tar.gz`);
  });

  app.delete("/api/backup/:id", (req, res) => {
    res.json({ ok: store.remove(req.params.id) });
  });

  // A backup file as the body (the Android app; a file chosen in a browser).
  app.post("/api/backup/restore", async (req, res) => {
    if (busy) return res.status(409).json({ error: "A backup or restore is already running" });
    busy = true;
    const upload = tmpFile(".tar.gz");
    try {
      await new Promise((resolve, reject) => {
        const w = fs.createWriteStream(upload);
        req.pipe(w);
        w.on("finish", resolve); w.on("error", reject); req.on("error", reject);
      });
      finish(res, await restoreFile(upload, partsOf(req.query.parts), req));
    } catch (e) { log(`[backup] restore: ${e.message}`); fail(res, e); }
    finally { rm(upload); busy = false; }
  });

  app.post("/api/backup/restore/:id", async (req, res) => {
    const f = store.file(req.params.id);
    if (!f) return res.status(404).json({ error: "No such backup" });
    if (busy) return res.status(409).json({ error: "A backup or restore is already running" });
    busy = true;
    try { finish(res, await restoreFile(f, partsOf((req.body || {}).include), req)); }
    catch (e) { log(`[backup] restore: ${e.message}`); fail(res, e); }
    finally { busy = false; }
  });
};

module.exports.partsOf = partsOf;
module.exports.newer = newer;
