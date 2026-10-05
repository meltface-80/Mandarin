"use strict";
/*
 * scanner.js — reading the music folder into the database.
 *
 * Incremental: a file whose size and modification time are unchanged is not
 * opened again, so a rescan of an untouched library is a directory walk and
 * nothing else. Work is done one directory at a time, because what an album IS
 * depends on its neighbours: a folder of tracks by different artists with no
 * album-artist tag is one compilation, not twenty one-track albums.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const N = require("./normalize");
const NAMES = require("./names");

const AUDIO_EXT = new Set([
  ".flac", ".fla", ".mp3", ".m4a", ".mp4", ".m4b", ".alac", ".aac", ".wav", ".wave",
  ".aif", ".aiff", ".aifc", ".ogg", ".oga", ".opus", ".dsf", ".dff", ".wv", ".ape", ".wma"
]);
const ART_NAMES = ["cover", "folder", "front", "album", "albumart", "albumartsmall", "thumb"];
const IMG_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const DISC_DIR = /^(cd|disc|disk|side)\s*[-_.]?\s*\d+\b/i;

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
function albumDateOf(dates, year) {
  if (!year) return null;
  const counts = new Map();
  for (const d of dates) if (d && d.startsWith(String(year))) counts.set(d, (counts.get(d) || 0) + 1);
  let best = String(year), n = 0;
  for (const [d, c] of counts) if (d.length > best.length || (d.length === best.length && c > n)) { best = d; n = c; }
  return best;
}

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
const TAGS_V = 2;

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

/*
 * Every folder under root, depth first. [listed] collects each folder read in
 * full, [unreadable] each one that couldn't be (a network share that dropped,
 * a disk that stalled, no permission): what was under those is kept as it
 * was, never taken for deleted.
 */
async function walk(root, onDir, { listed = new Set(), unreadable = new Set() } = {}) {
  const stack = [root];
  const seen = new Set();
  while (stack.length) {
    const dir = stack.pop();
    let real;
    try { real = fs.realpathSync(dir); } catch (e) { unreadable.add(dir); continue; }
    if (seen.has(real)) { unreadable.add(dir); continue; }   // a symlink loop: not read twice
    seen.add(real);
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { unreadable.add(dir); continue; }
    listed.add(dir);
    const files = [];
    const images = [];
    const discDirs = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      let isDir = e.isDirectory(), isFile = e.isFile();
      if (e.isSymbolicLink()) {
        try { const st = fs.statSync(full); isDir = st.isDirectory(); isFile = st.isFile(); } catch (err) { unreadable.add(full); continue; }
      }
      if (isDir) {
        // "CD1", "Disc 2"…: one album split across folders. Read them as part
        // of this folder so the album is decided with every disc in view.
        if (DISC_DIR.test(e.name)) discDirs.push(full); else stack.push(full);
      } else if (isFile) {
        const ext = path.extname(e.name).toLowerCase();
        if (AUDIO_EXT.has(ext)) files.push(full);
        else if (IMG_EXT.includes(ext)) images.push(full);
      }
    }
    const discImages = new Map();
    for (const d of discDirs.sort()) {
      let inner;
      try { inner = await fs.promises.readdir(d, { withFileTypes: true }); } catch (e) { unreadable.add(d); continue; }
      listed.add(d);
      const imgs = [];
      for (const e of inner) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(d, e.name);
        const ext = path.extname(e.name).toLowerCase();
        if (e.isDirectory()) stack.push(full);
        else if (AUDIO_EXT.has(ext)) files.push(full);
        else if (IMG_EXT.includes(ext)) imgs.push(full);
      }
      discImages.set(d, imgs);
    }
    if (files.length || images.length) await onDir(dir, files.sort(), images, discImages);
  }
}

/* Is p the folder dir, or somewhere inside it? */
function isInside(p, dir) {
  return p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);
}

function pickArt(images) {
  if (!images.length) return null;
  const scored = images.map(p => {
    const base = path.basename(p, path.extname(p)).toLowerCase();
    let score = 100;
    const i = ART_NAMES.indexOf(base);
    if (i >= 0) score = i;
    else if (/front|cover/.test(base)) score = 20;
    else if (/back|inlay|cd|disc|booklet|tray/.test(base)) score = 200;
    return { p, score };
  }).sort((a, b) => a.score - b.score || a.p.localeCompare(b.p));
  // Only a lone image, or one whose name says what it is, stands for the album.
  if (scored[0].score < 100 || images.length === 1) return scored[0].p;
  return null;
}

function artHash(p) {
  try {
    const st = fs.statSync(p);
    return crypto.createHash("sha1").update(`${p}|${st.size}|${st.mtimeMs}`).digest("hex").slice(0, 10);
  } catch (e) { return null; }
}

