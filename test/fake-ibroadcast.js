"use strict";
/*
 * fake-ibroadcast.js — iBroadcast's servers on loopback, under one address as IBROADCAST_URL puts them (item 443):
 *   /oauth   the device sign-in (GET /device/code, POST /token: approved when the test says so, slow_down asked for
 *            once, expired or turned down on demand), the refresh, POST /revoke;
 *   /api     the JSON API: POST /<mode>, Bearer <access token>; "authenticated": false for a token made stale, as
 *            iBroadcast answers one. status gives the user, the settings and, asked for them, the supported types;
 *   /library the library (item 444), as iBroadcast's library server sends it: each table an id → array of values with a
 *            map naming the places; its status.lastmodified moved on by changed();
 *   /artwork /artwork/<id>-<size>: a cover (a JPEG's first bytes);
 *   /streaming /<bitrate>/<path>?Expires&Signature&file_id&user_id&platform&version (item 445): a track's file ("src" in
 *            its album, a fixture's), byte ranges answered as a server answers them; refused without the access token;
 *   /upload  the upload server (item 446), as iBroadcast's own uploader asks it: an empty POST answers the MD5 of every
 *            file it has ({ md5 }); a multipart POST (file, file_path, method) is a file uploaded, kept in uploads with
 *            its MD5, and its MD5 then among them (but one notKept says: taken, as iBroadcast answered a real one's
 *            files it didn't keep, item 477). 401 without the access token; busy (503) as often as busy says; how
 *            many are under way at once counted (item 451).
 * What was asked for is recorded: the client id and scope a code was asked with, the bodies the API was sent.
 */
const http = require("http");
const crypto = require("crypto");

const hex = n => crypto.randomBytes(n).toString("hex");

class FakeIBroadcast {
  /* albums: [{ id, name, artist: { id, name }, disc, year, trashed, tracks: [{ id, title, track, length, type, genre, artwork_id, replay_gain, trashed }] }] */
  constructor({ user = { id: 4242, username: "tester", email_address: "tester@example.com", premium: true }, albums = [] } = {}) {
    this.albums = albums;
    this.lastmodified = "2026-11-16 12:00:00";
    this.libraryReads = 0;
    this.artworkAsks = [];
    this.refuseGrant = false;
    this.streamAsks = [];              // { path, query, range }          // the device grant refused, as iBroadcast refuses an app not let use it
    this.user = user;
    this.supported = [{ extension: ".flac" }, { extension: ".mp3" }, { extension: ".wav" }, { extension: ".m4a" }];
    this.codes = new Map();            // device_code -> { userCode, approved, denied, clientId, scope }
    this.access = "at-" + hex(6);
    this.refreshToken = "rt-" + hex(6);
    this.stale = new Set();            // access tokens that no longer work
    this.revoked = [];
    this.refreshes = 0;
    this.polls = 0;
    this.slowOnce = true;              // the first poll is asked to slow down
    this.expiresIn = 3600;             // the access token's life, in seconds
    this.deviceExpiresIn = 600;
    this.apiBodies = [];
    this.md5s = [];                    // the MD5 of every file iBroadcast has
    this.uploads = [];                 // { name, file_path, method, size, md5, data }
    this.md5Asks = 0;
    this.busy = 0;                     // how many uploads are answered 503 before one is taken
    this.uploadDelayMs = 0;            // how long each upload is held before it is answered
    this.sending = 0;                  // uploads under way now, and the most there have been at once (item 451)
    this.mostAtOnce = 0;
    this.receiving = 0;                // files' bodies arriving now, and the most at once (item 479)
    this.mostReceiving = 0;
    this.statusDelayMs = 0;            // how long the account's status is held before it is answered (item 452)
    this.refuseLogin = 0;              // how many uploads are answered as iBroadcast answered a real one whose login it couldn't confirm (item 454)
    this.refusedWith = [];             // the access token each refused upload came with
    this.refuseLoginOn = new Set();    // which uploads asked (the 1st, the 4th…) are answered so, whatever refuseLogin says
    this.uploadTries = 0;              // how many uploads have been asked
    this.notKept = () => false;        // a file (its file_path) taken, as iBroadcast answers, but not kept: not among its MD5s (item 477)
    this.server = null;
    this.port = 0;
  }

  get base() { return `http://127.0.0.1:${this.port}`; }

  /* The latest code approved, as a person does on iBroadcast. */
  approve() { const c = [...this.codes.values()].pop(); if (c) c.approved = true; }
  deny() { const c = [...this.codes.values()].pop(); if (c) c.denied = true; }
  /* The library changed: its lastmodified moved on. */
  changed() { this.lastmodified = new Date().toISOString().replace("T", " ").slice(0, 19); }

