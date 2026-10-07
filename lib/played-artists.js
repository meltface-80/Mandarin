"use strict";
/*
 * played-artists.js — the acts you play, ranked: the seeds of Smart Picks and
 * of the share card's taste graph (lib/server/features.js).
 *
 * All that was still used of lib/newreleases.js (v0.7.9). The rest of that
 * module — a Deezer-based New Releases picker — was left behind when New
 * releases moved to Qobuz's and Tidal's own lists (lib/services), and no
 * longer ran anywhere.
 */

const SEED_ARTISTS = 40;   // acts ranked by default

/* Fold to letters, digits and single spaces: the same shape as
 * lib/similar.js's, kept here so this module's ranking cannot change from
 * somewhere else. */
function normalize(s) {
  return String(s == null ? "" : s).toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The acts to ask about, best first, from rows of the plays table.
 *
 * Each row is { artist, ts }. The ranking is DISTINCT DAYS PLAYED and not the
 * number of plays, with recency breaking ties. One long evening with one
 * record would otherwise own the entire seed list — forty plays in a night is
 * an evening, while eight plays on eight different days is a habit, and a
 * habit is what predicts wanting the next record.
 *
 * `split` is injected rather than imported so the credit rule stays in one
 * place: index.js passes lib/share-links.js's primaryArtist, which knows that
 * "Hall & Oates" is one act and "A feat. B" is two.
 */
function playedArtists(rows, opts) {
  opts = opts || {};
  const split = typeof opts.split === "function" ? opts.split : (s => s);
  const limit = Number.isFinite(opts.limit) ? opts.limit : SEED_ARTISTS;
  const seen = new Map();   // key -> { name, days:Set, last }
  for (const r of rows || []) {
    if (!r) continue;
    const name = String(split(r.artist || "") || "").trim();
    if (!name) continue;
    const key = normalize(name);
    // "Various Artists" is a compilation's filing, never an act. It reaches
    // this table whenever Roon reports it as the track artist.
    if (!key || key === "various artists" || key === "various" || key === "va") continue;
    const ts = Number(r.ts) || 0;
    let e = seen.get(key);
    if (!e) { e = { name, days: new Set(), last: 0 }; seen.set(key, e); }
    e.days.add(Math.floor(ts / 86400000));
    if (ts > e.last) e.last = ts;
  }
  return [...seen.values()]
    .map(e => ({ name: e.name, days: e.days.size, last: e.last }))
    .sort((a, b) => (b.days - a.days) || (b.last - a.last))
    .slice(0, Math.max(0, limit));
}

module.exports = { SEED_ARTISTS, normalize, playedArtists };
