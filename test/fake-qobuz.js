"use strict";
/*
 * fake-qobuz.js — Qobuz's API on loopback, as much of it as Mandarin uses:
 * user/login, album/get, catalog/search, album/getFeatured, artist/get,
 * favorite/*, purchase/getUserPurchases, the signed track/getFileUrl (its
 * signature checked), and the two streaming reports, recorded. The audio is
 * the fixture library's own files, served at an address that expires.
 */
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { credentials } = require("../lib/qobuz/api");

class FakeQobuz {
  /* albums: [{ id, title, artist, tracks: [{ id, title, file, duration, rate, bits }] , rate, bits, year, label }] */
  constructor({ albums = [], user = { login: "tester@example.com", password: "pw" }, art = null } = {}) {
    this.albums = albums;
    this.art = art;             // a JPEG file served as every cover
    this.user = user;
    this.token = "tok-" + crypto.randomBytes(6).toString("hex");
    this.favourites = new Set();
    this.purchases = new Set();
    this.reports = [];          // { which, event }
    this.fileUrlCalls = [];     // { track_id, format_id, sig_ok }
    this.fetches = [];          // stream fetches
    this.logins = 0;
    this.server = null;
    this.port = 0;
  }

  get base() { return `http://127.0.0.1:${this.port}/api.json/0.2/`; }

  albumJson(a, withTracks) {
    const out = {
      id: a.id, title: a.title, artist: { id: 1, name: a.artist }, image: { large: `http://127.0.0.1:${this.port}/art/${a.id}.jpg` },
      release_date_original: a.year + "-01-01", label: { name: a.label || "Fake Label" }, genre: { name: "Rock" },
      maximum_sampling_rate: a.rate / 1000, maximum_bit_depth: a.bits, hires_streamable: a.bits > 16, streamable: true,
      tracks_count: a.tracks.length, duration: a.tracks.reduce((s, t) => s + t.duration, 0), upc: "000" + a.id
    };
    if (withTracks) out.tracks = { total: a.tracks.length, items: a.tracks.map((t, i) => ({
      id: t.id, title: t.title, track_number: i + 1, media_number: 1, duration: t.duration, streamable: true,
      performer: { name: a.artist }, maximum_sampling_rate: (t.rate || a.rate) / 1000, maximum_bit_depth: t.bits || a.bits, isrc: "ISRC" + t.id
    })) };
    return out;
  }

