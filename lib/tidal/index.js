"use strict";
/*
 * index.js — Tidal in Mandarin (v0.6.24): the account (signed in on
 * tidal.com with a link and a code), the catalogue as the page browses it,
 * Tidal albums as rows in the library, and the stream behind /stream for a
 * Tidal track. The library side (rows, kept and held sets, playlists, Clean
 * up) is lib/services/streaming.js, shared with Qobuz; here is what is
 * Tidal's own.
 *
 * The stream: Tidal answers an ask for a track with a manifest. CD quality
 * (and AAC, on a lesser subscription) comes as one address ffmpeg reads.
 * Hi-res FLAC comes as MPEG-DASH — an initialisation piece and numbered
 * segments of fragmented MP4 — which ffmpeg is fed as one stream through
 * /internal/dash/<key> on this server's loopback (index.js), the segments
 * fetched one after another; nothing is kept beyond the transcode cache.
 * Tidal has no play reports, so there are none.
 */
const { TidalApi, QUALITY } = require("./api");
const { StreamingService } = require("../services/streaming");

const KEY = "tidal:";
const PATH = "tidal://track/";
const DASH_TTL = 15 * 60 * 1000;

const isTidalPath = p => String(p || "").startsWith(PATH);
const trackIdOf = p => isTidalPath(p) ? String(p).slice(PATH.length) : null;

function mainArtist(a) {
  if (a && a.artist && a.artist.name) return a.artist.name;
  if (a && Array.isArray(a.artists) && a.artists.length) {
    const m = a.artists.find(x => x.type === "MAIN") || a.artists[0];
    return m.name || "";
  }
  return "";
}
const hiresTagged = x => !!(x && x.mediaMetadata && Array.isArray(x.mediaMetadata.tags) && x.mediaMetadata.tags.includes("HIRES_LOSSLESS"))
  || !!(x && /^HI_RES/.test(String(x.audioQuality || "")));

class Tidal extends StreamingService {
  constructor({ db, library, dataDir, log = () => {}, api = null, fetch: f, baseUrl, authUrl, imagesUrl, localBase = () => "", afterChange = () => {} }) {
    super({ id: "tidal", name: "Tidal", db, library, dataDir, log, afterChange, qualities: ["cd", "hires"], defaultQuality: "hires", fetch: f });
    this.api = api || new TidalApi({
      fetch: f, baseUrl, authUrl, imagesUrl, log,
      token: () => (this.account() || {}).token || null,
      onToken: (t) => { const a = this.account(); if (a) { a.token = Object.assign({}, a.token, { access: t.access, refresh: t.refresh || a.token.refresh, expires: t.expires }); this.db.setSetting(this.SETTING, a); } },
      country: () => ((this.account() || {}).user || {}).countryCode || "US"
    });
    this.fetch = this.api.fetch;
    this.localBase = localBase;
    this.pending = null;        // a sign-in under way: { deviceCode, url, code, expires, interval, timer, error }
    this.hiresDenied = false;   // Tidal answered a hi-res ask with CD: this account gets CD
    this.learnTimer = null;
    this.dash = new Map();      // key -> { init, segments, mime, at }
    this.q.setTrackRate = this.raw.prepare("UPDATE tracks SET sample_rate = ?, bits = ? WHERE path = ?");
    this.q.setAlbumRate = this.raw.prepare("UPDATE albums SET max_rate = MAX(max_rate, ?), max_bits = MAX(max_bits, ?) WHERE id = (SELECT album_id FROM tracks WHERE path = ?)");
  }

  // ------------------------------------------------------------ the account

  userId() { return (this.account() || {}).userId || null; }

  describe(out) {
    const a = this.account() || {}, u = a.user || {};
    out.user = { login: u.email || u.username || "", name: u.firstName || u.nickname || u.username || u.email || "", id: a.userId, country: u.countryCode || "" };
    const sub = a.subscription || {};
    out.subscription = sub.type || "";
    out.hires = /HI_RES/.test(String(sub.highestSoundQuality || "")) || sub.type === "HIFI_PLUS";
    out.lossless = out.hires || /LOSSLESS/.test(String(sub.highestSoundQuality || "")) || /HIFI|PREMIUM_PLUS/.test(String(sub.type || ""));
  }

  status() {
    const out = super.status();
    if (this.pending && !out.connected) {
      out.pending = { url: this.pending.url, code: this.pending.code, expires_at: this.pending.expires, error: this.pending.error || null };
    }
    return out;
  }

