"use strict";
/*
 * fake-tidal.js — Tidal's API on loopback, as much of it as Mandarin uses:
 * the device sign-in (auth.tidal.com's device_authorization and token,
 * approved when the test says so, with a refresh), albums, tracks, search,
 * artists, featured lists, the favourites, playlists, and
 * playbackinfopostpaywall — one address for CD quality, MPEG-DASH (an
 * initialisation piece and fragmented-MP4 segments, made with ffmpeg from
 * the fixture files) for a hi-res track asked for at HI_RES_LOSSLESS, as
 * Tidal does. What was asked for is recorded.
 */
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { credentials } = require("../lib/tidal/api");

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

class FakeTidal {
  /* albums: [{ id, title, artist, year, hires, tracks: [{ id, title, file, duration }] }] */
  constructor({ albums = [], user = { userId: 7001, email: "tester@example.com", countryCode: "GB", username: "tester" }, art = null, playlists = [] } = {}) {
    this.albums = albums;
    this.playlists = playlists;        // [{ uuid, name, tracks: [trackId…] }]
    this.user = user;
    this.art = art;
    this.favourites = new Set();
    this.favouriteTracks = new Set();
    this.subscription = { type: "HIFI_PLUS", highestSoundQuality: "HI_RES_LOSSLESS" };
    this.denyHires = false;            // an account Tidal gives CD to, whatever is asked
    this.featuredLists = [{ name: "New", path: "new", hasAlbums: true }, { name: "Recommended", path: "recommended", hasAlbums: true }, { name: "Top", path: "top", hasAlbums: true }, { name: "Rising", path: "rising", hasAlbums: true }];
    this.devices = new Map();          // deviceCode -> { approved, userCode }
    this.access = "at-" + crypto.randomBytes(6).toString("hex");
    this.refreshToken = "rt-" + crypto.randomBytes(6).toString("hex");
    this.expiredTokens = new Set();    // access tokens that no longer work (to make the server refresh)
    this.polls = 0;
    this.refreshes = 0;
    this.playbackCalls = [];           // { track_id, quality }
    this.fetches = [];                 // one-address stream fetches { id, range }
    this.dashFetches = [];             // { id, piece }
    this.dash = new Map();             // track id -> { init, segments }
    this.server = null;
    this.port = 0;
    this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fake-tidal-"));
  }

  get base() { return `http://127.0.0.1:${this.port}/v1/`; }
  get authBase() { return `http://127.0.0.1:${this.port}`; }

  /* The test approves the sign-in, as the person would on tidal.com. */
  approve(deviceCode) {
    for (const [code, d] of this.devices) if (!deviceCode || code === deviceCode) d.approved = true;
  }
  /* The access token the server holds stops working: its next call must refresh. */
  expireAccess() { this.expiredTokens.add(this.access); this.access = "at-" + crypto.randomBytes(6).toString("hex"); }

  trackOf(id) {
    for (const a of this.albums) { const t = a.tracks.find(x => String(x.id) === String(id)); if (t) return { a, t }; }
    return null;
  }
  albumJson(a) {
    return {
      id: a.id, title: a.title, duration: a.tracks.reduce((s, t) => s + t.duration, 0), numberOfTracks: a.tracks.length, numberOfVolumes: 1,
      releaseDate: a.year + "-03-01", cover: "aa11bb22-cc33-dd44-ee55-ff6677889900", upc: "00" + a.id, type: "ALBUM", explicit: false,
      audioQuality: a.hires ? "HI_RES_LOSSLESS" : "LOSSLESS", mediaMetadata: { tags: a.hires ? ["LOSSLESS", "HIRES_LOSSLESS"] : ["LOSSLESS"] },
      artist: { id: 11, name: a.artist, type: "MAIN" }, artists: [{ id: 11, name: a.artist, type: "MAIN" }], streamReady: true, allowStreaming: true
    };
  }
  trackJson(a, t, i) {
    return {
      id: t.id, title: t.title, duration: t.duration, trackNumber: i + 1, volumeNumber: 1, isrc: "ISRC" + t.id, streamReady: true, allowStreaming: true,
      audioQuality: a.hires ? "HI_RES_LOSSLESS" : "LOSSLESS", mediaMetadata: { tags: a.hires ? ["LOSSLESS", "HIRES_LOSSLESS"] : ["LOSSLESS"] },
      artist: { id: 11, name: a.artist, type: "MAIN" }, artists: [{ id: 11, name: a.artist, type: "MAIN" }],
      album: { id: a.id, title: a.title, cover: "aa11bb22-cc33-dd44-ee55-ff6677889900" }
    };
  }
  paged(items, q) {
    const offset = Number(q.offset) || 0, limit = Number(q.limit) || 100;
    return { limit, offset, totalNumberOfItems: items.length, items: items.slice(offset, offset + limit) };
  }

