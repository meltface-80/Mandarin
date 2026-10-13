"use strict";
/*
 * tag-oracle.js — a file's tags as the Node server's scanner read them
 * (lib/library/scanner.js readTags over music-metadata 11.16.0, kept here when
 * it went in v0.8.50): the reference the C# reader (server/Mandarin.Server/
 * Tags/, `mandarin-server tags`) is held to, file for file, in
 * test/tags-front.test.js. music-metadata is a test dependency only now.
 */
const path = require("path");

let mmPromise = null;
function mm() {
  if (!mmPromise) mmPromise = import("music-metadata");
  return mmPromise;
}

function yearOf(v) {
  const m = String(v == null ? "" : v).match(/(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return y > 1000 && y < 3000 ? y : null;
}

/*
 * A date tag as precisely as it states it: "2024-03-15", "2024-03" or "2024"
 * (also read from "2024/03/15", "2024.03.15", "20240315" and a full timestamp).
 * A month or day that can't exist ("2024-13", "2023-02-29") is dropped back to
 * what can be trusted rather than rounded into another date.
 */
function dateOf(v) {
  const s = String(v == null ? "" : v).trim();
  const y = yearOf(s);
  if (!y) return null;
  const m = /^(\d{4})(?:[-/.]?(\d{2})(?:[-/.]?(\d{2}))?)?(?:[T ].*)?$/.exec(s);
  if (!m || Number(m[1]) !== y || !m[2]) return String(y);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return String(y);
  const ym = `${y}-${m[2]}`;
  if (!m[3]) return ym;
  const d = Number(m[3]);
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d >= 1 && d <= days ? `${ym}-${m[3]}` : ym;
}

/*
 * The release date of a track from its tags. The year comes from the same
 * tags, in the same order, as it always has (the original release first);
 * the date is the most precise of the tags that agree on that year — so
 * ORIGINALDATE "1977" with DATE "1977-02-04" is 1977-02-04, while a 2011
 * remaster's DATE never lends its day to the 1977 original.
 */
function releaseDateOf(c) {
  const year = yearOf(c.originaldate) || yearOf(c.originalyear) || yearOf(c.date) || yearOf(c.year);
  if (!year) return { year: null, date: null };
  let date = String(year);
  for (const v of [c.originaldate, c.date]) {
    const d = dateOf(v);
    if (d && d.startsWith(String(year)) && d.length > date.length) date = d;
  }
  return { year, date };
}

/* Of several tracks' dates, the album's: the most precise one of [year], the commonest at that precision. */
function splitGenres(list) {
  const out = [];
  for (const g of list || []) {
    for (const part of String(g).split(/\s*;\s*|\u0000/)) {
      const t = part.trim();
      if (t && !out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  }
  return out;
}

/* Which reading of the tags a track row holds: rows from before are read again once. */
// 2 (v0.6.0-RC10): an untagged file is read again so its folder names are taken.

const first = v => Array.isArray(v) ? v[0] : v;
const clean = v => { const s = v == null ? "" : String(v).trim(); return s || null; };
const digits = v => { const s = clean(v); return s ? s.replace(/[^0-9]/g, "") || null : null; };

/*
 * Every tag a file carries, by name: { "BARCODE": ["0039841500523"], … }.
 * Pictures and other binary values are left out (the cover is read on its
 * own); a very long value (a lyrics sheet, a cue) is kept to 4000 characters.
 */
function allTags(native) {
  const out = {};
  for (const tags of Object.values(native || {})) {
    for (const t of tags || []) {
      const v = t.value;
      if (v == null || (typeof v === "object" && (v.data || v.format === "image/jpeg"))) continue;
      let s = typeof v === "object" ? (v.text != null ? String(v.text) : JSON.stringify(v)) : String(v);
      s = s.trim();
      if (!s) continue;
      if (s.length > 4000) s = s.slice(0, 4000);
      const k = String(t.id).toUpperCase();
      const list = out[k] || (out[k] = []);
      if (!list.includes(s) && list.length < 50) list.push(s);
    }
  }
  return out;
}

/* A gain in dB from what a tag holds ("-7.21 dB", or the reader's { dB }). */
function db(v) {
  if (v == null) return null;
  if (typeof v === "object" && Number.isFinite(v.dB)) return Math.round(v.dB * 100) / 100;
  const n = parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
/* A peak as a linear sample value (0–1+), from the reader's { ratio } or the tag text. */
function peakOf(v) {
  if (v == null) return null;
  if (typeof v === "object" && Number.isFinite(v.ratio)) return v.ratio;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/*
 * The identifiers and loudness, from the reader's common names where it has
 * them and the files' own names where it hasn't (Qobuz writes UPC, others
 * BARCODE; Opus files carry R128 gains, relative to −23 LUFS, not ReplayGain).
 */
function idsOf(c, tags) {
  const tag = k => (tags[k] || [])[0];
  const r128 = k => { const n = parseFloat(tag(k)); return Number.isFinite(n) ? Math.round((n / 256 + 5) * 100) / 100 : null; };
  return {
    isrc: clean(first(c.isrc) || tag("ISRC") || tag("TSRC")),
    barcode: digits(first(c.barcode) || tag("BARCODE") || tag("UPC") || tag("EAN")),
    catno: clean(first(c.catalognumber) || tag("CATALOGNUMBER") || tag("LABELNO") || tag("CATALOG")),
    country: clean(c.releasecountry || tag("RELEASECOUNTRY")),
    mb_album: clean(c.musicbrainz_albumid),
    mb_group: clean(c.musicbrainz_releasegroupid),
    mb_recording: clean(c.musicbrainz_recordingid),
    rg_track_gain: db(c.replaygain_track_gain) ?? r128("R128_TRACK_GAIN"),
    rg_track_peak: peakOf(c.replaygain_track_peak),
    rg_album_gain: db(c.replaygain_album_gain) ?? r128("R128_ALBUM_GAIN"),
    rg_album_peak: peakOf(c.replaygain_album_peak)
  };
}

async function readTags(file) {
  const { parseFile } = await mm();
  const md = await parseFile(file, { skipCovers: true, duration: false });
  const c = md.common || {};
  const f = md.format || {};
  const tags = allTags(md.native);
  const labelTag = (c.label && c.label[0]) || (c.publisher && c.publisher[0]) || null;
  const dates = releaseDateOf(c);
  return {
    // What the file itself carries, for the names to fill the rest (lib/library/names.js).
    tagged: {
      artist: !!(c.artist || (c.artists && c.artists.length) || c.albumartist), album: !!c.album, title: !!c.title,
      track: !!(c.track && c.track.no), disc: !!(c.disk && c.disk.no), year: !!dates.year
    },
    title: c.title || path.basename(file, path.extname(file)),
    artist: c.artist || (c.artists && c.artists.join(", ")) || "",
    album_artist: c.albumartist || "",
    album: c.album || "",
    artist_sort: c.albumartistsort || c.artistsort || "",
    compilation: !!c.compilation,
    track_no: (c.track && c.track.no) || null,
    disc_no: (c.disk && c.disk.no) || null,
    duration: Number(f.duration) || 0,
    codec: f.codec || null,
    container: f.container || null,
    sample_rate: f.sampleRate || null,
    bits: f.bitsPerSample || null,
    channels: f.numberOfChannels || null,
    lossless: f.lossless ? 1 : 0,
    ...dates,
    label: labelTag ? String(labelTag).trim() : null,
    genres: splitGenres(c.genre),
    ...idsOf(c, tags),
    tags
  };
}

module.exports = { readTags };
