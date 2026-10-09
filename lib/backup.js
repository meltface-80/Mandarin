"use strict";
/*
 * backup.js: Backup & restore (v0.6.14).
 *
 * A backup is one file, mandarin-backup-<date>.tar.gz, holding:
 *   manifest.json   what made it, when, and which parts are in it
 *   server.json     the server's settings you changed, every player's own
 *                   settings (names, on/off, output, DSP, levelling), your
 *                   collection and the API keys, each part if chosen
 *   app.json        the Android app's own settings (from the app only)
 *   page.json       one device's screen settings (UI Settings and the like)
 *   musicd.db       the whole database, if chosen
 *
 * Never in a backup: the account's password data, the signed-in devices, play
 * history (except inside the whole database), caches. The server's Tailscale
 * identity goes with the keys (v0.7.2; before, never): restored, the server
 * is the same node on your tailnet.
 *
 * Restoring the parts applies them to the database. Restoring the whole
 * database stages it, and the next start swaps it in (stageDatabase /
 * swapStaged), keeping the account and the signed-in devices of today. The
 * server restarts after either, so everything reads its settings afresh.
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const FORMAT = 1;

// Settings a person sets, and nothing the server keeps for itself.
const SETTINGS_KEYS = [
  "displayEnabled", "displaySeconds", "homeRows", "identify",
  "labelFolderDepth", "labelsEnabled", "mbpack_dir", "music_folders", "radioZones", "replaygain",
  "shareCardReview", "shareReviews", "shareServices", "smartPicksEnabled", "smartPicksHour", "waveformEnabled"
];
const COLLECTION_KEYS = ["userPlaylists", "smartPlaylists"];
const COLLECTION_TABLES = ["favourites", "listen_later", "label_merges", "album_edits", "track_edits", "album_matches"];
// The Qobuz (v0.6.23) and Tidal (v0.6.24) sign-ins travel with the keys: tokens, never a password.
const KEY_KEYS = ["discogsToken", "fanartKey", "lastfmKey", "qobuz", "qobuzSettings", "tidal", "tidalSettings"];
// Kept from the server being restored, whatever the database brought.
const KEEP_TABLES = ["account", "devices"];
const KEEP_SETTINGS = ["authSecret", "tailscale"];

const PARTS = ["settings", "devices", "collection", "keys", "database"];

/* ---------------------------------------------------------------- reading */

function settingsOf(raw, keys) {
  const out = {};
  const get = raw.prepare("SELECT value FROM settings WHERE key = ?");
  for (const k of keys) {
    const r = get.get(k);
    if (r) { try { out[k] = JSON.parse(r.value); } catch (e) { /* unreadable: left out */ } }
  }
  return out;
}

// A row with its blobs as base64, so it goes into JSON and back.
const rowOut = r => { const o = {}; for (const [k, v] of Object.entries(r)) o[k] = Buffer.isBuffer(v) ? { $b64: v.toString("base64") } : v; return o; };
const rowIn = r => { const o = {}; for (const [k, v] of Object.entries(r)) o[k] = v && typeof v === "object" && typeof v.$b64 === "string" ? Buffer.from(v.$b64, "base64") : v; return o; };

function tableRows(raw, table) {
  try { return raw.prepare(`SELECT * FROM ${table}`).all().map(rowOut); } catch (e) { return []; }
}

/* The server's part of a backup: only the parts asked for. */
function snapshot(raw, include) {
  const s = {};
  if (include.settings) s.settings = settingsOf(raw, SETTINGS_KEYS);
  if (include.devices) s.devices = tableRows(raw, "audio_devices");
  if (include.collection) {
    s.collection = { settings: settingsOf(raw, COLLECTION_KEYS), tables: {} };
    for (const t of COLLECTION_TABLES) s.collection.tables[t] = tableRows(raw, t);
  }
  if (include.keys) s.keys = settingsOf(raw, KEY_KEYS);
  return s;
}

/* ---------------------------------------------------------------- applying */

const swapId = (id, map) => (map && map[id]) || id;

function columnsOf(raw, table) {
  try { return raw.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name); } catch (e) { return []; }
}

