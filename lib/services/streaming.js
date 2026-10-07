"use strict";
/*
 * services/streaming.js — what a streaming service is to Mandarin, shared by
 * Qobuz (lib/qobuz, v0.6.23) and Tidal (lib/tidal, v0.6.24): an account kept
 * as a setting, the service's albums as rows in the library, its playlists
 * as playlists here, the stream behind /stream for its tracks.
 *
 * How a streamed album is a library album: a row in `albums` with the key
 * "<service>:<id>" and no folder, its tracks rows in `tracks` whose path is
 * "<service>://track/<id>". The scanner leaves those alone. The ones in your
 * favourites (and, on Qobuz, purchases) are KEPT (the cache table, ns
 * <service>-kept) and shown in the library like your own; one played from
 * the browser without being kept is TRANSIENT — it has rows while it is
 * needed (the queue, Now playing, history) and is left off the walls. The
 * albums a playlist or favourite track needs are HELD (ns <service>-held):
 * known, off the walls, never pruned.
 *
 * Playing: the device fetches /stream/t<id>…, the server asks the service
 * for the track's address (one ask per track, for the format the device
 * takes), ffmpeg reads it into the transcode cache — as it is, or converted
 * the way a file would be — and the device is fed from there, the next
 * track ready behind it (gapless). The cache is the "album by album" one: a
 * track is kept for the queue's sake and pruned as the cache fills, never
 * exported or offered as a download.
 *
 * What a service brings (the hooks a subclass fills in):
 *   account()/connected()            the sign-in, as the service keeps it
 *   describe(out)                    the user on the status, for the page
 *   fullAlbum(id, hint)              → { album, tracks } in the plain shape
 *                                    below, asked of the service
 *   wanted()                         → Map id → hint: albums to keep (hint.kept_as
 *                                    "favourite" | "purchase", hint.kept_at ms, if known)
 *   wantedIds()                      → Map id → why, from the id lists alone (the watch)
 *   listFavouriteTracks()            → [{ albumId, trackId }]
 *   listPlaylists()                  → [{ id, name, tracks: [{ albumId, trackId }] }]
 *   favouriteIdSet(fresh)            → Set of album ids in the favourites (fresh: asked now, not the minute's cache)
 *   apiFavourite(id, on)             the favourite on the service itself
 *   resolve(t, p)                    → { src, rate, bits, mime } for ffmpeg
 *   played(t, p)                     a device started fetching (reports)
 *   stop()                           the server stops
 *
 * The plain album shape: { id, title, version, artist, image (url), date
 * ("YYYY-MM-DD" or ""), label, genres [], upc, rate (Hz), bits }; a track:
 * { id, title, artist, duration (s), track_no, disc_no, rate, bits, isrc }.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// An album kept from a service is read from it again after this long (v0.7.10).
const REFRESH_MS = 7 * 86400e3;

class StreamingService {
  constructor({ id, name, db, library, dataDir, log = () => {}, afterChange = () => {}, qualities, defaultQuality, fetch: f = globalThis.fetch }) {
    this.id = id;
    this.name = name;
    this.KEY = id + ":";
    this.PATH = id + "://track/";
    this.SETTING = id;
    this.NS_KEPT = id + "-kept";
    this.NS_HELD = id + "-held";
    this.PL_PREFIX = id + "-pl-";
    this.PL_FAV = id + "-favourite-tracks";
    this.qualities = qualities;
    this.defaultQuality = defaultQuality;
    this.db = db;
    this.library = library;
    this.log = log;
    this.afterChange = afterChange;
    this.fetch = f;
    this.dir = path.join(dataDir, id);
    this.importing = null;
    this.raw = db.raw;
    this.q = {
      albumByKey: this.raw.prepare("SELECT id FROM albums WHERE key = ?"),
      albumAge: this.raw.prepare("SELECT updated_at, track_count FROM albums WHERE key = ?"),
      insertAlbum: this.raw.prepare(`INSERT INTO albums(key, title, artist, sort_title, sort_artist, year, date, label, genres, dir, art_path, art_hash,
                                      track_count, duration, max_rate, max_bits, lossless, container, compilation, added_at, updated_at, barcode)
                                      VALUES(@key, @title, @artist, @sort_title, @sort_artist, @year, @date, @label, @genres, @dir, @art_path, @art_hash,
                                      @track_count, @duration, @max_rate, @max_bits, 1, 'flac', @compilation, @now, @now, @barcode)`),
      updateAlbum: this.raw.prepare(`UPDATE albums SET title=@title, artist=@artist, sort_title=@sort_title, sort_artist=@sort_artist, year=@year, date=@date,
                                      label=@label, genres=@genres, art_path=@art_path, art_hash=@art_hash, track_count=@track_count, duration=@duration,
                                      max_rate=@max_rate, max_bits=@max_bits, compilation=@compilation, updated_at=@now, barcode=@barcode WHERE id=@id`),
      deleteTracks: this.raw.prepare("DELETE FROM tracks WHERE album_id = ?"),
      insertTrack: this.raw.prepare(`INSERT INTO tracks(album_id, path, mtime, size, title, artist, album_artist, album, track_no, disc_no, duration,
                                      codec, container, sample_rate, bits, channels, lossless, year, date, label, genres, has_picture, isrc)
                                      VALUES(@album_id, @path, 0, 0, @title, @artist, @album_artist, @album, @track_no, @disc_no, @duration,
                                      'flac', 'flac', @sample_rate, @bits, 2, 1, @year, @date, @label, @genres, 0, @isrc)`),
      deleteAlbum: this.raw.prepare("DELETE FROM albums WHERE id = ?"),
      ownAlbums: this.raw.prepare("SELECT id, key, updated_at FROM albums WHERE key LIKE ?"),
      played: this.raw.prepare("SELECT MAX(ts) AS last FROM plays WHERE album_id = ?")
    };
  }

  isPath(p) { return String(p || "").startsWith(this.PATH); }
  trackIdOf(p) { return this.isPath(p) ? String(p).slice(this.PATH.length) : null; }

  // ------------------------------------------------------------ the account

  account() { return this.db.setting(this.SETTING, null); }
  connected() { const a = this.account(); return !!(a && a.token && a.user); }
  settings() {
    const s = this.db.setting(this.SETTING + "Settings", {}) || {};
    return { quality: this.qualities.includes(s.quality) ? s.quality : this.defaultQuality, import: s.import === true };   // off until switched on (v0.7.10)
  }
  setSettings(patch) {
    const next = Object.assign({}, this.settings());
    if (patch.quality !== undefined) {
      if (!this.qualities.includes(patch.quality)) { const e = new Error("quality must be " + this.qualities.join(", ")); e.status = 400; throw e; }
      next.quality = patch.quality;
    }
    if (patch.import !== undefined) next.import = !!patch.import;
    this.db.setSetting(this.SETTING + "Settings", next);
    return next;
  }
  /* The stream quality setting as a number, for the transcode cache's keys. */
  tier() { return this.qualities.indexOf(this.settings().quality) + 1; }

  status() {
    const s = this.settings();
    const out = { connected: this.connected(), configured: true, available: true, quality: s.quality, import: s.import,
      importing: !!this.importing, last_import: this.db.setting(this.SETTING + "LastImport", null), kept: this.keptSet().size };
    if (out.connected) this.describe(out);
    return out;
  }
  describe() {}

  async signOut() {
    await this.stop().catch(() => {});
    this.db.setSetting(this.SETTING, null);
    if (this.api && this.api.cache) this.api.cache.clear();
    this.log(`[${this.id}] signed out`);
    this.afterChange();
    return this.status();
  }
  async stop() {}
  played() {}

  // ------------------------------------------------------------ rows in the library

  /* The library's id for this service album when it is here with its tracks and read within the week; else null. */
  freshAlbumId(id) {
    const have = this.q.albumAge.get(this.KEY + id);
    if (!have || !have.track_count || Date.now() - (have.updated_at || 0) > REFRESH_MS) return null;
    const row = this.q.albumByKey.get(this.KEY + id);
    return row ? row.id : null;
  }

  keptSet() { return new Set(this.raw.prepare("SELECT key FROM cache WHERE ns = ?").all(this.NS_KEPT).map(r => r.key)); }
  heldSet() { return new Set(this.raw.prepare("SELECT key FROM cache WHERE ns = ?").all(this.NS_HELD).map(r => r.key)); }
  inLibrary(id) { return !!this.q.albumByKey.get(this.KEY + id); }

  /*
   * A list's albums (in the plain shape), each marked whether it is in the
   * account's favourites — the service's own list, not what is kept here (a
   * Qobuz purchase is kept without being a favourite) — and whether it is
   * known here.
   */
  async marked(albums) {
    let ids = new Set();
    try { ids = await this.favouriteIdSet(); } catch (e) { /* unmarked */ }
    const kept = this.keptSet();
    for (const a of albums) { a.favourited = ids.has(String(a.id)); a.kept = kept.has(this.KEY + a.id); a.in_library = this.inLibrary(a.id); }
    return albums;
  }

  /* The album's cover, kept beside the database (the art reader wants a file). */
  async fetchArt(albumId, url) {
    if (!url) return { art_path: null, art_hash: null };
    fs.mkdirSync(path.join(this.dir, "art"), { recursive: true });
    const hash = crypto.createHash("md5").update(url).digest("hex").slice(0, 12);
    const file = path.join(this.dir, "art", `${albumId}.jpg`);
    const marker = file + ".url";
    try { if (fs.existsSync(file) && fs.readFileSync(marker, "utf8") === url) return { art_path: file, art_hash: hash }; } catch (e) { /* fetch it */ }
    try {
      const r = await this.fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      fs.writeFileSync(marker, url);
      return { art_path: file, art_hash: hash };
    } catch (e) {
      this.log(`[${this.id}] cover for ${albumId}: ${e.message}`);
      return { art_path: fs.existsSync(file) ? file : null, art_hash: fs.existsSync(file) ? hash : null };
    }
  }

  /*
   * The album (and its tracks) as library rows, written or brought up to
   * date. Returns the library album id. `hint` is the album as the service
   * listed it, if it was, for fullAlbum to use.
   */
  async ensureAlbum(id, hint = null) {
    id = String(id);
    const t0 = Date.now();
    const { album: a, tracks } = await this.fullAlbum(id, hint);
    const t1 = Date.now();
    const art = await this.fetchArt(id, a.image);
    const t2 = Date.now();
    if (t2 - t0 > 1500) this.log(`[${this.id}] album ${id}: ${this.name} answered in ${t1 - t0} ms, the cover in ${t2 - t1} ms more`);
    const N = require("../library/normalize");
    const artist = a.artist || "Unknown artist";
    const date = a.date || null;
    const year = date ? Number(String(date).slice(0, 4)) || null : null;
    const label = a.label || null;
    const genres = JSON.stringify(a.genres || []);
    const list = tracks;
    const row = {
      key: this.KEY + id, title: a.title + (a.version ? " (" + a.version + ")" : ""), artist,
      sort_title: N.sortName(a.title || ""), sort_artist: N.sortName(artist), year, date,
      label, genres, dir: this.id + "://album/" + id, art_path: art.art_path, art_hash: art.art_hash,
      track_count: list.length, duration: list.reduce((s, t) => s + t.duration, 0),
      max_rate: Math.max(0, ...list.map(t => t.rate)) || a.rate || 44100,
      max_bits: Math.max(0, ...list.map(t => t.bits)) || a.bits || 16,
      compilation: /^various artists$/i.test(artist) ? 1 : 0, now: Date.now(), barcode: a.upc || null
    };
    let albumId;
    this.raw.transaction(() => {
      const was = this.q.albumByKey.get(row.key);
      if (was) { albumId = was.id; this.q.updateAlbum.run(Object.assign({ id: albumId }, row)); this.q.deleteTracks.run(albumId); }
      else albumId = Number(this.q.insertAlbum.run(row).lastInsertRowid);
      for (const t of list) {
        this.q.insertTrack.run({
          album_id: albumId, path: this.PATH + t.id, title: t.title, artist: t.artist || artist, album_artist: artist, album: row.title,
          track_no: t.track_no, disc_no: t.disc_no || 1, duration: t.duration, sample_rate: t.rate, bits: t.bits,
          year, date, label, genres, isrc: t.isrc || null
        });
      }
    })();
    return albumId;
  }

  /*
   * Kept, with why ("favourite" or "purchase") and since when on the service
   * (its own date where the listing gave one), so the page can say how an
   * album came to be in the library (v0.7.3). Rows written before v0.7.3
   * hold 1: kept, reason unknown.
   */
  keep(albumId, on, why = "favourite", at = null) {
    if (on) this.db.cachePut(this.NS_KEPT, this.KEY + albumId, { why, at: at || Date.now() });
    else this.db.cacheDel(this.NS_KEPT, this.KEY + albumId);
  }
  keptInfo(albumId) {
    const v = this.db.cacheGet(this.NS_KEPT, this.KEY + albumId);
    if (v === undefined) return null;
    return v && typeof v === "object" ? { why: v.why || "favourite", at: v.at || null } : { why: null, at: null };
  }

  /*
   * Why the album is in the library, for its page: kept (and as what, since
   * when), held by a playlist or favourite track, or only played from the
   * browser — and whether it is out yet.
   */
  why(albumId) {
    const key = this.KEY + albumId;
    const row = this.q.albumByKey.get(key);
    const kept = this.keptInfo(albumId);
    const last = row ? ((this.q.played.get(row.id) || {}).last || 0) : 0;
    return { service: this.id, name: this.name, kept: kept ? kept.why || "unknown" : null, since: kept ? kept.at : null,
      held: this.heldSet().has(key), last_played: last || null };
  }

  /* In the account's favourites, as the service has them now. */
  async isFavourite(albumId) { return (await this.favouriteIdSet()).has(String(albumId)); }

  /*
   * The album's page opened (v0.7.3): what the service says of its favourite
   * is what the library goes by, there and then. Kept as a favourite but no
   * longer one on the service (removed in its app a moment ago) — let go,
   * off the walls from the next draw; a favourite there but not kept here —
   * kept. A purchase stays whatever the favourite. Returns the favourite.
   */
  async reconcile(albumId) {
    const fav = await this.isFavourite(albumId);
    const kept = this.keptInfo(albumId);
    if (kept && kept.why !== "purchase" && !fav) {
      let bought = false;
      try { bought = (await this.wantedIds()).get(String(albumId)) === "purchase"; } catch (e) { /* not known: a favourite's rules */ }
      if (!bought) { this.keep(albumId, false); this.log(`[${this.id}] ${albumId}: no longer a favourite on ${this.name}, let go`); this.afterChange(); }
    } else if (!kept && fav && this.inLibrary(albumId)) {
      this.keep(albumId, true); this.afterChange();
    }
    return fav;
  }

  /* The album in the library, kept (favourited on the service too) or not. */
  async setFavourite(albumId, on) {
    await this.apiFavourite(String(albumId), on);
    if (on) await this.ensureAlbum(albumId);
    this.keep(albumId, on);
    this.afterChange();
  }

  /*
   * The ids the account wants kept — the favourites, and on Qobuz the
   * purchases — as a Map id → why. One ask of the service each, nothing
   * fetched per album: the light form of wanted(), for the watch below.
   */
  async wantedIds(fresh = false) {
    const out = new Map();
    for (const id of await this.favouriteIdSet(fresh)) out.set(String(id), "favourite");
    return out;
  }

  /*
   * The favourites watched (v0.7.3): every couple of minutes, and when the
   * page comes back, the ids the account wants are compared with what is
   * kept here. A favourite added on the service — in its own app, say — is
   * brought in and kept; one removed there goes off the walls. The playlists
   * are the full import's (every six hours, Rescan library, Settings): this
   * is the quick check in between. Returns what changed, or null while a
   * full import runs or the last watch was within `minAgeMs`.
   */
  async watch({ minAgeMs = 0 } = {}) {
    if (this.importing) return null;
    if (this.watching) return this.watching;
    if (minAgeMs && this.lastWatch && Date.now() - this.lastWatch < minAgeMs) return null;
    this.watching = (async () => {
      const want = await this.wantedIds(true);
      const before = this.keptSet();
      let added = 0, dropped = 0, failed = 0;
      for (const [id, why] of want) {
        if (before.has(this.KEY + id)) continue;
        try { await this.ensureAlbum(id); this.keep(id, true, why); added++; }
        catch (e) { failed++; this.log(`[${this.id}] watch ${id}: ${e.message}`); }
      }
      for (const key of before) if (!want.has(key.slice(this.KEY.length))) { this.db.cacheDel(this.NS_KEPT, key); dropped++; }
      this.lastWatch = Date.now();
      if (added || dropped) {
        this.log(`[${this.id}] favourites: ${added} added on ${this.name}, ${dropped} removed there`);
        this.afterChange();
      }
      return { added, dropped, failed, changed: !!(added || dropped) };
    })().finally(() => { this.watching = null; });
    return this.watching;
  }

  /*
   * The service's playlists and favourite tracks as Mandarin playlists: each
   * playlist by its name there, and "<Service> favourite tracks". The albums
   * their tracks are from are held — known here so the tracks play and Now
   * playing has the cover, off the walls unless favourites — and a playlist
   * gone from the service goes from here.
   */
  async importPlaylists() {
    const lists = [];
    const held = new Set();
    const albumsSeen = new Map();   // the service's album id -> library album id
    const records = async (items) => {
      const out = [];
      for (const it of items) {
        const aid = it.albumId != null ? String(it.albumId) : null;
        if (!aid) continue;
        try {
          // Here and read this week: as it is (v0.7.10, as importLibrary).
          if (!albumsSeen.has(aid)) albumsSeen.set(aid, this.freshAlbumId(aid) || await this.ensureAlbum(aid));
        } catch (e) { this.log(`[${this.id}] playlist album ${aid}: ${e.message}`); continue; }
        held.add(this.KEY + aid);
        out.push({ albumId: albumsSeen.get(aid), trackPath: this.PATH + it.trackId });
      }
      return out;
    };
    const favs = await this.listFavouriteTracks().catch(() => []);
    if (favs.length) lists.push({ id: this.PL_FAV, name: this.name + " favourite tracks", items: await records(favs) });
    for (const p of await this.listPlaylists().catch(() => [])) {
      if (!p || p.id == null) continue;
      lists.push({ id: this.PL_PREFIX + p.id, name: String(p.name || this.name + " playlist").slice(0, 80), items: await records(p.tracks || []) });
    }
    // Into the user playlists (lib/server/api-playlists.js's shape), the
    // library read afresh first so the records find their rows.
    this.library.reload();
    const all = (this.db.setting("userPlaylists", []) || []).filter(x => x && x.id && x.name);
    const keepIds = new Set(lists.map(l => l.id));
    const out = all.filter(x => serviceOfPlaylist(x) !== this.id || keepIds.has(x.id));
    for (const l of lists) {
      const tracks = [];
      for (const it of l.items) {
        const al = this.library.album(it.albumId);
        if (!al) continue;
        const rows = this.library.tracks(al.id);
        const i = rows.findIndex(t => t.path === it.trackPath);
        if (i < 0) continue;
        const t = rows[i];
        tracks.push({ album_offset: al.id, album_title: al.title, album_subtitle: al.artist, track_index: i,
          title: t.title, subtitle: t.artist || al.artist, image_key: al.image_key, track_no: t.track_no || null });
      }
      const was = out.find(x => x.id === l.id);
      if (was) { was.name = l.name; was.tracks = tracks; was.updated_at = Date.now(); }
      else out.push({ id: l.id, name: l.name, service: this.id, tracks, created_at: Date.now(), updated_at: Date.now() });
    }
    this.db.setSetting("userPlaylists", out);
    // The held set, as it is now.
    this.raw.transaction(() => {
      this.db.cacheClear(this.NS_HELD);
      for (const k of held) this.db.cachePut(this.NS_HELD, k, 1);
    })();
    return { playlists: lists.length, held: held.size };
  }

  /*
   * Everything the account wants kept, every album (no cap), as kept albums
   * in the library; one that is no longer wanted goes back to being
   * transient. Then the playlists. Returns what was done.
   */
  async importLibrary({ refresh = false } = {}) {
    if (this.importing) return this.importing;
    this.importing = (async () => {
      const t0 = Date.now();
      const want = await this.wanted();
      const before = this.keptSet();
      let added = 0, failed = 0, fetched = 0;
      for (const [id, hint] of want) {
        try {
          /*
           * ONLY WHAT IS NEW, OR A WEEK OLD (v0.7.10). Every import — 20 s
           * after each start, every six hours, after every rescan — used to
           * fetch every favourite and purchase again in full and rewrite
           * all its tracks, unchanged or not: after a restart (the answers
           * cached in memory gone), one request after another to the
           * service for every album, and thousands of database writes, while
           * the app waited on the same server. An album already here and
           * read within the week is kept as it is; older ones are refreshed
           * a few at a time as each passes its week.
           */
          if (refresh || !this.freshAlbumId(id)) { await this.ensureAlbum(id, hint); fetched++; }
          if (!before.has(this.KEY + id)) added++;
          this.keep(id, true, (hint && hint.kept_as) || "favourite", (hint && hint.kept_at) || null);
        }
        catch (e) { failed++; this.log(`[${this.id}] import ${id}: ${e.message}`); }
      }
      // What is let go is decided by the id lists asked for now (v0.7.3), the
      // same lists the page reads an album's favourite off: the full listing
      // above can lag a removal made moments ago in the service's own app,
      // and a cached page of it a minute; the ids never disagree with the page.
      let drop = want;
      try { drop = await this.wantedIds(true); } catch (e) { /* the listing decides */ }
      let dropped = 0;
      for (const key of this.keptSet()) {
        const id = key.slice(this.KEY.length);
        if (!drop.has(id)) { this.db.cacheDel(this.NS_KEPT, key); dropped++; }
      }
      let pl = { playlists: 0, held: 0 };
      try { pl = await this.importPlaylists(); } catch (e) { this.log(`[${this.id}] playlists: ${e.message}`); }
      const result = { at: Date.now(), albums: want.size, added, fetched, dropped, failed, playlists: pl.playlists, seconds: Math.round((Date.now() - t0) / 1000) };
      this.db.setSetting(this.SETTING + "LastImport", result);
      this.log(`[${this.id}] library: ${want.size} album(s) (${added} new, ${dropped} no longer kept, ${failed} failed), ${pl.playlists} playlist(s), in ${result.seconds}s`);
      this.afterChange();
      return result;
    })().finally(() => { this.importing = null; });
    return this.importing;
  }

  /*
   * Albums no longer wanted (Clean up, Settings → Library Scanner): signed
   * out, every one; signed in, those neither kept nor needed by a playlist.
   * Counted, or removed with their edits, hearts and Listen later (plays
   * stay, as text).
   */
  stale() {
    // Signed in, kept and held albums are wanted, the import's switch on or
    // off: off only hides them (lib/library/index.js), to be shown again as
    // it goes back on.
    const kept = this.keptSet(), held = this.heldSet(), on = this.connected();
    return this.q.ownAlbums.all(this.KEY + "%").filter(r => !on || (!kept.has(r.key) && !held.has(r.key)));
  }

  /*
   * The import's switch (v0.7.10): it says whether the service's favourites,
   * purchases and playlists are in the library. Off, they are off the walls
   * and the Playlists screen at once — whatever brought them in, an import
   * that was running, Update library now — and nothing more is brought in;
   * on, they are back at once, and brought up to date. Nothing is deleted
   * either way: before, off only stopped further imports and everything
   * already in stayed on the walls.
   */
  setImport(on) {
    const was = this.settings().import;
    this.setSettings({ import: !!on });
    if (was !== !!on) {
      this.log(`[${this.id}] import ${on ? "on: the favourites back in the library" : "off: the favourites off the library"}`);
      this.afterChange();
    }
  }
  cleanUp() {
    const rows = this.stale();
    this.raw.transaction(() => {
      for (const r of rows) {
        for (const t of ["album_edits", "favourites", "listen_later", "track_edits"]) this.raw.prepare(`DELETE FROM ${t} WHERE key = ?`).run(r.key);
        this.q.deleteAlbum.run(r.id);
      }
      if (!this.connected()) {
        this.db.cacheClear(this.NS_KEPT); this.db.cacheClear(this.NS_HELD);
        const all = (this.db.setting("userPlaylists", []) || []).filter(x => x && x.id && x.name && serviceOfPlaylist(x) !== this.id);
        this.db.setSetting("userPlaylists", all);
      }
    })();
    if (rows.length) this.afterChange();
    return rows.length;
  }

  /* Transient albums nobody has played in a month: their rows go. */
  pruneTransient(days = 30) {
    const kept = this.keptSet(), held = this.heldSet();
    let n = 0;
    for (const r of this.q.ownAlbums.all(this.KEY + "%")) {
      if (kept.has(r.key) || held.has(r.key)) continue;
      const last = (this.q.played.get(r.id) || {}).last || 0;
      if (Math.max(last, r.updated_at || 0) > Date.now() - days * 86400e3) continue;
      this.q.deleteAlbum.run(r.id); n++;
    }
    if (n) this.afterChange();
    return n;
  }
}

/* Which service a user playlist came from, if any (v0.6.23 wrote `qobuz: true`). */
function serviceOfPlaylist(p) {
  if (!p) return null;
  if (p.service) return p.service;
  if (p.qobuz) return "qobuz";
  return null;
}

module.exports = { StreamingService, serviceOfPlaylist };
