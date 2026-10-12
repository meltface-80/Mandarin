"use strict";
/*
 * mbpack.js — the MusicBrainz pack (v0.6.4): every release with a barcode,
 * with its tracks, kept on this machine (tools/mbpack/build.js makes it from
 * MusicBrainz's data dump). The scan asks it first; what it doesn't have,
 * musicbrainz.org is still asked.
 *
 *   const pack = MbPack.open(file)     → null when there is none
 *   pack.byBarcode(code)               → releases with that barcode, either form
 *   pack.release(mbid)                 → one release, as musicbrainz.js gives it
 *   withPack(mb, pack)                 → mb, asking the pack first
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");
const Database = require("better-sqlite3");

const FORMAT = 1;
// Where .github/workflows/mbpack.yml publishes it each week.
const PACK_URL = "https://github.com/meltface-80/Mandarin/releases/download/mbpack";
const DAY = 24 * 3600 * 1000;

const codeOf = barcode => String(barcode || "").replace(/\D/g, "").replace(/^0+/, "") || null;
const gidBlob = g => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(String(g || "")) ? Buffer.from(String(g).replace(/-/g, ""), "hex") : null;
const gidText = b => { if (!b) return null; const h = Buffer.from(b).toString("hex"); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const dateText = n => {
  if (!n) return null;
  const y = Math.floor(n / 10000), m = Math.floor(n / 100) % 100, d = n % 100;
  const p = v => String(v).padStart(2, "0");
  return m ? (d ? `${y}-${p(m)}-${p(d)}` : `${y}-${p(m)}`) : String(y).padStart(4, "0");
};
const yearOf = n => (n ? Math.floor(n / 10000) : null);
const mb = n => Math.round(Number(n || 0) / 1048576).toLocaleString("en-GB") + " MB";

class MbPack {
  constructor(db, file) {
    this.db = db;
    this.file = file;
    this.meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map(r => [r.key, r.value]));
    this.q = {
      byCode: db.prepare("SELECT r.id, r.gid, r.title, r.artist, r.tracks FROM releases r WHERE r.code = ?"),
      has: db.prepare("SELECT 1 FROM releases WHERE code = ? LIMIT 1").pluck(),
      byGid: db.prepare(`SELECT r.*, g.gid AS g_gid, g.title AS g_title, g.note AS g_note, g.type AS g_type, g.first AS g_first
        FROM releases r LEFT JOIN groups g ON g.id = r.grp WHERE r.gid = ?`)
    };
  }

  /* The pack in this file, or null: none there, or not one this version reads. */
  static open(file, { log = () => {} } = {}) {
    if (!file || !fs.existsSync(file)) return null;
    try {
      const db = new Database(file, { readonly: true, fileMustExist: true });
      const pack = new MbPack(db, file);
      if (Number(pack.meta.format) !== FORMAT) { db.close(); log(`MusicBrainz pack: format ${pack.meta.format}, not ${FORMAT}; not used`); return null; }
      return pack;
    } catch (e) {
      log("MusicBrainz pack: can't be read (" + e.message + ")");
      return null;
    }
  }

  info() {
    return { file: this.file, built: this.meta.built || null, dump: this.meta.dump || null, releases: Number(this.meta.releases) || 0,
      size: (() => { try { return fs.statSync(this.file).size; } catch (e) { return 0; } })() };
  }

  /* Releases with this barcode, as MusicBrainz.byBarcode gives them. A
   * leading 0 is no part of it here, so a UPC finds its EAN and back. */
  byBarcode(code) {
    const c = codeOf(code);
    if (!c) return [];
    return this.q.byCode.all(c).map(r => ({
      mbid: gidText(r.gid), title: r.title || "", artist: r.artist || "",
      track_count: JSON.parse(r.tracks || "[]").length, score: 100
    }));
  }

  /* Whether any release carries this barcode (either form). */
  has(code) {
    const c = codeOf(code);
    return !!(c && this.q.has.get(c));
  }

  /* One release in full, as musicbrainz.js's candidateOf makes it; null when
   * the pack doesn't have it. */
  release(mbid) {
    const b = gidBlob(mbid);
    const r = b && this.q.byGid.get(b);
    if (!r) return null;
    const tracks = JSON.parse(r.tracks || "[]").map(([disc, no, title, length, artist]) => ({
      disc, no, title: title || "", artist: artist || "", length: length == null ? null : length
    }));
    const first = r.g_first || r.date;
    return {
      mbid: gidText(r.gid),
      group_mbid: gidText(r.g_gid),
      title: r.g_title || r.title || "",
      artist: r.artist || "",
      year: yearOf(first),
      date: dateText(first),
      release_title: r.title || "",
      release_year: yearOf(r.date),
      release_date: dateText(r.date),
      edition: r.note || "",
      group_note: r.g_note || "",
      type: r.g_type || null,
      country: r.country || null,
      discs: new Set(tracks.map(t => t.disc)).size || null,
      track_count: tracks.length,
      tracks,
      source: "musicbrainz",
      from_pack: true
    };
  }

  close() { try { this.db.close(); } catch (e) { /* closed */ } }
}