class Scanner {
  /*
   * [root]: the music folder the server was started with (MUSIC_DIR).
   * [roots]: the watched folders now, as a function (they change from
   * Settings → Music folders); just [root] when not given.
   */
  constructor({ db, root, roots, log = console.log, massRemoval = 500 }) {
    this.store = db;
    this.db = db.raw;
    this.massRemoval = massRemoval;
    this.root = root;
    this.rootsOf = roots || (() => [root]);
    this.log = log;
    this.state = { running: false, progress: 0, files: 0, parsed: 0, errors: 0, startedAt: null, finishedAt: null, lastResult: null };
    // Called (at most every few seconds) while a scan is writing, so albums
    // found so far can be shown and played before the scan finishes.
    this.onProgress = null;
    this.prep();
    this.migrateKeys();
    this.migrateNames();
    this.migrateDiscs();
  }

  /*
   * Once, on the first start of v0.6.0: a track in a disc folder ("Disc 2",
   * "CD2") whose tags carry no disc number takes the folder's, so a set split
   * across folders shows as the discs it is.
   */
  migrateDiscs() {
    if (!this.store.setting || Number(this.store.setting("discs_v", 0)) >= 1) return;
    const set = this.db.prepare("UPDATE tracks SET disc_no = ? WHERE id = ?");
    let n = 0;
    this.db.transaction(() => {
      for (const r of this.db.prepare("SELECT id, path FROM tracks WHERE disc_no IS NULL").all()) {
        const m = NAMES.DISC_DIR.exec(path.basename(path.dirname(r.path)));
        if (m) { set.run(Number(m[2]), r.id); n++; }
      }
    })();
    this.store.setSetting("discs_v", 1);
    if (n) this.log(`[scan] ${n} tracks in disc folders given their folder's disc number`);
  }

  /*
   * Once, on the first start of v0.6.0-RC10: only the tracks whose tags left
   * the artist or the album empty are read again (TAGS_V 2), to take their
   * names from the folders; every other track is marked as read already, so
   * the library isn't read through for them.
   */
  migrateNames() {
    if (!this.store.setting || Number(this.store.setting("names_v", 0)) >= 1) return;
    const r = this.db.prepare(`UPDATE tracks SET tags_v = ? WHERE tags_v >= 1 AND tags_v < ?
      AND (COALESCE(artist, '') != '' OR COALESCE(album_artist, '') != '') AND COALESCE(album, '') != ''`).run(TAGS_V, TAGS_V);
    const left = this.db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE COALESCE(tags_v, 0) < ?").get(TAGS_V).n;
    this.store.setSetting("names_v", 1);
    if (left) this.log(`[scan] ${left} tracks without an artist or album tag will be read again, their names taken from their folders (${r.changes} others left as they are)`);
  }

  // ------------------------------------------------------------ album identity
  //
  // An album is its artist, its title AND its folder (v0.6.0-RC8). Before,
  // it was artist and title alone, so two copies of a record in two folders —
  // "Random Access Memories (2013)" and "(2023)" — were one album with both
  // sets of tracks. Disc folders ("Disc 1", "CD2"…) are read as part of the
  // folder above them, so a set split across them is still one album.

  /* An album folder as the key names it: relative to its music folder. */
  relFolder(dir) {
    const roots = this.roots();
    const root = roots.filter(r => isInside(dir, r)).sort((a, b) => b.length - a.length)[0];
    const rel = root ? path.relative(root, dir) : dir;
    return (rel || ".").split(path.sep).join("/").toLowerCase();
  }

  /*
   * An album's key changed: every table that names the album by its key
   * follows, so its favourite, Listen later, edits, identification, label
   * lookup, release day and Album of the day go with it.
   */
  rekey(from, to) {
    if (!from || !to || from === to) return;
    const d = this.db;
    for (const t of ["albums", "favourites", "listen_later", "label_lookups", "album_edits", "track_edits", "album_matches", "album_ids"]) {
      d.prepare(`UPDATE OR IGNORE ${t} SET key = ? WHERE key = ?`).run(to, from);
    }
    d.prepare("UPDATE OR IGNORE cache SET key = ? WHERE ns = 'mbday' AND key = ?").run(to, from);
    const aotd = this.store.setting ? this.store.setting("album_of_the_day", null) : null;
    if (aotd && aotd.key === from) this.store.setSetting("album_of_the_day", Object.assign({}, aotd, { key: to }));
  }

