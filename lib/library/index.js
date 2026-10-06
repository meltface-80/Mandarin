"use strict";
/*
 * library/index.js — the whole library, in memory, in the shapes the
 * interface asks for.
 *
 * The database is the record; this is the working copy. Every screen — the
 * random wall, the sorted Library wall, search on every keystroke, the facet
 * counts — is a pass over an array of a few thousand objects, which is
 * milliseconds, so none of it touches SQLite on a user action. It is rebuilt
 * after each scan.
 *
 * An album's `offset` in the API is its database id. The interface was written
 * for Roon, where an album is addressed by its position in a browse list and
 * that position can go stale; here the id is permanent, so the stale-offset
 * machinery the interface carries simply never fires.
 */
const path = require("path");
const SV = require("../services");
const N = require("./normalize");
const LB = require("../labels");

function rateShort(hz) {
  const k = hz / 1000;
  return Number.isInteger(k) ? String(k) : k.toFixed(1);
}
function rateLabel(hz) { return hz ? rateShort(hz) + " kHz" : null; }
function channelLabel(n) {
  if (!n) return null;
  if (n === 1) return "Mono";
  if (n === 2) return "Stereo";
  return n + " channels";
}
function formatName(container, lossless) {
  const c = String(container || "");
  if (/mpeg/i.test(c) && !lossless) return "MP3";
  if (/flac/i.test(c)) return "FLAC";
  if (/wave|wav/i.test(c)) return "WAV";
  if (/aiff/i.test(c)) return "AIFF";
  if (/dsf|dsd|dff/i.test(c)) return "DSD";
  if (/ogg/i.test(c)) return "Ogg";
  if (/m4a|mp4|isom|m4b|alac/i.test(c)) return lossless ? "ALAC" : "AAC";
  if (/wavpack/i.test(c)) return "WavPack";
  if (/ape|monkey/i.test(c)) return "APE";
  return c || null;
}

