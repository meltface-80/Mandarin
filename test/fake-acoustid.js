"use strict";
/*
 * fake-acoustid.js — enough of AcoustID's web service on loopback for matching albums by sound (bug list item 414c):
 * the lookup by fingerprint (a form posted to /v2/lookup: client, duration, fingerprint, meta), answering with the
 * recordings a fingerprint is, their release groups, releases and tracks, in the shapes the real one answers with;
 * and the lookup by track id a key is checked with. A key it doesn't know is refused as AcoustID refuses one (error
 * 4, "invalid API key"); asked to, it answers every request "too many requests" (HTTP 429, error 14). Each request
 * is kept with the time it came, for the three-a-second limit; each answer can be held a while (delayMs).
 */
const http = require("http");

class FakeAcoustId {
  /* keys: the application keys it takes. */
  constructor({ keys = ["good-key"] } = {}) {
    this.keys = new Set(keys);
    this.prints = new Map();      // fingerprint → [{ release (fake-musicbrainz's release()), track (1-based), score }]
    this.limited = false;
    this.delayMs = 0;             // each answer held this long (a slow AcoustID: item 419's one job at a time)
    this.requests = [];           // { at, kind: "lookup" | "check", client, fingerprint, duration, meta }
    this.server = null;
  }

  /* What AcoustID says of [fingerprint]: the track [track] of each release given ([on]: [[release, track, score?], …]). */
  know(fingerprint, on) {
    this.prints.set(fingerprint, on.map(([release, track, score]) => ({ release, track, score: score == null ? 0.97 : score })));
  }

  /* One result a release gives: its recording, under its release group and release, the release's tracks with it. */
  static result(r, track, score, n) {
    const media = r.media.map(m => ({ position: m.position, format: m.format, track_count: m["track-count"],
      tracks: m.tracks.map(t => ({ position: t.position, id: t.id, title: t.title })) }));
    const all = r.media.flatMap(m => m.tracks);
    const t = all[track - 1];
    const g = r["release-group"];
    return { id: "aid-" + n, score, recordings: [{ id: t.recording.id, title: t.title, duration: Math.round((t.length || 0) / 1000),
      releasegroups: [{ id: g.id, type: "Album", title: g.title, releases: [{ id: r.id, title: r.title, country: r.country,
        track_count: all.length, medium_count: r.media.length, mediums: media }] }] }] };
  }

  start() {
    this.server = http.createServer((req, res) => {
      const chunks = [];
      req.on("data", c => chunks.push(c));
      req.on("end", () => setTimeout(() => {
        const u = new URL(req.url, "http://x");
        const send = (status, j) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(j)); };
        if (u.pathname !== "/v2/lookup") return send(404, { status: "error", error: { code: 1, message: "not found" } });
        const form = new URLSearchParams(req.method === "POST" ? Buffer.concat(chunks).toString("utf8") : u.search);
        const q = k => form.get(k) || u.searchParams.get(k);
        const kind = q("trackid") ? "check" : "lookup";
        this.requests.push({ at: Date.now(), kind, client: q("client"), fingerprint: q("fingerprint"), duration: q("duration"), meta: q("meta") });
        if (this.limited) return send(429, { status: "error", error: { code: 14, message: "rate limit exceeded" } });
        if (!this.keys.has(q("client"))) return send(400, { status: "error", error: { code: 4, message: "invalid API key" } });
        if (kind === "check") return send(200, { status: "ok", results: [] });
        const on = this.prints.get(q("fingerprint")) || [];
        send(200, { status: "ok", results: on.map((x, i) => FakeAcoustId.result(x.release, x.track, x.score, i + 1)) });
      }, this.delayMs));
    });
    return new Promise(r => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; r(this); }));
  }

  /* The lookups by fingerprint, and the fingerprints asked about. */
  lookups() { return this.requests.filter(r => r.kind === "lookup"); }

  get baseUrl() { return `http://127.0.0.1:${this.port}/v2`; }
  stop() { return require("./fixtures").stopServer(this.server); }
}

module.exports = { FakeAcoustId };
