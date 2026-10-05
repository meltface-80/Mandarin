"use strict";
/*
 * index.js — Qobuz in Mandarin (v0.6.23): the account, the catalogue as the
 * page browses it, Qobuz albums as rows in the library, the stream behind
 * /stream for a Qobuz track, and the play reports.
 *
 * How a Qobuz album is a library album: a row in `albums` with the key
 * "qobuz:<id>" and no folder, its tracks rows in `tracks` whose path is
 * "qobuz://track/<id>". The scanner leaves those alone. The ones in your
 * Qobuz favourites and purchases are KEPT (the cache table, ns qobuz-kept)
 * and shown in the library like your own; one played from the browser
 * without being kept is TRANSIENT — it has rows while it is needed (the
 * queue, Now playing, history) and is left off the walls.
 *
 * Playing: the device fetches /stream/t<id>…, the server asks Qobuz for the
 * track's address (one signed request per track, for the format the device
 * takes), ffmpeg reads it into the transcode cache — as it is, or converted
 * the way a file would be — and the device is fed from there, the next track
 * ready behind it (gapless). The cache is the "album by album" one: a track
 * is kept for the queue's sake and pruned as the cache fills, never exported
 * or offered as a download.
 *
 * Reporting: track/reportStreamingStart when a device starts fetching a
 * track, …End when the next one starts, the fetch is long over, or playback
 * stops — once each, with how long it was on.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { QobuzApi, FORMAT } = require("./api");

const KEY = "qobuz:";
const PATH = "qobuz://track/";
const SETTING = "qobuz";
const NS_KEPT = "qobuz-kept";
// Albums a Qobuz playlist or favourite track needs: known, off the walls, never pruned.
const NS_HELD = "qobuz-held";
const PL_PREFIX = "qobuz-pl-";
const PL_FAV = "qobuz-favourite-tracks";

const isQobuzPath = p => String(p || "").startsWith(PATH);
const trackIdOf = p => isQobuzPath(p) ? String(p).slice(PATH.length) : null;

// The image Qobuz offers at a useful size.
function imageOf(img) {
  if (!img || typeof img !== "object") return "";
  return img.large || img.extralarge || img.mega || img.medium || img.small || img.thumbnail || "";
}
function mainArtist(a) {
  if (a && a.artist && a.artist.name) return a.artist.name;
  if (a && Array.isArray(a.artists) && a.artists.length) return a.artists[0].name || "";
  return "";
}

class Qobuz {
  constructor({ db, library, dataDir, log = () => {}, api = null, fetch: f, baseUrl, afterChange = () => {} }) {
    this.db = db;
    this.library = library;
    this.log = log;
    this.afterChange = afterChange;
    this.dir = path.join(dataDir, "qobuz");
    this.api = api || new QobuzApi({ fetch: f, baseUrl, log, token: () => (this.account() || {}).token || null });
    this.plays = new Map();     // trackId -> { event, at, timer }
    this.importing = null;
    this.raw = db.raw;
    this.q = {
      albumByKey: this.raw.prepare("SELECT id FROM albums WHERE key = ?"),
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
      qobuzAlbums: this.raw.prepare("SELECT id, key, updated_at FROM albums WHERE key LIKE 'qobuz:%'"),
      played: this.raw.prepare("SELECT MAX(ts) AS last FROM plays WHERE album_id = ?")
    };
  }

  // ------------------------------------------------------------ the account

  account() { return this.db.setting(SETTING, null); }
  connected() { const a = this.account(); return !!(a && a.token && a.user); }
  settings() {
    const s = this.db.setting("qobuzSettings", {}) || {};
    return { quality: ["cd", "hires96", "hires192"].includes(s.quality) ? s.quality : "hires192", import: s.import !== false };
  }
  setSettings(patch) {
    const cur = this.settings();
    const next = Object.assign({}, cur);
    if (patch.quality !== undefined) {
      if (!["cd", "hires96", "hires192"].includes(patch.quality)) { const e = new Error("quality must be cd, hires96 or hires192"); e.status = 400; throw e; }
      next.quality = patch.quality;
    }
    if (patch.import !== undefined) next.import = !!patch.import;
    this.db.setSetting("qobuzSettings", next);
    return next;
  }

  /* The stream quality setting as a number, for the transcode cache's keys. */
  tier() { return { cd: 1, hires96: 2, hires192: 3 }[this.settings().quality] || 3; }

  /* A stable id for this server, as Qobuz's "device" in the reports. */
  deviceId() {
    let id = this.db.setting("qobuzDeviceId", null);
    if (!id) { id = crypto.randomUUID(); this.db.setSetting("qobuzDeviceId", id); }
    return id;
  }

  status() {
    const a = this.account();
    const s = this.settings();
    const out = { connected: this.connected(), configured: true, available: true, quality: s.quality, import: s.import,
      importing: !!this.importing, last_import: this.db.setting("qobuzLastImport", null), kept: this.keptSet().size };
    if (out.connected) {
      const u = a.user || {};
      out.user = { login: u.login || "", name: u.display_name || u.firstname || u.login || "", id: u.id };
      const sub = u.subscription || {};
      out.subscription = sub.offer || sub.label || (u.credential && u.credential.label) || "";
      out.hires = !!(u.credential && u.credential.parameters && u.credential.parameters.hires_streaming);
      out.lossless = !!(u.credential && u.credential.parameters && u.credential.parameters.lossless_streaming);
    }
    return out;
  }

  async signIn(username, password) {
    if (!username || !password) { const e = new Error("Username and password needed"); e.status = 400; throw e; }
    const { token, user } = await this.api.login(String(username), String(password), this.deviceId());
    // Only what the reports and the page need; never the password.
    const u = {
      id: user.id, login: user.login || user.email || "", display_name: user.display_name || "", firstname: user.firstname || "",
      subscription: user.subscription ? { offer: user.subscription.offer, end_date: user.subscription.end_date } : null,
      credential: user.credential ? { id: user.credential.id, label: user.credential.label, parameters: user.credential.parameters } : null,
      device: user.device ? { id: user.device.id } : null
    };
    this.db.setSetting(SETTING, { token, user: u, since: Date.now() });
    this.api.cache.clear();
    this.log(`[qobuz] signed in as ${u.login}${u.subscription && u.subscription.offer ? " (" + u.subscription.offer + ")" : ""}`);
    this.afterChange();
    return this.status();
  }

  async signOut() {
    for (const id of [...this.plays.keys()]) await this.end(id, "signed out").catch(() => {});
    this.db.setSetting(SETTING, null);
    this.api.cache.clear();
    this.log("[qobuz] signed out");
    this.afterChange();
    return this.status();
  }

  // ------------------------------------------------------------ the catalogue, as the page sees it

  normAlbum(a) {
    if (!a) return null;
    const rate = Number(a.maximum_sampling_rate) || 0, bits = Number(a.maximum_bit_depth) || 0;
    return {
      id: String(a.id), title: a.title || "", version: a.version || "", artist: mainArtist(a),
      artist_id: a.artist && a.artist.id ? String(a.artist.id) : "",
      image: imageOf(a.image), year: (a.release_date_original || a.release_date_stream || "").slice(0, 4) || "",
      label: a.label && a.label.name ? a.label.name : "", genre: a.genre && a.genre.name ? a.genre.name : "",
      tracks_count: Number(a.tracks_count) || 0, duration: Number(a.duration) || 0,
      hires: !!a.hires_streamable || bits > 16 || rate > 48, quality: bits && rate ? `${bits}/${rate}` : "",
      streamable: a.streamable !== false, kept: this.keptSet().has(KEY + a.id), favourited: false,
      release_date: a.release_date_original || "", in_library: !!this.q.albumByKey.get(KEY + a.id)
    };
  }
  normTrack(t, al) {
    const rate = Number(t.maximum_sampling_rate || (al && al.maximum_sampling_rate)) || 44.1;
    const bits = Number(t.maximum_bit_depth || (al && al.maximum_bit_depth)) || 16;
    return {
      id: String(t.id), title: (t.title || "") + (t.version ? " (" + t.version + ")" : ""),
      artist: (t.performer && t.performer.name) || mainArtist(al) || "", duration: Number(t.duration) || 0,
      track_no: Number(t.track_number) || null, disc_no: Number(t.media_number) || 1,
      rate: Math.round(rate * 1000), bits, streamable: t.streamable !== false, isrc: t.isrc || null
    };
  }

  /*
   * A list's albums, each marked whether it is in the account's Qobuz
   * favourites — Qobuz's own list (a minute's cache), not what is kept here:
   * a purchase is kept without being a favourite.
   */
  async marked(items) {
    const albums = items.map(a => this.normAlbum(a));
    let ids = new Set();
    try { const j = await this.api.favouriteIds(); ids = new Set(((j && j.albums) || []).map(String)); } catch (e) { /* unmarked */ }
    for (const a of albums) a.favourited = ids.has(a.id);
    return albums;
  }
  async newReleases(days = 30) {
    const j = await this.api.featured("new-releases-full", { limit: 100 });
    const since = Date.now() - days * 86400e3;
    const items = ((j.albums && j.albums.items) || []).filter(a => !a.release_date_original || new Date(a.release_date_original).getTime() >= since);
    return this.marked(items);
  }
  async featured(type) {
    const map = { "best-sellers": "best-sellers", "most-streamed": "most-streamed", "press-awards": "press-awards", "editor-picks": "editor-picks", "new-releases": "new-releases" };
    const j = await this.api.featured(map[type] || type, { limit: 100 });
    return this.marked((j.albums && j.albums.items) || []);
  }
  async search(query, offset = 0, limit = 50) {
    const j = await this.api.search(query, { limit, offset });
    const albums = (j.albums && j.albums.items) || [];
    const artists = ((j.artists && j.artists.items) || []).slice(0, 12).map(a => ({ id: String(a.id), name: a.name, image: imageOf(a.image) }));
    return { albums: await this.marked(albums), artists, total: (j.albums && j.albums.total) || albums.length, has_more: offset + albums.length < ((j.albums && j.albums.total) || 0), limit };
  }
  async artistAlbums(artistId, offset = 0, limit = 50) {
    const j = await this.api.artist(artistId, { limit, offset });
    const albums = (j.albums && j.albums.items) || [];
    return { artist: { id: String(j.id), name: j.name, image: imageOf(j.image) }, albums: await this.marked(albums),
      total: (j.albums && j.albums.total) || albums.length, has_more: offset + albums.length < ((j.albums && j.albums.total) || 0), limit };
  }
  async albumDetail(id) {
    const a = await this.api.album(id);
    const tracks = await this.api.albumTracks(id);
    return { album: (await this.marked([a]))[0], tracks: tracks.map(t => this.normTrack(t, a)), description: a.description || "" };
  }

  // ------------------------------------------------------------ rows in the library

  keptSet() {
    return new Set(this.raw.prepare("SELECT key FROM cache WHERE ns = ?").all(NS_KEPT).map(r => r.key));
  }
  heldSet() {
    return new Set(this.raw.prepare("SELECT key FROM cache WHERE ns = ?").all(NS_HELD).map(r => r.key));
  }

  /*
   * Qobuz playlists and favourite tracks (v0.6.23) as Mandarin playlists:
   * each playlist by its Qobuz name, and "Qobuz favourite tracks". The
   * albums their tracks are from are held — known here so the tracks play
   * and Now playing has the cover, off the walls unless favourites — and
   * a playlist gone from Qobuz goes from here. Returns the held keys.
   */
  async importPlaylists() {
    const lists = [];
    const held = new Set();
    const albumsSeen = new Map();   // qobuz album id -> library album id
    const records = async (tracks) => {
      const out = [];
      for (const t of tracks) {
        const aid = t.album && t.album.id != null ? String(t.album.id) : null;
        if (!aid || t.streamable === false) continue;
        try {
          if (!albumsSeen.has(aid)) albumsSeen.set(aid, await this.ensureAlbum(aid));
        } catch (e) { this.log(`[qobuz] playlist album ${aid}: ${e.message}`); continue; }
        held.add(KEY + aid);
        out.push({ albumId: albumsSeen.get(aid), trackPath: PATH + t.id });
      }
      return out;
    };
    const favs = await this.api.favouriteTracks().catch(() => []);
    if (favs.length) lists.push({ id: PL_FAV, name: "Qobuz favourite tracks", items: await records(favs) });
    for (const p of await this.api.playlists().catch(() => [])) {
      if (!p || p.id == null) continue;
      const tracks = await this.api.playlistTracks(p.id).catch(() => []);
      lists.push({ id: PL_PREFIX + p.id, name: String(p.name || "Qobuz playlist").slice(0, 80), items: await records(tracks) });
    }
    // Into the user playlists (lib/server/api-playlists.js's shape), the
    // library read afresh first so the records find their rows.
    this.library.reload();
    const all = (this.db.setting("userPlaylists", []) || []).filter(x => x && x.id && x.name);
    const keepIds = new Set(lists.map(l => l.id));
    const out = all.filter(x => !x.qobuz || keepIds.has(x.id));
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
      else out.push({ id: l.id, name: l.name, qobuz: true, tracks, created_at: Date.now(), updated_at: Date.now() });
    }
    this.db.setSetting("userPlaylists", out);
    // The held set, as it is now.
    this.raw.transaction(() => {
      this.db.cacheClear(NS_HELD);
      for (const k of held) this.db.cachePut(NS_HELD, k, 1);
    })();
    return { playlists: lists.length, held: held.size };
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
      const r = await this.api.fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      fs.writeFileSync(marker, url);
      return { art_path: file, art_hash: hash };
    } catch (e) {
      this.log(`[qobuz] cover for ${albumId}: ${e.message}`);
      return { art_path: fs.existsSync(file) ? file : null, art_hash: fs.existsSync(file) ? hash : null };
    }
  }

  /*
   * The album (and its tracks) as library rows, written or brought up to
   * date. Returns the library album id. `a` may be the album as Qobuz gave
   * it (with tracks), else it is fetched.
   */
  async ensureAlbum(id, a = null) {
    id = String(id);
    if (!a || !a.tracks) a = await this.api.album(id);
    const tracks = (a.tracks && a.tracks.items && a.tracks.total <= a.tracks.items.length) ? a.tracks.items : await this.api.albumTracks(id);
    const art = await this.fetchArt(id, imageOf(a.image));
    const N = require("../library/normalize");
    const artist = mainArtist(a) || "Unknown artist";
    const date = a.release_date_original || a.release_date_stream || null;
    const year = date ? Number(String(date).slice(0, 4)) || null : null;
    const label = a.label && a.label.name ? a.label.name : null;
    const genres = JSON.stringify(a.genre && a.genre.name ? [a.genre.name] : []);
    const list = tracks.filter(t => t.streamable !== false).map(t => this.normTrack(t, a));
    const row = {
      key: KEY + id, title: a.title + (a.version ? " (" + a.version + ")" : ""), artist,
      sort_title: N.sortName(a.title || ""), sort_artist: N.sortName(artist), year, date,
      label, genres, dir: "qobuz://album/" + id, art_path: art.art_path, art_hash: art.art_hash,
      track_count: list.length, duration: list.reduce((s, t) => s + t.duration, 0),
      max_rate: Math.max(0, ...list.map(t => t.rate)) || Math.round((Number(a.maximum_sampling_rate) || 44.1) * 1000),
      max_bits: Math.max(0, ...list.map(t => t.bits)) || Number(a.maximum_bit_depth) || 16,
      compilation: /^various artists$/i.test(artist) ? 1 : 0, now: Date.now(), barcode: a.upc || null
    };
    let albumId;
    this.raw.transaction(() => {
      const was = this.q.albumByKey.get(row.key);
      if (was) { albumId = was.id; this.q.updateAlbum.run(Object.assign({ id: albumId }, row)); this.q.deleteTracks.run(albumId); }
      else albumId = Number(this.q.insertAlbum.run(row).lastInsertRowid);
      for (const t of list) {
        this.q.insertTrack.run({
          album_id: albumId, path: PATH + t.id, title: t.title, artist: t.artist, album_artist: artist, album: row.title,
          track_no: t.track_no, disc_no: t.disc_no, duration: t.duration, sample_rate: t.rate, bits: t.bits,
          year, date, label, genres, isrc: t.isrc
        });
      }
    })();
    return albumId;
  }

  keep(albumId, on) {
    if (on) this.db.cachePut(NS_KEPT, KEY + albumId, 1);
    else this.db.cacheDel(NS_KEPT, KEY + albumId);
  }

  /* In the account's Qobuz favourites, as Qobuz has them now. */
  async isFavourite(albumId) {
    const j = await this.api.favouriteIds();
    const ids = (j && j.albums) || [];
    return ids.map(String).includes(String(albumId));
  }

  /* The album in the library, kept (favourited on Qobuz too) or not. */
  async setFavourite(albumId, on) {
    await this.api.setFavourite(albumId, on);
    if (on) await this.ensureAlbum(albumId);
    this.keep(albumId, on);
    this.afterChange();
  }

  /*
   * Your Qobuz favourites and purchases, every one (no cap), as kept albums
   * in the library; one that is no longer either goes back to being
   * transient. Returns what was done.
   */
  async importLibrary() {
    if (this.importing) return this.importing;
    this.importing = (async () => {
      const t0 = Date.now();
      const [favs, bought] = await Promise.all([this.api.favouriteAlbums(), this.api.purchases().catch(() => [])]);
      const want = new Map();
      for (const a of favs.concat(bought)) if (a && a.id) want.set(String(a.id), a);
      const before = this.keptSet();
      let added = 0, failed = 0;
      for (const [id, a] of want) {
        try { await this.ensureAlbum(id, a); if (!before.has(KEY + id)) added++; this.keep(id, true); }
        catch (e) { failed++; this.log(`[qobuz] import ${id}: ${e.message}`); }
      }
      let dropped = 0;
      for (const key of before) if (!want.has(key.slice(KEY.length))) { this.db.cacheDel(NS_KEPT, key); dropped++; }
      let pl = { playlists: 0, held: 0 };
      try { pl = await this.importPlaylists(); } catch (e) { this.log(`[qobuz] playlists: ${e.message}`); }
      const result = { at: Date.now(), albums: want.size, added, dropped, failed, playlists: pl.playlists, seconds: Math.round((Date.now() - t0) / 1000) };
      this.db.setSetting("qobuzLastImport", result);
      this.log(`[qobuz] library: ${want.size} album(s) from favourites and purchases (${added} new, ${dropped} no longer kept, ${failed} failed), ${pl.playlists} playlist(s), in ${result.seconds}s`);
      this.afterChange();
      return result;
    })().finally(() => { this.importing = null; });
    return this.importing;
  }

  /*
   * Qobuz albums no longer wanted (Clean up, Settings → Library Scanner):
   * signed out, every one; signed in, those neither in your favourites and
   * purchases nor needed by a playlist. Counted, or removed with their
   * edits, hearts and Listen later (plays stay, as text).
   */
  stale() {
    const kept = this.keptSet(), held = this.heldSet(), on = this.connected();
    return this.q.qobuzAlbums.all().filter(r => !on || (!kept.has(r.key) && !held.has(r.key)));
  }
  cleanUp() {
    const rows = this.stale();
    this.raw.transaction(() => {
      for (const r of rows) {
        for (const t of ["album_edits", "favourites", "listen_later", "track_edits"]) this.raw.prepare(`DELETE FROM ${t} WHERE key = ?`).run(r.key);
        this.q.deleteAlbum.run(r.id);
      }
      if (!this.connected()) {
        this.db.cacheClear(NS_KEPT); this.db.cacheClear(NS_HELD);
        const all = (this.db.setting("userPlaylists", []) || []).filter(x => x && x.id && x.name && !x.qobuz);
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
    for (const r of this.q.qobuzAlbums.all()) {
      if (kept.has(r.key) || held.has(r.key)) continue;
      const last = (this.q.played.get(r.id) || {}).last || 0;
      if (Math.max(last, r.updated_at || 0) > Date.now() - days * 86400e3) continue;
      this.q.deleteAlbum.run(r.id); n++;
    }
    if (n) this.afterChange();
    return n;
  }

  // ------------------------------------------------------------ the stream

  /* The format to ask for: the device's ceiling, the account's, and the track's. */
  formatFor(t, p) {
    const s = this.settings();
    const want = p && p.rate ? p.rate : 48000;
    const trackRate = Number(t.sample_rate) || 44100, trackBits = Number(t.bits) || 16;
    const cd = trackRate <= 48000 && trackBits <= 16;
    if (cd || s.quality === "cd") return FORMAT.FLAC;
    // Above CD and wanted above CD: the hi-res tier the device's rate falls in.
    // A Sonos (24/48) gets the 96 kHz tier and the 24/48 rule from there.
    if (want > 96000 && s.quality === "hires192") return FORMAT.HIRES192;
    return FORMAT.HIRES96;
  }

  /* A device is fetching this track to play it: reported to Qobuz (once). */
  played(t, p) {
    const id = trackIdOf(t.path);
    if (!id || !this.connected()) return;
    this.start(id, t, this.formatFor(t, p)).catch(e => this.log(`[qobuz] report: ${e.message}`));
  }

  /*
   * Where a track's audio is, for ffmpeg: a signed ask to Qobuz, answered
   * with a short-lived address and what is at it. Returns { src, rate, bits,
   * formatId }. (The play itself is reported by played(), when a device
   * fetches: the cache may already hold the track from being made ready.)
   */
  async resolve(t, p) {
    const id = trackIdOf(t.path);
    if (!id) throw new Error("not a Qobuz track");
    if (!this.connected()) { const e = new Error("Not signed in to Qobuz"); e.status = 401; throw e; }
    const formatId = this.formatFor(t, p);
    const j = await this.api.fileUrl(id, formatId);
    if (!j || !j.url) { const e = new Error(j && j.sample ? "Qobuz offers only a sample of this track on this account" : "Qobuz gave no stream for this track"); e.status = 502; throw e; }
    return { src: j.url, rate: Number(j.sampling_rate) ? Math.round(Number(j.sampling_rate) * 1000) : (Number(t.sample_rate) || 44100),
      bits: Number(j.bit_depth) || Number(t.bits) || 16, formatId: Number(j.format_id) || formatId, mime: j.mime_type || "audio/flac" };
  }

  // ------------------------------------------------------------ the reports

  async start(trackId, t, formatId) {
    if (this.plays.has(trackId)) return;
    // The track before it is over, as far as Qobuz is concerned.
    for (const id of [...this.plays.keys()]) await this.end(id, "next track");
    const a = this.account() || {}, u = a.user || {};
    const event = {
      user_id: u.id, duration: 0, date: Math.floor(Date.now() / 1000), online: true, intent: "streaming", sample: false,
      device_id: u.device ? u.device.id : this.deviceId(), track_id: Number(trackId), local: false,
      credential_id: u.credential ? u.credential.id : undefined, format_id: formatId, purchase: false
    };
    const rec = { event, at: Date.now(), duration: Number(t.duration) || 0, timer: null };
    this.plays.set(trackId, rec);
    // Over by itself once it has had time to play through (and a little more).
    rec.timer = setTimeout(() => this.end(trackId, "played through").catch(() => {}), (rec.duration || 600) * 1000 + 30000);
    rec.timer.unref();
    await this.api.report("start", event);
  }

  async end(trackId, why) {
    const rec = this.plays.get(trackId);
    if (!rec) return;
    this.plays.delete(trackId);
    clearTimeout(rec.timer);
    const seconds = Math.round((Date.now() - rec.at) / 1000);
    const event = Object.assign({}, rec.event, { date: Math.floor(Date.now() / 1000), duration: rec.duration ? Math.min(rec.duration, seconds) : seconds });
    await this.api.report("end", event);
    this.log(`[qobuz] track ${trackId}: ${event.duration}s (${why})`);
  }

  async stop() {
    for (const id of [...this.plays.keys()]) await this.end(id, "stopped").catch(() => {});
  }
}

module.exports = { Qobuz, isQobuzPath, trackIdOf, KEY, PATH, NS_KEPT };
