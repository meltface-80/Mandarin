"use strict";
/*
 * dates.js — the day each album came out, where its tags stop at the year.
 *
 * The Release date sort orders by the day (lib/library/index.js). File tags
 * often say only "2024", and a year alone sorts at the start of its year, so
 * an album tagged that way would sit below every album of that year that has
 * a day, whenever it came out. So albums known only to the year (or month)
 * are looked up on MusicBrainz, which states the first release day of almost
 * every album: newest year first, in the background after each scan.
 *
 * MusicBrainz asks for no more than a request a second, and that limit is on
 * REQUESTS, not albums: each request asks about [BATCH] albums at once, so a
 * library of a few thousand albums takes minutes, not an hour.
 *
 * Strict: a day is used only from a release group whose title and artist match
 * the album's and whose year IS the album's year — a remaster's or a reissue's
 * day never lands on the original. What's found (or not) is kept in the cache
 * table (ns "mbday", by album key), so it survives rescans and restarts; a miss
 * is asked about again after a month.
 *
 * Where MusicBrainz is can be said (MUSICBRAINZ_URL, a mirror; a fake in the
 * tests); off musicbrainz.org the wait between requests is dropped. Behind
 * Mandarin's C# server, the pass after a scan is made there (v0.8.20,
 * server/Mandarin.Server/Extras/ReleaseDays.cs); an album page's day "now"
 * stays here.
 */
const META = require("../meta");

const DEFAULT_BASE = "https://musicbrainz.org/ws/2";

const BATCH = 20;
const RETRY_MISS_MS = 30 * 86400000;

// "Album (Deluxe Edition)" and "Album [Remastered]" are the same album as "Album".
function baseTitle(s) {
  return META.normalize(String(s || "").replace(/\s*[([][^)\]]*[)\]]\s*$/, "")) || META.normalize(s);
}

function mbQuote(s) {
  return String(s).replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, "\\$&");
}

/* The query for a batch of albums: one clause per album, any of them matching. */
function queryFor(albums) {
  return albums.map(al => `(releasegroup:"${mbQuote(al.title)}" AND artist:"${mbQuote(al.artist)}")`).join(" OR ");
}

/*
 * Each album's day, from one search's release groups: the earliest first-
 * release date of a group matching the album, of the album's own year, more
 * precise than what the album has. null where nothing qualifies.
 */
function matchDays(albums, releaseGroups) {
  const out = new Map();
  for (const al of albums) {
    const t = baseTitle(al.title);
    const y = String(al.year);
    let best = null;
    for (const rg of releaseGroups || []) {
      const d = rg["first-release-date"] || "";
      if (!d.startsWith(y) || d.length <= String(al.date || y).length) continue;
      if (baseTitle(rg.title) !== t) continue;
      const credit = (rg["artist-credit"] || []).map(c => (c.name || (c.artist && c.artist.name) || "") + (c.joinphrase || "")).join("");
      if (!META.namesOverlap(credit, al.artist)) continue;
      if (!best || d < best || (d.slice(0, 7) === best.slice(0, 7) && d.length > best.length)) best = d;
    }
    out.set(al.key, best);
  }
  return out;
}

class ReleaseDays {
  constructor({ db, library, log = () => {}, fetchJson, baseUrl } = {}) {
    this.db = db;
    this.library = library;
    this.log = log;
    this.baseUrl = (baseUrl || DEFAULT_BASE).replace(/\/$/, "");
    this.fetchJson = fetchJson || (async (url) => {
      if (this.baseUrl === DEFAULT_BASE) await META.mbWait();
      return META.httpJson(url, { "User-Agent": META.MB_USER_AGENT }, 10000);
    });
    this.running = null;
    this.stopped = false;
    this.handedOver = false;
  }

  /* Made by the C# server from now on (v0.8.20): no pass here again; the one running ends after its batch. */
  handOver() {
    this.handedOver = true;
    this.stopped = true;
    return (this.running || Promise.resolve(0)).catch(() => 0);
  }

  /* Albums still wanting a day: known to a year, not to the day, not asked about lately. */
  wanting() {
    const out = [];
    for (const al of this.library.albums) {
      if (!al.year || (al.date && al.date.length >= 10)) continue;
      const hit = this.db.cacheGet("mbday", al.key);
      if (hit && hit.date) continue;                                    // found before (and of another year's)
      if (hit !== undefined && this.db.cacheGet("mbday", al.key, RETRY_MISS_MS) !== undefined) continue;
      out.push(al);
    }
    return out.sort((a, b) => b.year - a.year);
  }

  /* Ask about a batch of albums; keeps and applies what's found. */
  async lookup(albums) {
    const url = this.baseUrl + "/release-group/?query=" +
      encodeURIComponent(queryFor(albums)) + "&fmt=json&limit=100";
    const j = await this.fetchJson(url);
    const days = matchDays(albums, j && j["release-groups"]);
    let found = 0;
    for (const al of albums) {
      const day = days.get(al.key) || null;
      this.db.cachePut("mbday", al.key, { date: day });
      if (day) { this.library.setLookedUpDay(al.key, day); found++; }
    }
    return found;
  }

  /* The background pass: every album wanting a day, a batch at a time. One at a time. */
  run() {
    if (this.handedOver) return Promise.resolve(0);
    if (this.running) return this.running;
    this.running = (async () => {
      const list = this.wanting();
      if (!list.length) return 0;
      let found = 0, failures = 0;
      for (let i = 0; i < list.length && !this.stopped; i += BATCH) {
        try {
          found += await this.lookup(list.slice(i, i + BATCH));
          failures = 0;
        } catch (e) {
          // MusicBrainz down or unreachable: try again after the next scan.
          if (++failures >= 3) { this.log(`[dates] MusicBrainz isn't answering (${e.message}); trying again later`); break; }
        }
      }
      if (found) this.log(`[dates] found the release day of ${found} album(s) on MusicBrainz`);
      return found;
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /*
   * An album being opened: its day now if it can be had quickly (the album page
   * shows it), else whenever the lookup ends. Resolves true when found in time.
   */
  async now(al, waitMs = 1500) {
    if (!al || !al.year || (al.date && al.date.length >= 10)) return false;
    if (this.db.cacheGet("mbday", al.key) !== undefined) return false;
    const job = this.lookup([al]).catch(() => 0);
    const timer = new Promise(r => { const t = setTimeout(() => r(0), waitMs); if (t.unref) t.unref(); });
    return (await Promise.race([job, timer])) > 0;
  }

  stop() { this.stopped = true; }
}

module.exports = { ReleaseDays, matchDays, queryFor, baseTitle, BATCH };
