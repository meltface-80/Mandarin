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
 * What counts most, in order (v0.6.3, tried against a real library's
 * accepted, matched-by-hand and waiting albums before it went in): the
 * track count and the lengths, then the track names — with what's in
 * brackets set aside ("Live For (Album Version (Explicit))" is "Live For"),
 * and a track the same length in the same place taken as the same track
 * whatever it's called — then the album's name and artist, and the year
 * least (a 2006 collection of 1955 recordings is still that record). A
 * release MusicBrainz labels live, remix, demo… costs a little when nothing
 * of yours (the title, the folders, the tags) says so.
 *
 * The artist is not counted when the tag is a value that can't be trusted
 * ("Various Artists", "Unknown", blank, the album's own title): that is the
 * case the scan exists for.
 *
 *   ≥ 95 % alike (as the page shows it) applied without asking (v0.6.2;
 *              it was 96 %), whichever service found it
 *   ≤ PROPOSE  proposed, one tap to accept
 *   above      unidentified, for you to match by hand
 */
const N = require("../library/normalize");

const WEIGHTS = {
  album: 2, artist: 2, year: 0.5,
  track_title: 2, track_length: 3,
  missing_track: 0.9, unmatched_track: 0.6, note: 0.5,
  // A copy that is the whole of itself on a bigger pressing (every track
  // there, to the name and the second): one edition difference, not a
  // penalty a track (v0.7.2).
  edition: 1.5
};
// What sets a recording apart (disambiguation): "live", "remix"…, each
// spelling to one word.
const MARKS = /\b(live|remix(?:ed|es)?|re-?mix|demos?|instrumentals?|karaoke|acoustic|unplugged)\b/g;
const markOf = w => w.replace(/-/g, "").replace(/(?:ed|es|s)$/, "").replace(/^remix.*/, "remix");
const LENGTH_GRACE = 15;   // seconds off that cost nothing
const LENGTH_MAX = 30;     // seconds beyond the grace that cost everything
// Applied unasked from 95 % alike, as the page rounds it: a distance under
// 0.055 (v0.6.2; it was 0.04, 96 %). APPLY is that boundary as a distance.
const APPLY_PERCENT = 95;
const similarity = d => Math.round((1 - d) * 100);
const APPLY = 1 - (APPLY_PERCENT - 0.5) / 100;
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

/*
 * A name folded for comparing (v0.6.3): case, accents and punctuation as
 * always ("Kiddin'" is "Kiddin", "&" is "and"), and the spellings a tag and
 * a release write differently: "+" and "'n'" are "and", and a dropped g is
 * the same word ("Kickin'", "Kickin" and "Kicking" meet). For scoring only;
 * what an album is in the library is decided by normalize.js as before.
 */
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18, xix: 19, xx: 20 };
const ABBR = { pt: "part", vol: "volume", no: "number", nr: "number", st: "saint", mr: "mister", dr: "doctor", vs: "versus", v: "versus" };
const COUNTED = new Set(["part", "volume", "number", "chapter", "act", "book", "movement", "op", "opus", "disc", "side", "symphony", "suite"]);
function cmp(s) {
  const words = N.fold(String(s == null ? "" : s).replace(/\+/g, " and "))
    .replace(/(^| )n(?= |$)/g, "$1and")
    .replace(/(\p{L}{2,})ing(?![\p{L}\p{N}])/gu, "$1in")
    .split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (ABBR[words[i]] && (words[i] !== "v" || i > 0) && (words[i] !== "no" || /^\d|^[ivx]+$/.test(words[i + 1] || ""))) words[i] = ABBR[words[i]];
    // A Roman numeral after "Part", "Vol."…, or ending a title of several words: a number.
    if (ROMAN[words[i]] && (COUNTED.has(words[i - 1]) || (i === words.length - 1 && i > 0 && words[i].length > 1))) words[i] = String(ROMAN[words[i]]);
  }
  return words.join(" ");
}
/* The name without anything in brackets or after a " - " or a slash: the song itself. */
function core(s) {
  return cmp(String(s || "").replace(/\s*[([][^)\]]*[)\]]/g, " ").replace(/\s+[-–—]\s+.*$/, " "));
}

