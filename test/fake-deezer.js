"use strict";
/*
 * fake-deezer.js — Deezer's keyless API on loopback for the suggestion tests
 * (the share card's acts, the taste graph, Smart Picks): canned answers by
 * path and query, exactly as asked ("search/artist?limit=10&q=Artist%20A");
 * anything else is a 404. Every request is kept in [calls], in that form.
 * [hold] (optional): given the request, a promise to wait for before
 * answering it — a slow Deezer.
 */
const http = require("http");

class FakeDeezer {
  constructor(answers = {}) { this.answers = answers; this.calls = []; this.server = null; this.base = ""; this.hold = null; }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const p = req.url.replace(/^\//, "");
        this.calls.push(p);
        const j = this.answers[p];
        const answer = () => {
          res.writeHead(j ? 200 : 404, { "Content-Type": "application/json" });
          res.end(JSON.stringify(j || { error: { type: "DataException", message: "no data", code: 800 } }));
        };
        const wait = this.hold && this.hold(p);
        if (wait) wait.then(answer, answer); else answer();
      });
      this.server.listen(0, "127.0.0.1", () => { this.base = `http://127.0.0.1:${this.server.address().port}`; resolve(this.base); });
    });
  }
  stop() { return require("./fixtures").stopServer(this.server); }
}

module.exports = { FakeDeezer };