/* mb, asking the pack first for a barcode or a release: what the pack has
 * needs no request (and no second's wait); what it hasn't goes to
 * musicbrainz.org as before. pack is a function, so a pack downloaded or
 * removed while the server runs is seen at once. */
function withPack(mb, pack) {
  const p = typeof pack === "function" ? pack : () => pack;
  return new Proxy(mb, {
    get(target, prop, recv) {
      if (prop === "byBarcode") {
        return async (code) => {
          const k = p();
          const found = k ? k.byBarcode(code) : [];
          if (found.length) { target.packHits = (target.packHits || 0) + 1; return found; }
          return target.byBarcode(code);
        };
      }
      if (prop === "release") {
        return async (mbid) => {
          const k = p();
          const rel = k ? k.release(mbid) : null;
          return rel || target.release(mbid);
        };
      }
      const v = Reflect.get(target, prop, recv);
      return typeof v === "function" ? v.bind(target) : v;
    }
  });
}

/*
 * The pack in the data folder (Settings → Library Scanner → MusicBrainz
 * pack): downloaded on request, checked against its published SHA-256, and
 * kept up to date — once a day the server asks whether a newer one is out
 * and fetches it. Removed, the scan asks musicbrainz.org for everything.
 */
const NAME = "mbpack.sqlite";
// Room kept free beside a download, so the drive isn't filled to the last byte.
const SPARE = 200 * 1048576;

/* Free bytes on the drive a folder is on; null when it can't be told. */
function freeIn(dir) {
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch (e) { return null; }
}

/* Moved across drives as well as within one. */
async function moveFile(from, to) {
  try { fs.renameSync(from, to); return; } catch (e) { if (e.code !== "EXDEV") throw e; }
  const tmp = to + ".moving";
  try {
    await fs.promises.copyFile(from, tmp);
    fs.renameSync(tmp, to);
  } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
  fs.rmSync(from, { force: true });
}

class PackStore {
  /* The pack lives in the data folder, or the folder chosen in Settings
   * (dir is MBPACK_DIR, which overrides the setting). */
  constructor({ dataDir, dir, db, url = PACK_URL, log = () => {}, fetchImpl, checkMs = DAY }) {
    this.dataDir = dataDir;
    this.fixedDir = dir || null;
    this.db = db;
    this.url = String(url).replace(/\/$/, "");
    this.log = log;
    this.fetch = fetchImpl || ((...a) => fetch(...a));
    this.checkMs = checkMs;
    this.pack = undefined;     // undefined: not opened yet; null: none
    this.job = null;           // { phase, done, total, error }
    this.latest = null;        // the published pack's description
    this.timer = null;
  }

  /* Where the pack lives: MBPACK_DIR, else the folder chosen, else the data folder. */
  get dir() {
    if (this.fixedDir) return path.resolve(this.fixedDir);
    const chosen = this.db ? this.db.setting("mbpack_dir", null) : null;
    return chosen ? path.resolve(chosen) : path.resolve(this.dataDir);
  }
  get file() { return path.join(this.dir, NAME); }