function replaceTable(raw, table, rows) {
  const cols = columnsOf(raw, table);
  if (!cols.length) return 0;
  raw.prepare(`DELETE FROM ${table}`).run();
  let n = 0;
  for (const r0 of rows || []) {
    const r = rowIn(r0);
    const use = cols.filter(c => c in r);
    if (!use.length) continue;
    raw.prepare(`INSERT OR REPLACE INTO ${table}(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`)
      .run(...use.map(c => r[c]));
    n++;
  }
  return n;
}

/*
 * The server's part of a backup, applied. `include` says which parts; `map`
 * swaps a player id for another (this phone's, after the app was reinstalled).
 * Settings the backup doesn't hold go back to their defaults: restored means
 * as it was then.
 */
function apply(raw, server, include, { map = null } = {}) {
  const put = raw.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const del = raw.prepare("DELETE FROM settings WHERE key = ?");
  const putAll = (keys, values) => {
    for (const k of keys) {
      if (values && Object.prototype.hasOwnProperty.call(values, k)) {
        let v = values[k];
        if (k === "radioZones" && Array.isArray(v)) v = v.map(id => swapId(id, map));
        put.run(k, JSON.stringify(v));
      } else del.run(k);
    }
  };
  const done = [];
  raw.transaction(() => {
    if (include.settings && server.settings) { putAll(SETTINGS_KEYS, server.settings); done.push("settings"); }
    if (include.devices && Array.isArray(server.devices)) {
      const cols = columnsOf(raw, "audio_devices");
      for (const r0 of server.devices) {
        const r = rowIn(r0);
        r.id = swapId(r.id, map);
        const have = raw.prepare("SELECT id FROM audio_devices WHERE id = ?").get(r.id);
        if (have) raw.prepare("UPDATE audio_devices SET name = ?, settings = ? WHERE id = ?").run(r.name || null, r.settings || "{}", r.id);
        else {
          const use = cols.filter(c => c in r);
          raw.prepare(`INSERT INTO audio_devices(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`).run(...use.map(c => r[c]));
        }
      }
      done.push("devices");
    }
    if (include.collection && server.collection) {
      putAll(COLLECTION_KEYS, server.collection.settings || {});
      for (const t of COLLECTION_TABLES) replaceTable(raw, t, (server.collection.tables || {})[t] || []);
      done.push("collection");
    }
    if (include.keys && server.keys) { putAll(KEY_KEYS, server.keys); done.push("keys"); }
  })();
  return done;
}

/* ---------------------------------------------------------------- tar.gz */

