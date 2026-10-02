"use strict";
/*
 * labellookup.js — a record label for the albums whose files carry none
 * (Stage 8, part 3).
 *
 * Asked about one album at a time, in the background: MusicBrainz first (a
 * release search by title and artist; the labels come back with the hits),
 * then Discogs (a release search; needs your token). What's found is kept in
 * label_lookups by the album's identity, so a library rebuild keeps it; a
 * miss is remembered for a month, and Force rescan asks about everything
 * again. The files' own tags always win: an album that gets a LABEL tag later
 * stops using what was looked up.
 */
const META = require("./meta");
const N = require("./library/normalize");
const { isLikelyNotALabel, labelKey } = require("./labels");

const DAY = 86400000;
const MISS_TTL = 30 * DAY;
const DISCOGS_BASE = "https://api.discogs.com";
const UA = "Mandarin/" + require("../package.json").version + " (+https://github.com/meltface-80/Mandarin)";

/* "Blue Note (2)" → "Blue Note": Discogs numbers labels that share a name. */
function plainName(s) { return String(s || "").replace(/\s*\(\d+\)\s*$/, "").trim(); }

class LabelLookup {
  constructor({ db, library, mb, log = () => {}, discogsBaseUrl, pauseMs }) {
    this.db = db; this.library = library; this.mb = mb; this.log = log;
    this.discogsBase = (discogsBaseUrl || DISCOGS_BASE).replace(/\/$/, "");
    this.pauseMs = pauseMs == null ? 1100 : pauseMs;
    this.state = { running: false, done: 0, total: 0, found: 0 };
    this.lines = [];
    this.lastRunAt = 0;
    this.q = {
      get: db.raw.prepare("SELECT * FROM label_lookups WHERE key = ?"),
      put: db.raw.prepare(`INSERT INTO label_lookups(key, label, source, looked_up_at) VALUES(?, ?, ?, ?)
                           ON CONFLICT(key) DO UPDATE SET label=excluded.label, source=excluded.source, looked_up_at=excluded.looked_up_at`),
      clear: db.raw.prepare("DELETE FROM label_lookups")
    };
  }

  note(line) {
    this.lines.push(new Date().toISOString().slice(11, 19) + " " + line);
    if (this.lines.length > 400) this.lines.shift();
    this.log("[labels] " + line);
  }
  discogsToken() { return String(this.db.setting("discogsToken", "") || ""); }

  /* The albums to ask about: no label of their own, and not asked (or missed) lately. */
  pending({ force = false } = {}) {
    const now = Date.now();
    return this.library.albums.filter(al => {
      if (al.labelSource === "tag" || al.labelSource === "folder") return false;
      if (force) return true;
      const r = this.q.get.get(al.key);
      if (!r) return true;
      if (r.label) return false;                              // found: kept
      return now - r.looked_up_at > MISS_TTL;                 // a miss: asked again after a month
    });
  }

  /* MusicBrainz: the labels on the best release of this title by this artist. */
  async fromMusicBrainz(al) {
    if (!this.mb) return null;
    const quote = s => String(s).replace(/["\\]/g, "\\$&");
    const parts = [`release:"${quote(al.title)}"`];
    if (al.artist && !al.compilation) parts.push(`artist:"${quote(al.artist)}"`);
    const j = await this.mb.get("release/", { query: parts.join(" AND "), limit: 10 });
    const want = N.fold(al.title);
    const wantArtist = N.fold(al.artist || "");
    const hits = ((j && j.releases) || []).filter(r => N.fold(r.title || "") === want && (Number(r.score) || 0) >= 80);
    const byArtist = hits.filter(r => !wantArtist || N.fold((r["artist-credit"] || []).map(c => c.name || (c.artist && c.artist.name) || "").join(" ")) === wantArtist);
    for (const r of (byArtist.length ? byArtist : hits)) {
      for (const li of r["label-info"] || []) {
        const name = li && li.label && li.label.name;
        if (name && !isLikelyNotALabel(name) && !/^\[no label\]$/i.test(name)) return name;
      }
    }
    return null;
  }

  /* Discogs: the first release matching title and artist, its first label. */
  async fromDiscogs(al) {
    const token = this.discogsToken();
    if (!token) return null;
    const qs = `type=release&release_title=${encodeURIComponent(al.title)}` + (al.artist && !al.compilation ? `&artist=${encodeURIComponent(al.artist)}` : "") + "&per_page=5";
    const j = await META.httpJson(`${this.discogsBase}/database/search?${qs}`, { "User-Agent": UA, Accept: "application/json", Authorization: "Discogs token=" + token }, 15000);
    for (const r of j.results || []) {
      const name = plainName((r.label || [])[0]);
      if (name && !isLikelyNotALabel(name) && !/^not on label$/i.test(name)) return name;
    }
    return null;
  }

  /* Ask about every pending album, one at a time. → true when a pass started. */
  run({ force = false } = {}) {
    if (this.state.running || !this.library.labelsOn()) return false;
    const todo = this.pending({ force });
    if (!todo.length) return false;
    this.state = { running: true, done: 0, total: todo.length, found: 0 };
    this.lastRunAt = Date.now();
    this.note(`lookups: ${todo.length} album(s) without a label tag; asking MusicBrainz` + (this.discogsToken() ? " then Discogs" : " (no Discogs token for the rest)"));
    (async () => {
      let errors = 0;
      for (const al of todo) {
        try {
          let label = await this.fromMusicBrainz(al), source = "musicbrainz";
          if (!label) { label = await this.fromDiscogs(al); source = "discogs"; }
          this.q.put.run(al.key, label || null, label ? source : null, Date.now());
          if (label) { this.state.found++; this.note(`${al.artist} — ${al.title}: ${label} (${source === "discogs" ? "Discogs" : "MusicBrainz"})`); }
          else this.note(`${al.artist} — ${al.title}: no label found`);
          errors = 0;
        } catch (e) {
          this.note(`${al.artist} — ${al.title}: ${e.message}`);
          if (/HTTP 429/.test(e.message)) await new Promise(r => setTimeout(r, 30000));
          if (++errors >= 5) { this.note("lookups: five errors in a row — stopping; the next rescan carries on"); break; }
        }
        this.state.done++;
        if (this.pauseMs) await new Promise(r => setTimeout(r, this.pauseMs));
      }
      this.note(`lookups: done, ${this.state.found} of ${this.state.total} found`);
      this.state.running = false;
      this.library.loadLabelLookups();
      if (this.onDone) this.onDone();
    })().catch(e => { this.note("lookups: " + e.message); this.state.running = false; });
    return true;
  }

  /* Force rescan: forget every answer and ask again. */
  forget() { this.q.clear.run(); this.library.loadLabelLookups(); }

  counts() {
    let found = 0, missed = 0;
    for (const r of this.db.raw.prepare("SELECT label FROM label_lookups").all()) { if (r.label) found++; else missed++; }
    return { found, missed };
  }
}

module.exports = { LabelLookup, plainName };
