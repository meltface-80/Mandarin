"use strict";
// ---------------------------------------------------------------------------
// What Random Album Radio has played, and the rule built on it (from Rouen,
// MusicD Remote v1.9.3): an album the radio played is not played BY THE RADIO
// again for six months.
//
// Asked for as "already played albums are skipped in random radio mode", and
// set as exactly that rule: played by the radio, not within the next six
// months. Albums only (the radio adds whole albums, and so their tracks with
// them) — not artists, and not albums you played yourself, which the radio's
// older "not heard in 60 days" preference already leans away from.
//
// Never a dead end. A library small enough for the radio to have played all of
// it inside six months gets the album whose radio play is OLDEST — a radio that
// falls silent because it has run out is worse than one that repeats.
//
// Pure: storage and the clock are handed in, so the suite drives it with both.
// lib/server/features.js keeps it in the database (radio_played).
// ---------------------------------------------------------------------------
const N = require("./library/normalize");

const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

/**
 * @param {object} o
 * @param {Function} o.load   () → { [albumKey]: ms } as last saved, or null
 * @param {Function} o.save   ({ [albumKey]: ms }) → void
 * @param {Function} [o.now]  ms clock
 * @param {number}   [o.windowMs] default six months
 */
function createRadioMemory(o) {
  const now = o.now || Date.now;
  const windowMs = o.windowMs || SIX_MONTHS_MS;
  const played = new Map();
  const saved = o.load ? o.load() : null;
  if (saved && typeof saved === "object") {
    for (const k of Object.keys(saved)) {
      const at = Number(saved[k]);
      if (k && Number.isFinite(at)) played.set(k, at);
    }
  }
  prune();

  // Entries past the window can never exclude anything again.
  function prune() {
    const cutoff = now() - windowMs;
    for (const [k, at] of played) if (at <= cutoff) played.delete(k);
  }
  function persist() {
    if (!o.save) return;
    const out = {};
    for (const [k, at] of played) out[k] = at;
    o.save(out);
  }

  /** When the radio last played this album, if inside the window; else null. */
  function playedAt(key) {
    if (!key) return null;
    const at = played.get(key);
    return at !== undefined && at > now() - windowMs ? at : null;
  }

  /** The radio has just played (or queued) this album. */
  function note(key) {
    if (!key) return;
    played.set(key, now());
    prune();
    persist();
  }

  /**
   * One album for the radio from `pool`.
   *   keyOf(al)   → the album's identity, as note() is given it
   *   heard(al)   → true when the user played it recently (the older, softer
   *                 preference: honoured when it can be, never a refusal)
   *   random()    → [0, 1)
   * Returns null only for an empty pool.
   */
  function pick(pool, keyOf, heard, random) {
    const rnd = random || Math.random;
    if (!Array.isArray(pool) || !pool.length) return null;
    const free = pool.filter(al => playedAt(keyOf(al)) === null);
    if (free.length) {
      const fresh = heard ? free.filter(al => !heard(al)) : free;
      const from = fresh.length ? fresh : free;
      return from[Math.floor(rnd() * from.length)];
    }
    // Everything has been the radio's within six months: the longest ago.
    let best = null, bestAt = Infinity;
    for (const al of pool) {
      const at = playedAt(keyOf(al));
      const t = at === null ? -Infinity : at;
      if (t < bestAt) { bestAt = t; best = al; }
    }
    return best;
  }

  return { playedAt, note, pick, size: () => played.size };
}

/**
 * An album's identity for the memory: its title and artist as the library
 * folds them, so a rescan (a new id) is the same album. A title or artist
 * the fold empties — a lone symbol, "÷" — falls back to the names as they
 * are, lower-cased: an empty key could never be remembered, and the rule
 * would quietly never apply to that album.
 */
function radioKey(al) {
  const title = String((al && al.title) || ""), artist = String((al && al.artist) || "");
  const t = N.fold(title), a = N.artistKey(artist);
  if (t && (a || !artist.trim())) return t + "|" + a;
  if (!title.trim() && !artist.trim()) return "";
  return "raw|" + title.trim().toLowerCase() + "|" + artist.trim().toLowerCase();
}

module.exports = { createRadioMemory, radioKey, SIX_MONTHS_MS };