  /*
   * Once, on the first start of v0.6.0-RC8: each album's key gains its folder,
   * and the next scan regroups every folder (no tags read again), so albums
   * that were two folders merged come apart.
   */
  migrateKeys() {
    if (!this.store.setting || Number(this.store.setting("album_key_v", 1)) >= 2) return;
    const rows = this.db.prepare("SELECT id, key, dir FROM albums").all();
    this.db.transaction(() => {
      for (const r of rows) {
        if (r.key.split("\u0001").length >= 3) continue;
        this.rekey(r.key, r.key + "\u0001" + this.relFolder(r.dir || ""));
      }
    })();
    this.store.setSetting("album_key_v", 2);
    this.store.setSetting("album_regroup", true);
    if (this.store.backupEdits) this.store.backupEdits();
    if (rows.length) this.log(`[scan] albums are now told apart by their folder too: ${rows.length} keys updated; the next scan regroups every folder`);
  }

  prep() {
    const d = this.db;
    this.q = {
      trackByPath: d.prepare("SELECT * FROM tracks WHERE path = ?"),
      albumByKey: d.prepare("SELECT id FROM albums WHERE key = ?"),
      insertAlbum: d.prepare(`INSERT INTO albums(key, title, artist, sort_title, sort_artist, dir, added_at, updated_at, compilation)
                              VALUES(@key, @title, @artist, @sort_title, @sort_artist, @dir, @now, @now, @compilation)`),
      upsertTrack: d.prepare(`INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration,
                                codec, container, sample_rate, bits, channels, lossless, year, date, label, genres,
                                tags_v, isrc, barcode, catno, country, mb_album, mb_group, mb_recording,
                                rg_track_gain, rg_track_peak, rg_album_gain, rg_album_peak, names_from)
                              VALUES(@album_id, @path, @mtime, @size, @title, @artist, @album_artist, @album, @track_no, @disc_no, @duration,
                                @codec, @container, @sample_rate, @bits, @channels, @lossless, @year, @date, @label, @genres,
                                @tags_v, @isrc, @barcode, @catno, @country, @mb_album, @mb_group, @mb_recording,
                                @rg_track_gain, @rg_track_peak, @rg_album_gain, @rg_album_peak, @names_from)
                              ON CONFLICT(path) DO UPDATE SET album_id=excluded.album_id, mtime=excluded.mtime, size=excluded.size,
                                title=excluded.title, artist=excluded.artist, album_artist=excluded.album_artist, album=excluded.album,
                                track_no=excluded.track_no, disc_no=excluded.disc_no, duration=excluded.duration, codec=excluded.codec,
                                container=excluded.container, sample_rate=excluded.sample_rate, bits=excluded.bits, channels=excluded.channels,
                                lossless=excluded.lossless, year=excluded.year, date=excluded.date, label=excluded.label, genres=excluded.genres,
                                tags_v=excluded.tags_v, isrc=excluded.isrc, barcode=excluded.barcode, catno=excluded.catno, country=excluded.country,
                                mb_album=excluded.mb_album, mb_group=excluded.mb_group, mb_recording=excluded.mb_recording,
                                rg_track_gain=excluded.rg_track_gain, rg_track_peak=excluded.rg_track_peak,
                                rg_album_gain=excluded.rg_album_gain, rg_album_peak=excluded.rg_album_peak, names_from=excluded.names_from`),
      trackIdByPath: d.prepare("SELECT id FROM tracks WHERE path = ?"),
      dropLoudness: d.prepare("DELETE FROM track_loudness WHERE track_id = ?"),
      putTags: d.prepare("INSERT INTO track_tags(track_id, tags) VALUES(?, ?) ON CONFLICT(track_id) DO UPDATE SET tags = excluded.tags"),
      moveTrack: d.prepare("UPDATE tracks SET album_id = ? WHERE id = ?"),
      relocateTrack: d.prepare("UPDATE tracks SET path = ? WHERE id = ?"),
      deleteTrack: d.prepare("DELETE FROM tracks WHERE id = ?"),
      albumTracks: d.prepare("SELECT * FROM tracks WHERE album_id = ? ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path"),
      updateAlbum: d.prepare(`UPDATE albums SET year=@year, date=@date, label=@label, genres=@genres, dir=@dir, art_path=@art_path, art_embedded=@art_embedded,
                               art_hash=@art_hash, track_count=@track_count, duration=@duration, max_rate=@max_rate, max_bits=@max_bits,
                               lossless=@lossless, container=@container, added_at=@added_at,
                               barcode=@barcode, catno=@catno, country=@country, mb_album=@mb_album, mb_group=@mb_group, updated_at=@now WHERE id=@id`),
      emptyAlbums: d.prepare("SELECT a.id, a.key FROM albums a LEFT JOIN tracks t ON t.album_id = a.id WHERE t.id IS NULL"),
      deleteAlbum: d.prepare("DELETE FROM albums WHERE id = ?"),
      retireId: d.prepare("INSERT INTO album_ids(key, id) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET id = excluded.id"),
      retiredId: d.prepare("SELECT id FROM album_ids WHERE key = ?"),
      albumById: d.prepare("SELECT id FROM albums WHERE id = ?"),
      albumRow: d.prepare("SELECT id, key, dir FROM albums WHERE id = ?"),
      renameAlbum: d.prepare("UPDATE albums SET title = @title, artist = @artist, sort_title = @sort_title, sort_artist = @sort_artist, compilation = @compilation WHERE id = @id"),
      insertAlbumAs: d.prepare(`INSERT INTO albums(id, key, title, artist, sort_title, sort_artist, dir, added_at, updated_at, compilation)
                                VALUES(@id, @key, @title, @artist, @sort_title, @sort_artist, @dir, @now, @now, @compilation)`)
    };
  }

