"use strict";
/*
 * fake-ibroadcast.js — iBroadcast's servers on loopback, under one address as IBROADCAST_URL puts them (item 443):
 *   /oauth   the device sign-in (GET /device/code, POST /token: approved when the test says so, slow_down asked for
 *            once, expired or turned down on demand), the refresh, POST /revoke;
 *   /api     the JSON API: POST /<mode>, Bearer <access token>; "authenticated": false for a token made stale, as
 *            iBroadcast answers one. status gives the user, the settings and, asked for them, the supported types.
 * What was asked for is recorded: the client id and scope a code was asked with, the bodies the API was sent.
 */
const http = require("http");
const crypto = require("crypto");

const hex = n => crypto.randomBytes(n).toString("hex");

class FakeIBroadcast {
  constructor({ user = { id: 4242, username: "tester", email_address: "tester@example.com", premium: true } } = {}) {
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
    this.server = null;
    this.port = 0;
  }

  get base() { return `http://127.0.0.1:${this.port}`; }

  /* The latest code approved, as a person does on iBroadcast. */
  approve() { const c = [...this.codes.values()].pop(); if (c) c.approved = true; }
  deny() { const c = [...this.codes.values()].pop(); if (c) c.denied = true; }
  /* The access token made stale: the next API call answers "authenticated": false. */
  expire() { this.stale.add(this.access); }

  tokenAnswer() {
    return { access_token: this.access, token_type: "Bearer", expires_in: this.expiresIn, refresh_token: this.refreshToken, scope: ["user.account:read", "user.library:read", "user.library:write", "user.upload"] };
  }

  async handle(req, res, body) {
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
    if (u.pathname === "/oauth/revoke" && req.method === "POST") { this.revoked.push(form()); return json(200, { result: true }); }
    if (u.pathname.startsWith("/api/") && req.method === "POST") {
      const auth = (req.headers.authorization || "").replace(/^Bearer /, "");
      let b = {};
      try { b = JSON.parse(body); } catch (e) { /* none */ }
      this.apiBodies.push({ path: u.pathname, body: b, agent: req.headers["user-agent"] });
      if (auth !== this.access || this.stale.has(auth)) return json(200, { result: false, authenticated: false, message: "Your session has expired" });
      if (u.pathname === "/api/status") {
        const o = { result: true, authenticated: true, message: "ok", user: Object.assign({ token: "legacy-token" }, this.user),
          settings: { streaming_server: this.base + "/streaming", artwork_server: this.base + "/artwork" }, status: { timestamp: "2026-11-16 12:00:00", lastmodified: "2026-11-16 12:00:00" } };
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
      req.on("data", c => chunks.push(c));
      req.on("end", () => this.handle(req, res, Buffer.concat(chunks).toString("utf8")).catch(e => { res.writeHead(500); res.end(String(e)); }));
    });
    return new Promise(resolve => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; resolve(this); }));
  }

  stop() {
    return require("./fixtures").stopServer(this.server);
  }
}

module.exports = { FakeIBroadcast };