function tarHeader(name, size, mtime) {
  const h = Buffer.alloc(512, 0);
  h.write(name.slice(0, 99), 0, "utf8");
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write(Math.floor(mtime / 1000).toString(8).padStart(11, "0") + "\0", 136);
  h.write("        ", 148);
  h.write("0", 156);
  h.write("ustar\0", 257); h.write("00", 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
const pad = n => Buffer.alloc((512 - (n % 512)) % 512, 0);

/*
 * Write a backup to `out` (a writable stream). `entries`: [{ name, data }] or
 * [{ name, file }] for one read from disk (the database copy).
 */
async function writeBackup(out, entries) {
  const gz = zlib.createGzip({ level: 6 });
  const done = new Promise((resolve, reject) => { out.on("finish", resolve); out.on("close", resolve); out.on("error", reject); gz.on("error", reject); });
  gz.pipe(out);
  const write = buf => new Promise(r => { if (gz.write(buf)) r(); else gz.once("drain", r); });
  const now = Date.now();
  for (const e of entries) {
    if (e.file) {
      const size = fs.statSync(e.file).size;
      await write(tarHeader(e.name, size, now));
      for await (const chunk of fs.createReadStream(e.file)) await write(chunk);
      await write(pad(size));
    } else {
      const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(typeof e.data === "string" ? e.data : JSON.stringify(e.data, null, 1));
      await write(tarHeader(e.name, data.length, now));
      await write(data);
      await write(pad(data.length));
    }
  }
  await write(Buffer.alloc(1024, 0));
  gz.end();
  await done;
}

/*
 * Read a backup from `input` (a readable stream): the JSON parts into memory
 * (each at most 64 MB), the database copy to `dbFile` when there is one.
 */
async function readBackup(input, { dbFile } = {}) {
  const gun = zlib.createGunzip();
  input.pipe(gun);
  const parts = {};
  let hasDb = false;
  let buf = Buffer.alloc(0);
  let cur = null;   // { name, left, chunks, stream }
  const JSON_MAX = 64 * 1024 * 1024;
  const finishEntry = async () => {
    if (cur.stream) { await new Promise((res, rej) => cur.stream.end(err => err ? rej(err) : res())); hasDb = true; }
    else if (cur.chunks) {
      try { parts[cur.name.replace(/\.json$/, "")] = JSON.parse(Buffer.concat(cur.chunks).toString("utf8")); }
      catch (e) { throw new Error("The backup's " + cur.name + " is unreadable"); }
    }
  };
  let skipPad = 0, ended = false;
  for await (const chunk of gun) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (ended) break;
      if (skipPad) { const n = Math.min(skipPad, buf.length); buf = buf.subarray(n); skipPad -= n; if (skipPad) break; }
      if (!cur) {
        if (buf.length < 512) break;
        const h = buf.subarray(0, 512); buf = buf.subarray(512);
        if (h.every(b => b === 0)) { ended = true; break; }
        const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
        const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/s, "").trim() || "0", 8);
        cur = { name, size, left: size };
        if (name === "musicd.db") {
          if (!dbFile) throw new Error("A database copy wasn't expected here");
          cur.stream = fs.createWriteStream(dbFile);
        } else if (/^[a-z]+\.json$/.test(name)) {
          if (size > JSON_MAX) throw new Error("The backup's " + name + " is too large");
          cur.chunks = [];
        }
        if (!size) { await finishEntry(); cur = null; }
        continue;
      }
      if (!buf.length) break;
      const n = Math.min(cur.left, buf.length);
      const piece = buf.subarray(0, n); buf = buf.subarray(n); cur.left -= n;
      if (cur.stream) { if (!cur.stream.write(piece)) await new Promise(r => cur.stream.once("drain", r)); }
      else if (cur.chunks) cur.chunks.push(Buffer.from(piece));
      if (!cur.left) { skipPad = (512 - (cur.size % 512)) % 512; await finishEntry(); cur = null; }
    }
  }
  if (cur) throw new Error("The backup file is cut short");
  if (!parts.manifest || parts.manifest.app !== "mandarin") throw new Error("That isn't a Mandarin backup");
  return { parts, hasDb };
}

/* ---------------------------------------------------------------- the whole database */

/* A consistent copy of the open database at `file`. */
async function copyDatabase(raw, file) { await raw.backup(file); return file; }

