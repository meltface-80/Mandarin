"use strict";
/*
 * fake-web.js — Wikipedia's API, Qobuz's public pages and Pitchfork's pages on
 * loopback, for the write-up tests: canned answers by path and query (the
 * page asked for exactly as the server asks for it); anything else a 404.
 * Every request is kept in [calls] ("/w/api.php?…", "/us-en/search?q=…").
 */
const http = require("http");

class FakeWeb {
  /* pages: { "<path and query>": string (HTML) | object (JSON) | (() => string | object) } */
  constructor(pages = {}) { this.pages = pages; this.calls = []; this.server = null; this.base = ""; }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        // A "|" as it was written, or escaped (.NET's client escapes it; Node's doesn't).
        const url = req.url.replace(/%7C/gi, "|");
        this.calls.push(url);
        let v = this.pages[url];
        if (typeof v === "function") v = v();
        if (v == null) { res.writeHead(404, { "Content-Type": "text/html" }); return res.end("<h1>Not found</h1>"); }
        const json = typeof v !== "string";
        res.writeHead(200, { "Content-Type": json ? "application/json; charset=utf-8" : "text/html; charset=utf-8" });
        res.end(json ? JSON.stringify(v) : v);
      });
      this.server.listen(0, "127.0.0.1", () => { this.base = `http://127.0.0.1:${this.server.address().port}`; resolve(this.base); });
    });
  }
  stop() { return new Promise(r => this.server ? this.server.close(() => r()) : r()); }
}

/* Wikipedia's API addresses, as lib/meta.js asks them. */
const wiki = {
  search: (q, limit = 5) => `/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=${limit}&format=json&origin=*`,
  extract: (title) => `/w/api.php?action=query&prop=extracts|info&exintro=true&explaintext=true&redirects=1&inprop=url&titles=${encodeURIComponent(title)}&format=json&origin=*`,
  hits: (...titles) => ({ query: { search: titles.map(title => ({ ns: 0, title })) } }),
  page: (title, extract) => ({ query: { pages: { "4242": { pageid: 4242, title, extract, fullurl: "https://en.wikipedia.org/wiki/" + encodeURIComponent(title.replace(/ /g, "_")) } } } })
};

module.exports = { FakeWeb, wiki };
