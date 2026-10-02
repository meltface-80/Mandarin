"use strict";
/*
 * score.js — how far a MusicBrainz release is from an album in the library.
 *
 * beets' distance, ported (docs/specs/album-identification.md §4): a weighted
 * sum over the album's title and artist, its year, its track count, and each
 * track's title and length, divided by the weights, so 0 is identical and 1
 * is nothing alike. Lengths carry the identification — twelve tracks that
 * match to the second are that release whatever the tags say — so they get no
 * penalty within 15 s and the full one at 45 s off.
 *
 * The artist is not counted when the tag is a value that can't be trusted
 * ("Various Artists", "Unknown", blank, the album's own title): that is the
 * case the scan exists for.
 *
 *   ≤ APPLY    applied without asking (≥ 96 % alike — the 95 % asked for)
 *   ≤ PROPOSE  proposed, one tap to accept
 *   above      unidentified, for you to match by hand
 */
const N = require("../library/normalize");

const WEIGHTS = {
  album: 3, artist: 3, year: 1,
  track_title: 3, track_length: 2,
  missing_track: 0.9, unmatched_track: 0.6
};
const LENGTH_GRACE = 15;   // seconds off that cost nothing
const LENGTH_MAX = 30;     // seconds beyond the grace that cost everything
const APPLY = 0.04;
const PROPOSE = 0.15;
const AMBIGUOUS = 0.02;    // two candidates this close, saying different things: neither is applied

const SUSPECT = new Set(["", "various artists", "various", "va", "v a", "unknown", "unknown artist", "artist", "compilation", "soundtrack", "original soundtrack"]);