// Deterministic shuffle: paging must not reshuffle between requests, so the
// order is a pure function of (album, seed).
function seededRank(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

// ---- search scoring, from MusicD Remote -------------------------------------
function consecutivePrefixStart(tokens, qTokens) {
  const last = tokens.length - qTokens.length;
  for (let i = 0; i <= last; i++) {
    let ok = true;
    for (let k = 0; k < qTokens.length; k++) {
      if (!tokens[i + k].startsWith(qTokens[k])) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}
function allTokensPrefixSomewhere(tokens, qTokens) {
  const used = new Array(tokens.length).fill(false);
  for (const qt of qTokens) {
    let found = false;
    for (let i = 0; i < tokens.length; i++) {
      if (!used[i] && tokens[i].startsWith(qt)) { used[i] = true; found = true; break; }
    }
    if (!found) return false;
  }
  return true;
}
function isSubsequence(q, s) {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) i++;
  return i === q.length;
}
function scoreAlbum(al, q, qTokens, qJoined, singleChar) {
  let s = 0;
  if (al.nTitle === q) return 1000;
  if (al.nTitle.startsWith(q)) s = Math.max(s, 920 - Math.min(al.nTitle.length - q.length, 60));
  {
    const start = consecutivePrefixStart(al.tTitle, qTokens);
    if (start === 0) s = Math.max(s, 900 - Math.min(al.tTitle.length, 40));
    else if (start > 0 && !singleChar) s = Math.max(s, 820 - start * 4);
  }
  if (al.jTitle.startsWith(qJoined)) s = Math.max(s, 870 - Math.min(al.jTitle.length - qJoined.length, 60));
  if (!singleChar) {
    if (s < 760 && qTokens.length > 1 && allTokensPrefixSomewhere(al.tTitle, qTokens)) s = Math.max(s, 760);
    if (s < 650 && al.nTitle.includes(q)) s = Math.max(s, 650 - Math.min(al.nTitle.indexOf(q), 40));
    // "dark moon" → Dark Side of the Moon; "radiohead ok" → OK Computer.
    if (s < 700 && qTokens.length > 1 && allTokensPrefixSomewhere(al.tTitle.concat(al.tArtist), qTokens)) s = Math.max(s, 700);
  }
  if (al.nArtist) {
    if (al.nArtist === q) s = Math.max(s, 770);
    if (al.nArtist.startsWith(q)) s = Math.max(s, 740 - Math.min(al.nArtist.length - q.length, 60));
    {
      const start = consecutivePrefixStart(al.tArtist, qTokens);
      if (start === 0) s = Math.max(s, 720 - Math.min(al.tArtist.length, 40));
      else if (start > 0 && !singleChar) s = Math.max(s, 660 - start * 4);
    }
    if (al.jArtist.startsWith(qJoined)) s = Math.max(s, 700 - Math.min(al.jArtist.length - qJoined.length, 60));
    if (!singleChar) {
      if (s < 600 && qTokens.length > 1 && allTokensPrefixSomewhere(al.tArtist, qTokens)) s = Math.max(s, 600);
      if (s < 520 && al.nArtist.includes(q)) s = Math.max(s, 520 - Math.min(al.nArtist.indexOf(q), 40));
    }
  }
  if (s === 0 && !singleChar && qJoined.length >= 4) {
    if (isSubsequence(qJoined, al.jTitle)) s = 300;
    else if (isSubsequence(qJoined, al.jArtist)) s = 260;
  }
  return s;
}

const LIB_SORTS = ["album", "artist", "year", "added", "plays", "lastplayed", "random"];
const LIB_PLAYED = ["any", "never", "played", "6", "12"];
const ADDED_WINDOWS = [
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "3 months", days: 90 },
  { value: "365", label: "12 months", days: 365 }
];
const CHIP_MAX = 40;

/*
 * An album's release date, as precisely as anything states it: its tags'
 * date ("2024", "2024-03" or "2024-03-15"), else the year, refined by a day
 * MusicBrainz states for the same year ([mbDay], the cache row's JSON). A hand-
 * edited year takes the tags' day with it when they disagree, and never takes a
 * looked-up day of another year.
 */
function releaseDate(year, tagDate, mbDay) {
  if (!year) return null;
  const y = String(year);
  let date = tagDate && String(tagDate).startsWith(y) ? String(tagDate) : y;
  if (mbDay) {
    let d = null;
    try { d = JSON.parse(mbDay).date; } catch (e) { /* not ours */ }
    if (d && String(d).startsWith(y) && String(d).length > date.length) date = String(d);
  }
  return date;
}

/* A date as a sort key: what isn't stated is "00", so "2024" < "2024-01-05". */
function dateKey(date) {
  if (!date) return "";
  const [y, m, d] = String(date).split("-");
  return `${y}-${m || "00"}-${d || "00"}`;
}

class Library {
  constructor(db, { musicRoot = "/music", log = () => {} } = {}) {
    this.db = db;
    this.raw = db.raw;
    this.musicRoot = musicRoot;
    this.log = log;
    this.albums = [];
    this.byId = new Map();
    this.builtAt = 0;
    this.version = 0;
    this.artistKeys = new Set();
    this.viewCache = new Map();
    // Record labels (Stage 8): off until Settings says otherwise; the folder
    // depth a library filed by label uses, and the folders it's read from.
    this.labelRules = { enabled: false, depth: 0, roots: () => [musicRoot] };
    this.q = {
      tracks: this.raw.prepare("SELECT * FROM tracks WHERE album_id = ? ORDER BY COALESCE(disc_no,1), COALESCE(track_no, 9999), path"),
      track: this.raw.prepare("SELECT * FROM tracks WHERE id = ?"),
      trackCount: this.raw.prepare("SELECT COUNT(*) AS n FROM tracks"),
      playsSince: this.raw.prepare("SELECT DISTINCT album_id FROM plays WHERE ts >= ? AND album_id IS NOT NULL"),
      playStats: this.raw.prepare("SELECT album_id, COUNT(*) AS n, MAX(ts) AS t FROM plays WHERE album_id IS NOT NULL GROUP BY album_id")
    };
  }

  /* Rebuild the in-memory copy from the database. */
  reload() {
    const rows = this.raw.prepare(`SELECT a.*, e.title AS e_title, e.artist AS e_artist, e.year AS e_year,
                                          e.art_hash AS e_art_hash, e.art_source AS e_art_source, d.value AS mb_day
                                     FROM albums a LEFT JOIN album_edits e ON e.key = a.key
                                     LEFT JOIN cache d ON d.ns = 'mbday' AND d.key = a.key`).all();
    // One name per artist whatever the leading "The" (v0.6.0-RC10): where the
    // library has "The Beatles", an album tagged "Beatles" is shown as by The
    // Beatles — its artist page, search and links one with theirs.
    const theForms = new Map();
    for (const r of rows) {
      const a = String(r.e_artist || r.artist || "").trim();
      if (/^the\s+\S/i.test(a)) { const k = N.artistKey(a); if (!theForms.has(k)) theForms.set(k, a); }
    }
    // How many discs each album is (v0.6.0): its tracks' disc numbers.
    const discs = new Map(this.raw.prepare("SELECT album_id, COUNT(DISTINCT COALESCE(disc_no, 1)) AS n FROM tracks GROUP BY album_id").all().map(x => [x.album_id, x.n]));
    const albums = rows.map(r => {
      // A hand edit wins over the tags; the scanned values are kept alongside
      // so the editor can show them and put them back.
      const title = r.e_title || r.title || "";
      let artist = r.e_artist || r.artist || "";
      if (!r.e_artist && !/^the\s/i.test(artist) && theForms.has(N.artistKey(artist))) artist = theForms.get(N.artistKey(artist));
      const year = r.e_year || r.year || null;
      const date = releaseDate(year, r.date, r.mb_day);
      const customArt = !!r.e_art_hash;
      const nTitle = N.fold(title);
      const nArtist = N.fold(artist);
      const names = N.splitArtists(artist).map(name => ({ name, n: N.fold(name) })).filter(x => x.n);
      return {
        id: r.id,
        offset: r.id,
        title, subtitle: artist, artist,
        image_key: customArt ? `al-${r.id}-e${r.e_art_hash}` : `al-${r.id}-${r.art_hash || "0"}`,
        nTitle, nArtist,
        tTitle: nTitle.split(" ").filter(Boolean),
        tArtist: nArtist.split(" ").filter(Boolean),
        jTitle: nTitle.replace(/ /g, ""),
        jArtist: nArtist.replace(/ /g, ""),
        sortTitle: (!r.e_title && r.sort_title) || N.sortName(title),
        sortArtist: (!r.e_artist && r.sort_artist) || N.sortName(artist),
        artistNames: names,
        year,
        date,
        dateKey: dateKey(date),
        genres: JSON.parse(r.genres || "[]"),
        rate: r.max_rate || null,
        bits: r.lossless ? (r.max_bits || null) : null,
        lossless: !!r.lossless,
        container: formatName(r.container, r.lossless),
        added: r.added_at || null,
        tracks: r.track_count,
        duration: r.duration,
        compilation: !!r.compilation,
        discs: discs.get(r.id) || 1,
        dir: r.dir,
        artPath: r.art_path,
        artEmbedded: r.art_embedded,
        artHash: r.art_hash,
        key: r.key,
        label: r.label || null,       // the files' LABEL tag, the most common one
        customArt,
        artSource: r.e_art_source || null,
        scanned: { title: r.title || "", artist: r.artist || "", year: r.year || null },
        edited: !!(r.e_title || r.e_artist || r.e_year || customArt),
        // A streamed album (lib/services: Qobuz v0.6.23, Tidal v0.6.24): no files of its own.
        service: SV.ofKey(r.key)
      };
    });
    // One spelling per genre (v0.6.3): "Rock", "rock" and "ROCK" are one
    // genre, shown as most of the library writes it, so the genre list and
    // the Focus sheet don't split it in two. Ties go to the first seen.
    const spellings = new Map();
    for (const al of albums) for (const g of al.genres) {
      const k = N.fold(g);
      if (!k) continue;
      if (!spellings.has(k)) spellings.set(k, new Map());
      const m = spellings.get(k);
      m.set(g, (m.get(g) || 0) + 1);
    }
    const genreAs = new Map();
    for (const [k, m] of spellings) genreAs.set(k, [...m.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]);
    for (const al of albums) {
      al.genres = [...new Set(al.genres.map(g => genreAs.get(N.fold(g)) || g))];
    }
    this.boxSets(albums);
    // A service's albums in your favourites (or purchases) are kept, on the
    // walls like your own; one only played from the service's browser is
    // transient — reachable by id (the queue, Now playing, its page), off
    // the walls. Signed out of the service, none of them: the rows stay for
    // the sign-in that follows (Clean up removes them).
    const kept = new Set(this.raw.prepare("SELECT key FROM cache WHERE ns IN ('qobuz-kept', 'tidal-kept')").all().map(r => r.key));
    const signedIn = {};
    for (const id of SV.IDS) signedIn[id] = !!this.db.setting(id, null);
    for (const a of albums) a.transient = !!a.service && (!signedIn[a.service] || !kept.has(a.key));
    this.albums = albums.filter(a => !a.transient);
    this.byId = new Map(albums.map(a => [a.id, a]));
    this.favKeys = new Map(this.raw.prepare("SELECT key, added_at FROM favourites").all().map(r => [r.key, r.added_at]));
    this.laterKeys = new Map(this.raw.prepare("SELECT key, added_at FROM listen_later").all().map(r => [r.key, r.added_at]));
    this.loadLabelMerges();
    this.loadLabelLookups(false);
    // Corrected track titles (lib/identify), by album key then place on the album.
    this.trackEdits = new Map();
    for (const r of this.raw.prepare("SELECT key, pos, title FROM track_edits WHERE title IS NOT NULL").all()) {
      if (!this.trackEdits.has(r.key)) this.trackEdits.set(r.key, new Map());
      this.trackEdits.get(r.key).set(r.pos, r.title);
    }
    this.artistKeys = new Set();
    for (const a of this.albums) for (const n of a.artistNames) this.artistKeys.add(n.n);
    this.applyLabelRules();
    this.builtAt = Date.now();
    this.version++;
    this.viewCache.clear();
  }

  // ------------------------------------------------------------ labels

  /* Settings → Record labels: on or off, and the folder depth. */
  setLabelRules(rules) {
    Object.assign(this.labelRules, rules || {});
    this.applyLabelRules();
    this.version++;
    this.viewCache.clear();
  }
  /* Each album's label name and key under the rules: the folder at the set
   * depth when there is one, else the files' tag; neither when it isn't a
   * label's name (lib/labels.js). */
  applyLabelRules() {
    const { depth, roots } = this.labelRules;
    const dirs = depth ? roots() : null;
    for (const al of this.albums) {
      let name = depth ? LB.labelFromFolder(al.dir, dirs, depth) : null, source = "folder";
      if (!name) { name = al.label; source = "tag"; }
      if (LB.isLikelyNotALabel(name)) name = null;
      // Nothing of its own: what was looked up for it (lib/labellookup.js).
      if (!name && this.labelLookups && this.labelLookups.has(al.key)) { name = this.labelLookups.get(al.key); source = "lookup"; }
      al.labelName = name ? LB.canonicalLabelName(name) : null;
      al.labelKey = name ? LB.labelKey(name) : null;
      al.labelSource = name ? source : null;
    }
  }
  /* The labels looked up for untagged albums (label_lookups), by album key. */
  loadLabelLookups(apply = true) {
    this.labelLookups = new Map();
    try {
      for (const r of this.raw.prepare("SELECT key, label FROM label_lookups WHERE label IS NOT NULL").all()) this.labelLookups.set(r.key, r.label);
    } catch (e) { /* an older database without the table */ }
    if (apply) { this.applyLabelRules(); this.version++; this.viewCache.clear(); }
  }
  labelsOn() { return !!this.labelRules.enabled; }
  /* An album's label as shown, or null: the label it was merged into, if any. */
  labelOf(al) {
    if (!al || !this.labelsOn() || !al.labelName) return null;
    const m = this.labelMerges && this.labelMerges.get(al.labelKey);
    if (!m) return al.labelName;
    const g = this.labelGroups().get(m.target_key);
    return g ? g.title : al.labelName;
  }
  /* Merged labels (label_merges): source key → { target_key, source_name }.
   * A chain (A into B, then B into C) is followed to its end. */
  loadLabelMerges() {
    const rows = this.raw.prepare("SELECT source_key, source_name, target_key FROM label_merges").all();
    const direct = new Map(rows.map(r => [r.source_key, r]));
    this.labelMerges = new Map();
    for (const r of rows) {
      let t = r.target_key, hops = 0;
      while (direct.has(t) && hops++ < 20 && t !== r.source_key) t = direct.get(t).target_key;
      this.labelMerges.set(r.source_key, { target_key: t, source_name: r.source_name });
    }
    this.version++;
    this.viewCache.clear();
  }
  /* The key a label's albums gather under: its own, or the label it was merged into. */
  mergedKey(key) {
    const m = this.labelMerges && this.labelMerges.get(key);
    return m ? m.target_key : key;
  }
  /* Every label, with its albums, by key — merged labels folded into their
   * target. Built once per library version: the facet asks per album. */
  labelGroups() {
    if (this.labelGroupsMemo && this.labelGroupsMemo.version === this.version) return this.labelGroupsMemo.map;
    const m = this.buildLabelGroups();
    this.labelGroupsMemo = { version: this.version, map: m };
    return m;
  }
  buildLabelGroups() {
    const m = new Map();
    for (const al of this.albums) {
      if (!al.labelKey) continue;
      const key = this.mergedKey(al.labelKey);
      let g = m.get(key);
      if (!g) { g = { key, names: new Map(), ownNames: new Map(), albums: [], mergedFrom: [] }; m.set(key, g); }
      g.albums.push(al);
      g.names.set(al.labelName, (g.names.get(al.labelName) || 0) + 1);
      if (key === al.labelKey) g.ownNames.set(al.labelName, (g.ownNames.get(al.labelName) || 0) + 1);
    }
    if (this.labelMerges) {
      for (const [src, mg] of this.labelMerges) {
        const g = m.get(mg.target_key);
        if (g) g.mergedFrom.push({ key: src, display: mg.source_name });
      }
    }
    for (const g of m.values()) {
      // The name most of its own albums use (the merged-in ones don't rename it); the shorter one when tied.
      const pick = names => [...names.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
      g.title = g.ownNames.size ? pick(g.ownNames) : pick(g.names);
      g.albums.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle) || a.nArtist.localeCompare(b.nArtist));
      g.mergedFrom.sort((a, b) => a.display.localeCompare(b.display));
    }
    return m;
  }
  /* The Labels wall: every label, alphabetical, in the shape its tiles take.
   * [logos] maps a key to its logo's address. */
  labels(logos) {
    if (!this.labelsOn()) return [];
    return [...this.labelGroups().values()].map(g => ({
      key: g.key, title: g.title,
      subtitle: `${g.albums.length.toLocaleString()} album${g.albums.length === 1 ? "" : "s"}`,
      albumCount: g.albums.length, image_key: g.albums[0].image_key,
      logo_url: (logos && logos.get(g.key)) || null, mergedFrom: g.mergedFrom
    })).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  }
  /* A label's albums by any of its names: alphabetical, or shuffled. */
  labelAlbums(name, order) {
    if (!this.labelsOn()) return null;
    const g = this.labelGroups().get(this.mergedKey(LB.labelKey(name)));
    if (!g) return null;
    const albums = g.albums.slice();
    if (order === "random") for (let i = albums.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [albums[i], albums[j]] = [albums[j], albums[i]]; }
    return { key: g.key, title: g.title, albums, mergedFrom: g.mergedFrom };
  }
  /* Fold labels into the first: [items] is [{ key, display }], the target first.
   * A label that was itself a target carries what was merged into it along. */
  mergeLabels(items) {
    const target = items[0].key;
    const now = Date.now();
    this.raw.transaction(() => {
      for (const it of items.slice(1)) {
        if (!it.key || it.key === target) continue;
        this.raw.prepare("DELETE FROM label_merges WHERE source_key = ?").run(target);   // the target is nobody's source now
        this.raw.prepare(`INSERT INTO label_merges(source_key, source_name, target_key, merged_at) VALUES(?, ?, ?, ?)
                          ON CONFLICT(source_key) DO UPDATE SET source_name=excluded.source_name, target_key=excluded.target_key, merged_at=excluded.merged_at`)
          .run(it.key, String(it.display || it.key), target, now);
        this.raw.prepare("UPDATE label_merges SET target_key = ? WHERE target_key = ?").run(target, it.key);
      }
    })();
    this.loadLabelMerges();
  }
  unmergeLabel(sourceKey) {
    const n = this.raw.prepare("DELETE FROM label_merges WHERE source_key = ?").run(sourceKey).changes;
    this.loadLabelMerges();
    return n > 0;
  }
  searchLabels(query) {
    if (!this.labelsOn()) return [];
    const q = N.fold(query);
    if (!q) return [];
    const out = [];
    for (const g of this.labelGroups().values()) {
      const n = N.fold(g.title);
      const merged = g.mergedFrom.some(x => N.fold(x.display).includes(q));
      if (n.includes(q) || g.key.includes(q.replace(/ /g, "")) || merged) out.push({ display: g.title, albumCount: g.albums.length, logo_url: null, n });
    }
    return out.sort((a, b) => (a.n.startsWith(q) ? 0 : 1) - (b.n.startsWith(q) ? 0 : 1) || b.albumCount - a.albumCount)
      .slice(0, 10).map(({ display, albumCount, logo_url }) => ({ display, albumCount, logo_url }));
  }
  /* How many albums the tags (or folders) name a label for, and how many they don't. */
  labelStats() {
    const groups = this.labelGroups();
    let tagged = 0, lookedUp = 0;
    for (const al of this.albums) { if (al.labelSource === "lookup") lookedUp++; else if (al.labelKey) tagged++; }
    return { labels: groups.size, tagged, lookedUp, untagged: this.albums.length - tagged - lookedUp, total: this.albums.length };
  }
  /* One label a week, from those with three albums or more: the same one all
   * week, whichever device asks. */
  labelOfTheWeek(weekKey) {
    if (!this.labelsOn()) return null;
    const groups = this.labelGroups();
    const keys = [...groups.values()].filter(g => g.albums.length >= 3).map(g => g.key).sort();
    if (!keys.length) return null;
    const g = groups.get(keys[fnv1a(String(weekKey)) % keys.length]);
    return { key: g.key, label: g.title, albums: g.albums.slice(0, 24) };
  }

  /* A day found for an album known only to its year or month (lib/library/dates.js). */
  setLookedUpDay(key, day) {
    for (const al of this.albums) {
      if (al.key !== key) continue;
      const date = releaseDate(al.year, al.date, JSON.stringify({ date: day }));
      if (date === al.date) continue;
      al.date = date;
      al.dateKey = dateKey(date);
      this.version++;
      this.viewCache.clear();
    }
  }

  get count() { return this.albums.length; }
  trackCount() { return this.q.trackCount.get().n; }

  album(id) { return this.byId.get(Number(id)) || null; }

  // ------------------------------------------------------------ edits

  /* Lay corrections over an album. `fields` may carry title, artist, year
   * (an empty value puts back what was scanned) and art: a Buffer with its
   * source, or null to drop a found cover. */
  saveEdit(id, fields) {
    const al = this.album(id);
    if (!al) return null;
    const cur = this.raw.prepare("SELECT * FROM album_edits WHERE key = ?").get(al.key) || {};
    const next = {
      key: al.key,
      title: cur.title || null, artist: cur.artist || null, year: cur.year || null,
      art: cur.art || null, art_hash: cur.art_hash || null, art_source: cur.art_source || null,
      updated_at: Date.now()
    };
    const text = (v, scanned) => {
      const t = String(v == null ? "" : v).trim();
      return t && t !== scanned ? t : null;
    };
    if ("title" in fields) next.title = text(fields.title, al.scanned.title);
    if ("artist" in fields) next.artist = text(fields.artist, al.scanned.artist);
    if ("year" in fields) {
      const y = parseInt(fields.year, 10);
      next.year = y >= 1000 && y <= 2999 && y !== al.scanned.year ? y : null;
    }
    if ("art" in fields) {
      const a = fields.art;
      next.art = a ? a.buf : null;
      next.art_hash = a ? require("crypto").createHash("sha1").update(a.buf).digest("hex").slice(0, 12) : null;
      next.art_source = a ? (a.source || null) : null;
    }
    if (!next.title && !next.artist && !next.year && !next.art) {
      this.raw.prepare("DELETE FROM album_edits WHERE key = ?").run(al.key);
    } else {
      this.raw.prepare(`INSERT INTO album_edits(key, title, artist, year, art, art_hash, art_source, updated_at)
                        VALUES(@key, @title, @artist, @year, @art, @art_hash, @art_source, @updated_at)
                        ON CONFLICT(key) DO UPDATE SET title=excluded.title, artist=excluded.artist, year=excluded.year,
                          art=excluded.art, art_hash=excluded.art_hash, art_source=excluded.art_source,
                          updated_at=excluded.updated_at`).run(next);
    }
    if (this.db.backupEdits) this.db.backupEdits();
    this.reload();
    return this.album(id);
  }

  clearEdits(id) {
    const al = this.album(id);
    if (!al) return null;
    this.raw.prepare("DELETE FROM album_edits WHERE key = ?").run(al.key);
    if (this.db.backupEdits) this.db.backupEdits();
    this.reload();
    return this.album(id);
  }

  editedArt(id) {
    const al = this.album(id);
    if (!al || !al.customArt) return null;
    const r = this.raw.prepare("SELECT art FROM album_edits WHERE key = ?").get(al.key);
    return r && r.art ? r.art : null;
  }
  /* An album's tracks in playing order, each with its corrected title laid
   * over the tagged one (the tagged one kept as scanned_title). */
  tracks(albumId) {
    const rows = this.q.tracks.all(Number(albumId));
    const al = this.album(albumId);
    const edits = al && this.trackEdits && this.trackEdits.get(al.key);
    if (!edits || !edits.size) return rows;
    return rows.map((t, i) => this.overlayTrack(t, edits, i));
  }
  track(id) {
    const t = this.q.track.get(Number(id));
    if (!t) return null;
    const al = this.album(t.album_id);
    const edits = al && this.trackEdits && this.trackEdits.get(al.key);
    if (!edits || !edits.size) return t;
    // Its place among the album's tracks: needed only when the number is missing.
    const i = t.track_no ? 0 : this.q.tracks.all(t.album_id).findIndex(x => x.id === t.id);
    return this.overlayTrack(t, edits, i);
  }
  /* Where a track sits on its album, as track_edits keys it: "disc-number",
   * or "disc-p<index>" for a file with no track number. */
  trackPos(t, i) { return `${t.disc_no || 1}-${t.track_no ? t.track_no : "p" + (i + 1)}`; }
  overlayTrack(t, edits, i) {
    const title = edits.get(this.trackPos(t, i));
    return title ? Object.assign({}, t, { title, scanned_title: t.title }) : t;
  }
  /* Lay corrected titles over an album's tracks: `titles` maps a track's
   * position (trackPos) to its title, or null to put the tagged one back.
   * Nothing is written for a title that only repeats the tag. */
  saveTrackEdits(id, titles) {
    const al = this.album(id);
    if (!al) return null;
    const rows = this.q.tracks.all(al.id);
    const put = this.raw.prepare("INSERT INTO track_edits(key, pos, title) VALUES(?, ?, ?) ON CONFLICT(key, pos) DO UPDATE SET title = excluded.title");
    const del = this.raw.prepare("DELETE FROM track_edits WHERE key = ? AND pos = ?");
    this.raw.transaction(() => {
      for (const [pos, title] of Object.entries(titles || {})) {
        const t = String(title == null ? "" : title).trim();
        const i = rows.findIndex((r, k) => this.trackPos(r, k) === pos);
        const tagged = i >= 0 ? (rows[i].title || "") : null;
        if (!t || t === tagged) del.run(al.key, pos); else put.run(al.key, pos, t);
      }
    })();
    this.reload();
    return al;
  }
  clearTrackEdits(id) {
    const al = this.album(id);
    if (!al) return null;
    this.raw.prepare("DELETE FROM track_edits WHERE key = ?").run(al.key);
    this.reload();
    return al;
  }
  trackEditsOf(al) {
    const m = al && this.trackEdits && this.trackEdits.get(al.key);
    return m ? Object.fromEntries(m) : {};
  }

  qualityOf(al) {
    if (!al) return {};
    if (!al.lossless) return { quality: al.container || null, hires: false };
    let q = null;
    if (al.bits && al.rate) q = al.bits + "/" + rateShort(al.rate);
    else if (al.rate) q = rateShort(al.rate) + " kHz";
    return { quality: q || al.container, hires: !!((al.bits && al.bits > 16) || (al.rate && al.rate > 48000)) };
  }

  /*
   * Box sets filed as discs that are albums of their own (v0.6.3):
   *
   *   Yes - The Steven Wilson Remixes (2018)/
   *     Disc 1 - The Yes Album (1971)/   ← its own album, by its tags
   *     Disc 4 - Tales From Topographic Oceans (1973)/
   *
   * An album whose tracks all sit in one "Disc N - Name" folder, beside
   * another such folder holding a different album, is that disc of the box
   * the parent folder names. Each stays its own album; al.box says where it
   * came from — { name, disc, of, ids } — for the page to say so. Plain
   * "Disc 1", "CD2" folders are one album's discs, as before.
   */
  boxSets(albums) {
    const NAMED_DISC = /^(?:cd|disc|disk)\s*[-_.]?\s*(\d+)\s*[-–—:_.]\s*(\S.*)$/i;
    const dirs = new Map();
    for (const r of this.raw.prepare("SELECT album_id, path FROM tracks").all()) {
      if (!dirs.has(r.album_id)) dirs.set(r.album_id, new Set());
      dirs.get(r.album_id).add(path.dirname(r.path));
    }
    const byParent = new Map();
    for (const al of albums) {
      al.box = null;
      const set = dirs.get(al.id);
      if (!set || set.size !== 1) continue;
      const dir = [...set][0];
      const m = NAMED_DISC.exec(path.basename(dir));
      if (!m) continue;
      const parent = path.dirname(dir);
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push({ al, disc: Number(m[1]), dir });
    }
    for (const [parent, list] of byParent) {
      if (new Set(list.map(x => x.dir)).size < 2) continue;
      list.sort((a, b) => a.disc - b.disc);
      // "Yes - The Steven Wilson Remixes (2018)": the artist's own name
      // in front is the artist, not the box's name.
      let name = path.basename(parent);
      const lead = /^(.+?)\s+[-–—]\s+(.+)$/.exec(name);
      if (lead && list.some(x => N.artistKey(x.al.artist) === N.artistKey(lead[1]))) name = lead[2];
      const ids = list.map(x => x.al.id);
      // "of": the discs there are, at least the highest number filed (a box
      // with one disc missing is still disc 4 of 5).
      const of = Math.max(list.length, list[list.length - 1].disc);
      for (const x of list) x.al.box = { name, disc: x.disc, of, ids };
    }
  }

  json(al, extra) {
    if (!al) return null;
    const q = this.qualityOf(al);
    const out = { offset: al.id, title: al.title, subtitle: al.subtitle, image_key: al.image_key, source: al.service || null };
    if (al.service) out[al.service + "_id"] = out.service_id = SV.albumIdOf(al.key);
    if (this.favKeys && this.favKeys.has(al.key)) out.favourite = true;
    if (this.laterKeys && this.laterKeys.has(al.key)) out.later = true;
    if (q.quality) out.quality = q.quality;
    if (q.hires) out.hires = true;
    if (al.year) out.year = al.year;
    if (al.discs > 1) out.discs = al.discs;
    if (al.box) out.box = { name: al.box.name, disc: al.box.disc, of: al.box.of };
    return extra ? Object.assign(out, extra) : out;
  }

  // ------------------------------------------------------------ favourites

  /* The hearted albums, newest heart first. */
  favourites() {
    if (!this.favKeys) return [];
    return this.albums.filter(al => this.favKeys.has(al.key))
      .sort((a, b) => (this.favKeys.get(b.key) || 0) - (this.favKeys.get(a.key) || 0));
  }
  isFavourite(al) { return !!(al && this.favKeys && this.favKeys.has(al.key)); }

  // ------------------------------------------------------------ listen later

  /* The albums put aside, newest first. */
  listenLater() {
    if (!this.laterKeys) return [];
    return this.albums.filter(al => this.laterKeys.has(al.key))
      .sort((a, b) => (this.laterKeys.get(b.key) || 0) - (this.laterKeys.get(a.key) || 0));
  }
  isLater(al) { return !!(al && this.laterKeys && this.laterKeys.has(al.key)); }
  setLater(id, on) {
    const al = this.album(id);
    if (!al) return null;
    if (on) {
      const now = Date.now();
      this.raw.prepare("INSERT INTO listen_later(key, added_at) VALUES(?, ?) ON CONFLICT(key) DO NOTHING").run(al.key, now);
      if (!this.laterKeys.has(al.key)) this.laterKeys.set(al.key, now);
    } else {
      this.raw.prepare("DELETE FROM listen_later WHERE key = ?").run(al.key);
      this.laterKeys.delete(al.key);
    }
    return al;
  }
  /*
   * A play was recorded for a track of this album: once every track has a
   * play since the album was put aside (a track counts as played once it is
   * well under way — zones.js), the album comes off the list. An album left
   * part way stays.
   */
  laterPlayed(albumId) {
    const al = this.album(albumId);
    if (!al || !this.laterKeys || !this.laterKeys.has(al.key)) return false;
    const since = this.laterKeys.get(al.key) || 0;
    const played = new Set(this.raw.prepare("SELECT DISTINCT track_id FROM plays WHERE album_id = ? AND ts >= ? AND track_id IS NOT NULL").all(al.id, since).map(r => r.track_id));
    const tracks = this.tracks(al.id);
    if (!tracks.length || tracks.some(t => !played.has(t.id))) return false;
    this.setLater(al.id, false);
    return true;
  }
  setFavourite(id, on) {
    const al = this.album(id);
    if (!al) return null;
    if (on) {
      const now = Date.now();
      this.raw.prepare("INSERT INTO favourites(key, added_at) VALUES(?, ?) ON CONFLICT(key) DO NOTHING").run(al.key, now);
      if (!this.favKeys.has(al.key)) this.favKeys.set(al.key, now);
    } else {
      this.raw.prepare("DELETE FROM favourites WHERE key = ?").run(al.key);
      this.favKeys.delete(al.key);
    }
    return al;
  }

  /* Find an album by title and artist: what a speaker says is playing, a
   * row of play history, a page asking for write-ups. An edited album answers
   * to its new names and to the ones in its files (a queue or a history
   * entry from before the edit still carries those). A title made only of
   * punctuation — Sigur Rós's "( )" — is compared as written. */
  relocate(title, artist) {
    const fold = s => N.fold(s) || String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
    const t = fold(title);
    if (!t) return null;
    const a = N.fold(artist || "");
    const titles = al => al.edited ? [fold(al.title), fold(al.scanned.title)] : [fold(al.title)];
    const artistOk = al => !a || al.nArtist === a || al.artistNames.some(n => n.n === a) ||
      (al.edited && N.fold(al.scanned.artist) === a);
    let best = null;
    for (const al of this.albums) {
      if (!titles(al).includes(t)) continue;
      if (artistOk(al)) return al;
      best = best || al;
    }
    return best;
  }

  // ------------------------------------------------------------ plays

  playedAlbumIdsSince(ts) {
    return new Set(this.q.playsSince.all(ts).map(r => r.album_id));
  }
  playStats() {
    const count = new Map(), last = new Map();
    for (const r of this.q.playStats.all()) { count.set(r.album_id, r.n); last.set(r.album_id, r.t); }
    return { count, last };
  }

  // ----------------------------------------------------------- search

  search(query, limit = 60) {
    const q = N.fold(query);
    if (!q) return [];
    const qTokens = q.split(" ").filter(Boolean);
    const qJoined = q.replace(/ /g, "");
    const singleChar = qJoined.length <= 1;
    const out = [];
    for (const al of this.albums) {
      const score = scoreAlbum(al, q, qTokens, qJoined, singleChar);
      if (score > 0) out.push({ al, score });
    }
    out.sort((a, b) => b.score - a.score || a.al.nTitle.localeCompare(b.al.nTitle) || a.al.nArtist.localeCompare(b.al.nArtist));
    return out.slice(0, limit).map(({ al, score }) => this.json(al, { score }));
  }

  searchArtists(query) {
    const q = N.fold(query);
    if (!q) return [];
    const seen = new Map();
    for (const al of this.albums) {
      for (const { name, n } of al.artistNames) {
        if (!n.includes(q)) continue;
        if (seen.has(n)) seen.get(n).count++;
        else seen.set(n, { name, n, count: 1, albumCount: 0 });
      }
    }
    return [...seen.values()]
      .map(x => Object.assign(x, { albumCount: x.count }))
      .sort((a, b) => (a.n.startsWith(q) ? 0 : 1) - (b.n.startsWith(q) ? 0 : 1) || b.count - a.count)
      .slice(0, 8);
  }

  // ---------------------------------------------------- lists & facets

  artistAlbums(name) {
    // "Beatles" and "The Beatles" are one artist (v0.6.0-RC10).
    const q = N.artistKey(name);
    const primary = [], featured = [];
    if (!q) return { primary, featured };
    for (const al of this.albums) {
      const whole = N.artistKey(al.artist);
      const names = al.artistNames.map(x => N.artistKey(x.name));
      if (whole !== q && !names.includes(q)) continue;
      if (whole === q || names[0] === q) primary.push(al); else featured.push(al);
    }
    // A compilation track credit: albums where this artist is on a track but
    // not the album credit. Found through the tracks table.
    const viaTracks = this.raw.prepare(
      "SELECT DISTINCT album_id FROM tracks WHERE lower(artist) IN (lower(?), lower(?), lower(?)) LIMIT 200")
      .all(name, String(name).replace(/^the\s+/i, ""), /^the\s/i.test(name) ? name : "The " + name);
    for (const r of viaTracks) {
      const al = this.byId.get(r.album_id);
      if (al && !primary.includes(al) && !featured.includes(al)) featured.push(al);
    }
    const byYear = (a, b) => (a.year || 9999) - (b.year || 9999) || a.sortTitle.localeCompare(b.sortTitle);
    primary.sort(byYear); featured.sort(byYear);
    return { primary, featured };
  }

  artists(sort = "az", seed = 1) {
    const m = new Map();
    for (const al of this.albums) {
      if (al.compilation) continue;
      for (const { name, n } of al.artistNames) {
        if (!m.has(n)) m.set(n, { name, n, albumCount: 0, image_key: al.image_key, sortName: N.sortName(name) });
        m.get(n).albumCount++;
      }
    }
    const list = [...m.values()];
    if (sort === "random") list.sort((a, b) => seededRank(a.n, seed) - seededRank(b.n, seed));
    else if (sort === "albums") list.sort((a, b) => b.albumCount - a.albumCount || a.sortName.localeCompare(b.sortName));
    else list.sort((a, b) => a.sortName.localeCompare(b.sortName));
    return list;
  }

  genres() {
    const m = new Map();
    for (const al of this.albums) for (const g of al.genres) m.set(g, (m.get(g) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([title, n]) => ({
      title, subtitle: `${n.toLocaleString()} album${n === 1 ? "" : "s"}`, count: n
    }));
  }

  decades() {
    const m = new Map();
    for (const al of this.albums) {
      if (!al.year) continue;
      const d = Math.floor(al.year / 10) * 10;
      m.set(d, (m.get(d) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([d, n]) => ({
      title: d + "s", subtitle: `${n.toLocaleString()} album${n === 1 ? "" : "s"}`, count: n
    }));
  }

  facetDefs() {
    return [
      { id: "genre", label: "Genre", values: al => al.genres },
      { id: "decade", label: "Decade", sort: "numeric-desc", labels: v => v + "s",
        values: al => al.year ? [String(Math.floor(al.year / 10) * 10)] : [] },
      // Record label (Stage 8): in the Focus sheet only while labels are on.
      this.labelsOn() ? { id: "label", label: "Record label", values: al => { const l = this.labelOf(al); return l ? [l] : []; } } : null,
      { id: "format", label: "Format", values: al => al.container ? [al.container] : [] },
      { id: "rate", label: "Sample rate", sort: "numeric-asc", labels: v => rateLabel(parseInt(v, 10)) || v,
        values: al => al.rate ? [String(al.rate)] : [] },
      { id: "bits", label: "Bit depth", sort: "numeric-asc", labels: v => v + "-bit",
        values: al => al.bits ? [String(al.bits)] : [] },
      { id: "letter", label: "Starts with",
        values: al => { const c = (al.sortTitle || "").charAt(0).toUpperCase(); return c ? [/[A-Z]/.test(c) ? c : "#"] : []; } },
      { id: "added", label: "Added in the last", sort: "none",
        labels: v => (ADDED_WINDOWS.find(w => w.value === v) || { label: v }).label,
        values: al => {
          if (!al.added) return [];
          const age = Date.now() - al.added;
          return ADDED_WINDOWS.filter(w => age <= w.days * 86400000).map(w => w.value);
        } }
    ].filter(Boolean);
  }

  facets() {
    const defs = this.facetDefs();
    const counts = defs.map(() => new Map());
    for (const al of this.albums) {
      for (let i = 0; i < defs.length; i++) {
        for (const v of defs[i].values(al)) counts[i].set(v, (counts[i].get(v) || 0) + 1);
      }
    }
    const facets = defs.map((def, i) => {
      const m = counts[i];
      let values = [...m.keys()];
      if (def.sort === "numeric-desc") values.sort((a, b) => parseFloat(b) - parseFloat(a));
      else if (def.sort === "numeric-asc") values.sort((a, b) => parseFloat(a) - parseFloat(b));
      else if (def.sort === "none") values = ADDED_WINDOWS.map(w => w.value).filter(v => m.has(v));
      else values.sort((a, b) => (m.get(b) - m.get(a)) || a.localeCompare(b));
      const labelOf = v => typeof def.labels === "function" ? def.labels(v) : v;
      return {
        id: def.id, label: def.label, total_values: values.length,
        values: values.slice(0, CHIP_MAX).map(v => ({ value: v, label: labelOf(v), count: m.get(v) }))
      };
    }).filter(f => f.values.length);
    const countWith = id => {
      const def = defs.find(d => d.id === id);
      return this.albums.filter(al => def.values(al).length).length;
    };
    let hasPlays = false;
    try { hasPlays = !!this.raw.prepare("SELECT 1 FROM plays LIMIT 1").get(); } catch (e) { /* no table yet */ }
    return {
      total: this.albums.length,
      facets,
      coverage: {
        decade: countWith("decade"), genre: countWith("genre"),
        format: countWith("format"), added: countWith("added")
      },
      sources_derived: false,
      played: LIB_PLAYED,
      hasPlays
    };
  }

  /*
   * The Library wall: facets (a "!" prefix excludes), a starts-with prefix,
   * listening history, then one of seven sorts. Same vocabulary as MusicD
   * Remote's libraryView, so saved dynamic playlists carry over unchanged.
   */
  view(q = {}) {
    const sort = LIB_SORTS.includes(String(q.sort || "")) ? String(q.sort) : "album";
    const desc = String(q.dir || "asc") === "desc";
    const seed = parseInt(q.seed, 10) || 1;
    const played = String(q.played || "any");
    const asList = v => (v === undefined || v === null ? [] : (Array.isArray(v) ? v : [v])).map(String).filter(Boolean);
    const defs = this.facetDefs();
    const picked = defs.map(d => ({ def: d, sel: asList(q[d.id]) })).filter(x => x.sel.length);
    const prefix = N.fold(q.prefix || "").slice(0, 40);
    const sig = [this.version, sort, desc, seed, played, prefix]
      .concat(picked.map(x => x.def.id + "=" + x.sel.slice().sort().join(","))).join("|");
    const usesPlays = played !== "any" || sort === "plays" || sort === "lastplayed";
    const hit = !usesPlays && !prefix ? this.viewCache.get(sig) : null;
    if (hit) return hit;

    let list = this.albums;
    for (const { def, sel } of picked) list = list.filter(al => facetMatch(sel, def.values(al)));
    if (prefix) {
      list = list.filter(al => al.sortTitle.startsWith(prefix) || al.nTitle.startsWith(prefix) ||
        al.nArtist.startsWith(prefix) || al.artistNames.some(a => a.n.startsWith(prefix)));
    }
    if (played !== "any") {
      const months = parseInt(played, 10);
      const since = (played === "never" || played === "played") ? 0
        : Date.now() - (Number.isFinite(months) && months > 0 ? months : 6) * 30 * 86400000;
      const seen = this.playedAlbumIdsSince(since);
      const want = played === "played";
      list = list.filter(al => seen.has(al.id) === want);
    }
    const stats = (sort === "plays" || sort === "lastplayed") ? this.playStats() : null;
    const cmp = {
      album: (a, b) => a.sortTitle.localeCompare(b.sortTitle) || a.nArtist.localeCompare(b.nArtist),
      artist: (a, b) => a.sortArtist.localeCompare(b.sortArtist) || (a.year || 0) - (b.year || 0) || a.sortTitle.localeCompare(b.sortTitle),
      // By the day wherever it's known (see releaseDate): a year alone sorts
      // after that year's dated albums newest-first, and before them oldest-first.
      year: (a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0) || a.sortTitle.localeCompare(b.sortTitle),
      added: (a, b) => a.added - b.added || a.sortTitle.localeCompare(b.sortTitle),
      plays: (a, b) => (stats.count.get(a.id) || 0) - (stats.count.get(b.id) || 0) || a.sortTitle.localeCompare(b.sortTitle),
      lastplayed: (a, b) => (stats.last.get(a.id) || 0) - (stats.last.get(b.id) || 0) || a.sortTitle.localeCompare(b.sortTitle),
      random: (a, b) => seededRank(a.nTitle + a.nArtist, seed) - seededRank(b.nTitle + b.nArtist, seed)
    }[sort];
    let out;
    if (sort === "year" || sort === "added") {
      const key = sort === "year" ? "year" : "added";
      const known = [], unknown = [];
      for (const al of list) (al[key] ? known : unknown).push(al);
      known.sort(cmp);
      if (desc) known.reverse();
      unknown.sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
      out = known.concat(unknown);
    } else {
      out = list.slice().sort(cmp);
      if (desc) out.reverse();
    }
    if (!usesPlays && !prefix) {
      if (this.viewCache.size > 64) this.viewCache.delete(this.viewCache.keys().next().value);
      this.viewCache.set(sig, out);
    }
    return out;
  }

  /* A random draw, optionally filtered, optionally seeded (Home's daily row). */
  random(count, filter, seed) {
    let pool = this.albums;
    if (filter) pool = this.filtered(filter);
    const n = Math.min(count, pool.length);
    if (seed != null && Number.isFinite(Number(seed))) {
      return { albums: pool.slice().sort((a, b) => seededRank(a.nTitle + a.nArtist, Number(seed)) - seededRank(b.nTitle + b.nArtist, Number(seed))).slice(0, n), total: pool.length };
    }
    const picked = new Set();
    while (picked.size < n) picked.add(Math.floor(Math.random() * pool.length));
    return { albums: [...picked].map(i => pool[i]), total: pool.length };
  }

  filtered(f) {
    const v = N.fold(f.value);
    if (f.type === "genre") return this.albums.filter(al => al.genres.some(g => N.fold(g) === v));
    if (f.type === "decade") {
      const d = parseInt(String(f.value), 10);
      return this.albums.filter(al => al.year && al.year >= d && al.year < d + 10);
    }
    if (f.type === "label") { const r = this.labelAlbums(f.value); return r ? r.albums : []; }
    return [];   // tags: a Roon feature with no file-tag equivalent
  }

  /**
   * Album of the day's day ("2026-10-3"), on the server's clock (TZ): it turns
   * over at 00:01, so a minute is taken off before the date is read.
   */
  dayKey(now = new Date()) {
    const d = new Date(now.getTime() - 60 * 1000);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }

  /** When that day began: today's 00:01 (yesterday's, in the minute after midnight). */
  dayStart(now = new Date()) {
    const d = new Date(now.getTime() - 60 * 1000);
    d.setHours(0, 1, 0, 0);
    return d.getTime();
  }

  /*
   * The day's album. Chosen once, at the first ask after 00:01, and kept in
   * the database (v0.6.0-RC8) — before, it was worked out afresh on every ask
   * from the date and the album list, so a scan that added or removed one
   * album, or a restart while the library was being read, put a different
   * album there mid-day, and one already played came back as a "new" one.
   * Now it stays the day's album through scans, updates and restarts; only a
   * new day, or the album leaving the library, chooses again.
   */
  albumOfTheDay(now = new Date()) {
    if (!this.albums.length) return null;
    const day = this.dayKey(now);
    const kept = this.db.setting ? this.db.setting("album_of_the_day", null) : null;
    if (kept && kept.day === day) {
      const al = (kept.key && this.albums.find(a => a.key === kept.key)) || this.byId.get(kept.id);
      if (al) return al;
    }
    const sorted = this.albums.slice().sort((a, b) => a.id - b.id);
    const al = sorted[fnv1a(day) % sorted.length];
    if (this.db.setSetting) this.db.setSetting("album_of_the_day", { day, key: al.key, id: al.id, at: now.getTime() });
    return al;
  }
}

function facetMatch(selected, values) {
  if (!selected || !selected.length) return true;
  let wanted = false, sawInclude = false;
  for (const sel of selected) {
    if (sel.charAt(0) === "!") { if (values.includes(sel.slice(1))) return false; }
    else { sawInclude = true; if (values.includes(sel)) wanted = true; }
  }
  return sawInclude ? wanted : true;
}

module.exports = { Library, seededRank, fnv1a, rateShort, rateLabel, channelLabel, formatName, LIB_SORTS, LIB_PLAYED, releaseDate, dateKey };
