"use strict";
/*
 * index.js — Qobuz in Mandarin (v0.6.23): the account, the catalogue as the
 * page browses it, Qobuz albums as rows in the library, the stream behind
 * /stream for a Qobuz track, and the play reports. The library side (rows,
 * kept and held sets, playlists, Clean up) is lib/services/streaming.js,
 * shared with Tidal; here is what is Qobuz's own.
 *
 * Reporting: track/reportStreamingStart when a device starts fetching a
 * track, …End when the next one starts, the fetch is long over, or playback
 * stops — once each, with how long it was on.
 */
const crypto = require("crypto");
const { QobuzApi, FORMAT } = require("./api");
const { StreamingService } = require("../services/streaming");

const KEY = "qobuz:";
const PATH = "qobuz://track/";
const NS_KEPT = "qobuz-kept";

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

class Qobuz extends StreamingService {
  constructor({ db, library, dataDir, log = () => {}, api = null, fetch: f, baseUrl, afterChange = () => {} }) {
    super({ id: "qobuz", name: "Qobuz", db, library, dataDir, log, afterChange, qualities: ["cd", "hires96", "hires192"], defaultQuality: "hires192", fetch: f });
    this.api = api || new QobuzApi({ fetch: f, baseUrl, log, token: () => (this.account() || {}).token || null });
    this.fetch = this.api.fetch;
    this.plays = new Map();     // trackId -> { event, at, timer }
  }

  // ------------------------------------------------------------ the account

  /* A stable id for this server, as Qobuz's "device" in the reports. */
  deviceId() {
    let id = this.db.setting("qobuzDeviceId", null);
    if (!id) { id = crypto.randomUUID(); this.db.setSetting("qobuzDeviceId", id); }
    return id;
  }

  describe(out) {
    const u = (this.account() || {}).user || {};
    out.user = { login: u.login || "", name: u.display_name || u.firstname || u.login || "", id: u.id };
    const sub = u.subscription || {};
    out.subscription = sub.offer || sub.label || (u.credential && u.credential.label) || "";
    out.hires = !!(u.credential && u.credential.parameters && u.credential.parameters.hires_streaming);
    out.lossless = !!(u.credential && u.credential.parameters && u.credential.parameters.lossless_streaming);
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
    this.db.setSetting(this.SETTING, { token, user: u, since: Date.now() });
    this.api.cache.clear();
    this.log(`[qobuz] signed in as ${u.login}${u.subscription && u.subscription.offer ? " (" + u.subscription.offer + ")" : ""}`);
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
      date: a.release_date_original || a.release_date_stream || "",
      label: a.label && a.label.name ? a.label.name : "", genre: a.genre && a.genre.name ? a.genre.name : "",
      genres: a.genre && a.genre.name ? [a.genre.name] : [], upc: a.upc || null,
      rate: Math.round(rate * 1000) || 44100, bits: bits || 16,
      tracks_count: Number(a.tracks_count) || 0, duration: Number(a.duration) || 0,
      hires: !!a.hires_streamable || bits > 16 || rate > 48, quality: bits && rate ? `${bits}/${rate}` : "",
      streamable: a.streamable !== false, kept: false, favourited: false,
      release_date: a.release_date_original || "", in_library: this.inLibrary(a.id)
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

  async favouriteIdSet() {
    const j = await this.api.favouriteIds();
    return new Set(((j && j.albums) || []).map(String));
  }
  async newReleases(days = 30) {
    const j = await this.api.featured("new-releases-full", { limit: 100 });
    const since = Date.now() - days * 86400e3;
    const items = ((j.albums && j.albums.items) || []).filter(a => !a.release_date_original || new Date(a.release_date_original).getTime() >= since);
    return this.marked(items.map(a => this.normAlbum(a)));
  }
  async featured(type) {
    const map = { "best-sellers": "best-sellers", "most-streamed": "most-streamed", "press-awards": "press-awards", "editor-picks": "editor-picks", "new-releases": "new-releases" };
    const j = await this.api.featured(map[type] || type, { limit: 100 });
    return this.marked(((j.albums && j.albums.items) || []).map(a => this.normAlbum(a)));
  }
  async search(query, offset = 0, limit = 50) {
    const j = await this.api.search(query, { limit, offset });
    const albums = (j.albums && j.albums.items) || [];
    const artists = ((j.artists && j.artists.items) || []).slice(0, 12).map(a => ({ id: String(a.id), name: a.name, image: imageOf(a.image) }));
    return { albums: await this.marked(albums.map(a => this.normAlbum(a))), artists, total: (j.albums && j.albums.total) || albums.length, has_more: offset + albums.length < ((j.albums && j.albums.total) || 0), limit };
  }
  async artistAlbums(artistId, offset = 0, limit = 50) {
    const j = await this.api.artist(artistId, { limit, offset });
    const albums = (j.albums && j.albums.items) || [];
    return { artist: { id: String(j.id), name: j.name, image: imageOf(j.image) }, albums: await this.marked(albums.map(a => this.normAlbum(a))),
      total: (j.albums && j.albums.total) || albums.length, has_more: offset + albums.length < ((j.albums && j.albums.total) || 0), limit };
  }
  async albumDetail(id) {
    const a = await this.api.album(id);
    const tracks = await this.api.albumTracks(id);
    return { album: (await this.marked([this.normAlbum(a)]))[0], tracks: tracks.map(t => this.normTrack(t, a)), description: a.description || "" };
  }

  // ------------------------------------------------------------ rows in the library (the hooks)

  /* The album and its tracks in the plain shape; `hint` is Qobuz's album if listed. */
  async fullAlbum(id, hint = null) {
    let a = hint;
    if (!a || !a.tracks) a = await this.api.album(id);
    const tracks = (a.tracks && a.tracks.items && a.tracks.total <= a.tracks.items.length) ? a.tracks.items : await this.api.albumTracks(id);
    return { album: this.normAlbum(a), tracks: tracks.filter(t => t.streamable !== false).map(t => this.normTrack(t, a)) };
  }
  /* Favourites and purchases, every one (no cap). */
  async wanted() {
    const [favs, bought] = await Promise.all([this.api.favouriteAlbums(), this.api.purchases().catch(() => [])]);
    const want = new Map();
    for (const a of favs.concat(bought)) if (a && a.id) want.set(String(a.id), a);
    return want;
  }
  async listFavouriteTracks() {
    return (await this.api.favouriteTracks()).filter(t => t && t.album && t.album.id != null && t.streamable !== false).map(t => ({ albumId: String(t.album.id), trackId: String(t.id) }));
  }
  async listPlaylists() {
    const out = [];
    for (const p of await this.api.playlists()) {
      if (!p || p.id == null) continue;
      const tracks = await this.api.playlistTracks(p.id).catch(() => []);
      out.push({ id: p.id, name: p.name, tracks: tracks.filter(t => t && t.album && t.album.id != null && t.streamable !== false).map(t => ({ albumId: String(t.album.id), trackId: String(t.id) })) });
    }
    return out;
  }
  apiFavourite(id, on) { return this.api.setFavourite(id, on); }

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
