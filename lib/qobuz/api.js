"use strict";
/*
 * api.js — Qobuz's API (v0.6.23), as the Lyrion (LMS) Qobuz plugin uses it:
 * a subscriber signs in, every stream is asked for one track at a time with
 * a signed request and comes back as a short-lived address, every play is
 * reported for the royalties, nothing is downloaded.
 *
 *   https://www.qobuz.com/api.json/0.2/<call>?app_id=…  with the headers
 *   X-App-Id and X-User-Auth-Token.
 *
 * Signed calls (track/getFileUrl): request_sig = md5("trackgetFileUrl" +
 * the other parameters sorted and run together + request_ts + secret),
 * exactly as Qobuz's own API documentation describes and the plugin does.
 *
 * The app id and secret are the ones the plugin ships (its install.xml,
 * decoded the way its Common::init does): Qobuz answers no application
 * requests, and lets the plugin be because of how it behaves — a paying
 * account, streaming only, plays reported. This client behaves the same.
 */
const crypto = require("crypto");

const BASE = "https://www.qobuz.com/api.json/0.2/";
// The plugin's credentials, as it carries them.
const BLOB = "3934323835323536373736313733306433663935653461663039616336336239613337636363393661393530303936393633";

// Stream formats Qobuz knows, as the plugin names them.
const FORMAT = { MP3: 5, FLAC: 6, HIRES96: 7, HIRES192: 27 };

function credentials() {
  const s = Buffer.from(BLOB, "hex").toString("ascii");
  const m = /^(\d{9})([a-f0-9]{32})(\d{9})/i.exec(s);
  if (!m) throw new Error("Qobuz credentials unreadable");
  return { appId: m[1], secret: m[2], webAppId: m[3] };
}

class QobuzApi {
  /*
   * fetch: for tests, a fake; baseUrl likewise. token(): the signed-in
   * user's token, read each call so a sign-out takes at once.
   */
  constructor({ baseUrl = BASE, fetch: f = globalThis.fetch, token = () => null, log = () => {}, creds = null } = {}) {
    this.base = baseUrl;
    this.fetch = f;
    this.token = token;
    this.log = log;
    this.creds = creds || credentials();
    this.cache = new Map();   // url -> { at, ttl, value }
  }

  // ------------------------------------------------------------ requests