  /*
   * A sign-in begins: Tidal gives a link and a code; the person opens the
   * link on any device and signs in there; this server asks Tidal every
   * few seconds whether it has happened, until it has or the code expires.
   */
  async beginSignIn() {
    if (this.connected()) return this.status();
    if (this.pending && !this.pending.error && Date.now() < this.pending.expires) return this.status();
    this.cancelSignIn();
    const d = await this.api.deviceAuthorization();
    this.pending = { deviceCode: d.deviceCode, url: d.url, code: d.userCode, expires: Date.now() + d.expiresIn * 1000, interval: Math.max(1, d.interval), timer: null, error: null };
    this.schedulePoll(this.pending.interval);
    this.log(`[tidal] sign in at ${d.url}`);
    return this.status();
  }
  schedulePoll(seconds) {
    const p = this.pending;
    if (!p) return;
    p.timer = setTimeout(() => this.poll().catch(e => { if (this.pending === p) { p.error = e.message; this.log(`[tidal] sign-in: ${e.message}`); } }), seconds * 1000);
    p.timer.unref();
  }
  async poll() {
    const p = this.pending;
    if (!p) return;
    if (Date.now() > p.expires) { p.error = "The sign-in link expired — ask for a new one"; return; }
    const r = await this.api.pollDevice(p.deviceCode);
    if (this.pending !== p) return;
    if (r.pending) { this.schedulePoll(p.interval); return; }
    await this.finishSignIn(r);
  }
  cancelSignIn() {
    if (this.pending && this.pending.timer) clearTimeout(this.pending.timer);
    this.pending = null;
  }
  /* The tokens and the user, kept; what the page shows asked for once. */
  async finishSignIn(t) {
    const userId = t.userId || (t.user && (t.user.userId || t.user.id));
    if (!t.access || !userId) { const e = new Error("Tidal gave no account back"); e.status = 502; throw e; }
    const u0 = t.user || {};
    const user = { id: userId, username: u0.username || "", email: u0.email || "", countryCode: u0.countryCode || "US", firstName: u0.firstName || "", nickname: u0.nickname || "" };
    this.db.setSetting(this.SETTING, { token: { access: t.access, refresh: t.refresh, expires: t.expires }, userId, user, subscription: null, since: Date.now() });
    this.cancelSignIn();
    this.hiresDenied = false;
    try {
      const [full, sub] = await Promise.all([this.api.user(userId).catch(() => null), this.api.subscription(userId).catch(() => null)]);
      const a = this.account();
      if (full) Object.assign(a.user, { username: full.username || a.user.username, email: full.email || a.user.email, countryCode: full.countryCode || a.user.countryCode, firstName: full.firstName || a.user.firstName, nickname: full.nickname || a.user.nickname });
      if (sub) a.subscription = { type: sub.subscription && sub.subscription.type || sub.type || "", highestSoundQuality: sub.highestSoundQuality || "", validUntil: sub.validUntil || null };
      this.db.setSetting(this.SETTING, a);
    } catch (e) { /* the page shows less */ }
    this.api.cache.clear();
    this.log(`[tidal] signed in as ${user.email || user.username || userId}`);
    this.afterChange();
    return this.status();
  }

  async signOut() { this.cancelSignIn(); return super.signOut(); }

  // ------------------------------------------------------------ the catalogue, as the page sees it

  normAlbum(a) {
    if (!a) return null;
    const hires = hiresTagged(a);
    return {
      id: String(a.id), title: a.title || "", version: a.version || "", artist: mainArtist(a),
      artist_id: a.artist && a.artist.id != null ? String(a.artist.id) : "",
      image: this.api.image(a.cover, "640x640"), year: String(a.releaseDate || "").slice(0, 4), date: a.releaseDate || "",
      label: "", genre: "", genres: [], upc: a.upc || null,
      rate: hires ? 96000 : 44100, bits: hires ? 24 : 16,
      tracks_count: Number(a.numberOfTracks) || 0, duration: Number(a.duration) || 0,
      hires, quality: hires ? "24/96" : "16/44.1",
      streamable: a.allowStreaming !== false && a.streamReady !== false, kept: false, favourited: false,
      release_date: a.releaseDate || "", in_library: this.inLibrary(a.id)
    };
  }
  normTrack(t, al) {
    const hires = hiresTagged(t) || hiresTagged(al);
    return {
      id: String(t.id), title: (t.title || "") + (t.version ? " (" + t.version + ")" : ""),
      artist: mainArtist(t) || mainArtist(al) || "", duration: Number(t.duration) || 0,
      track_no: Number(t.trackNumber) || null, disc_no: Number(t.volumeNumber) || 1,
      rate: hires ? 96000 : 44100, bits: hires ? 24 : 16, streamable: t.allowStreaming !== false && t.streamReady !== false, isrc: t.isrc || null
    };
  }
  normArtist(a) { return { id: String(a.id), name: a.name || "", image: this.api.image(a.picture, "320x320") }; }