// Spaces are not a difference (v0.7.2): "LateNightTales" is "Late Night Tales".
const nospace = s => String(s || "").replace(/ /g, "");
/* 0..1: how unlike two names are, after folding (cmp). */
function stringDist(a, b) {
  const x = cmp(a), y = cmp(b);
  if (x === y || nospace(x) === nospace(y)) return 0;
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

// "CD2", "Disc 2", "(Disk 02)" at the end of an album's title: which disc of
// a set the folder is, not part of the name (v0.7.2).
const DISC_TAIL = /[\s\-–—(:,]*\b(?:cd|disc|disk)\s*0?\d{1,2}\b\s*\)?\s*$/i;
const DISC_MARK = /\b(?:cd|disc|disk)\s*0?(\d{1,2})\b/i;
/* The disc a title or a folder names ("CD2", "Disc 2"), or null. */
function discOf(s) {
  const m = DISC_MARK.exec(String(s || ""));
  return m ? Number(m[1]) : null;
}
/* The name alone, for comparing. */
function bare(s) {
  return stripTail(tidy(s), x => EDITION_WORD.test(x) || CREDIT.test(x)).replace(FEAT, "").replace(DISC_TAIL, "").trim();
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
  if (cmp(a) === cmp(b) || nospace(cmp(a)) === nospace(cmp(b))) return 0;
  const strip = s => bare(String(s || "").replace(/^\s*\d{1,2}[.\-\s]+(?=\S)/, ""));
  const x = strip(a), y = strip(b);
  if (cmp(x) === cmp(y) || nospace(cmp(x)) === nospace(cmp(y))) return 0.05;
  // The same song once what's in brackets is set aside ("Live For (Album
  // Version (Explicit))", "Little Rio (Un poco Rio)"), or one name the
  // other's part ("Kill Time" / "Pipeline/Kill Time").
  const cx = core(a), cy = core(b);
  if (cx && cx === cy) return 0.1;
  const parts = t => String(t || "").split(/\s*\/\s*/).map(core).filter(Boolean);
  if (cx && cy && (parts(b).includes(cx) || parts(a).includes(cy))) return 0.15;
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
  // Disambiguation (v0.6.3): a release MusicBrainz sets apart as live, a
  // remix, a demo… when nothing of yours — the title, the folders, the box
  // set, the tags — says so. Only the release's own notes are read, not its
  // type, so a live album isn't charged for being one.
  // Both ways: a folder that says "Remixes" prefers the release that says
  // remix to the one that doesn't.
  const marksIn = t => new Set((String(t || "").toLowerCase().match(MARKS) || []).map(markOf));
  const theirsMarks = marksIn([cand.edition, cand.group_note, cand.title, cand.release_title].join(" "));
  const ours = marksIn([album.title, album.context].join(" "));
  add("note", WEIGHTS.note, [...theirsMarks].some(m => !ours.has(m)) || [...ours].some(m => !theirsMarks.has(m)) ? 1 : 0);

  // Tracks are paired by likeness, not by number: a copy missing track 3
  // still has tracks 4 to 11 exactly. A track on the release that isn't in
  // the copy costs a little (beets' missing_tracks, 0.9), one in the copy
  // the release hasn't a little less (unmatched_tracks, 0.6) — a bonus
  // track or a dropped one is not another record.
  const mine = album.tracks || [];
  let theirs = cand.tracks || [];
  // A folder that is one disc of a set ("CD2") is scored against that disc
  // of the release alone (v0.7.2); the other discs are not missing from it.
  const disc = discOf(album.title) || discOf(album.context);
  if (disc && new Set(theirs.map(t => t.disc)).size > 1 && theirs.some(t => t.disc === disc)) {
    theirs = theirs.filter(t => t.disc === disc);
    parts.disc = disc;
  }
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
  // The whole of the copy on the release, to the name and the second, and
  // the release has more: a bigger pressing of the same record (v0.7.2). One
  // edition difference, whatever the number of bonus tracks — not a penalty
  // a track that would put a ten-track original on a twenty-track
  // anniversary pressing out of reach.
  const whole = n > 0 && n === mine.length && !noLengths && cost.every(c => c && c.title <= 0.05 && c.length === 0);
  parts.edition = !!(missing && whole);
  if (parts.edition) { sum += WEIGHTS.edition; weight += WEIGHTS.edition; }
  else { sum += WEIGHTS.missing_track * missing; weight += WEIGHTS.missing_track * missing; }
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
    // The same length to a few seconds in the same place is the same track
    // whatever it's called (lengths first, v0.6.3).
    if ((best == null || !(bestC < UNPAIRED || bestParts.title <= 0.15)) && !used.has(i) && theirs[i] &&
        m.length != null && theirs[i].length != null && Math.abs(m.length - theirs[i].length) <= 3) {
      best = i; bestParts = { title: titleDist(m.title, theirs[i].title), length: 0 }; bestC = 0;
    }
    if (best != null && (bestC < UNPAIRED || bestParts.title <= 0.15)) { used.add(best); after = best; pairs.push(best); cost.push(bestParts); }
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
  let status;
  if (best.distance > PROPOSE) status = "unidentified";
  else if (appliesUnasked(best)) status = "applied";
  else status = "proposed";
  return { status, best, scored, ambiguous: !!rival };
}

/*
 * Whether a scored match is applied without asking: 95 % alike or better,
 * as the page shows it — nothing else (v0.6.3). Two different records as
 * close, or a release MusicBrainz has without track lengths, are applied
 * like any other; you put right the odd wrong one by hand (Undo, or the
 * album editor). Also asked of a proposal already waiting, from what was
 * kept of it (identifier.applyWaiting).
 */
function appliesUnasked(s) {
  return !!s && s.distance != null && similarity(s.distance) >= APPLY_PERCENT;
}

/*
 * Why a match is short of 100 %, in words for the page (v0.6.3): what of the
 * score was lost, largest kinds first. Missing and extra tracks the page says
 * already. year: the album's own year, to name it.
 */
function why(parts, { year } = {}) {
  const p = parts || {};
  const out = [];
  if (p.track_lengths > 0) out.push("track lengths differ");
  if (p.track_titles > 0.05) out.push("track names differ");
  if (p.album > 0.05) out.push("the title differs");
  if (p.artist > 0) out.push("the artist is spelt differently");
  if (p.year === 1) out.push("the year differs" + (year ? " (" + year + " here)" : ""));
  if (p.note === 1) out.push("MusicBrainz marks it as another version");
  if (p.no_lengths) out.push("MusicBrainz has no track lengths");
  if (p.edition) out.push("a bigger pressing of the same record");
  if (!out.length && (p.album > 0 || p.track_titles > 0)) out.push("edition notes in the names");
  return out;
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

module.exports = { why, cmp, exact, discOf, appliesUnasked, similarity, APPLY_PERCENT, distance, decide, pairTracks, tidy, titleDist, stringDist, lengthDist, artistSuspect, levenshtein, bare, clean, editionYear, WEIGHTS, APPLY, PROPOSE, AMBIGUOUS };
