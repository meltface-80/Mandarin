"use strict";
/*
 * autoeq.js — headphone profiles from AutoEq (github.com/jaakkopasanen/AutoEq),
 * kept in the database.
 *
 * AutoEq publishes, for thousands of headphones, a parametric EQ that
 * brings each measured response to a target — a text file of up to ten
 * bands and a preamp ("ParametricEQ.txt"). Its index (results/INDEX.md)
 * lists every one with the source that measured it and the rig.
 *
 * The index is fetched once a day and held in the database (its 8,000-odd
 * rows are a few hundred kilobytes); a profile is fetched when chosen and
 * held for good, so a headphone once picked never needs GitHub again. A
 * profile pasted or uploaded by hand goes through the same parser.
 */
const Biquad = require("../public/biquad");

const DEFAULT_BASE = "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results";
const INDEX_MAX_AGE = 24 * 3600 * 1000;
const NS = "autoeq";

// "- [Sennheiser HD 650](./oratory1990/over-ear/Sennheiser%20HD%20650) by oratory1990 on GRAS 43AG-7"
const ROW = /^- \[([^\]]+)\]\(\.\/([^)]+)\)\s+by\s+(.+?)(?:\s+on\s+(.+?))?\s*$/;

/* The index's markdown as rows: { id, name, source, rig, form }. The id is
 * the path under results/, decoded. */
function parseIndex(md) {
  const out = [];
  for (const line of String(md || "").split("\n")) {
    const m = ROW.exec(line.trim());
    if (!m) continue;
    const id = decodeURIComponent(m[2]);
    const parts = id.split("/");
    // The middle folder names the rig and the form: "GRAS 43AG-7 over-ear", "in-ear", "earbud".
    const mid = parts.length >= 3 ? parts[1] : "";
    const form = /in-ear/i.test(mid) ? "in-ear" : /earbud/i.test(mid) ? "earbud" : /over-ear/i.test(mid) ? "over-ear" : "";
    out.push({ id, name: m[1], source: m[3].trim(), rig: (m[4] || "").trim(), form });
  }
  return out;
}

const TYPE = { PK: "peak", PEQ: "peak", LSC: "low_shelf", LS: "low_shelf", LSQ: "low_shelf", HSC: "high_shelf", HS: "high_shelf", HSQ: "high_shelf", LPQ: "low_pass", LP: "low_pass", HPQ: "high_pass", HP: "high_pass" };

/*
 * A ParametricEQ.txt (AutoEq's, or Equalizer APO's shape generally):
 *   Preamp: -6.1 dB
 *   Filter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70
 * → { preamp, bands }. Filters marked OFF are left out; more than ten
 * bands keeps the first ten. Throws when nothing in it is a filter.
 */
function parseProfile(text) {
  let preamp = null;
  const bands = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    let m = /^Preamp:\s*(-?[\d.]+)\s*dB/i.exec(line);
    if (m) { preamp = Math.min(0, Number(m[1])); continue; }
    m = /^Filter\s*\d*:\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+(-?[\d.]+)\s*Hz(?:\s+Gain\s+(-?[\d.]+)\s*dB)?(?:\s+Q\s+(-?[\d.]+))?/i.exec(line);
    if (!m) continue;
    if (m[1].toUpperCase() === "OFF") continue;
    const type = TYPE[m[2].toUpperCase()];
    if (!type) continue;
    const freq = Number(m[3]), gain = m[4] != null ? Number(m[4]) : 0, q = m[5] != null ? Number(m[5]) : 0.707;
    try { bands.push(Biquad.normaliseBand({ type, freq, gain, q })); } catch (e) { /* a band out of range is left out */ }
  }
  if (!bands.length) throw Object.assign(new Error("No filters found — a profile reads like “Filter 1: ON PK Fc 105 Hz Gain 3.1 dB Q 0.70”"), { status: 400 });
  return { preamp, bands: bands.slice(0, Biquad.MAX_BANDS) };
}

class AutoEq {
  constructor({ db, baseUrl, fetchText, log = () => {} } = {}) {
    this.db = db;
    this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
    this.log = log;
    this.fetchText = fetchText || (async (url) => {
      const r = await fetch(url, { headers: { "User-Agent": "Mandarin (https://github.com/meltface-80/MusicD-Server)" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`AutoEq: HTTP ${r.status} for ${url}`);
      return r.text();
    });
    this.loading = null;
  }

  /* The index, from the database or fetched when a day old. Fails soft:
   * an index that can't be fetched leaves the last one in use. */
  async index() {
    const fresh = this.db.cacheGet(NS, "index", INDEX_MAX_AGE);
    if (fresh && fresh.rows) return fresh.rows;
    if (!this.loading) {
      this.loading = (async () => {
        try {
          const md = await this.fetchText(`${this.baseUrl}/INDEX.md`);
          const rows = parseIndex(md);
          if (!rows.length) throw new Error("AutoEq: the index had no rows");
          this.db.cachePut(NS, "index", { rows, at: Date.now() });
          this.log(`[autoeq] index: ${rows.length} headphones`);
          return rows;
        } catch (e) {
          this.log(`[autoeq] index not fetched: ${e.message}`);
          const old = this.db.cacheGet(NS, "index");
          if (old && old.rows) return old.rows;
          throw e;
        } finally { this.loading = null; }
      })();
    }
    return this.loading;
  }

  indexedAt() { const c = this.db.cacheGet(NS, "index"); return c ? c.at : null; }

  /* Headphones whose names carry every word of the query, best first:
   * oratory1990's over-ear and crinacle's in-ear measurements are the ones
   * most people reach for, so they lead. */
  async search(query, limit = 40) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const rows = await this.index();
    const rank = r => (r.source === "oratory1990" ? 0 : r.source === "crinacle" ? 1 : r.source === "Rtings" ? 2 : 3);
    return rows
      .filter(r => { const n = r.name.toLowerCase(); return words.every(w => n.includes(w)); })
      .sort((a, b) => a.name.length - b.name.length || rank(a) - rank(b) || a.source.localeCompare(b.source))
      .slice(0, limit);
  }

  /* One headphone's profile — { source: "autoeq", id, name, preamp, bands } — fetched once. */
  async profile(id) {
    const key = String(id || "");
    if (!key || key.includes("..")) throw Object.assign(new Error("No such headphone"), { status: 404 });
    const hit = this.db.cacheGet(NS, "profile:" + key);
    if (hit) return hit;
    const rows = await this.index();
    const row = rows.find(r => r.id === key);
    if (!row) throw Object.assign(new Error("No such headphone in AutoEq's index"), { status: 404 });
    const file = `${this.baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(row.name)}%20ParametricEQ.txt`;
    const text = await this.fetchText(file);
    const p = parseProfile(text);
    const out = { source: "autoeq", id: key, name: row.name + (row.source ? ` (${row.source}${row.rig ? ", " + row.rig : ""})` : ""), preamp: p.preamp, bands: p.bands };
    this.db.cachePut(NS, "profile:" + key, out);
    return out;
  }
}

module.exports = { AutoEq, parseIndex, parseProfile, DEFAULT_BASE };