  /* Albums left with no tracks go — their ids kept, for when they come back. */
  dropEmptyAlbums() {
    for (const r of this.q.emptyAlbums.all()) {
      this.q.retireId.run(r.key, r.id);
      this.q.deleteAlbum.run(r.id);
    }
  }

  /* The watched folders: absolute, each once, none inside another. */
  roots() {
    const list = [...new Set((this.rootsOf() || []).filter(Boolean).map(r => path.resolve(String(r))))].sort();
    return list.filter(r => !list.some(o => o !== r && isInside(r, o)));
  }

  /*
   * Decide each track's album within one directory.
   *   - The album-artist tag wins when present.
   *   - A compilation flag, or several track artists on one album title with
   *     no album artist, makes it "Various Artists".
   *   - Otherwise the track artist is the album artist.
   * A missing album tag names the album after its folder (or the folder above
   * a "CD1"-style disc folder).
   */
  groupDir(dir, rows) {
    const byAlbum = new Map();
    const dirName = path.basename(dir);
    for (const r of rows) {
      const title = r.album || dirName;
      const k = N.key(title);
      if (!byAlbum.has(k)) byAlbum.set(k, { title, rows: [] });
      byAlbum.get(k).rows.push(r);
    }
    for (const g of byAlbum.values()) {
      const tagged = g.rows.find(r => r.album_artist);
      const artists = new Set(g.rows.map(r => N.key(r.artist)).filter(Boolean));
      let albumArtist;
      if (tagged) albumArtist = tagged.album_artist;
      else if (g.rows.some(r => r.compilation) || artists.size > 1) albumArtist = "Various Artists";
      else albumArtist = (g.rows[0] && g.rows[0].artist) || "Unknown Artist";
      g.artist = albumArtist;
      g.compilation = N.key(albumArtist) === "various artists" ? 1 : 0;
      g.sortArtist = (g.rows.find(r => r.artist_sort) || {}).artist_sort || albumArtist;
      g.base = N.key(albumArtist) + "\u0001" + N.key(g.title);
      g.key = g.base + "\u0001" + this.relFolder(dir);
    }
    return [...byAlbum.values()];
  }

  albumIdFor(g, dir, now) {
    const id = this.albumIdFor1(g, dir, now);
    if (this.claimed) this.claimed.add(id);
    return id;
  }

  albumIdFor1(g, dir, now) {
    const hit = this.q.albumByKey.get(g.key);
    if (hit) return hit.id;
    // The folder renamed or moved (the tracks known, the old folder gone):
    // the same album, under its new key — plays, edits and favourite kept.
    const prevIds = [...new Set(g.rows.map(r => r.unchanged ? r.album_id : r.prev_album).filter(Boolean))];
    if (prevIds.length === 1) {
      const old = this.q.albumRow.get(prevIds[0]);
      const sameName = old && old.key.split("\u0001").slice(0, 2).join("\u0001") === g.base;
      // Its names changed in the same folder — an untagged album named from its
      // folders (v0.6.0-RC10), or tags rewritten: still the same album.
      const sameFolder = old && old.dir && path.resolve(old.dir) === path.resolve(dir) && !(this.claimed && this.claimed.has(old.id));
      if (old && ((sameName && !(old.dir && fs.existsSync(old.dir))) || sameFolder)) {
        this.rekey(old.key, g.key);
        this.q.renameAlbum.run({ id: old.id, title: g.title, artist: g.artist, sort_title: N.sortName(g.title), sort_artist: N.sortName(g.sortArtist), compilation: g.compilation });
        // New names, not yet looked up under them: identification asks again.
        if (!sameName) this.db.prepare("DELETE FROM album_matches WHERE key = ? AND status = 'unidentified'").run(g.key);
        return old.id;
      }
    }
    // What was kept under the key before folders counted (edits restored from
    // album-edits.json into a new database; an album that left and is back).
    if (g.base) {
      this.rekey(g.base, g.key);
      const was = this.q.albumByKey.get(g.key);
      if (was) return was.id;
    }
    const row = {
      key: g.key, title: g.title, artist: g.artist,
      sort_title: N.sortName(g.title), sort_artist: N.sortName(g.sortArtist),
      dir, now, compilation: g.compilation
    };
    // Back after a while away: the id it had, if nothing has taken it since.
    const was = this.q.retiredId.get(g.key);
    if (was && !this.q.albumById.get(was.id)) {
      this.q.insertAlbumAs.run(Object.assign({ id: was.id }, row));
      return was.id;
    }
    return Number(this.q.insertAlbum.run(row).lastInsertRowid);
  }

