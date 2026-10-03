"use strict";
/*
 * names.js — what the folders and file names say about a track whose tags
 * don't (v0.6.0-RC10). An untagged rip filed as
 *
 *   808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac
 *   808 State/ESP_ The 808 State Effect (2021)/1-01 - Pacific State.flac
 *   808 State - Ninety (1989)/Disc 2/03 - Ancodia.flac
 *
 * is read as artist 808 State, album 10x10, year 1993, track 1 "10x10 (Radio
 * Mix)", and so on, instead of "Unknown Artist" and an album named after the
 * whole folder. Only what the tags leave empty is taken from the names, and
 * the track remembers which fields those were. Nothing is written to the
 * files: the names live in the database, and the identification scan can then
 * look the album up by them.
 */
const path = require("path");

// "CD1", "Disc 2", "DISC 1", "cd 2", "Side 1": one album split across folders.
const DISC_DIR = /^(cd|disc|disk|side)\s*[-_.]?\s*(\d+)\b/i;
// Folders that hold artists rather than being one, never taken for an artist's name.
const NOT_ARTIST = /^(music|my ?music|music library|library|flac|mp3|hi-?res|lossless|albums?|artists?|downloads?|media|audio|rips?|cds?|vinyl|various|compilations?|soundtracks?|\d+ ?[tg]b|[a-z]:?)$/i;
const fold = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

function isInside(p, dir) {
  return p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

/* "Album (1993)", "Album [1993]", "1993 - Album": the album and its year. */
function albumAndYear(name) {
  let album = String(name || "").trim(), year = null;
  let m = /\s*[([](\d{4})[)\]]\s*$/.exec(album);
  if (m) { year = Number(m[1]); album = album.slice(0, m.index).trim(); }
  else if ((m = /^[([]?(\d{4})[)\]]?\s*[-–.]\s+(.+)$/.exec(album))) { year = Number(m[1]); album = m[2].trim(); }
  if (year && (year < 1900 || year > 2100)) year = null;
  return { album, year };
}

/*
 * What the names say: { artist, album, year, disc, track, title }, each null
 * where they say nothing. roots: the music folders, never read as an artist.
 */
function fromNames(file, roots = []) {
  let dir = path.dirname(file);
  let disc = null;
  const dm = DISC_DIR.exec(path.basename(dir));
  if (dm) { disc = Number(dm[2]); dir = path.dirname(dir); }
  const isRoot = d => roots.some(r => path.resolve(r) === path.resolve(d)) || path.dirname(d) === d;
  const inRoot = !roots.length || roots.some(r => isInside(path.resolve(dir), path.resolve(r)));
  let { album, year } = isRoot(dir) ? { album: null, year: null } : albumAndYear(path.basename(dir));
  const parent = path.dirname(dir);
  let artist = !isRoot(dir) && inRoot && !isRoot(parent) && !NOT_ARTIST.test(path.basename(parent)) ? path.basename(parent) : null;
  // "Artist - Album" as the album's folder: when the parent isn't the artist
  // already, or says the same name.
  if (album) {
    const m = /^(.+?)\s+[-–]\s+(.+)$/.exec(album);
    if (m && (!artist || fold(m[1]) === fold(artist))) {
      artist = m[1].trim();
      ({ album, year } = (() => { const r = albumAndYear(m[2]); return { album: r.album, year: r.year || year }; })());
    }
  }
  // The file: "1-01 - Title", "01 - Title", "01. Title", "01 Title"; an
  // "Artist - " in front of the title is the artist again, not the title.
  const base = path.basename(file, path.extname(file));
  const fm = /^(?:(\d{1,2})[-.](\d{1,3})|(\d{1,3}))(?:\s*[-._]\s*|\s+)(.+)$/.exec(base);
  let title = fm ? fm[4].trim() : base.trim();
  if (artist) {
    const lead = new RegExp("^" + artist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+[-–]\\s+", "i");
    title = title.replace(lead, "");
  }
  return {
    artist: artist || null,
    album: album || null,
    year,
    disc: disc || (fm && fm[1] ? Number(fm[1]) : null),
    track: fm ? Number(fm[2] || fm[3]) : null,
    title: title || null
  };
}

/*
 * A track's tags with what they lack filled from the names. tagged says what
 * the file itself carried (readTags). Returns the fields filled, by name.
 */
function fill(row, file, roots, tagged) {
  const n = fromNames(file, roots);
  const from = [];
  if (!tagged.artist && n.artist) { row.artist = n.artist; row.album_artist = n.artist; from.push("artist"); }
  if (!tagged.album && n.album) { row.album = n.album; from.push("album"); }
  if (!tagged.title && n.title) { row.title = n.title; from.push("title"); }
  if (!tagged.track && n.track) { row.track_no = n.track; from.push("track"); }
  if (!tagged.disc && n.disc) { row.disc_no = n.disc; from.push("disc"); }
  if (!tagged.year && n.year) { row.year = n.year; row.date = row.date || String(n.year); from.push("year"); }
  row.names_from = from.length ? from.join(",") : null;
  return from;
}

module.exports = { fromNames, fill, albumAndYear, DISC_DIR, NOT_ARTIST };
