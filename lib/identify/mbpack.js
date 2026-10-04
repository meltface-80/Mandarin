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
const Database = require("better-sqlite3");

const FORMAT = 1;

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

module.exports = { MbPack, withPack, codeOf, gidText, gidBlob, FORMAT };