  /* Why the pack's folder can't be used, or null: not there (in Docker, a
   * mount the container was started without), or not writable. */
  dirProblem() {
    const d = this.dir;
    let st = null;
    try { st = fs.statSync(d); } catch (e) { /* not there */ }
    const docker = fs.existsSync("/.dockerenv");
    if (!st || !st.isDirectory()) {
      return d + " isn't there" + (docker ? " — the container wasn't started with it mounted (-v …:" + d + "). Start it again with that line, or choose another folder." : ". Choose another folder.");
    }
    try { fs.accessSync(d, fs.constants.W_OK); }
    catch (e) { return "Can't write to " + d + (e.code === "EROFS" ? " — it's read-only to the server" + (docker ? " (mounted with :ro)" : "") : "") + ". Choose another folder."; }
    return null;
  }

  busy() { return !!(this.job && !this.job.error && this.job.phase !== "done"); }

  /* Keep the pack in another folder (another drive): the one here is moved
   * there. null puts it back in the data folder. */
  async setDir(dir) {
    if (this.fixedDir) throw Object.assign(new Error("The pack's folder is set by MBPACK_DIR on the server"), { status: 409 });
    if (this.busy()) throw Object.assign(new Error("Wait for the download to finish"), { status: 409 });
    const next = dir ? path.resolve(String(dir)) : path.resolve(this.dataDir);
    if (next === "/") throw Object.assign(new Error("Not the top folder — choose one on the drive"), { status: 400 });
    try { fs.accessSync(next, fs.constants.W_OK); if (!fs.statSync(next).isDirectory()) throw new Error(); }
    catch (e) {
      const docker = fs.existsSync("/.dockerenv");
      // A folder reached through a read-only mount (-v /mnt:/mnt:ro) can't be written, though the drive can.
      const why = e.code === "EROFS" ? " — it's read-only to the server" + (docker ? " (mounted with :ro). Mount the folder into the container on its own line, without :ro, and choose it there" : "")
        : docker ? " — is it mounted into the container?" : "";
      throw Object.assign(new Error("Can't write to " + next + why), { status: 400 });
    }
    const from = this.file, to = path.join(next, NAME);
    if (from !== to && fs.existsSync(from)) {
      const size = fs.statSync(from).size, free = freeIn(next);
      if (free != null && free < size + SPARE) throw Object.assign(new Error(`Not enough room there: the pack needs ${mb(size)}, ${mb(free)} free`), { status: 400 });
      this.close();
      this.job = { phase: "moving", done: 0, total: size, error: null };
      try { await moveFile(from, to); }
      catch (e) { this.job = { phase: "moving", done: 0, total: size, error: "Couldn't move the pack: " + e.message }; this.pack = undefined; throw Object.assign(new Error(this.job.error), { status: 500 }); }
      this.job = null;
    }
    if (this.db) this.db.setSetting("mbpack_dir", dir ? next : null);
    this.pack = undefined;
    return this.status();
  }

  /* The pack, opened once; null when there's none. */
  get() {
    // Not while it's being moved: musicbrainz.org is asked meanwhile.
    if (this.job && this.job.phase === "moving" && !this.job.error) return null;
    if (this.pack === undefined) this.pack = MbPack.open(this.file, { log: this.log });
    return this.pack;
  }

  wanted() { return this.db ? !!this.db.setting("mbpack", false) : false; }

  status() {
    const p = this.get();
    const job = this.job ? Object.assign({}, this.job) : null;
    return {
      dir: this.dir, dir_fixed: !!this.fixedDir, dir_problem: this.dirProblem(), data_dir: path.resolve(this.dataDir), free: freeIn(this.dir),
      installed: p ? p.info() : null,
      latest: this.latest ? { built: this.latest.built, dump: this.latest.dump, releases: Number(this.latest.releases) || 0, gz_size: this.latest.gz_size, size: this.latest.size } : null,
      newer: !!(p && this.latest && this.latest.built && this.latest.built > (p.meta.built || "")),
      job,
      checking: !!this.checking
    };
  }