  /* The library as iBroadcast's library server sends it. */
  library() {
    const albums = { map: { name: 0, tracks: 1, artist_id: 2, trashed: 3, rating: 4, disc: 5, year: 6 } };
    const artists = { map: { name: 0, tracks: 1, trashed: 2, rating: 3 } };
    const tracks = { map: { track: 0, year: 1, title: 2, genre: 3, length: 4, album_id: 5, artwork_id: 6, artist_id: 7, enid: 8, uploaded_on: 9, trashed: 10,
      size: 11, path: 12, uid: 13, rating: 14, plays: 15, file: 16, type: 17, replay_gain: 18, uploaded_time: 19 } };
    for (const a of this.albums) {
      albums[a.id] = [a.name, a.tracks.map(t => t.id), a.artist.id, !!a.trashed, 0, a.disc || 0, a.year || 0];
      artists[a.artist.id] = [a.artist.name, [], false, 0];
      for (const t of a.tracks) tracks[t.id] = [t.track, a.year || 0, t.title, t.genre || "", t.length || 60, t.album_id || a.id, t.artwork_id || 0, a.artist.id, "", "2026-11-16", !!t.trashed,
        t.size || 1000, t.path || "", "", 0, 0, "/128/a/b/" + t.id, t.type || "audio/flac", t.replay_gain || "", "12:00:00"];
    }
    return { albums, artists, tracks, playlists: { map: { name: 0, tracks: 1 } }, tags: {}, trash: { map: { name: 0, tracks: 1 } } };
  }

  /* The access token made stale: the next API call answers "authenticated": false. */
  expire() { this.stale.add(this.access); }

  tokenAnswer() {
    return { access_token: this.access, token_type: "Bearer", expires_in: this.expiresIn, refresh_token: this.refreshToken, scope: ["user.account:read", "user.library:read", "user.library:write", "user.upload"] };
  }

  /* A multipart body's parts: { name, filename, data }. */
  static parts(raw, type) {
    const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(type || "");
    if (!m) return [];
    const sep = Buffer.from("--" + (m[1] || m[2]).trim()), out = [];
    let at = raw.indexOf(sep);
    while (at >= 0) {
      const next = raw.indexOf(sep, at + sep.length);
      if (next < 0) break;
      const part = raw.subarray(at + sep.length + 2, next - 2);
      const head = part.indexOf("\r\n\r\n");
      if (head >= 0) {
        const h = part.subarray(0, head).toString("utf8");
        const said = k => { const x = new RegExp("[;:]\\s*" + k + "=(?:\"([^\"]*)\"|([^;\\s]+))").exec(h); return x ? (x[1] !== undefined ? x[1] : x[2]) : undefined; };
        const name = said("name"), filename = said("filename");
        out.push({ name, filename, data: part.subarray(head + 4) });
      }
      at = next;
    }
    return out;
  }

