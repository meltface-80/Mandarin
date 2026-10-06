"use strict";
/*
 * api.js — Tidal's API (v0.6.24), as the Lyrion (LMS) Tidal plugin uses it:
 * a subscriber signs in on tidal.com (OAuth's device flow: a short link and
 * a code, nothing typed in here), every stream is asked for one track at a
 * time and comes back as a short-lived address, nothing is downloaded.
 *
 *   https://auth.tidal.com/v1/oauth2/device_authorization   the link and code
 *   https://auth.tidal.com/v1/oauth2/token                  polled until the
 *     sign-in is done; later, a refresh_token for a new access token
 *   https://api.tidal.com/v1/<call>?countryCode=…           Bearer <token>
 *
 * Lists come in pages (limit, offset, totalNumberOfItems); every page is
 * read, no cap of our own. The client id and secret are the ones the plugin
 * ships (its Auth.pm, decoded the way its _fetchKs does): Tidal's own
 * developer programme answers no streaming requests, and lets the plugin be
 * because of how it behaves — a paying account, streaming only. This client
 * behaves the same.
 */
const AUTH = "https://auth.tidal.com";
const BASE = "https://api.tidal.com/v1/";
const IMAGES = "https://resources.tidal.com/images/";
const SCOPE = "r_usr w_usr";
const GRANT_DEVICE = "urn:ietf:params:oauth:grant-type:device_code";
// The plugin's credentials, as it carries them.
const BLOB = "$WyI0TjNu$.$NlExeDk1TEw1SzdwIiwib0tPWGZKVzM3$.$MWNYNnhhWjBQeWhnR05CZE5MbEJaZDRB$.$S0tZb3VnTWppaz0iXQ$";

// What to ask for (audioquality), as Tidal names it.
const QUALITY = { LOSSLESS: "LOSSLESS", HIRES: "HI_RES_LOSSLESS" };
const PAGE = 100;

function credentials() {
  const [clientId, secret] = JSON.parse(Buffer.from(BLOB.replace(/[$.]/g, "") + "==", "base64").toString("utf8"));
  if (!clientId || !secret) throw new Error("Tidal credentials unreadable");
  return { clientId, secret };
}

/* A cover id ("a1b2c3d4-…") as the picture at a size Tidal serves. */
function imageUrl(id, size = "1280x1280", base = IMAGES) {
  if (!id) return "";
  if (/^https?:/.test(id)) return id;
  return base + String(id).replace(/-/g, "/") + "/" + size + ".jpg";
}

class TidalApi {
  /*
   * fetch: for tests, a fake; authUrl/baseUrl likewise. token(): the
   * signed-in account's { access, refresh, expires }, read each call so a
   * sign-out takes at once; onToken(t): a refreshed token to keep.
   */
  constructor({ authUrl = AUTH, baseUrl = BASE, imagesUrl = IMAGES, fetch: f = globalThis.fetch, token = () => null, onToken = () => {}, country = () => "US", log = () => {}, creds = null } = {}) {
    this.auth = authUrl;
    this.base = baseUrl;
    this.images = imagesUrl;
    this.fetch = f;
    this.token = token;
    this.onToken = onToken;
    this.country = country;
    this.log = log;
    this.creds = creds || credentials();
    this.cache = new Map();   // url -> { at, ttl, value }
    this.refreshing = null;
  }

  /* A cover id as the picture at a size Tidal serves. */
  image(id, size) { return imageUrl(id, size, this.images); }

  // ------------------------------------------------------------ signing in