  async favouriteIdSet() {
    const j = await this.api.favouriteIds(this.userId());
    return new Set(((j && j.ALBUM) || []).map(String));
  }
  /*
   * A list's albums as Tidal gave them, kept as the answer to albums/<id>:
   * opening one from the browser then asks Tidal for its tracks only. And
   * the favourites asked for beside the list, not after it.
   */
  listed(items) {
    for (const a of items || []) if (a && a.id != null && a.title) this.api.prime(`albums/${a.id}`, {}, a, 30 * 86400e3);
    return items || [];
  }
  withFavs(p) { return Promise.all([p, this.favouriteIdSet().catch(() => null)]).then(([j]) => j); }
  async newReleases(days = 30) {
    const j = await this.withFavs(this.api.newReleases({ limit: 100 }));
    const since = Date.now() - days * 86400e3;
    const items = this.listed(j.items).filter(a => !a.releaseDate || new Date(a.releaseDate).getTime() >= since);
    return this.marked(items.map(a => this.normAlbum(a)));
  }
  /* The lists Tidal features that hold albums, as the browser's tabs: { id, label }. */
  async lists() {
    // "new" is the New Releases tab already.
    const all = ((await this.api.featured()).items || []).filter(x => x && x.path && x.path !== "new" && x.hasAlbums !== false);
    if (!this.listsLogged) { this.listsLogged = true; this.log(`[tidal] featured lists: ${all.map(x => `${x.name} (${x.path})`).join(", ") || "none"}`); }
    return all.map(x => ({ id: String(x.path), label: String(x.name || x.path) }));
  }
  /* One of the lists Tidal features, by its path or its name there. */
  async featured(type) {
    const want = String(type || "").toLowerCase();
    const lists = ((await this.api.featured()).items || []);
    const l = lists.find(x => String(x.path || "").toLowerCase() === want) || lists.find(x => String(x.name || "").toLowerCase() === want);
    if (!l || l.hasAlbums === false) { const e = new Error("Tidal doesn't feature that list"); e.status = 404; throw e; }
    const j = await this.withFavs(this.api.featuredAlbums(l.path, { limit: 100 }));
    return this.marked(this.listed(j.items).map(a => this.normAlbum(a)));
  }
  async search(query, offset = 0, limit = 50) {
    const j = await this.withFavs(this.api.search(query, { limit, offset }));
    const albums = this.listed((j.albums && j.albums.items) || []);
    const total = (j.albums && j.albums.totalNumberOfItems) || albums.length;
    const artists = offset ? [] : ((j.artists && j.artists.items) || []).slice(0, 12).map(a => this.normArtist(a));
    return { albums: await this.marked(albums.map(a => this.normAlbum(a))), artists, total, has_more: offset + albums.length < total, limit };
  }
  async artistAlbums(artistId, offset = 0, limit = 50) {
    const [ar, j] = await Promise.all([this.api.artist(artistId), this.withFavs(this.api.artistAlbums(artistId, { limit, offset }))]);
    const albums = this.listed(j.items);
    const total = Number(j.totalNumberOfItems) || albums.length;
    return { artist: this.normArtist(ar), albums: await this.marked(albums.map(a => this.normAlbum(a))), total, has_more: offset + albums.length < total, limit };
  }
  async albumDetail(id) {
    const a = await this.api.album(id);
    const tracks = await this.api.albumTracks(id);
    return { album: (await this.marked([this.normAlbum(a)]))[0], tracks: tracks.map(t => this.normTrack(t, a)), description: "" };
  }

  // ------------------------------------------------------------ rows in the library (the hooks)