  /*
   * One call. opts.sign: a signed request; opts.ttl: cached for that long
   * (ms); opts.noToken: before sign-in. Qobuz answers errors as JSON with
   * `message` and a status; both are put in the thrown error.
   */
  async get(call, params = {}, opts = {}) {
    const q = [];
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.push(k + "=" + encodeURIComponent(String(v)));
    const token = opts.noToken ? null : this.token();
    if (!opts.noToken && !token) { const e = new Error("Not signed in to Qobuz"); e.status = 401; throw e; }
    if (opts.sign) {
      const ts = Math.floor(Date.now() / 1000);
      const sig = call.replace(/\//g, "") + Object.keys(params).sort().map(k => k + String(params[k])).join("") + ts + this.creds.secret;
      q.push("request_ts=" + ts, "request_sig=" + crypto.createHash("md5").update(sig).digest("hex"));
    }
    q.push("app_id=" + this.creds.appId);
    const url = this.base + call + "?" + q.sort().join("&");
    const key = url + "|" + (token || "");
    if (opts.ttl) {
      const c = this.cache.get(key);
      if (c && Date.now() - c.at < c.ttl) return c.value;
    }
    const headers = { "X-App-Id": this.creds.appId };
    if (token) headers["X-User-Auth-Token"] = token;
    const r = await this.fetch(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs || 15000) });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { j = null; }
    if (!r.ok) {
      const e = new Error((j && (j.message || j.error)) || `Qobuz answered ${r.status}`);
      e.status = r.status === 401 ? 401 : 502;
      e.qobuz = r.status;
      throw e;
    }
    if (opts.ttl) {
      this.cache.set(key, { at: Date.now(), ttl: opts.ttl, value: j });
      if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value);
    }
    return j;
  }

  /* Every page of a list call, as the plugin's _pagingGet: no limit of our own. */
  async getAll(call, params, pick, { ttl = 0, limit = 500, max = Infinity } = {}) {
    const out = [];
    for (let offset = 0; offset < max; offset += limit) {
      const j = await this.get(call, Object.assign({}, params, { limit, offset }), { ttl });
      const list = pick(j) || {};
      const items = list.items || [];
      out.push(...items);
      const total = Number(list.total) || 0;
      if (!items.length || out.length >= total) break;
    }
    return out;
  }

  async post(call, params, body) {
    const q = Object.entries(params || {}).map(([k, v]) => k + "=" + encodeURIComponent(String(v)));
    q.push("app_id=" + this.creds.appId);
    const url = this.base + call + "?" + q.join("&");
    const headers = { "X-App-Id": this.creds.appId, "Content-Type": "application/x-www-form-urlencoded" };
    const token = this.token();
    if (token) headers["X-User-Auth-Token"] = token;
    const r = await this.fetch(url, { method: "POST", headers, body, signal: AbortSignal.timeout(15000) });
    const text = await r.text();
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  // ------------------------------------------------------------ the account

  /* user/login: the token and the user, for a subscriber. */
  async login(username, password, deviceId) {
    const j = await this.get("user/login", { username, password, device_manufacturer_id: deviceId }, { noToken: true });
    if (!j || !j.user_auth_token || !j.user || !j.user.id) { const e = new Error("Qobuz didn't accept that sign-in"); e.status = 401; throw e; }
    return { token: j.user_auth_token, user: j.user };
  }

  userGet() { return this.get("user/get", {}, {}); }

  // ------------------------------------------------------------ the catalogue

  album(id) { return this.get("album/get", { album_id: id, extra: "track_ids" }, { ttl: 30 * 86400e3 }); }
  albumTracks(id) { return this.getAll("album/get", { album_id: id }, j => j.tracks, { ttl: 30 * 86400e3 }); }
  track(id) { return this.get("track/get", { track_id: id }, { ttl: 30 * 86400e3 }); }
  search(query, { limit = 50, offset = 0 } = {}) { return this.get("catalog/search", { query, limit, offset }, { ttl: 3600e3 }); }
  artist(id, { limit = 50, offset = 0 } = {}) { return this.get("artist/get", { artist_id: id, extra: "albums", limit, offset }, { ttl: 3600e3 }); }
  featured(type, { limit = 50, offset = 0 } = {}) { return this.get("album/getFeatured", { type, limit, offset }, { ttl: 3600e3 }); }
  favouriteAlbums() { return this.getAll("favorite/getUserFavorites", { type: "albums" }, j => j.albums, { ttl: 60e3 }); }
  favouriteIds() { return this.get("favorite/getUserFavoriteIds", {}, { ttl: 60e3 }); }
  purchases() { return this.getAll("purchase/getUserPurchases", {}, j => j.albums, { ttl: 60e3 }); }
  purchaseIds() { return this.get("purchase/getUserPurchasesIds", {}, { ttl: 60e3 }); }
  favouriteTracks() { return this.getAll("favorite/getUserFavorites", { type: "tracks" }, j => j.tracks, { ttl: 60e3 }); }
  playlists() { return this.getAll("playlist/getUserPlaylists", {}, j => j.playlists, { ttl: 60e3 }); }
  playlistTracks(id) { return this.getAll("playlist/get", { playlist_id: id, extra: "tracks" }, j => j.tracks, { ttl: 60e3 }); }
  setFavourite(albumId, on) {
    this.cache.clear();
    return this.get(on ? "favorite/create" : "favorite/delete", { album_ids: albumId }, {});
  }

  // ------------------------------------------------------------ the stream

  /*
   * track/getFileUrl, signed: the address the audio is at for a few minutes,
   * and what it is (mime_type, sampling_rate, bit_depth, format_id). Qobuz
   * answers with what the subscription allows, which may be below what was
   * asked for; the caller reads what came back.
   */
  fileUrl(trackId, formatId) {
    return this.get("track/getFileUrl", { track_id: trackId, format_id: formatId, intent: "stream" }, { sign: true });
  }

  /* track/reportStreamingStart and …End: the plugin's exact event shape. */
  report(which, event) {
    const body = "events=" + encodeURIComponent(JSON.stringify([event])) + "&user_auth_token=" + encodeURIComponent(this.token() || "");
    return this.post(which === "start" ? "track/reportStreamingStart" : "track/reportStreamingEnd", {}, body);
  }
}

module.exports = { QobuzApi, credentials, FORMAT, BASE };
