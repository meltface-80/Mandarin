"use strict";
/*
 * fake-deezer.js — Deezer's keyless API on loopback for the suggestion tests
 * (the share card's acts, the taste graph, Smart Picks): canned answers by
 * path and query, exactly as asked ("search/artist?limit=10&q=Artist%20A");
 * anything else is a 404. Every request is kept in [calls], in that form.
 */
const http = require("http");

class FakeDeezer {
  constructor(answers = {}) { this.answers = answers; this.calls = []; this.server = null; this.base = ""; }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const p = req.url.replace(/^\//, "");
        this.calls.push(p);
        const j = this.answers[p];
        res.writeHead(j ? 200 : 404, { "Content-Type": "application/json" });
        res.end(JSON.stringify(j || { error: { type: "DataException", message: "no data", code: 800 } }));
      });
      this.server.listen(0, "127.0.0.1", () => { this.base = `http://127.0.0.1:${this.server.address().port}`; resolve(this.base); });
    });
  }
  stop() { return new Promise(r => this.server ? this.server.close(() => r()) : r()); }
}

module.exports = { FakeDeezer };