/* Does `file` look like a Mandarin database? */
function checkDatabase(file) {
  let d;
  try {
    d = new Database(file, { readonly: true, fileMustExist: true });
    const names = new Set(d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    for (const t of ["albums", "tracks", "settings"]) if (!names.has(t)) throw new Error("missing " + t);
  } catch (e) {
    throw new Error("The database in that backup isn't a Mandarin database (" + e.message + ")");
  } finally { if (d) d.close(); }
}

/*
 * Ready `file` (a database from a backup) to replace the open one at the next
 * start: today's account, signed-in devices and Tailscale identity copied in,
 * so nobody is signed out and the password stays. Then staged beside it.
 */
function stageDatabase(file, currentFile, dataDir, { map = null } = {}) {
  checkDatabase(file);
  const d = new Database(file);
  try {
    d.prepare("ATTACH DATABASE ? AS cur").run(currentFile);
    d.transaction(() => {
      for (const t of KEEP_TABLES) {
        const cols = d.prepare(`PRAGMA main.table_info(${t})`).all().map(c => c.name);
        const have = new Set(d.prepare(`PRAGMA cur.table_info(${t})`).all().map(c => c.name));
        const use = cols.filter(c => have.has(c));
        if (!use.length) continue;
        d.prepare(`DELETE FROM main.${t}`).run();
        d.prepare(`INSERT INTO main.${t}(${use.join(",")}) SELECT ${use.join(",")} FROM cur.${t}`).run();
      }
      for (const k of KEEP_SETTINGS) {
        d.prepare("DELETE FROM main.settings WHERE key = ?").run(k);
        d.prepare("INSERT INTO main.settings(key, value) SELECT key, value FROM cur.settings WHERE key = ?").run(k);
      }
      // This phone under its id of today (the app reinstalled since the backup).
      for (const [from, to] of Object.entries(map || {})) {
        if (!d.prepare("SELECT 1 FROM main.audio_devices WHERE id = ?").get(from)) continue;
        d.prepare("DELETE FROM main.audio_devices WHERE id = ?").run(to);
        d.prepare("UPDATE main.audio_devices SET id = ? WHERE id = ?").run(to, from);
      }
      const rz = d.prepare("SELECT value FROM main.settings WHERE key = 'radioZones'").get();
      if (rz && map) {
        try {
          const v = JSON.parse(rz.value);
          if (Array.isArray(v)) d.prepare("UPDATE main.settings SET value = ? WHERE key = 'radioZones'").run(JSON.stringify(v.map(id => swapId(id, map))));
        } catch (e) { /* left as it is */ }
      }
    })();
    d.prepare("DETACH DATABASE cur").run();
    d.pragma("journal_mode = DELETE");
  } finally { d.close(); }
  const staged = path.join(dataDir, "restore-staged.db");
  fs.renameSync(file, staged);
  return staged;
}

/*
 * At start, before the database opens: a staged database replaces it. The one
 * it replaces is kept in backups/ (with its WAL), and the album-edits copy
 * beside it is dropped, so the restored edits stand and are written out anew.
 */
function swapStaged(dataDir, log = () => {}) {
  const staged = path.join(dataDir, "restore-staged.db");
  if (!fs.existsSync(staged)) return false;
  const file = path.join(dataDir, "musicd.db");
  const dir = path.join(dataDir, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const aside = path.join(dir, `before-restore-${stamp()}.db`);
  for (const suffix of ["", "-wal", "-shm"]) {
    if (fs.existsSync(file + suffix)) fs.renameSync(file + suffix, aside + suffix);
  }
  try { fs.rmSync(path.join(dataDir, "album-edits.json"), { force: true }); } catch (e) { /* none */ }
  fs.renameSync(staged, file);
  log(`[backup] restored the database from a backup; the one before it is kept as ${aside}`);
  return true;
}

/* ---------------------------------------------------------------- stored on the server */

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const KEEP = { manual: 10, auto: 5 };

class Store {
  constructor(dataDir) { this.dir = path.join(dataDir, "backups"); }
  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter(n => /^[a-z0-9-]+\.json$/.test(n)); } catch (e) { return []; }
    return names.map(n => { try { return JSON.parse(fs.readFileSync(path.join(this.dir, n), "utf8")); } catch (e) { return null; } })
      .filter(Boolean).sort((a, b) => b.created - a.created);
  }
  file(id) {
    if (!/^[a-z0-9-]+$/.test(String(id))) return null;
    const f = path.join(this.dir, id + ".tar.gz");
    return fs.existsSync(f) ? f : null;
  }
  newId(kind) { return `${kind}-${stamp()}-${crypto.randomBytes(3).toString("hex")}`; }
  pathFor(id) { fs.mkdirSync(this.dir, { recursive: true }); return path.join(this.dir, id + ".tar.gz"); }
  record(meta) {
    fs.writeFileSync(path.join(this.dir, meta.id + ".json"), JSON.stringify(meta, null, 1));
    this.prune(meta.kind);
    return meta;
  }
  remove(id) {
    if (!/^[a-z0-9-]+$/.test(String(id))) return false;
    let gone = false;
    for (const ext of [".tar.gz", ".json"]) {
      const f = path.join(this.dir, id + ext);
      if (fs.existsSync(f)) { fs.rmSync(f); gone = true; }
    }
    return gone;
  }
  prune(kind) {
    const keep = KEEP[kind] || 10;
    for (const m of this.list().filter(m => m.kind === kind).slice(keep)) this.remove(m.id);
  }
}

module.exports = {
  FORMAT, PARTS, SETTINGS_KEYS, COLLECTION_KEYS, COLLECTION_TABLES, KEY_KEYS,
  snapshot, apply, writeBackup, readBackup, copyDatabase, checkDatabase, stageDatabase, swapStaged, Store, stamp
};