  /* Recompute an album's derived columns from its tracks. */
  refreshAlbum(id, imagesByDir) {
    const tracks = this.q.albumTracks.all(id);
    if (!tracks.length) return;
    const now = Date.now();
    const count = (vals) => {
      const m = new Map();
      for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
    };
    const years = count(tracks.map(t => t.year));
    const labels = count(tracks.map(t => t.label));
    const genres = [];
    for (const t of tracks) for (const g of JSON.parse(t.genres || "[]")) if (!genres.includes(g)) genres.push(g);
    const dirs = count(tracks.map(t => path.dirname(t.path)));
    let dir = dirs[0] || "";
    if (DISC_DIR.test(path.basename(dir))) dir = path.dirname(dir);
    // Folder art: the album's own folder, then each disc folder.
    let art = null;
    for (const d of [dir, ...dirs]) {
      const imgs = imagesByDir && imagesByDir.get(d);
      const list = imgs || listImages(d);
      art = pickArt(list);
      if (art) break;
    }
    const lossy = tracks.some(t => !t.lossless);
    const rates = tracks.map(t => t.sample_rate || 0);
    const bits = tracks.map(t => t.bits || 0);
    const containers = count(tracks.map(t => t.container));
    this.q.updateAlbum.run({
      id,
      year: years[0] || null,
      date: albumDateOf(tracks.map(t => t.date), years[0]),
      label: labels[0] || null,
      genres: JSON.stringify(genres.slice(0, 8)),
      dir,
      art_path: art,
      art_embedded: art ? null : tracks[0].path,
      art_hash: art ? artHash(art) : artHash(tracks[0].path),
      track_count: tracks.length,
      duration: tracks.reduce((a, t) => a + (t.duration || 0), 0),
      max_rate: Math.max(...rates) || null,
      max_bits: Math.max(...bits) || null,
      lossless: lossy ? 0 : 1,
      container: containers[0] || null,
      added_at: Math.min(...tracks.map(t => t.mtime)) || now,
      // The release's identifiers: what most of its tracks say (v0.6.0-RC5).
      barcode: count(tracks.map(t => t.barcode))[0] || null,
      catno: count(tracks.map(t => t.catno))[0] || null,
      country: count(tracks.map(t => t.country))[0] || null,
      mb_album: count(tracks.map(t => t.mb_album))[0] || null,
      mb_group: count(tracks.map(t => t.mb_group))[0] || null,
      now
    });
  }

