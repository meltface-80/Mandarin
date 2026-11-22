"use strict";
/*
 * fake-spotify.js — Spotify on loopback, as much of it as Mandarin asks (bug list item 497): the accounts service
 * (authorize, approved when the test says so; /api/token for the code, with PKCE's verifier checked against the
 * challenge, and for a refresh, each refresh token good once, as Spotify's are) and the Web API (/v1/me, the saved
 * albums a page at a time with Spotify's "next", an album with its tracks' first page; item 498: the artists you
 * follow a page at a time by cursor, an artist and their albums, search, an album saved or unsaved in your library).
 * What was asked for is recorded; access tokens can be made to expire, the token call slowed, and a list's next page
 * sent elsewhere.
 */
const http = require("http");
const crypto = require("crypto");

class FakeSpotify {
  /* albums: [{ id, name, artist, date, upc, type?, tracks: [{ id, name, ms }] }], saved: [{ id, added_at, as? }] newest
   * first; followed: [{ id, name }] (each artist's albums are those whose artist is their name) */
  constructor({ albums = [], saved = [], followed = [], user = { id: "listener1", display_name: "A Listener" }, page = 2, trackPage = 50 } = {}) {
    this.followed = followed;
    this.followPage = 50;
    this.followDelayMs = 0;            // those followed answered this late (two asks then overlap)              // the most artists a page of those followed holds (smaller: more pages)
    this.library = [];                 // { method, uris } every PUT or DELETE /me/library
    this.albums = albums;
    this.saved = saved;
    this.user = user;
    this.page = page;                  // saved albums per page
    this.trackPage = trackPage;        // tracks on an album's first page
    this.codes = new Map();            // code -> { challenge, redirect, client }
    this.access = new Set();           // access tokens that work
    this.refreshTokens = new Set();    // refresh tokens that work (each once)
    this.grants = [];                  // { grant_type, ... } every /api/token call
    this.calls = [];                   // { path, auth } every /v1 call
    this.tokenDelayMs = 0;
    this.busyOnce = false;             // the next /v1 call answered 429, Retry-After: 1
    this.busyFor = 0;
    this.busyAtCall = 0;               // the /v1 call of this number (counting from the first) answered busy once                  // every /v1 call answered 429 with this Retry-After (seconds) until it is 0 again
    this.nextElsewhere = null;         // an address the saved albums' next page points to instead
    this.server = null;
    this.base = "";
  }

  start() {
    this.server = http.createServer((req, res) => this.handle(req, res));
    return new Promise(r => this.server.listen(0, "127.0.0.1", () => { this.base = "http://127.0.0.1:" + this.server.address().port; r(this); }));
  }
  stop() { this.server.closeAllConnections(); return new Promise(r => this.server.close(() => r())); }
  get apiUrl() { return this.base + "/v1/"; }
  get accountsUrl() { return this.base + "/"; }

  /* The person approves Mandarin on Spotify's page: the address Spotify sends them back to (or a refusal). */
  approve(authorizeUrl, { deny = false } = {}) {
    const u = new URL(authorizeUrl);
    const q = Object.fromEntries(u.searchParams);
    const back = new URL(q.redirect_uri);
    if (deny) { back.searchParams.set("error", "access_denied"); back.searchParams.set("state", q.state); return back.toString(); }
    const code = "code-" + crypto.randomBytes(6).toString("hex");
    this.codes.set(code, { challenge: q.code_challenge, method: q.code_challenge_method, redirect: q.redirect_uri, client: q.client_id, scope: q.scope });
    back.searchParams.set("code", code);
    back.searchParams.set("state", q.state);
    return back.toString();
  }

  /* Every access token stops working now: the next call is refused (401) and Mandarin must refresh. */
  expireAccess() { this.access.clear(); }

  mint() {
    const access = "at-" + crypto.randomBytes(6).toString("hex"), refresh = "rt-" + crypto.randomBytes(6).toString("hex");
    this.access.add(access);
    this.refreshTokens.add(refresh);
    return { access_token: access, token_type: "Bearer", expires_in: 3600, refresh_token: refresh, scope: "user-library-read" };
  }

