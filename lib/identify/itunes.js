"use strict";
/*
 * itunes.js — Apple's catalogue as a second opinion for the identification
 * scan, for the albums MusicBrainz can't place.
 *
 * Apple's iTunes Search API needs no key and no account: an album search and
 * a lookup of one album's songs, each with its title and its length to the
 * millisecond — the same evidence the scan weighs from MusicBrainz. Apple
 * asks for no more than about twenty requests a minute from one address;
 * this keeps to one every 3.2 seconds, so each server stays well inside it
 * however many servers there are. A refusal (403 or 429) pauses iTunes for
 * a quarter of an hour; MusicBrainz carries on.
 *
 *   search({ title, artist })  → albums that could be the one
 *   album(id)                  → one album with its tracks and lengths
 *
 * Candidates come back in the shape lib/identify/musicbrainz.js gives, so the
 * scorer weighs them the same way. What Apple can't say, they leave out: no
 * release group (Apple has none) and no year — Apple's date is the edition's
 * on sale, often a remaster's, so the album keeps the year its tags carry.
 */
const META = require("../meta");
const pkg = require("../../package.json");

const DEFAULT_BASE = "https://itunes.apple.com";
const GAP_MS = 3200;
const PAUSE_MS = 15 * 60 * 1000;

// Apple's suffixes that aren't part of the name.
const FORMAT_TAIL = /\s+-\s+(?:Single|EP)\s*$/i;

class ITunes {
  constructor({ baseUrl, country, fetchJson, log = () => {}, gapMs, pauseMs } = {}) {
    this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this.country = String(country || process.env.ITUNES_COUNTRY || "US").toUpperCase();
    this.log = log;
    this.gapMs = gapMs != null ? gapMs : (this.baseUrl === DEFAULT_BASE ? GAP_MS : 0);
    // How long a refusal rests it: a quarter of an hour (ITUNES_PAUSE_MS for the tests).
    this.pauseMs = pauseMs != null ? pauseMs : (Number(process.env.ITUNES_PAUSE_MS) || PAUSE_MS);
    this.last = 0;
    this.pausedUntil = 0;
    this.requests = 0;
    this.fetchJson = fetchJson || (url => META.httpJson(url, {
      "User-Agent": `Mandarin/${pkg.version} ( https://github.com/meltface-80/Mandarin )`, Accept: "application/json"
    }, 15000));
  }

  /* Refusing for now (it said too many): don't ask. */
  get paused() { return Date.now() < this.pausedUntil; }

  async get(path, params) {
    if (this.paused) throw Object.assign(new Error("iTunes asked us to wait"), { paused: true });
    const wait = this.last + this.gapMs - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    this.last = Date.now();
    this.requests++;
    const qs = Object.entries(Object.assign({ country: this.country }, params))
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    try {
      return await this.fetchJson(`${this.baseUrl}/${path}?${qs}`);
    } catch (e) {
      if (/HTTP (403|429)/.test(e.message)) {
        this.pausedUntil = Date.now() + this.pauseMs;
        this.log("[identify] iTunes asked us to slow down; asking it again in a quarter of an hour");
        e.paused = true;
      }
      throw e;
    }
  }

  /* Albums that could be this one: by artist and title, or by title alone
   * when the artist tag can't be trusted. */
  async search({ title, artist, limit = 15 }) {
    const term = [artist, title].filter(Boolean).join(" ").trim();
    if (!term) return [];
    const j = await this.get("search", { term, media: "music", entity: "album", limit });
    return ((j && j.results) || []).filter(r => r.collectionId).map(r => ({
      id: String(r.collectionId), title: r.collectionName || "", artist: r.artistName || "",
      track_count: r.trackCount || 0
    }));
  }

  /* One album in full, as a candidate for the scorer — or null. */
  async album(id) {
    return this.albumFrom(await this.get("lookup", { id, entity: "song", limit: 200 }));
  }

  /* The album carrying this barcode (UPC/EAN), in full — v0.6.0-RC5. */
  async byUpc(upc) {
    const code = String(upc || "").replace(/\D/g, "");
    if (!code) return null;
    return this.albumFrom(await this.get("lookup", { upc: code, entity: "song", limit: 200 }));
  }

  albumFrom(j) {
    const rows = (j && j.results) || [];
    const col = rows.find(r => r.wrapperType === "collection");
    if (!col) return null;
    const songs = rows.filter(r => r.wrapperType === "track" && r.kind === "song")
      .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0));
    if (!songs.length) return null;
    const date = col.releaseDate ? String(col.releaseDate).slice(0, 10) : null;
    return {
      mbid: "itunes:" + col.collectionId,
      source: "itunes",
      group_mbid: null,
      title: String(col.collectionName || "").replace(FORMAT_TAIL, ""),
      artist: col.artistName || "",
      year: null,
      date: null,
      release_title: col.collectionName || "",
      release_year: null,
      release_date: date,
      edition: "",
      type: (FORMAT_TAIL.exec(col.collectionName || "") || [""])[0].replace(/[\s-]/g, "") || "Album",
      country: col.country || this.country,
      discs: Math.max(1, ...songs.map(s => s.discNumber || 1)),
      track_count: songs.length,
      tracks: songs.map((s, i) => ({
        disc: s.discNumber || 1, no: s.trackNumber || i + 1,
        title: s.trackName || "", artist: s.artistName || "",
        length: s.trackTimeMillis != null ? s.trackTimeMillis / 1000 : null
      }))
    };
  }
}

module.exports = { ITunes, DEFAULT_BASE, GAP_MS, PAUSE_MS };