  async scan({ force = false } = {}) {
    if (this.state.running) return { status: "running" };
    const t0 = Date.now();
    this.state = { running: true, progress: 0, files: 0, parsed: 0, errors: 0, startedAt: t0, finishedAt: null, lastResult: this.state.lastResult };
    const roots = this.roots();
    const present = roots.filter(r => fs.existsSync(r));
    if (!present.length) {
      // Nothing to read at all: every track is kept as it was.
      this.state.running = false;
      this.state.lastResult = { status: "no-music", root: roots[0] || this.root, roots };
      this.log(`[scan] ${roots.join(", ") || this.root} not found — mount your music there, or add a folder in Settings → Music folders`);
      return this.state.lastResult;
    }
    // Once after v0.6.0-RC8's key change: every folder regrouped, so albums
    // that were two folders merged come apart (no tags read again).
    const regroup = !!(this.store.setting && this.store.setting("album_regroup", false));
    this.claimed = new Set();     // albums given to a group in this scan: not taken over by another
    const known = new Map();
    for (const r of this.db.prepare("SELECT id, path, mtime, size, album_id, year, date, tags_v FROM tracks").all()) known.set(r.path, r);
    const seen = new Set();
    const touchedAlbums = new Set();
    const imagesByDir = new Map();
    let added = 0, changed = 0;
    const knownTotal = known.size || 1;

    // A file that is the same file under a new path — the music mounted at a
    // different place, or a folder renamed — is recognised by its size,
    // modification time and name, and keeps its track (and album, plays,
    // playlists, edits) instead of being read again from scratch.
    const idOf = (size, mtime, file) => `${size}|${mtime}|${path.basename(file)}`;
    const byIdentity = new Map();
    for (const r of known.values()) {
      const k = idOf(r.size, r.mtime, r.path);
      if (!byIdentity.has(k)) byIdentity.set(k, []);
      byIdentity.get(k).push(r);
    }
    let relocated = 0;
    const relocate = (file, size, mtime) => {
      const list = byIdentity.get(idOf(size, mtime, file));
      if (!list) return null;
      const i = list.findIndex(r => !seen.has(r.path) && !fs.existsSync(r.path));
      if (i < 0) return null;
      const r = list.splice(i, 1)[0];
      this.q.relocateTrack.run(file, r.id);
      known.delete(r.path);
      r.path = file;
      known.set(file, r);
      relocated++;
      return r;
    };
    let lastProgress = Date.now();

    const listed = new Set(), unreadable = new Set();
    const onDir = async (dir, files, images, discImages) => {
      imagesByDir.set(dir, images);
      for (const [d, imgs] of discImages || []) imagesByDir.set(d, imgs);
      if (!files.length) return;
      const rows = [];
      let dirty = false;
      for (const file of files) {
        seen.add(file);
        this.state.files++;
        let st;
        try { st = fs.statSync(file); } catch (e) { continue; }
        const mtime = Math.floor(st.mtimeMs);
        let prev = known.get(file);
        if (!prev && !force) {
          const moved = relocate(file, st.size, mtime);
          if (moved) { touchedAlbums.add(moved.album_id); rows.push({ unchanged: true, prev: moved }); continue; }
        }
        // (A track read before release dates were kept has a year and no date:
        // read once more, so its day is known without a forced rescan.)
        // (Likewise a track read before every tag was kept, v0.6.0-RC5: read
        // once more, so its identifiers and ReplayGain are known.)
        if (!force && prev && prev.mtime === mtime && prev.size === st.size && !(prev.year && !prev.date) && (prev.tags_v || 0) >= TAGS_V) {
          rows.push({ unchanged: true, prev });
          continue;
        }
        dirty = true;
        try {
          const tags = await readTags(file);
          // Untagged, or partly: the rest from the folder and file names (v0.6.0-RC10).
          if (tags.tagged) NAMES.fill(tags, file, this.roots(), tags.tagged);
          this.state.parsed++;
          rows.push(Object.assign({ path: file, mtime, size: st.size, prev_album: prev ? prev.album_id : null }, tags));
          if (prev) changed++; else added++;
        } catch (e) {
          this.state.errors++;
          if (this.state.errors <= 20) this.log(`[scan] could not read ${file}: ${e.message}`);
        }
        this.state.progress = Math.min(99, Math.round(100 * this.state.files / Math.max(knownTotal, this.state.files + 1)));
      }
      if (!dirty && !regroup) return;
      // Regroup the whole folder, unchanged neighbours included.
      const full = rows.map(r => {
        if (!r.unchanged) return r;
        const t = this.q.trackByPath.get(r.prev.path);
        return Object.assign({ unchanged: true, genres: JSON.parse(t.genres || "[]") }, t);
      });
      const groups = this.groupDir(dir, full);
      const now = Date.now();
      this.db.transaction(() => {
        for (const g of groups) {
          const albumId = this.albumIdFor(g, dir, now);
          touchedAlbums.add(albumId);
          for (const r of g.rows) {
            if (r.unchanged) {
              if (r.album_id !== albumId) { touchedAlbums.add(r.album_id); this.q.moveTrack.run(albumId, r.id); }
              continue;
            }
            const prev = known.get(r.path);
            if (prev) touchedAlbums.add(prev.album_id);
            this.q.upsertTrack.run({
              album_id: albumId, path: r.path, mtime: r.mtime, size: r.size, title: r.title, artist: r.artist,
              album_artist: r.album_artist, album: r.album, track_no: r.track_no, disc_no: r.disc_no, duration: r.duration,
              codec: r.codec, container: r.container, sample_rate: r.sample_rate, bits: r.bits, channels: r.channels,
              lossless: r.lossless, year: r.year, date: r.date || null, label: r.label, genres: JSON.stringify(r.genres || []),
              tags_v: TAGS_V, isrc: r.isrc || null, barcode: r.barcode || null, catno: r.catno || null, country: r.country || null,
              mb_album: r.mb_album || null, mb_group: r.mb_group || null, mb_recording: r.mb_recording || null,
              rg_track_gain: r.rg_track_gain ?? null, rg_track_peak: r.rg_track_peak ?? null,
              rg_album_gain: r.rg_album_gain ?? null, rg_album_peak: r.rg_album_peak ?? null,
              names_from: r.names_from || null
            });
            const tid = this.q.trackIdByPath.get(r.path);
            if (tid) this.q.putTags.run(tid.id, JSON.stringify(r.tags || {}));
            // A file changed on disk is measured again (lib/loudness.js).
            if (tid && prev && (prev.mtime !== r.mtime || prev.size !== r.size)) this.q.dropLoudness.run(tid.id);
          }
        }
        // Ready to show and play now, not only when the whole scan ends.
        for (const g of groups) { const id = this.q.albumByKey.get(g.key); if (id) this.refreshAlbum(id.id, imagesByDir); }
      })();
      if (this.onProgress && Date.now() - lastProgress > 5000) {
        lastProgress = Date.now();
        try { this.onProgress(); } catch (e) { /* display only */ }
      }
      // Let the event loop breathe between folders: the API stays responsive.
      await new Promise(r => setImmediate(r));
    };
    for (const root of present) await walk(root, onDir, { listed, unreadable });

    // A file that wasn't found is removed only when the folder it was in (or,
    // the album's folder gone, the nearest one above it) was read in full
    // this time and it wasn't there. Everything else is kept as it was —
    // albums, edits and play history with it — and checked again next scan:
    //   - a watched folder missing or empty: a drive not mounted (yet), or a
    //     -v line left off a re-created container;
    //   - a folder that couldn't be read: a network share that dropped, a
    //     disk that stalled;
    //   - most of a folder gone at once (over a quarter, and over 500 tracks —
    //     [massRemoval]):
    //     far likelier a share half there than music deleted.
    // The page says which folder, with a way to forget it for good (forget()).
    const rootOf = p => roots.filter(r => isInside(p, r)).sort((a, b) => b.length - a.length)[0] || null;
    const isEmptyDir = d => { try { return fs.readdirSync(d).filter(n => !n.startsWith(".")).length === 0; } catch (e) { return false; } };
    const seenTops = new Set([...seen].map(p => { const r = rootOf(p); return r ? path.join(r, path.relative(r, p).split(path.sep)[0]) : p; }));
    const offline = new Map();   // folder → { tracks, reason }
    const keep = (d, reason) => { const o = offline.get(d) || { tracks: 0, reason }; o.tracks++; offline.set(d, o); };
    const gone = new Map();      // folder → tracks that would go
    const knownIn = new Map();   // folder → tracks known in it
    let removed = 0;
    for (const [p, r] of known) {
      // A Qobuz track (lib/qobuz) has no file: never the scanner's to remove.
      if (p.startsWith("qobuz://")) continue;
      const root = rootOf(p);
      // In no watched folder (MUSIC_DIR changed, and not found again elsewhere):
      // gone. Folders removed in Settings take their tracks with them there.
      if (!root) { if (!seen.has(p)) (gone.get(null) || gone.set(null, []).get(null)).push(r); continue; }
      const rel = path.relative(root, p).split(path.sep);
      const group = rel.length > 1 ? path.join(root, rel[0]) : root;
      knownIn.set(group, (knownIn.get(group) || 0) + 1);
      if (seen.has(p)) continue;
      if (!present.includes(root) || isEmptyDir(root)) { keep(root, fs.existsSync(root) ? "empty" : "missing"); continue; }
      // In the music folder the server was started with, each folder in it is
      // usually a drive mounted there (-v …:/music/4tb): one missing or empty
      // is kept the same way. In a folder added in Settings they're just folders.
      if (group !== root && root === path.resolve(this.root) && !seenTops.has(group) && (!fs.existsSync(group) || isEmptyDir(group))) {
        keep(group, fs.existsSync(group) ? "empty" : "missing"); continue;
      }
      let d = p, verdict = "keep";
      for (;;) {
        if (unreadable.has(d)) break;
        if (d !== p && listed.has(d)) { verdict = "remove"; break; }
        if (d === root) break;
        d = path.dirname(d);
      }
      if (verdict === "keep") { keep(group, "unreadable"); continue; }
      (gone.get(group) || gone.set(group, []).get(group)).push(r);
    }
    // The same, over a whole watched folder: many small folders gone at once.
    const tooMany = (n, of) => n > this.massRemoval && n > 0.25 * of;
    const goneByRoot = new Map(), knownByRoot = new Map();
    for (const [group, n] of knownIn) { const r = rootOf(group); knownByRoot.set(r, (knownByRoot.get(r) || 0) + n); }
    for (const [group, rows] of gone) if (group) { const r = rootOf(group); goneByRoot.set(r, (goneByRoot.get(r) || 0) + rows.length); }
    this.db.transaction(() => {
      for (const [group, rows] of gone) {
        const root = group && rootOf(group);
        const whole = root && tooMany(goneByRoot.get(root) || 0, knownByRoot.get(root) || 0);
        if (group && (whole || tooMany(rows.length, knownIn.get(group) || 0))) {
          for (let i = 0; i < rows.length; i++) keep(whole ? root : group, "vanished");
          continue;
        }
        for (const r of rows) { this.q.deleteTrack.run(r.id); touchedAlbums.add(r.album_id); removed++; }
      }
    })();
    const words = { missing: "is missing", empty: "is empty", unreadable: "couldn't all be read", vanished: "has lost most of its files at once" };
    for (const [d, o] of offline) {
      this.log(`[scan] ${d} ${words[o.reason]} — kept its ${o.tracks} tracks as they were`);
    }
    this.db.transaction(() => {
      for (const id of touchedAlbums) this.refreshAlbum(id, imagesByDir);
      this.dropEmptyAlbums();
    })();

    const albums = this.db.prepare("SELECT COUNT(*) AS n FROM albums").get().n;
    const tracks = this.db.prepare("SELECT COUNT(*) AS n FROM tracks").get().n;
    const result = {
      status: (added || changed || removed || relocated || regroup) ? "updated" : "unchanged",
      added, changed, removed, relocated, kept_offline: [...offline.values()].reduce((a, o) => a + o.tracks, 0), albums, tracks,
      // Each folder whose tracks were kept, for the page's notice.
      offline_dirs: [...offline].map(([dir, o]) => ({ dir, name: path.basename(dir), tracks: o.tracks, reason: o.reason, missing: !fs.existsSync(dir) })),
      roots,
      errors: this.state.errors, ms: Date.now() - t0
    };
    // The regroup done everywhere it could be: not asked again.
    if (regroup && !offline.size) this.store.setSetting("album_regroup", false);
    this.state.running = false;
    this.state.progress = 100;
    this.state.finishedAt = Date.now();
    this.state.lastResult = result;
    this.log(`[scan] ${result.status}: +${added} ~${changed} -${removed}${relocated ? ` moved ${relocated}` : ""} files; ${albums} albums, ${tracks} tracks in ${(result.ms / 1000).toFixed(1)}s`);
    return result;
  }

