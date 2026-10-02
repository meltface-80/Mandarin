"use strict";
/*
 * fake-musicbrainz.js — enough of MusicBrainz's web service on loopback for
 * the identification tests: a release search by title, and a release with
 * its media, tracks, lengths and artist credit, in the shapes the real one
 * answers with.
 */
const http = require("http");

function credit(name) { return [{ name, artist: { name } }]; }

/* A release from a short description: { id, title, artist, date, tracks: [[title, seconds], …],
 * group: { title, date } (the release group, when it differs), disambiguation, barcode } */
function release(d) {
  const g = d.group || {};
  return {
    id: d.id, title: d.title, date: d.date || "", country: d.country || "XW", disambiguation: d.disambiguation || "",
    barcode: d.barcode || "",
    "artist-credit": credit(d.artist),
    "label-info": d.label ? [{ "catalog-number": "1", label: { id: d.label + "-id", name: d.label } }] : [],
    "release-group": { id: g.id || d.id + "-rg", title: g.title || d.title, "first-release-date": g.date || d.date || "", "primary-type": "Album" },
    media: [{ position: 1, format: "CD", "track-count": d.tracks.length,
      tracks: d.tracks.map(([title, s], i) => ({ id: `${d.id}-t${i + 1}`, position: i + 1, number: String(i + 1), title, length: s == null ? null : Math.round(s * 1000),
        "artist-credit": credit(d.artist), recording: { id: `${d.id}-r${i + 1}`, title, length: s == null ? null : Math.round(s * 1000) } }))
    }]
  };
}

class FakeMusicBrainz {
  /* labels (the record labels, for the logo tests): [{ id, name }] */
  constructor(releases, { labels = [] } = {}) {
    this.releases = releases.map(release);
    this.labels = labels;
    this.requests = [];
    this.server = null;
  }
  start() {
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      this.requests.push(u.pathname + u.search);
      const send = j => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(j)); };
      let m;
      if (u.pathname === "/ws/2/label/") {
        const t = /label:"((?:\\.|[^"])*)"/.exec(u.searchParams.get("query") || "");
        const want = t ? t[1].replace(/\\(.)/g, "$1").toLowerCase() : "";
        const hits = this.labels.filter(l => l.name.toLowerCase().includes(want.split(" ")[0]));
        return send({ count: hits.length, labels: hits.map((l, i) => ({ id: l.id, name: l.name, type: "Original Production", score: 100 - i })) });
      }
      if (u.pathname === "/ws/2/release/") {
        const q = u.searchParams.get("query") || "";
        const t = /release:"((?:\\.|[^"])*)"/.exec(q);
        const loose = /release:\(([^)]*)\)/.exec(q);          // the title's words in any order
        const bc = /barcode:(\d+)/.exec(q);
        const want = t ? t[1].replace(/\\(.)/g, "$1").toLowerCase() : "";
        const words = loose ? loose[1].split(" AND ").map(w => w.replace(/\\(.)/g, "$1").toLowerCase()) : null;
        const hits = bc ? this.releases.filter(r => r.barcode === bc[1])
          : words ? this.releases.filter(r => words.every(w => r.title.toLowerCase().includes(w)))
          : this.releases.filter(r => r.title.toLowerCase() === want);
        return send({ count: hits.length, offset: 0, releases: hits.map((r, i) => ({
          id: r.id, score: 100 - i, title: r.title, date: r.date, country: r.country, "artist-credit": r["artist-credit"], "label-info": r["label-info"],
          "track-count": r.media[0]["track-count"], media: [{ format: "CD", "track-count": r.media[0]["track-count"] }]
        })) });
      }
      if ((m = /^\/ws\/2\/release-group\/([^/]+)$/.exec(u.pathname))) {
        const rs = this.releases.filter(r => r["release-group"].id === decodeURIComponent(m[1]));
        if (!rs.length) { res.statusCode = 404; return send({ error: "Not Found" }); }
        return send({ id: m[1], title: rs[0]["release-group"].title, releases: rs.map(r => ({ id: r.id, title: r.title, media: [{ "track-count": r.media[0]["track-count"] }] })) });
      }
      if ((m = /^\/ws\/2\/release\/([^/]+)$/.exec(u.pathname))) {
        const r = this.releases.find(x => x.id === decodeURIComponent(m[1]));
        if (!r) { res.statusCode = 404; return send({ error: "Not Found" }); }
        return send(r);
      }
      res.statusCode = 404; send({ error: "Not Found" });
    });
    return new Promise(r => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; r(this); }));
  }
  get baseUrl() { return `http://127.0.0.1:${this.port}/ws/2`; }
  stop() { return new Promise(r => this.server ? this.server.close(r) : r()); }
}

module.exports = { FakeMusicBrainz, release };