/* An artist tag not worth scoring against. */
function artistSuspect(artist, title) {
  const a = N.fold(tidy(artist));
  return SUSPECT.has(a) || (!!a && a === N.fold(title));
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/* 0..1: how unlike two names are, after folding case, accents and punctuation. */
function stringDist(a, b) {
  const x = N.fold(a), y = N.fold(b);
  if (x === y) return 0;
  const n = Math.max(x.length, y.length);
  return n ? levenshtein(x, y) / n : 0;
}

// Edition noise: what a tag or a release puts after the name and the other
// doesn't — "(2015 Remaster)", "[Remastered]", "- 2009 Remastered Version",
// "(Deluxe Edition)", "(feat. B)". The album is the album whatever its
// pressing (Roon's model: the version is a fact about the copy, not part of
// the name), so all of it is set aside before names are compared, and the
// remaster part is set aside before a name is written.
const EDITION_WORD = /\b(?:remaster(?:ed|ing)?|deluxe|edition|expanded|anniversary|bonus|reissue|re-?issue|version|mono|stereo|explicit|clean|digital|special|limited|collector'?s?|super|legacy|redux|remix(?:ed)?|mix)\b|\b(?:19|20)\d{2}\b/i;
const PAREN = /\s*[([][^)\]]*[)\]]\s*$/;
const DASH = /\s+[-–—]\s+([^-–—]*)$/;
const FEAT = /\s+(?:feat|featuring|ft)\.?\s+.*$/i;
const CREDIT = /^\s*[([]\s*(?:feat|featuring|ft|with|live|demo|edit)\b/i;
const REMASTER = /\b(?:remaster(?:ed|ing)?|reissue|re-?issue)\b/i;
function stripTail(s, test) {
  let t = String(s || "");
  for (let i = 0; i < 3; i++) {
    const p = PAREN.exec(t);
    if (p && test(p[0])) { t = t.slice(0, p.index); continue; }
    const d = DASH.exec(t);
    if (d && test(d[1])) { t = t.slice(0, d.index); continue; }
    break;
  }
  return t.trim();
}
// A ripper's template with nothing to fill it: "null: Line Up (null)",
// "Line Up - undefined", "(Unknown)". Not part of any name.
const NOTHING = "(?:null|undefined|nan|none|unknown|n\\/a)";
const JUNK = [
  new RegExp(`^\\s*${NOTHING}\\s*[:\\-–—]\\s*`, "i"),               // "null: …"
  new RegExp(`\\s*[([]\\s*${NOTHING}\\s*[)\\]]\\s*`, "gi"),          // "… (null)"
  new RegExp(`\\s*[-–—:]\\s*${NOTHING}\\s*$`, "i"),                   // "… - null"
  new RegExp(`^\\s*${NOTHING}\\s*$`, "i")                            // "null"
];
function tidy(s) {
  let t = String(s || "");
  for (const re of JUNK) t = t.replace(re, " ");
  return t.replace(/\s+/g, " ").trim();
}

/* The name alone, for comparing. */
function bare(s) {
  return stripTail(tidy(s), x => EDITION_WORD.test(x) || CREDIT.test(x)).replace(FEAT, "").trim();
}
/* The name as it should be written: only the remaster/reissue tail goes
 * ("(Live)", "(Deluxe Edition)" and a featured artist stay, they are part of
 * what the record is called). */
function clean(s) {
  return stripTail(s, x => REMASTER.test(x)) || String(s || "").trim();
}
/* A year named in an edition tail ("2015 Remaster"): the version's, not the record's. */
function editionYear(s) {
  const m = /\b((?:19|20)\d{2})\b(?=[^()[\]]*(?:remaster|edition|version|reissue|anniversary|mix))/i.exec(String(s || ""));
  return m ? Number(m[1]) : null;
}

/* Titles: identical after folding is 0; identical once the noise is off is
 * nearly so; otherwise the edit distance of the bare titles. A leading track
 * number ("03 Song") in a tag is dropped too. */
function titleDist(a, b) {
  a = tidy(a); b = tidy(b);
  if (N.fold(a) === N.fold(b)) return 0;
  const strip = s => bare(String(s || "").replace(/^\s*\d{1,2}[.\-\s]+(?=\S)/, ""));
  const x = strip(a), y = strip(b);
  if (N.fold(x) === N.fold(y)) return 0.05;
  return Math.min(1, stringDist(x, y) + 0.05);
}

function lengthDist(a, b) {
  if (a == null || b == null) return 0.5;                 // one side unknown: half a penalty
  const off = Math.abs(a - b);
  if (off <= LENGTH_GRACE) return 0;
  return Math.min(1, (off - LENGTH_GRACE) / LENGTH_MAX);
}

/*
 * The distance between an album — { title, artist, year, tracks: [{ title,
 * length }] } — and a candidate from lib/identify/musicbrainz.js. Also the
 * parts, so the page can say why.
 */
function distance(album, cand) {
  const parts = {};
  let sum = 0, weight = 0;
  const add = (name, w, d) => { parts[name] = d; sum += w * d; weight += w; };

  // The album's name is its group's (Roon's "album"), but a tag may carry the
  // release's own title instead; whichever is nearer counts.
  add("album", WEIGHTS.album, Math.min(titleDist(album.title, cand.title), cand.release_title ? titleDist(album.title, cand.release_title) : 1));
  if (!artistSuspect(album.artist, album.title)) add("artist", WEIGHTS.artist, stringDist(album.artist, cand.artist));
  else parts.artist = null;
  // A tag's year may be the original's (1988) or the pressing's (2015): both
  // are right. So is a year the title itself names ("2015 Remaster").
  const years = new Set([cand.year, cand.release_year, editionYear(album.title)].filter(Boolean));
  add("year", WEIGHTS.year, album.year && years.size && !years.has(album.year) ? 1 : 0);

  // Tracks are paired by likeness, not by number: a copy missing track 3
  // still has tracks 4 to 11 exactly. A track on the release that isn't in
  // the copy costs a little (beets' missing_tracks, 0.9), one in the copy
  // the release hasn't a little less (unmatched_tracks, 0.6) — a bonus
  // track or a dropped one is not another record.
  const mine = album.tracks || [], theirs = cand.tracks || [];
  const { pairs, cost } = pairTracks(mine, theirs);
  // A release MusicBrainz has without any lengths (older entries, no disc id)
  // is scored on its names and count alone: half a penalty a track for what
  // nobody knows would put it out of reach however exactly the titles match.
  // decide() applies such a match only when every title and the count agree.
  const noLengths = theirs.length > 0 && theirs.every(t => t.length == null);
  const lengthW = noLengths ? 0 : WEIGHTS.track_length;
  let titles = 0, lengths = 0, n = 0;
  pairs.forEach((j, i) => {
    if (j == null) { sum += WEIGHTS.unmatched_track; weight += WEIGHTS.unmatched_track; return; }
    n++; titles += cost[i].title; lengths += cost[i].length;
    sum += WEIGHTS.track_title * cost[i].title + lengthW * cost[i].length;
    weight += WEIGHTS.track_title + lengthW;
  });
  const missing = theirs.length - n;
  sum += WEIGHTS.missing_track * missing; weight += WEIGHTS.missing_track * missing;
  parts.track_titles = n ? titles / n : 1;
  parts.track_lengths = noLengths ? null : (n ? lengths / n : 1);
  parts.no_lengths = noLengths;
  parts.missing_tracks = missing;
  parts.extra_tracks = mine.length - n;
  return { distance: weight ? sum / weight : 1, parts, pairs };
}

/*
 * Which of the release's tracks each of the copy's tracks is: the nearest
 * by title and length, in order, each used once. A track with nothing near
 * enough is left unpaired (null) — costlier to pair badly than to admit it.
 */
function pairTracks(mine, theirs) {
  const used = new Set();
  const pairs = [], cost = [];
  const UNPAIRED = WEIGHTS.unmatched_track + WEIGHTS.missing_track;
  let after = -1;
  mine.forEach((m, i) => {
    let best = null, bestC = Infinity, bestParts = null;
    theirs.forEach((t, j) => {
      if (used.has(j)) return;
      const td = titleDist(m.title, t.title), ld = lengthDist(m.length, t.length);
      // The same names in the same order pair in order (twelve "Untitled"s).
      const c = WEIGHTS.track_title * td + WEIGHTS.track_length * ld + (j > after ? j - after - 1 : theirs.length) * 0.001;
      if (c < bestC) { bestC = c; best = j; bestParts = { title: td, length: ld }; }
    });
    // The same name is the same track however far the lengths are (a radio
    // edit against the album cut still pairs, and is charged for the length).
    if (best != null && (bestC < UNPAIRED || bestParts.title <= 0.05)) { used.add(best); after = best; pairs.push(best); cost.push(bestParts); }
    else { pairs.push(null); cost.push(null); }
  });
  return { pairs, cost };
}

/*
 * The candidates scored and sorted, and the verdict: which one, and whether
 * it is applied, proposed, or nothing. A close second that says something
 * different (another artist or title, other names for the tracks you have)
 * makes the match ambiguous: proposed at best, never applied.
 *
 * Another pressing of the same record is not a rival: two releases of one
 * release group, or two that would write the same artist, title and track
 * names over your copy, are the same answer (the version is a fact about
 * the copy, not a different album — Roon's model). Between equals the one
 * with lengths known wins, then the earlier.
 */
function decide(album, candidates) {
  const hasLengths = s => (s.parts.no_lengths ? 0 : 1);
  const date = s => s.candidate.release_date || s.candidate.date || "9999";
  const scored = candidates.map(c => Object.assign({ candidate: c }, distance(album, c)))
    .sort((a, b) => a.distance - b.distance || hasLengths(b) - hasLengths(a) || (date(a) < date(b) ? -1 : date(a) > date(b) ? 1 : 0));
  if (!scored.length) return { status: "unidentified", best: null, scored };
  const best = scored[0];
  const same = (a, b) => {
    if (a.candidate.group_mbid && a.candidate.group_mbid === b.candidate.group_mbid) return true;
    if (N.fold(a.candidate.artist) !== N.fold(b.candidate.artist) || N.fold(a.candidate.title) !== N.fold(b.candidate.title)) return false;
    // The names each would give your tracks (a bonus track one has and the other hasn't is not a difference).
    const name = (s, i) => { const j = s.pairs[i]; return j == null ? "" : N.fold((s.candidate.tracks[j] || {}).title || ""); };
    return (album.tracks || []).every((t, i) => name(a, i) === name(b, i));
  };
  const rival = scored.slice(1).find(s => s.distance - best.distance < AMBIGUOUS && !same(s, best));
  // Without lengths, only an exact fit is applied unasked.
  const sure = !best.parts.no_lengths || (best.parts.track_titles === 0 && !best.parts.missing_tracks && !best.parts.extra_tracks);
  let status;
  if (best.distance > PROPOSE) status = "unidentified";
  else if (best.distance <= APPLY && !rival && sure) status = "applied";
  else status = "proposed";
  return { status, best, scored, ambiguous: !!rival };
}

/*
 * A fit with nothing left to doubt: every track of the copy on the release
 * and every track of the release in the copy, each length within the grace,
 * the album's name and every track's name the same once edition noise is
 * set aside. What a second source (iTunes) needs before it's applied unasked.
 */
function exact(s) {
  const p = s && s.parts;
  if (!p || p.no_lengths) return false;
  return !p.missing_tracks && !p.extra_tracks && p.track_lengths === 0 &&
    p.album <= 0.05 && p.track_titles <= 0.05;
}

module.exports = { exact, distance, decide, pairTracks, tidy, titleDist, stringDist, lengthDist, artistSuspect, levenshtein, bare, clean, editionYear, WEIGHTS, APPLY, PROPOSE, AMBIGUOUS };