  /*
   * A kept folder (see offline_dirs), on being told it isn't coming back: one
   * of the watched folders, or a folder straight inside one. Missing or empty,
   * its tracks go; still there (a share half there, files deleted in bulk),
   * only the tracks whose files are gone — never a file that's there.
   */
  forget(dir) {
    const d = path.resolve(String(dir || ""));
    const roots = this.roots();
    if (!roots.some(r => d === r || path.dirname(d) === r)) throw new Error("Not one of the music folders");
    let present = false;
    try { present = fs.readdirSync(d).some(n => !n.startsWith(".")); } catch (e) { present = false; }
    const n = this.removeUnder(d, present ? (p => !fs.existsSync(p)) : null);
    const last = this.state.lastResult;
    if (last && Array.isArray(last.offline_dirs)) last.offline_dirs = last.offline_dirs.filter(x => path.resolve(x.dir) !== d);
    this.log(`[scan] forgot ${d}${present ? " (files no longer there)" : ""}: ${n} tracks removed`);
    return n;
  }

  /* Tracks under dir out of the library ([which]: only those it says). */
  removeUnder(dir, which = null) {
    const d = path.resolve(String(dir));
    let n = 0;
    this.db.transaction(() => {
      for (const r of this.db.prepare("SELECT id, path FROM tracks").all()) {
        if (isInside(r.path, d) && r.path !== d && (!which || which(r.path))) { this.q.deleteTrack.run(r.id); n++; }
      }
      this.dropEmptyAlbums();
    })();
    return n;
  }

  /* Tracks the library has under dir. */
  countUnder(dir) {
    const d = path.resolve(String(dir));
    const like = d.replace(/[\\%_]/g, c => "\\" + c) + path.sep + "%";
    return this.db.prepare("SELECT COUNT(*) AS n FROM tracks WHERE path LIKE ? ESCAPE '\\'").get(like).n;
  }
}

function listImages(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => IMG_EXT.includes(path.extname(f).toLowerCase()) && !f.startsWith("."))
      .map(f => path.join(dir, f));
  } catch (e) { return []; }
}

module.exports = { isInside, Scanner, readTags, pickArt, AUDIO_EXT, yearOf, dateOf, releaseDateOf, albumDateOf };