  /*
   * The album and its tracks in the plain shape. The tracks and the cover
   * (the big one, kept beside the database) are fetched side by side, so an
   * album opens in the time of the slower of the two, not the sum.
   */
  async fullAlbum(id, hint = null) {
    const a = hint && hint.title ? hint : await this.api.album(id);
    const album = this.normAlbum(a);
    album.image = this.api.image(a.cover, "1280x1280");
    const [tracks] = await Promise.all([this.api.albumTracks(id), this.fetchArt(id, album.image).catch(() => null)]);
    return { album, tracks: tracks.filter(t => t.allowStreaming !== false && t.streamReady !== false).map(t => this.normTrack(t, a)) };
  }
  /* Your favourite albums, every one (no cap). */
  async wanted() {
    const want = new Map();
    for (const x of await this.api.favouriteAlbums(this.userId())) {
      const a = x && x.item ? x.item : x;
      if (a && a.id != null) want.set(String(a.id), a);
    }
    return want;
  }
  async listFavouriteTracks() {
    return (await this.api.favouriteTracks(this.userId())).map(x => x && x.item ? x.item : x)
      .filter(t => t && t.album && t.album.id != null && t.allowStreaming !== false).map(t => ({ albumId: String(t.album.id), trackId: String(t.id) }));
  }
  async listPlaylists() {
    const out = [];
    for (const x of await this.api.playlists(this.userId())) {
      const p = x && x.playlist ? x.playlist : x;
      if (!p || !p.uuid) continue;
      const items = await this.api.playlistItems(p.uuid).catch(() => []);
      const tracks = items.filter(i => i && (i.type === "track" || !i.type) && i.item && i.item.album && i.item.album.id != null && i.item.allowStreaming !== false)
        .map(i => ({ albumId: String(i.item.album.id), trackId: String(i.item.id) }));
      out.push({ id: p.uuid, name: p.title, tracks });
    }
    return out;
  }
  apiFavourite(id, on) { return this.api.setFavourite(this.userId(), id, on); }

  // ------------------------------------------------------------ the stream

  /*
   * The quality to ask for: the setting's ceiling, the track's, and the
   * account's — a subscription without hi-res, or one Tidal has already
   * answered a hi-res ask with CD for, is asked for CD straight away, not
   * twice for every track.
   */
  qualityFor(t) {
    const hires = (Number(t.bits) || 16) > 16 || (Number(t.sample_rate) || 44100) > 48000;
    if (this.settings().quality !== "hires" || !hires || this.hiresDenied) return QUALITY.LOSSLESS;
    const sub = (this.account() || {}).subscription;
    if (sub && sub.highestSoundQuality && !/HI_RES/.test(String(sub.highestSoundQuality))) return QUALITY.LOSSLESS;
    return QUALITY.HIRES;
  }
  setSettings(patch) { this.hiresDenied = false; return super.setSettings(patch); }

  /*
   * Where a track's audio is, for ffmpeg. Returns { src, rate, bits, mime }.
   * A hi-res ask Tidal answers with something other than FLAC (an account
   * without hi-res) is asked again at CD quality, as the plugin does.
   */
  async resolve(t, p) {
    const id = trackIdOf(t.path);
    if (!id) throw new Error("not a Tidal track");
    if (!this.connected()) { const e = new Error("Not signed in to Tidal"); e.status = 401; throw e; }
    let quality = this.qualityFor(t);
    let j = await this.api.playbackInfo(id, quality);
    let m = decodeManifest(j);
    if (quality === QUALITY.HIRES && (!m || !/^HI_RES/.test(String(j.audioQuality || "")))) {
      // Not hi-res from this account: CD from now on, without asking twice.
      if (!this.hiresDenied) this.log(`[tidal] hi-res asked for, ${j && j.audioQuality ? j.audioQuality : "nothing"} given: CD quality from here on`);
      this.hiresDenied = true;
      if (!m) { quality = QUALITY.LOSSLESS; j = await this.api.playbackInfo(id, quality); m = decodeManifest(j); }
    }
    if (!m) { const e = new Error("Tidal gave no stream for this track (" + String(j && j.manifestMimeType || "no manifest") + ")"); e.status = 502; throw e; }
    const rate = Number(j.sampleRate) || m.rate || (/^HI_RES/.test(String(j.audioQuality || "")) ? 96000 : 44100);
    const bits = Number(j.bitDepth) || (/^HI_RES/.test(String(j.audioQuality || "")) ? 24 : 16);
    this.learn(t, rate, bits);
    if (m.kind === "bts") return { src: m.url, rate, bits, mime: m.mime, quality: j.audioQuality || quality };
    // DASH: through this server, the segments one after another.
    const key = require("crypto").randomBytes(12).toString("hex");
    this.dash.set(key, { init: m.init, segments: m.segments, mime: m.mime, at: Date.now() });
    for (const [k, d] of this.dash) if (Date.now() - d.at > DASH_TTL) this.dash.delete(k);
    return { src: this.localBase() + "/internal/dash/" + key, rate, bits, mime: m.mime, quality: j.audioQuality || quality, dash: true };
  }