  start() {
    const creds = credentials();
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      const q = Object.fromEntries(u.searchParams);
      const json = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      const call = u.pathname.replace("/api.json/0.2/", "");
      if (u.pathname.startsWith("/art/")) { res.writeHead(200, { "Content-Type": "image/jpeg" }); return res.end(this.art ? fs.readFileSync(this.art) : Buffer.from("ffd8ffd9", "hex")); }
      if (u.pathname.startsWith("/stream/")) {
        // The expiring address: /stream/<trackId>?until=<ts>
        const id = u.pathname.split("/")[2];
        if (Number(q.until) < Date.now()) { res.writeHead(410); return res.end(); }
        const t = this.albums.flatMap(a => a.tracks).find(x => String(x.id) === id);
        if (!t) { res.writeHead(404); return res.end(); }
        this.fetches.push({ id, range: req.headers.range || null });
        const buf = fs.readFileSync(t.file);
        res.writeHead(200, { "Content-Type": "audio/flac", "Content-Length": buf.length });
        return res.end(buf);
      }
      if (req.headers["x-app-id"] !== creds.appId || q.app_id !== creds.appId) return json(400, { message: "Invalid app id" });
      const authed = () => req.headers["x-user-auth-token"] === this.token;
      let body = "";
      req.on("data", c => { body += c; });
      req.on("end", () => {
        if (call === "user/login") {
          this.logins++;
          if (q.username !== this.user.login || q.password !== this.user.password) return json(401, { message: "Invalid username/password", status: "error", code: 401 });
          return json(200, { user_auth_token: this.token, user: { id: 4242, login: this.user.login, display_name: "Tester", email: this.user.login,
            subscription: { offer: "Studio", end_date: "2030-01-01" }, credential: { id: 77, label: "Studio", parameters: { hires_streaming: true, lossless_streaming: true } }, device: { id: 9001 } } });
        }
        if (!authed()) return json(401, { message: "Invalid or missing user token", code: 401 });
        const find = id => this.albums.find(a => String(a.id) === String(id));
        switch (call) {
          case "user/get": return json(200, { id: 4242, login: this.user.login });
          case "album/get": { const a = find(q.album_id); return a ? json(200, this.albumJson(a, true)) : json(404, { message: "No such album" }); }
          case "catalog/search": {
            const s = String(q.query || "").toLowerCase();
            const hits = this.albums.filter(a => (a.title + " " + a.artist).toLowerCase().includes(s));
            return json(200, { albums: { total: hits.length, items: hits.map(a => this.albumJson(a, false)) }, artists: { items: [{ id: 1, name: hits[0] ? hits[0].artist : "Nobody", image: null }] } });
          }
          case "album/getFeatured": return json(200, { albums: { total: this.albums.length, items: this.albums.map(a => this.albumJson(a, false)) } });
          case "artist/get": return json(200, { id: Number(q.artist_id), name: "Artist A", albums: { total: this.albums.length, items: this.albums.map(a => this.albumJson(a, false)) } });
          case "favorite/getUserFavorites": {
            const list = [...this.favourites].map(id => find(id)).filter(Boolean);
            const offset = Number(q.offset) || 0, limit = Number(q.limit) || 50;
            return json(200, { albums: { total: list.length, offset, limit, items: list.slice(offset, offset + limit).map(a => this.albumJson(a, false)) } });
          }
          case "purchase/getUserPurchases": {
            const list = [...this.purchases].map(id => find(id)).filter(Boolean);
            return json(200, { albums: { total: list.length, items: list.map(a => this.albumJson(a, false)) } });
          }
          case "favorite/getUserFavoriteIds": return json(200, { albums: [...this.favourites], tracks: [], artists: [] });
          case "favorite/create": for (const id of String(q.album_ids || "").split(",")) if (find(id)) this.favourites.add(String(id)); return json(200, { status: "success" });
          case "favorite/delete": for (const id of String(q.album_ids || "").split(",")) this.favourites.delete(String(id)); return json(200, { status: "success" });
          case "track/getFileUrl": {
            // The signature, as Qobuz checks it.
            const want = crypto.createHash("md5").update("trackgetFileUrl" + "format_id" + q.format_id + "intent" + q.intent + "track_id" + q.track_id + q.request_ts + creds.secret).digest("hex");
            const ok = want === q.request_sig && Math.abs(Number(q.request_ts) - Date.now() / 1000) < 300;
            this.fileUrlCalls.push({ track_id: q.track_id, format_id: Number(q.format_id), sig_ok: ok });
            if (!ok) return json(400, { message: "Invalid Request Signature parameter" });
            const a = this.albums.find(x => x.tracks.some(t => String(t.id) === q.track_id));
            const t = a && a.tracks.find(t => String(t.id) === q.track_id);
            if (!t) return json(404, { message: "No such track" });
            // What the format allows: 6 is CD, 7 up to 96, 27 up to 192 — the file is what it is.
            const f = Number(q.format_id);
            const rate = t.rate || a.rate, bits = t.bits || a.bits;
            const cap = f === 6 ? 44100 : f === 7 ? 96000 : 192000;
            const outRate = Math.min(rate, cap), outBits = f === 6 ? 16 : bits;
            return json(200, { track_id: Number(q.track_id), format_id: f, mime_type: "audio/flac", sampling_rate: outRate / 1000, bit_depth: outBits,
              url: `http://127.0.0.1:${this.port}/stream/${t.id}?until=${Date.now() + 120000}` });
          }
          case "track/reportStreamingStart":
          case "track/reportStreamingEnd": {
            const p = new URLSearchParams(body);
            const events = JSON.parse(p.get("events") || "[]");
            if (p.get("user_auth_token") !== this.token) return json(401, { message: "token" });
            for (const e of events) this.reports.push({ which: call.endsWith("Start") ? "start" : "end", event: e });
            return json(200, { status: "success" });
          }
          default: return json(404, { message: "Unknown call " + call });
        }
      });
    });
    return new Promise(resolve => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; resolve(this); }));
  }

  stop() { return new Promise(r => this.server ? this.server.close(() => r()) : r()); }
}

module.exports = { FakeQobuz };
