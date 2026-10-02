"use strict";
/*
 * musicbrainz.js — the two questions the identification scan asks MusicBrainz.
 *
 * No key: MusicBrainz's read API asks only for a User-Agent that names the
 * app and no more than one request a second. Both are kept here, and the
 * one-a-second wait is the same one lib/library/dates.js uses, so the two
 * never add up to two a second between them.
 *
 *   search({ title, artist, tracks })  → releases that could be the album
 *   release(mbid)                      → one release with its tracks and lengths
 *
 * The base URL can be pointed elsewhere (a fake in the tests); off
 * musicbrainz.org the wait between requests is dropped.
 */
const META = require("../meta");
const pkg = require("../../package.json");

const DEFAULT_BASE = "https://musicbrainz.org/ws/2";
const USER_AGENT = `Mandarin/${pkg.version} ( https://github.com/meltface-80/Mandarin )`;

/* Lucene's special characters escaped, so a title with a colon or a
 * bracket is searched for as text. */
function quote(s) {
  return String(s == null ? "" : s).replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, "\\$&");
}

/* "Artist A feat. B" from a release's artist credit, as MusicBrainz shows it. */
function creditName(credit) {
  return (credit || []).map(c => (c.name || (c.artist && c.artist.name) || "") + (c.joinphrase || "")).join("").trim();
}

/* A release as the scorer wants it: names, year and the tracks in order with
 * their lengths in seconds. Lengths MusicBrainz doesn't know are null. */
function candidateOf(rel) {
  const tracks = [];
  const media = (rel.media || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  media.forEach((m, mi) => {
    for (const t of (m.tracks || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0))) {
      const ms = t.length != null ? t.length : (t.recording && t.recording.length);
      tracks.push({
        disc: m.position || mi + 1,
        no: t.position || tracks.length + 1,
        title: t.title || (t.recording && t.recording.title) || "",
        artist: t["artist-credit"] ? creditName(t["artist-credit"]) : "",
        length: ms != null ? ms / 1000 : null
      });
    }
  });
  // Roon's model, in MusicBrainz's terms: the ALBUM is the release group
  // (its title, its first release date — the original's); the copy you have
  // is one RELEASE of it (this pressing's title, date, country, and what
  // sets it apart: "2015 remaster", "deluxe edition").
  const rg = rel["release-group"] || {};
  const first = rg["first-release-date"] || rel.date || "";
  const yearOf = d => (/^\d{4}/.test(d || "") ? Number(String(d).slice(0, 4)) : null);
  return {
    mbid: rel.id,
    group_mbid: rg.id || null,
    title: rg.title || rel.title || "",
    artist: creditName(rel["artist-credit"]),
    year: yearOf(first),
    date: first || null,
    release_title: rel.title || "",
    release_year: yearOf(rel.date),
    release_date: rel.date || null,
    edition: rel.disambiguation || "",
    type: [rg["primary-type"]].concat(rg["secondary-types"] || []).filter(Boolean).join(" + ") || null,
    country: rel.country || null,
    discs: media.length || null,
    track_count: tracks.length || rel["track-count"] || 0,
    tracks
  };
}

class MusicBrainz {
  constructor({ baseUrl, userAgent, fetchJson, log = () => {} } = {}) {
    this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this.userAgent = userAgent || USER_AGENT;
    this.log = log;
    this.requests = 0;
    this.fetchJson = fetchJson || (async (url) => {
      if (this.baseUrl === DEFAULT_BASE) await META.mbWait();
      return META.httpJson(url, { "User-Agent": this.userAgent, Accept: "application/json" }, 15000);
    });
  }

  async get(path, params) {
    const qs = Object.entries(Object.assign({ fmt: "json" }, params || {}))
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    this.requests++;
    return this.fetchJson(`${this.baseUrl}/${path}?${qs}`);
  }

  /* Releases with this title — and this artist, when the artist tag is worth
   * trusting; and this many tracks, if asked (the scan doesn't: a copy with a
   * track missing is still the record). The search's own track counts and
   * years come back, enough to pick which candidates are worth fetching in full. */
  async search({ title, artist, tracks, limit = 10 }) {
    const parts = [`release:"${quote(title)}"`];
    if (tracks) parts.push(`tracks:${Number(tracks)}`);
    if (artist) parts.push(`artist:"${quote(artist)}"`);
    const j = await this.get("release/", { query: parts.join(" AND "), limit });
    return ((j && j.releases) || []).map(r => ({
      mbid: r.id, title: r.title || "", artist: creditName(r["artist-credit"]),
      year: /^\d{4}/.test(r.date || "") ? Number(r.date.slice(0, 4)) : null,
      track_count: r["track-count"] || (r.media || []).reduce((n, m) => n + (m["track-count"] || 0), 0) || 0,
      score: Number(r.score) || 0
    }));
  }

  /* Releases carrying this barcode (a UPC or EAN off the sleeve): the surest
   * question there is, since a barcode names one pressing. */
  async byBarcode(code) {
    const digits = String(code || "").replace(/\D/g, "");
    if (!digits) return [];
    const j = await this.get("release/", { query: `barcode:${digits}`, limit: 10 });
    return ((j && j.releases) || []).map(r => ({
      mbid: r.id, title: r.title || "", artist: creditName(r["artist-credit"]),
      track_count: r["track-count"] || (r.media || []).reduce((n, m) => n + (m["track-count"] || 0), 0) || 0,
      score: Number(r.score) || 0
    }));
  }

  /* The releases in a release group (a MusicBrainz "album" link pasted in). */
  async groupReleases(mbid) {
    const j = await this.get(`release-group/${encodeURIComponent(mbid)}`, { inc: "releases+media" });
    return ((j && j.releases) || []).map(r => ({
      mbid: r.id, title: r.title || "",
      track_count: (r.media || []).reduce((n, m) => n + (m["track-count"] || 0), 0) || 0, score: 0
    }));
  }

  /* One release in full: every track with its title and length. */
  async release(mbid) {
    const j = await this.get(`release/${encodeURIComponent(mbid)}`, { inc: "recordings+artist-credits+release-groups" });
    return j && j.id ? candidateOf(j) : null;
  }
}

module.exports = { MusicBrainz, candidateOf, creditName, quote, USER_AGENT, DEFAULT_BASE };