  /* A DASH stream ffmpeg is fetching: its pieces, or null once forgotten. */
  dashPieces(key) {
    const d = this.dash.get(key);
    if (!d || Date.now() - d.at > DASH_TTL) { this.dash.delete(key); return null; }
    return d;
  }

  /*
   * What Tidal actually streams a track at, learnt the first time it is
   * asked for (its lists say only "hi-res"): the rows corrected so the
   * plans that follow ask for the right conversion, and the badges are right.
   */
  learn(t, rate, bits) {
    if (!rate || !bits) return;
    if (Number(t.sample_rate) === rate && Number(t.bits) === bits) return;
    try {
      this.q.setTrackRate.run(rate, bits, t.path);
      this.q.setAlbumRate.run(rate, bits, t.path);
      // The library read afresh once things have settled, not for every
      // track of an album being made ready: a reload is the whole library.
      clearTimeout(this.learnTimer);
      this.learnTimer = setTimeout(() => this.afterChange(), 20000);
      this.learnTimer.unref();
    } catch (e) { this.log(`[tidal] learn ${t.path}: ${e.message}`); }
  }
}

/*
 * The manifest in a playbackinfo answer, decoded: { kind: "bts", url, mime,
 * rate } for one address, { kind: "dash", init, segments, mime, rate } for
 * MPEG-DASH, null for anything else (an encrypted stream, a video).
 */
function decodeManifest(j) {
  if (!j || !j.manifest) return null;
  const type = String(j.manifestMimeType || "");
  let text;
  try { text = Buffer.from(j.manifest, "base64").toString("utf8"); } catch (e) { return null; }
  if (/vnd\.tidal\.bt/.test(type)) {
    let m;
    try { m = JSON.parse(text); } catch (e) { return null; }
    if (!m || !Array.isArray(m.urls) || !m.urls.length) return null;
    if (m.encryptionType && m.encryptionType !== "NONE") return null;
    return { kind: "bts", url: m.urls[0], mime: m.mimeType || "audio/flac", rate: 0 };
  }
  if (/dash\+xml/.test(type)) return parseMpd(text);
  return null;
}

/*
 * The one audio Representation of a Tidal MPD: its initialisation address
 * and the numbered segment addresses, from the SegmentTemplate and its
 * SegmentTimeline (each <S> is a segment, repeated r more times).
 */
function parseMpd(xml) {
  const unesc = s => String(s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
  const attr = (tag, name) => { const m = new RegExp(name + "=\"([^\"]*)\"").exec(tag); return m ? unesc(m[1]) : null; };
  const rep = /<Representation\b[^>]*>/.exec(xml);
  const tpl = /<SegmentTemplate\b[^>]*>/.exec(xml);
  if (!tpl) return null;
  const init = attr(tpl[0], "initialization");
  const media = attr(tpl[0], "media");
  if (!init || !media) return null;
  const start = Number(attr(tpl[0], "startNumber") || 1);
  let count = 0;
  const re = /<S\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(xml))) count += 1 + (Number(attr(m[0], "r")) || 0);
  if (!count) count = 1;
  const segments = [];
  for (let i = 0; i < count; i++) {
    const n = start + i;
    segments.push(media.replace(/\$Number(%0(\d+)d)?\$/g, (s, fmt, w) => w ? String(n).padStart(Number(w), "0") : String(n)).replace(/\$RepresentationID\$/g, rep ? (attr(rep[0], "id") || "") : ""));
  }
  const set = /<AdaptationSet\b[^>]*>/.exec(xml);
  const mime = (rep && attr(rep[0], "mimeType")) || (set && attr(set[0], "mimeType")) || "audio/mp4";
  const rate = Number((rep && attr(rep[0], "audioSamplingRate")) || (set && attr(set[0], "audioSamplingRate"))) || 0;
  return { kind: "dash", init, segments, mime, rate };
}

module.exports = { Tidal, isTidalPath, trackIdOf, KEY, PATH, decodeManifest, parseMpd };