  async authPost(path, params) {
    const body = new URLSearchParams(Object.assign({ client_id: this.creds.clientId }, params)).toString();
    const basic = Buffer.from(this.creds.clientId + ":" + this.creds.secret).toString("base64");
    const r = await this.fetch(this.auth + path, {
      method: "POST", body, signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + basic }
    });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch (e) { j = null; }
    return { status: r.status, json: j || {} };
  }

  /* The link and the code for the person to sign in with, on tidal.com. */
  async deviceAuthorization() {
    const { status, json: j } = await this.authPost("/v1/oauth2/device_authorization", { scope: SCOPE });
    if (status >= 400 || !j.deviceCode) { const e = new Error(j.error_description || j.error || `Tidal answered ${status}`); e.status = 502; throw e; }
    const uri = j.verificationUriComplete || j.verificationUri || "link.tidal.com";
    return { deviceCode: j.deviceCode, userCode: j.userCode || "", url: /^https?:/.test(uri) ? uri : "https://" + uri,
      expiresIn: Number(j.expiresIn) || 300, interval: Number(j.interval) || 2 };
  }

  /*
   * One ask whether the sign-in is done: { pending: true } while it isn't,
   * the tokens and the user once it is, an error once the code has expired.
   */
  async pollDevice(deviceCode) {
    const { status, json: j } = await this.authPost("/v1/oauth2/token", { scope: SCOPE, grant_type: GRANT_DEVICE, device_code: deviceCode });
    if (j.access_token) return tokensOf(j);
    if (j.error === "authorization_pending" || j.error === "slow_down") return { pending: true };
    const e = new Error(j.error === "expired_token" ? "The sign-in link expired — ask for a new one" : (j.error_description || j.error || `Tidal answered ${status}`));
    e.status = j.error === "expired_token" ? 410 : 401;
    throw e;
  }

  /* A new access token from the refresh token, kept through onToken. */
  async refresh() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const t = this.token();
      if (!t || !t.refresh) { const e = new Error("Not signed in to Tidal"); e.status = 401; throw e; }
      const { status, json: j } = await this.authPost("/v1/oauth2/token", { scope: SCOPE, grant_type: "refresh_token", refresh_token: t.refresh });
      if (!j.access_token) { const e = new Error(j.error_description || j.error || `Tidal refused a new token (${status})`); e.status = 401; throw e; }
      const next = tokensOf(j);
      if (!next.refresh) next.refresh = t.refresh;
      this.onToken(next);
      return next;
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async accessToken() {
    const t = this.token();
    if (!t || !t.access) { const e = new Error("Not signed in to Tidal"); e.status = 401; throw e; }
    if (t.expires && Date.now() > t.expires - 60000) return (await this.refresh()).access;
    return t.access;
  }

  // ------------------------------------------------------------ requests

  /*
   * One call. opts.ttl: cached for that long (ms); opts.method/body for the
   * favourites. A 401 is answered once more with a refreshed token. Tidal
   * answers errors as JSON with userMessage; it goes in the thrown error.
   */
  urlFor(path, params = {}) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) q.set(k, String(v));
    if (!q.has("countryCode")) q.set("countryCode", this.country() || "US");
    return this.base + path + "?" + q.toString();
  }
  /* An answer known already (an album as a list gave it), kept as if the call had been made. */
  prime(path, params, value, ttl) {
    this.cache.set("GET " + this.urlFor(path, params), { at: Date.now(), ttl, value });
  }
  async call(path, params = {}, opts = {}) {
    const url = this.urlFor(path, params);
    const method = opts.method || "GET";
    const key = method + " " + url;
    // opts.fresh: asked again now (the favourites watch), the answer cached as before.
    if (opts.ttl && method === "GET" && !opts.fresh) {
      const c = this.cache.get(key);
      if (c && Date.now() - c.at < c.ttl) return c.value;
    }
    const once = async (token) => {
      const headers = Object.assign({ Authorization: "Bearer " + token }, opts.headers || {});
      const init = { method, headers, signal: AbortSignal.timeout(opts.timeoutMs || 20000) };
      if (opts.body !== undefined) { headers["Content-Type"] = "application/x-www-form-urlencoded"; init.body = typeof opts.body === "string" ? opts.body : new URLSearchParams(opts.body).toString(); }
      const r = await this.fetch(url, init);
      const text = await r.text();
      let j = null;
      try { j = JSON.parse(text); } catch (e) { j = null; }
      return { r, j };
    };
    let { r, j } = await once(await this.accessToken());
    if (r.status === 401) ({ r, j } = await once((await this.refresh()).access));
    if (!r.ok) {
      const e = new Error((j && (j.userMessage || j.error_description || j.error)) || `Tidal answered ${r.status}`);
      e.status = r.status === 401 ? 401 : r.status === 404 ? 404 : 502;
      e.tidal = r.status;
      e.sub = j && j.subStatus;
      throw e;
    }
    if (opts.ttl && method === "GET") {
      this.cache.set(key, { at: Date.now(), ttl: opts.ttl, value: j });
      if (this.cache.size > 2000) this.cache.delete(this.cache.keys().next().value);
    }
    return j;
  }

  /* Every page of a list call, as the plugin's paging: no limit of our own. */
  async getAll(path, params = {}, { ttl = 0, limit = PAGE, pick = j => j } = {}) {
    const out = [];
    for (let offset = 0; ; offset += limit) {
      const j = pick(await this.call(path, Object.assign({}, params, { limit, offset }), { ttl })) || {};
      const items = j.items || [];
      out.push(...items);
      const total = Number(j.totalNumberOfItems) || 0;
      if (!items.length || out.length >= total) break;
    }
    return out;
  }

  // ------------------------------------------------------------ the account

  user(userId) { return this.call(`users/${userId}`, {}, { ttl: 3600e3 }); }
  subscription(userId) { return this.call(`users/${userId}/subscription`, {}, { ttl: 3600e3 }); }

  // ------------------------------------------------------------ the catalogue

  album(id) { return this.call(`albums/${id}`, {}, { ttl: 30 * 86400e3 }); }
  albumTracks(id) { return this.getAll(`albums/${id}/tracks`, {}, { ttl: 30 * 86400e3 }); }
  track(id) { return this.call(`tracks/${id}`, {}, { ttl: 30 * 86400e3 }); }
  search(query, { limit = 50, offset = 0 } = {}) { return this.call("search", { query, types: "ALBUMS,ARTISTS", limit, offset }, { ttl: 3600e3 }); }
  artist(id) { return this.call(`artists/${id}`, {}, { ttl: 86400e3 }); }
  artistAlbums(id, { limit = 50, offset = 0, filter = "ALBUMS" } = {}) { return this.call(`artists/${id}/albums`, { filter, limit, offset }, { ttl: 3600e3 }); }
  /* The lists Tidal features (New, Recommended, Top, Rising…) and one list's albums. */
  featured() { return this.call("featured", {}, { ttl: 3600e3 }); }
  featuredAlbums(path, { limit = 100 } = {}) { return this.call(`featured/${path}/albums`, { limit }, { ttl: 3600e3 }); }
  newReleases({ limit = 100 } = {}) { return this.featuredAlbums("new", { limit }); }
  favouriteAlbums(userId) { return this.getAll(`users/${userId}/favorites/albums`, { order: "DATE", orderDirection: "DESC" }); }
  favouriteIds(userId, fresh = false) { return this.call(`users/${userId}/favorites/ids`, {}, { ttl: 60e3, fresh }); }
  favouriteTracks(userId) { return this.getAll(`users/${userId}/favorites/tracks`, { order: "DATE", orderDirection: "DESC" }); }
  playlists(userId) { return this.getAll(`users/${userId}/playlistsAndFavoritePlaylists`, {}, { limit: 50 }); }
  playlistItems(uuid) { return this.getAll(`playlists/${uuid}/items`); }
  async setFavourite(userId, albumId, on) {
    this.cache.clear();
    if (on) return this.call(`users/${userId}/favorites/albums`, {}, { method: "POST", body: { albumIds: albumId, onArtifactNotFound: "SKIP" } });
    return this.call(`users/${userId}/favorites/albums/${albumId}`, {}, { method: "DELETE" });
  }

  // ------------------------------------------------------------ the stream

  /*
   * tracks/<id>/playbackinfopostpaywall: where the audio is, for a few
   * minutes, and what it is. Answered with a manifest: application/vnd.tidal.bts
   * (one address, FLAC or AAC) or application/dash+xml (MPEG-DASH, the way
   * Tidal sends its hi-res FLAC). Decoded by lib/tidal's resolve.
   */
  playbackInfo(trackId, quality) {
    return this.call(`tracks/${trackId}/playbackinfopostpaywall`, { audioquality: quality, playbackmode: "STREAM", assetpresentation: "FULL" });
  }
}

function tokensOf(j) {
  return { access: j.access_token, refresh: j.refresh_token || null, expires: Date.now() + (Number(j.expires_in) || 3600) * 1000,
    userId: j.user_id || (j.user && j.user.userId) || null, user: j.user || null };
}

module.exports = { TidalApi, credentials, imageUrl, QUALITY, AUTH, BASE };
