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

class MbPack {
  constructor(db, file) {
    this.db = db;
    this.file = file;
    this.meta = Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map(r => [r.key, r.value]));
    this.q = {
      byCode: db.prepare("SELECT r.id, r.gid, r.title, r.artist, r.tracks FROM releases r WHERE r.code = ?"),
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
class PackStore {
  constructor({ dataDir, db, url = PACK_URL, log = () => {}, fetchImpl, checkMs = DAY }) {
    this.file = path.join(dataDir, "mbpack.sqlite");
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

  /* The pack, opened once; null when there's none. */
  get() {
    if (this.pack === undefined) this.pack = MbPack.open(this.file, { log: this.log });
    return this.pack;
  }

  wanted() { return this.db ? !!this.db.setting("mbpack", false) : false; }

  status() {
    const p = this.get();
    const job = this.job ? Object.assign({}, this.job) : null;
    return {
      installed: p ? p.info() : null,
      latest: this.latest ? { built: this.latest.built, dump: this.latest.dump, releases: Number(this.latest.releases) || 0, gz_size: this.latest.gz_size, size: this.latest.size } : null,
      newer: !!(p && this.latest && this.latest.built && this.latest.built > (p.meta.built || "")),
      job
    };
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
    if (this.job && !this.job.error && this.job.phase !== "done") return this.status();
    this.job = { phase: "checking", done: 0, total: 0, error: null };
    const run = (async () => {
      const tmp = this.file + ".download";
      try {
        const d = await this.describe();
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
    this.close();
    fs.rmSync(this.file, { force: true });
    if (this.db) this.db.setSetting("mbpack", false);
    this.pack = null;
    this.job = null;
    return this.status();
  }

  /* Once a day: a newer pack published is fetched (only once you've chosen one). */
  start() {
    const tick = async () => {
      if (!this.wanted() || !this.get()) return;
      try {
        await this.describe();
        if (this.status().newer) await this.download();
      } catch (e) { /* asked again tomorrow */ }
    };
    this.timer = setInterval(() => { tick(); }, this.checkMs);
    if (this.timer.unref) this.timer.unref();
    setTimeout(tick, 60000).unref();
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.close(); }

  close() { if (this.pack) this.pack.close(); this.pack = undefined; }
}

module.exports = { MbPack, PackStore, withPack, codeOf, gidText, gidBlob, FORMAT, PACK_URL };