  /*
   * What's published, asked in the background (v0.8.17): the page's answer
   * doesn't wait for GitHub (it says "checking" until it has asked), and
   * GitHub is asked at most every ten minutes.
   */
  checkSoon() {
    if (this.checking || (this.checkedAt && Date.now() - this.checkedAt < 10 * 60 * 1000)) return;
    this.checking = this.describe()
      .then(() => { this.describeError = null; })
      .catch(e => { this.describeError = e.message; })
      .finally(() => { this.checking = null; this.checkedAt = Date.now(); });
  }

  /* What's published: its date, size and checksum. */
  async describe() {
    const r = await this.fetch(`${this.url}/mbpack-${FORMAT}.json`, { redirect: "follow", signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(r.status === 404 ? "no pack is published yet" : "HTTP " + r.status);
    this.latest = await r.json();
    return this.latest;
  }

  /* Fetch the published pack and put it in place of the one here. */
  async download() {
    if (this.busy()) return this.status();
    // A folder that isn't there says so, rather than an ENOENT from the download.
    const problem = this.dirProblem();
    if (problem) { this.job = { phase: "checking", done: 0, total: 0, error: problem }; return this.status(); }
    this.job = { phase: "checking", done: 0, total: 0, error: null };
    const run = (async () => {
      const tmp = this.file + ".download";
      try {
        const d = await this.describe();
        // Room for the new pack beside the old one, which stays until it's in place.
        const free = freeIn(this.dir);
        if (free != null && d.size && free < Number(d.size) + SPARE) throw new Error(`Not enough room in ${this.dir}: the pack needs ${mb(d.size)}, ${mb(free)} free`);
        this.job = { phase: "downloading", done: 0, total: Number(d.gz_size) || 0, error: null };
        const r = await this.fetch(`${this.url}/${d.file || `mbpack-${FORMAT}.sqlite.gz`}`, { redirect: "follow" });
        if (!r.ok || !r.body) throw new Error("download HTTP " + r.status);
        const hash = crypto.createHash("sha256");
        const job = this.job;
        const count = new Transform({ transform(chunk, enc, cb) { hash.update(chunk); job.done += chunk.length; cb(null, chunk); } });
        await pipeline(Readable.fromWeb(r.body), count, zlib.createGunzip(), fs.createWriteStream(tmp));
        const sum = hash.digest("hex");
        if (d.sha256 && sum !== d.sha256) throw new Error("the download doesn't match its checksum; try again");
        const test = MbPack.open(tmp);
        if (!test) throw new Error("the download isn't a pack this server reads");
        test.close();
        this.close();
        fs.renameSync(tmp, this.file);
        this.pack = undefined;
        if (this.db) this.db.setSetting("mbpack", true);
        this.job = { phase: "done", done: job.done, total: job.total, error: null };
        this.log(`MusicBrainz pack: ${this.get().info().releases} releases (${d.built})`);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        this.log("MusicBrainz pack: " + e.message);
        this.job = Object.assign({}, this.job, { error: e.message });
      }
    })();
    this.running = run;
    return this.status();
  }

  remove() {
    if (this.busy()) throw Object.assign(new Error("Wait for the " + (this.job.phase === "moving" ? "move" : "download") + " to finish"), { status: 409 });
    this.close();
    fs.rmSync(this.file, { force: true });
    if (this.db) this.db.setSetting("mbpack", false);
    this.pack = null;
    this.job = null;
    return this.status();
  }

  /* Once a day: a newer pack published is fetched (only once you've chosen one). */
  start() {
    if (this.handedOver) return;
    const tick = async () => {
      if (this.handedOver || !this.wanted() || !this.get()) return;
      try {
        await this.describe();
        if (this.status().newer) await this.download();
      } catch (e) { /* asked again tomorrow */ }
    };
    this.timer = setInterval(() => { tick(); }, this.checkMs);
    if (this.timer.unref) this.timer.unref();
    this.first = setTimeout(tick, 60000);
    if (this.first.unref) this.first.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
    this.timer = this.first = null;
    this.close();
  }

  /* Mandarin's C# server keeps the pack from now on (v0.8.19): not checked or fetched here. */
  handOver() { this.handedOver = true; this.stop(); }

  close() { if (this.pack) this.pack.close(); this.pack = undefined; }
}

module.exports = { MbPack, PackStore, withPack, codeOf, gidText, gidBlob, FORMAT, PACK_URL };
