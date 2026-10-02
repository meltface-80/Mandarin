"use strict";
/*
 * fake-itunes.js — enough of Apple's iTunes Search API on loopback for the
 * identification tests: an album search and an album lookup with its songs,
 * in the shapes the real one answers with. `refuse` makes every answer a 429.
 */
const http = require("http");

class FakeITunes {
  /* albums: [{ id, title, artist, date, tracks: [[title, seconds], …] }] */
  constructor(albums = []) {
    this.albums = albums;
    this.requests = [];
    this.refuse = false;
  }
  start() {
    this.server = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      this.requests.push(u.pathname + u.search);
      const send = (j, code = 200) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(j)); };
      if (this.refuse) return send({ errorMessage: "Too many requests" }, 429);
      const collection = a => ({
        wrapperType: "collection", collectionType: "Album", collectionId: a.id, collectionName: a.title,
        artistName: a.artist, trackCount: a.tracks.length, releaseDate: (a.date || "2020-01-01") + "T08:00:00Z", country: "USA"
      });
      if (u.pathname === "/search") {
        const words = String(u.searchParams.get("term") || "").toLowerCase().split(/\s+/).filter(Boolean);
        const hits = this.albums.filter(a => words.every(w => (a.artist + " " + a.title).toLowerCase().includes(w)));
        return send({ resultCount: hits.length, results: hits.map(collection) });
      }
      if (u.pathname === "/lookup") {
        const a = this.albums.find(x => String(x.id) === u.searchParams.get("id"));
        if (!a) return send({ resultCount: 0, results: [] });
        const songs = a.tracks.map(([title, s], i) => ({
          wrapperType: "track", kind: "song", collectionId: a.id, trackId: a.id * 100 + i, trackName: title,
          artistName: a.artist, discNumber: 1, trackNumber: i + 1, trackTimeMillis: Math.round(s * 1000)
        }));
        return send({ resultCount: songs.length + 1, results: [collection(a)].concat(songs) });
      }
      send({ errorMessage: "Not Found" }, 404);
    });
    return new Promise(r => this.server.listen(0, "127.0.0.1", () => { this.port = this.server.address().port; r(this); }));
  }
  get baseUrl() { return `http://127.0.0.1:${this.port}`; }
  stop() { return new Promise(r => this.server ? this.server.close(r) : r()); }
}

module.exports = { FakeITunes };
