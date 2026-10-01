"use strict";
/*
 * fake-discogs.js — enough of Discogs' API on loopback for the label logo
 * tests: a label search, a label's page with its images, and the images
 * themselves. A token is required, as the real one requires for images.
 */
const http = require("http");

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");

class FakeDiscogs {
  /* labels: [{ id, title, image: "x.png" }] */
  constructor(labels, { token = "tok" } = {}) {
    this.labels = labels; this.token = token; this.hits = []; this.server = null; this.base = "";
  }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        this.hits.push(u.pathname + u.search);
        const send = (j, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
        let m;
        if ((m = /^\/img\/(.+)$/.exec(u.pathname))) {
          const png = m[1].endsWith(".png");
          res.writeHead(200, { "Content-Type": png ? "image/png" : "image/jpeg" }); return res.end(png ? PNG : JPG);
        }
        if (req.headers.authorization !== "Discogs token=" + this.token) return send({ message: "You must authenticate" }, 401);
        if (u.pathname === "/database/search") {
          const q = (u.searchParams.get("q") || "").toLowerCase();
          const hits = this.labels.filter(l => l.title.toLowerCase().includes(q.split(" ")[0]));
          return send({ results: hits.map(l => ({ id: l.id, type: "label", title: l.title, thumb: l.image ? `${this.base}/img/${l.image}` : "", cover_image: l.image ? `${this.base}/img/${l.image}` : "" })) });
        }
        if ((m = /^\/labels\/(\d+)$/.exec(u.pathname))) {
          const l = this.labels.find(x => String(x.id) === m[1]);
          if (!l) return send({ message: "Not found" }, 404);
          return send({ id: l.id, name: l.title, images: l.image ? [{ type: "primary", uri: `${this.base}/img/${l.image}` }] : [] });
        }
        send({ message: "Not found" }, 404);
      });
      this.server.listen(0, "127.0.0.1", () => { this.base = `http://127.0.0.1:${this.server.address().port}`; resolve(this.base); });
    });
  }
  stop() { return new Promise(r => this.server ? this.server.close(() => r()) : r()); }
}

class FakeFanart {
  /* logos: { mbid: "x.png" } */
  constructor(logos, { key = "fk" } = {}) { this.logos = logos; this.key = key; this.hits = []; this.server = null; this.base = ""; }
  start() {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        this.hits.push(u.pathname + u.search);
        let m;
        if ((m = /^\/img\/(.+)$/.exec(u.pathname))) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(PNG); }
        if (u.searchParams.get("api_key") !== this.key) { res.writeHead(401); return res.end("{}"); }
        if ((m = /^\/v3\/music\/labels\/(.+)$/.exec(u.pathname)) && this.logos[m[1]]) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ name: m[1], hdmusiclogo: [{ id: "1", url: `${this.base}/img/${this.logos[m[1]]}`, likes: "1" }] }));
        }
        res.writeHead(404, { "Content-Type": "application/json" }); res.end('{"status":"error","error message":"null"}');
      });
      this.server.listen(0, "127.0.0.1", () => { this.base = `http://127.0.0.1:${this.server.address().port}`; resolve(this.base); });
    });
  }
  stop() { return new Promise(r => this.server ? this.server.close(() => r()) : r()); }
}

module.exports = { FakeDiscogs, FakeFanart, PNG, JPG };