  albumJson(a, full) {
    const o = { id: a.id, name: a.name, album_type: "album", total_tracks: a.tracks.length, release_date: a.date || "2020-01-01",
      artists: [{ id: "ar-" + a.artist.replace(/\W+/g, ""), name: a.artist }],
      images: [{ url: this.base + "/img/" + a.id + "-64.jpg", width: 64, height: 64 }, { url: this.base + "/img/" + a.id + "-640.jpg", width: 640, height: 640 }] };
    if (!full) return o;
    const first = a.tracks.slice(0, this.trackPage);
    const tracks = first.map((t, i) => this.trackJson(a, t, i));
    o.external_ids = { upc: a.upc || null };
    o.label = a.label || "";
    o.album_type = a.type || "album";
    o.tracks = { items: tracks, total: a.tracks.length, offset: 0, limit: this.trackPage,
      next: a.tracks.length > this.trackPage ? this.apiUrl + "albums/" + a.id + "/tracks?offset=" + this.trackPage + "&limit=" + this.trackPage : null };
    return o;
  }
  /* A track as an album's list of them gives it: Spotify's simplified track, without its ISRC (no external_ids). */
  trackJson(a, t, i) {
    return { id: t.id, name: t.name, duration_ms: t.ms || 180000, track_number: i + 1, disc_number: 1, artists: [{ id: "ar", name: a.artist }],
      is_playable: t.playable !== false };
  }

  send(res, status, body) { res.writeHead(status, { "Content-Type": "application/json" }); res.end(body == null ? "" : JSON.stringify(body)); }