  /* The hi-res tracks as fragmented MP4 (FLAC inside), split into init and segments. */
  prepareDash() {
    for (const a of this.albums) {
      if (!a.hires) continue;
      for (const t of a.tracks) {
        const out = path.join(this.tmp, t.id + ".m4a");
        const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", t.file, "-c:a", "flac", "-strict", "-2",
          "-movflags", "frag_keyframe+empty_moov+default_base_moof", "-frag_duration", "1000000", "-f", "mp4", out], { encoding: "utf8" });
        if (r.status !== 0) throw new Error("ffmpeg (fake dash): " + r.stderr);
        const b = fs.readFileSync(out);
        const boxes = [];
        for (let i = 0; i < b.length;) { const n = b.readUInt32BE(i) || (b.length - i); boxes.push({ type: b.toString("ascii", i + 4, i + 8), buf: b.subarray(i, i + n) }); i += n; }
        const init = Buffer.concat(boxes.filter(x => x.type === "ftyp" || x.type === "moov").map(x => x.buf));
        const segments = [];
        for (let i = 0; i < boxes.length; i++) if (boxes[i].type === "moof") segments.push(Buffer.concat([boxes[i].buf, boxes[i + 1] && boxes[i + 1].type === "mdat" ? boxes[i + 1].buf : Buffer.alloc(0)]));
        this.dash.set(String(t.id), { init, segments, rate: t.rate || 96000 });
      }
    }
  }
  mpd(id) {
    const d = this.dash.get(String(id));
    const base = `http://127.0.0.1:${this.port}/dash/${id}/`;
    return `<?xml version="1.0" encoding="UTF-8"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static"><Period id="0"><AdaptationSet id="0" contentType="audio" mimeType="audio/mp4" segmentAlignment="true"><Representation id="0" codecs="flac" bandwidth="2000000" audioSamplingRate="${d.rate}"><SegmentTemplate initialization="${base}init.mp4?x=1&amp;y=2" media="${base}$Number$.m4s?x=1&amp;y=2" startNumber="1" timescale="${d.rate}"><SegmentTimeline><S d="${d.rate}" r="${d.segments.length - 1}"/></SegmentTimeline></SegmentTemplate></Representation></AdaptationSet></Period></MPD>`;
  }

  start() {
    const creds = credentials();
    this.prepareDash();
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const q = Object.fromEntries(u.searchParams);
      const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        const form = Object.fromEntries(new URLSearchParams(body));
        // ---- pictures and audio
        if (u.pathname.startsWith("/images/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(this.art ? fs.readFileSync(this.art) : Buffer.from("ffd8ffd9", "hex")); }
        if (u.pathname.startsWith("/stream/")) {
          const id = u.pathname.split("/")[2];
          if (Number(q.until) < Date.now()) { res.writeHead(410); return res.end(); }
          const f = this.trackOf(id);
          if (!f) { res.writeHead(404); return res.end(); }
          this.fetches.push({ id, range: req.headers.range || null });
          const buf = fs.readFileSync(f.t.file);
          res.writeHead(200, { "Content-Type": "audio/flac", "Content-Length": buf.length });
          return res.end(buf);
        }
        if (u.pathname.startsWith("/dash/")) {
          const [, , id, piece] = u.pathname.split("/");
          const d = this.dash.get(id);
          if (!d) { res.writeHead(404); return res.end(); }
          this.dashFetches.push({ id, piece });
          const buf = piece === "init.mp4" ? d.init : d.segments[Number(piece.replace(".m4s", "")) - 1];
          if (!buf) { res.writeHead(404); return res.end(); }
          res.writeHead(200, { "Content-Type": "audio/mp4", "Content-Length": buf.length });
          return res.end(buf);
        }
        // ---- the sign-in
        if (u.pathname === "/v1/oauth2/device_authorization") {
          if (form.client_id !== creds.clientId) return json(401, { error: "invalid_client" });
          const deviceCode = "dc-" + crypto.randomBytes(4).toString("hex"), userCode = "ABCDE";
          this.devices.set(deviceCode, { approved: false, userCode });
          return json(200, { deviceCode, userCode, verificationUri: "link.tidal.com", verificationUriComplete: "link.tidal.com/" + userCode, expiresIn: 300, interval: 1 });
        }
        if (u.pathname === "/v1/oauth2/token") {
          const basic = "Basic " + Buffer.from(creds.clientId + ":" + creds.secret).toString("base64");
          if (req.headers.authorization !== basic) return json(401, { error: "invalid_client", error_description: "the client secret" });
          const tokens = () => ({ access_token: this.access, refresh_token: this.refreshToken, expires_in: Number(this.expiresIn) || 3600, token_type: "Bearer",
            user_id: this.user.userId, user: { userId: this.user.userId, email: this.user.email, countryCode: this.user.countryCode, username: this.user.username } });
          if (form.grant_type === "refresh_token") {
            if (form.refresh_token !== this.refreshToken) return json(401, { error: "invalid_grant" });
            this.refreshes++;
            return json(200, tokens());
          }
          this.polls++;
          const d = this.devices.get(form.device_code);
          if (!d) return json(400, { error: "expired_token", error_description: "Device code has expired" });
          if (!d.approved) return json(400, { error: "authorization_pending", error_description: "Device Authorization pending" });
          this.devices.delete(form.device_code);
          return json(200, tokens());
        }
        // ---- the API: a Bearer token that works
        const bearer = String(req.headers.authorization || "").replace(/^Bearer /, "");
        if (bearer !== this.access || this.expiredTokens.has(bearer)) return json(401, { status: 401, subStatus: 11003, userMessage: "The token has expired" });
        if (!q.countryCode) return json(400, { userMessage: "countryCode missing" });
        const call = u.pathname.replace(/^\/v1\//, "");
        const uid = String(this.user.userId);
        const find = id => this.albums.find(a => String(a.id) === String(id));
        let m;
        if (call === `users/${uid}`) return json(200, { id: this.user.userId, username: this.user.username, email: this.user.email, countryCode: this.user.countryCode, firstName: "Tess" });
        if (call === `users/${uid}/subscription`) return json(200, { subscription: { type: this.subscription.type }, highestSoundQuality: this.subscription.highestSoundQuality, validUntil: "2030-01-01" });
        if ((m = /^albums\/(\d+)$/.exec(call))) { const a = find(m[1]); return a ? json(200, this.albumJson(a)) : json(404, { userMessage: "No such album" }); }
        if ((m = /^albums\/(\d+)\/tracks$/.exec(call))) { const a = find(m[1]); return a ? json(200, this.paged(a.tracks.map((t, i) => this.trackJson(a, t, i)), q)) : json(404, { userMessage: "No such album" }); }
        if ((m = /^tracks\/(\d+)$/.exec(call))) { const f = this.trackOf(m[1]); return f ? json(200, this.trackJson(f.a, f.t, f.a.tracks.indexOf(f.t))) : json(404, { userMessage: "No such track" }); }
        if (call === "search") {
          const s = String(q.query || "").toLowerCase();
          const hits = this.albums.filter(a => (a.title + " " + a.artist).toLowerCase().includes(s));
          return json(200, { albums: this.paged(hits.map(a => this.albumJson(a)), q), artists: { items: hits.length ? [{ id: 11, name: hits[0].artist, picture: null }] : [] } });
        }
        if ((m = /^artists\/(\d+)$/.exec(call))) return json(200, { id: Number(m[1]), name: "Artist T", picture: "aa11bb22-cc33-dd44-ee55-ff6677889900" });
        if ((m = /^artists\/(\d+)\/albums$/.exec(call))) return json(200, this.paged(this.albums.map(a => this.albumJson(a)), q));
        if (call === "featured") return json(200, { items: this.featuredLists });
        if ((m = /^featured\/([a-z]+)\/albums$/.exec(call))) {
          if (!this.featuredLists.some(l => l.path === m[1])) return json(404, { userMessage: "No such list" });
          return json(200, this.paged(this.albums.map(a => this.albumJson(a)), q));
        }
        if (call === `users/${uid}/favorites/albums` && req.method === "GET") return json(200, this.paged([...this.favourites].map(id => find(id)).filter(Boolean).map(a => ({ created: "2026-01-01T00:00:00.000+0000", item: this.albumJson(a) })), q));
        if (call === `users/${uid}/favorites/albums` && req.method === "POST") { for (const id of String(form.albumIds || "").split(",")) if (find(id)) this.favourites.add(String(id)); return json(200, {}); }
        if ((m = new RegExp(`^users/${uid}/favorites/albums/(\\d+)$`).exec(call)) && req.method === "DELETE") { this.favourites.delete(String(m[1])); return json(200, {}); }
        if (call === `users/${uid}/favorites/ids`) return json(200, { ALBUM: [...this.favourites], ARTIST: [], PLAYLIST: [], TRACK: [...this.favouriteTracks], VIDEO: [] });
        if (call === `users/${uid}/favorites/tracks`) return json(200, this.paged([...this.favouriteTracks].map(id => this.trackOf(id)).filter(Boolean).map(f => ({ created: "2026-01-01T00:00:00.000+0000", item: this.trackJson(f.a, f.t, f.a.tracks.indexOf(f.t)) })), q));
        if (call === `users/${uid}/playlistsAndFavoritePlaylists`) return json(200, this.paged(this.playlists.map(p => ({ type: "USER_CREATED", playlist: { uuid: p.uuid, title: p.name, numberOfTracks: p.tracks.length } })), q));
        if ((m = /^playlists\/([0-9a-z-]+)\/items$/.exec(call))) {
          const p = this.playlists.find(x => x.uuid === m[1]);
          if (!p) return json(404, { userMessage: "No such playlist" });
          return json(200, this.paged(p.tracks.map(id => this.trackOf(id)).filter(Boolean).map(f => ({ type: "track", item: this.trackJson(f.a, f.t, f.a.tracks.indexOf(f.t)) })), q));
        }
        if ((m = /^tracks\/(\d+)\/playbackinfopostpaywall$/.exec(call))) {
          const f = this.trackOf(m[1]);
          if (!f) return json(404, { userMessage: "No such track" });
          this.playbackCalls.push({ track_id: m[1], quality: q.audioquality });
          if (q.audioquality === "HI_RES_LOSSLESS" && f.a.hires && this.dash.has(m[1]) && !this.denyHires) {
            const d = this.dash.get(m[1]);
            return json(200, { trackId: Number(m[1]), assetPresentation: "FULL", audioMode: "STEREO", audioQuality: "HI_RES_LOSSLESS", sampleRate: d.rate, bitDepth: 24,
              manifestMimeType: "application/dash+xml", manifest: Buffer.from(this.mpd(m[1])).toString("base64") });
          }
          const manifest = { mimeType: "audio/flac", codecs: "flac", encryptionType: "NONE", urls: [`http://127.0.0.1:${this.port}/stream/${m[1]}?until=${Date.now() + 120000}`] };
          return json(200, { trackId: Number(m[1]), assetPresentation: "FULL", audioMode: "STEREO", audioQuality: "LOSSLESS", sampleRate: 44100, bitDepth: 16,
            manifestMimeType: "application/vnd.tidal.bts", manifest: Buffer.from(JSON.stringify(manifest)).toString("base64") });
        }
        return json(404, { userMessage: "Unknown call " + call });
      });
    });
    return new Promise(resolve => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; resolve(this); }));
  }

  stop() {
    try { fs.rmSync(this.tmp, { recursive: true, force: true }); } catch (e) { /* tmp */ }
    return new Promise(r => this.server ? this.server.close(() => r()) : r());
  }
}

module.exports = { FakeTidal };