  async handle(req, res, body, raw) {
    const u = new URL(req.url, this.base);
    const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const form = () => Object.fromEntries(new URLSearchParams(body));
    if (u.pathname === "/oauth/device/code" && req.method === "GET") {
      const device = "dc-" + hex(8), userCode = hex(3).toUpperCase();
      this.codes.set(device, { userCode, approved: false, denied: false, clientId: u.searchParams.get("client_id"), scope: u.searchParams.get("scope") });
      return json(200, { device_code: device, user_code: userCode, verification_uri: "https://media.ibroadcast.com/device",
        verification_uri_complete: "https://media.ibroadcast.com/device?code=" + userCode, interval: 1, expires_in: this.deviceExpiresIn });
    }
    if (u.pathname === "/oauth/token" && req.method === "POST") {
      const f = form();
      if (f.grant_type === "device_code") {
        this.polls++;
        const c = this.codes.get(f.device_code);
        if (!c) return json(400, { error: "invalid_grant" });
        if (c.denied) return json(400, { error: "access_denied" });
        if (this.refuseGrant) return json(400, { message: "Unauthorized client: `grant_type` is invalid" });
        if (this.slowOnce) { this.slowOnce = false; return json(429, { error: "slow_down" }); }
        if (!c.approved) return json(400, { error: "authorization_pending" });
        this.codes.delete(f.device_code);
        return json(200, this.tokenAnswer());
      }
      if (f.grant_type === "refresh_token") {
        this.refreshes++;
        if (f.refresh_token !== this.refreshToken) return json(400, { error: "invalid_grant", error_description: "The refresh token is no good" });
        this.access = "at-" + hex(6);
        return json(200, { access_token: this.access, token_type: "Bearer", expires_in: this.expiresIn, scope: "user.library:read" });
      }
      return json(400, { error: "unsupported_grant_type" });
    }
    if (u.pathname.startsWith("/artwork/artwork/") && req.method === "GET") {
      this.artworkAsks.push(u.pathname);
      res.writeHead(200, { "Content-Type": "image/jpeg" });
      return res.end(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]));
    }
    if (u.pathname.startsWith("/streaming/") && req.method === "GET") {
      const q = Object.fromEntries(u.searchParams);
      this.streamAsks.push({ path: u.pathname, query: q, range: req.headers.range || null });
      if (q.Signature !== this.access) { res.writeHead(403); return res.end(); }
      const id = u.pathname.split("/").pop();
      const t = this.albums.flatMap(a => a.tracks).find(x => String(x.id) === id && x.src);
      if (!t) { res.writeHead(404); return res.end(); }
      const body = require("fs").readFileSync(t.src);
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
      if (m) {
        const from = Number(m[1]), to = Math.min(body.length - 1, m[2] ? Number(m[2]) : body.length - 1);
        res.writeHead(206, { "Content-Type": t.type || "audio/flac", "Content-Range": `bytes ${from}-${to}/${body.length}`, "Content-Length": to - from + 1, "Accept-Ranges": "bytes" });
        return res.end(body.subarray(from, to + 1));
      }
      res.writeHead(200, { "Content-Type": t.type || "audio/flac", "Content-Length": body.length, "Accept-Ranges": "bytes" });
      return res.end(body);
    }
    if (u.pathname === "/library" && req.method === "POST") {
      const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (auth !== this.access || this.stale.has(auth)) return json(200, { result: false, authenticated: false });
      this.libraryReads++;
      return json(200, { result: true, message: "ok", library: this.library(), status: { timestamp: this.lastmodified, lastmodified: this.lastmodified },
        settings: { streaming_server: this.base + "/streaming", artwork_server: this.base + "/artwork" } });
    }
    if (u.pathname === "/upload" && req.method === "POST") {
      const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (auth !== this.access || this.stale.has(auth)) return json(401, { result: false, message: "Unauthorized" });
      if (!raw.length) { this.md5Asks++; return json(200, { result: true, md5: this.md5s.slice() }); }
      if (this.busy > 0) { this.busy--; return json(503, { result: false, message: "Busy" }); }
      this.uploadTries++;
      if (this.refuseLogin > 0 || this.refuseLoginOn.has(this.uploadTries)) {
        if (!this.refuseLoginOn.has(this.uploadTries)) this.refuseLogin--;
        this.refusedWith.push(auth);
        return json(200, { result: false, message: "Your login couldn't be confirmed, so nothing was uploaded. Sign out and back in, then try again." });
      }
      this.sending++;
      this.mostAtOnce = Math.max(this.mostAtOnce, this.sending);
      try { if (this.uploadDelayMs) await new Promise(r => setTimeout(r, this.uploadDelayMs)); } finally { this.sending--; }
      const ps = FakeIBroadcast.parts(raw, req.headers["content-type"]);
      const file = ps.find(p => p.name === "file"), field = n => { const p = ps.find(x => x.name === n); return p ? p.data.toString("utf8") : null; };
      if (!file) return json(400, { result: false, message: "No file" });
      const md5 = crypto.createHash("md5").update(file.data).digest("hex");
      this.uploads.push({ name: file.filename, file_path: field("file_path"), method: field("method"), size: file.data.length, md5, data: Buffer.from(file.data) });
      if (this.notKept(field("file_path"))) return json(200, { result: true, message: "Track already in library" });
      this.md5s.push(md5);
      return json(200, { result: true, message: "File uploaded" });
    }
    if (u.pathname === "/oauth/revoke" && req.method === "POST") { this.revoked.push(form()); return json(200, { result: true }); }
    if (u.pathname.startsWith("/api/") && req.method === "POST") {
      const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
      let b = {};
      try { b = JSON.parse(body); } catch (e) { /* none */ }
      this.apiBodies.push({ path: u.pathname, body: b, agent: req.headers["user-agent"] });
      if (auth !== this.access || this.stale.has(auth)) return json(200, { result: false, authenticated: false, message: "Your session has expired" });
      if (u.pathname === "/api/status") {
        if (this.statusDelayMs) await new Promise(r => setTimeout(r, this.statusDelayMs));
        const o = { result: true, authenticated: true, message: "ok", user: Object.assign({ token: "legacy-token" }, this.user),
          settings: { streaming_server: this.base + "/streaming", artwork_server: this.base + "/artwork" }, status: { timestamp: this.lastmodified, lastmodified: this.lastmodified } };
        if (b.supported_types) o.supported = this.supported;
        return json(200, o);
      }
      return json(200, { result: false, message: "Unknown mode " + b.mode });
    }
    res.writeHead(404); res.end();
  }

  start() {
    this.server = http.createServer((req, res) => {
      const chunks = [];
      // A file's body arriving: how many at once, as their bytes come (item 479), not only once each has come.
      const file = req.method === "POST" && req.url === "/upload" && (Number(req.headers["content-length"] || 0) > 0 || /chunked/.test(req.headers["transfer-encoding"] || ""));
      if (file) { this.receiving++; this.mostReceiving = Math.max(this.mostReceiving, this.receiving); }
      req.on("data", c => chunks.push(c));
      req.on("end", () => {
        if (file) this.receiving--; const raw = Buffer.concat(chunks); return this.handle(req, res, raw.toString("utf8"), raw).catch(e => { res.writeHead(500); res.end(String(e)); }); });
    });
    return new Promise(resolve => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; resolve(this); }));
  }

  stop() {
    return require("./fixtures").stopServer(this.server);
  }
}

module.exports = { FakeIBroadcast };