  async handle(req, res) {
    const u = new URL(req.url, this.base);
    let body = "";
    for await (const c of req) body += c;
    if (u.pathname.startsWith("/img/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); }
    if (u.pathname === "/api/token" && req.method === "POST") {
      const f = Object.fromEntries(new URLSearchParams(body));
      this.grants.push(f);
      if (this.tokenDelayMs) await new Promise(r => setTimeout(r, this.tokenDelayMs));
      if (f.grant_type === "authorization_code") {
        const c = this.codes.get(f.code);
        if (!c) return this.send(res, 400, { error: "invalid_grant", error_description: "Invalid authorization code" });
        this.codes.delete(f.code);
        const want = crypto.createHash("sha256").update(f.code_verifier || "").digest("base64url");
        if (c.method !== "S256" || want !== c.challenge) return this.send(res, 400, { error: "invalid_grant", error_description: "code_verifier was incorrect" });
        if (f.redirect_uri !== c.redirect || f.client_id !== c.client) return this.send(res, 400, { error: "invalid_grant", error_description: "Invalid redirect URI" });
        return this.send(res, 200, this.mint());
      }
      if (f.grant_type === "refresh_token") {
        if (!this.refreshTokens.delete(f.refresh_token)) return this.send(res, 400, { error: "invalid_grant", error_description: "Refresh token revoked" });
        return this.send(res, 200, this.mint());
      }
      return this.send(res, 400, { error: "unsupported_grant_type" });
    }
    if (!u.pathname.startsWith("/v1/")) return this.send(res, 404, { error: { status: 404, message: "Not found" } });
    const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
    const path = u.pathname.slice(4);
    this.calls.push({ path: path + u.search, auth, at: Date.now() });
    if (!this.access.has(auth)) return this.send(res, 401, { error: { status: 401, message: "The access token expired" } });
    if (this.busyAtCall && this.calls.length === this.busyAtCall) { this.busyAtCall = 0; this.busyOnce = true; }
    if (this.busyOnce || this.busyFor) {
      const wait = this.busyFor || 1;
      this.busyOnce = false;
      res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(wait) });
      return res.end(JSON.stringify({ error: { status: 429, message: "API rate limit exceeded" } }));
    }
    if (path === "me") return this.send(res, 200, this.user);
    if (path === "me/albums") {
      const offset = Number(u.searchParams.get("offset") || 0), limit = this.page;
      const items = this.saved.slice(offset, offset + limit).map(s => {
        const a = this.albums.find(x => x.id === s.id);
        return { added_at: s.added_at, [s.as || "album"]: this.albumJson(a, true) };
      });
      const more = offset + limit < this.saved.length;
      const next = !more ? null : this.nextElsewhere || this.apiUrl + "me/albums?offset=" + (offset + limit) + "&limit=" + limit;
      return this.send(res, 200, { items, total: this.saved.length, offset, limit, next });
    }
    if (path === "me/following") {
      if (this.followDelayMs) await new Promise(r => setTimeout(r, this.followDelayMs));
      const after = u.searchParams.get("after"), limit = Math.min(Number(u.searchParams.get("limit") || 20), this.followPage);
      const from = after ? this.followed.findIndex(a => a.id === after) + 1 : 0;
      const items = this.followed.slice(from, from + limit).map(a => ({ id: a.id, name: a.name, images: [] }));
      const more = from + limit < this.followed.length;
      return this.send(res, 200, { artists: { items, total: this.followed.length, limit, cursors: { after: more ? items.at(-1).id : null },
        next: more ? this.apiUrl + "me/following?type=artist&limit=" + limit + "&after=" + items.at(-1).id : null } });
    }
    if (path === "me/library" && (req.method === "PUT" || req.method === "DELETE")) {
      const uris = (u.searchParams.get("uris") || "").split(",");
      this.library.push({ method: req.method, uris });
      for (const uri of uris) {
        const id = uri.replace(/^spotify:album:/, "");
        if (req.method === "PUT" && !this.saved.some(x => x.id === id)) this.saved.unshift({ id, added_at: new Date().toISOString() });
        if (req.method === "DELETE") this.saved = this.saved.filter(x => x.id !== id);
      }
      res.writeHead(200); return res.end();
    }
    if (path === "search") {
      const q = (u.searchParams.get("q") || "").toLowerCase(), limit = Number(u.searchParams.get("limit") || 20), offset = Number(u.searchParams.get("offset") || 0);
      if (limit > 10) return this.send(res, 400, { error: { status: 400, message: "Invalid limit" } });
      const hits = this.albums.filter(a => (a.name + " " + a.artist).toLowerCase().includes(q));
      const artists = [...new Set(hits.map(a => a.artist))].map(n => ({ id: "ar-" + n.replace(/\W+/g, ""), name: n, images: [] }));
      return this.send(res, 200, { albums: { items: hits.slice(offset, offset + limit).map(a => this.albumJson(a, false)), total: hits.length, offset, limit },
        artists: { items: artists, total: artists.length } });
    }
    let m = /^artists\/([^/]+)$/.exec(path);
    if (m) {
      const a = this.followed.find(x => x.id === m[1]) || this.albums.map(x => ({ id: "ar-" + x.artist.replace(/\W+/g, ""), name: x.artist })).find(x => x.id === m[1]);
      return a ? this.send(res, 200, { id: a.id, name: a.name, images: [{ url: this.base + "/img/" + a.id + ".jpg", width: 320, height: 320 }] })
        : this.send(res, 404, { error: { status: 404, message: "Non existing id" } });
    }
    m = /^artists\/([^/]+)\/albums$/.exec(path);
    if (m) {
      this.artistAlbumCalls = (this.artistAlbumCalls || 0) + 1;
      const ar = this.followed.find(x => x.id === m[1]);
      const name = ar ? ar.name : (this.albums.find(x => "ar-" + x.artist.replace(/\W+/g, "") === m[1]) || {}).artist;
      const limit = Number(u.searchParams.get("limit") || 20), offset = Number(u.searchParams.get("offset") || 0);
      if (limit > 10) return this.send(res, 400, { error: { status: 400, message: "Invalid limit" } });
      const groups = (u.searchParams.get("include_groups") || "album,single").split(",");
      const mine = this.albums.filter(a => a.artist === name && groups.includes(a.type || "album")).sort((x, y) => (y.date || "").localeCompare(x.date || ""));
      return this.send(res, 200, { items: mine.slice(offset, offset + limit).map(a => this.albumJson(a, false)), total: mine.length, offset, limit });
    }
    m = /^albums\/([^/]+)$/.exec(path);
    if (m) { const a = this.albums.find(x => x.id === m[1]); return a ? this.send(res, 200, this.albumJson(a, true)) : this.send(res, 404, { error: { status: 404, message: "Non existing id" } }); }
    m = /^albums\/([^/]+)\/tracks$/.exec(path);
    if (m) {
      const a = this.albums.find(x => x.id === m[1]);
      const offset = Number(u.searchParams.get("offset") || 0), limit = Number(u.searchParams.get("limit") || 50);
      const items = a.tracks.slice(offset, offset + limit).map((t, i) => this.trackJson(a, t, offset + i));
      return this.send(res, 200, { items, total: a.tracks.length, offset, limit, next: offset + limit < a.tracks.length ? this.apiUrl + "albums/" + a.id + "/tracks?offset=" + (offset + limit) + "&limit=" + limit : null });
    }
    return this.send(res, 404, { error: { status: 404, message: "Service not found" } });
  }
}

module.exports = { FakeSpotify };
