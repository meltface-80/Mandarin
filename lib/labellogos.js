"use strict";
/*
 * labellogos.js — a record label's logo (Stage 8, part 2).
 *
 * Found in the background for every label that has none: Discogs first (its
 * label page's own image; needs your Discogs token), then FanArt.tv (its HD
 * logo for the label's MusicBrainz id, looked up by name; needs your FanArt.tv
 * key). Or chosen by hand on the label's page, from Discogs' candidates or a
 * pasted address. The file is kept under the data folder and served through
 * the image route as `label-<key>`, so the app caches it like a cover. A label
 * no source has a logo for is asked about again after a week.
 */
const fs = require("fs");
const path = require("path");
const META = require("./meta");
const { labelKey } = require("./labels");

const DAY = 86400000;
const MISS_TTL = 7 * DAY;
const DISCOGS_BASE = "https://api.discogs.com";
const FANART_BASE = "https://webservice.fanart.tv";
const UA = "Mandarin/" + require("../package.json").version + " (+https://github.com/meltface-80/Mandarin)";
const MAX_IMAGE = 8 * 1024 * 1024;

function typeOf(buf, declared) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50) return ["image/png", "png"];
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return ["image/jpeg", "jpg"];
  if (buf.length > 6 && buf.toString("ascii", 0, 6).startsWith("GIF8")) return ["image/gif", "gif"];
  if (buf.length > 12 && buf.toString("ascii", 8, 12) === "WEBP") return ["image/webp", "webp"];
  if (/^\s*<(\?xml|svg)/i.test(buf.toString("utf8", 0, 200))) return ["image/svg+xml", "svg"];
  if (/^image\/svg/.test(declared || "")) return ["image/svg+xml", "svg"];
  return null;
}

class LabelLogos {
  constructor({ db, dataDir, mb, log = () => {}, discogsBaseUrl, fanartBaseUrl, pauseMs }) {
    this.db = db;
    this.mb = mb;
    this.log = log;
    this.dir = path.join(dataDir, "labels");
    this.discogsBase = (discogsBaseUrl || DISCOGS_BASE).replace(/\/$/, "");
    this.fanartBase = (fanartBaseUrl || FANART_BASE).replace(/\/$/, "");
    // Discogs allows sixty calls a minute with a token; one a second keeps under it.
    this.pauseMs = pauseMs == null ? 1100 : pauseMs;
    this.state = { running: false, done: 0, total: 0, startedAt: 0 };
    this.lines = [];
    this.lastPassKeys = "";
    this.q = {
      get: db.raw.prepare("SELECT * FROM label_logos WHERE key = ?"),
      all: db.raw.prepare("SELECT key, file, source, updated_at FROM label_logos"),
      put: db.raw.prepare(`INSERT INTO label_logos(key, file, type, source, url, updated_at) VALUES(@key, @file, @type, @source, @url, @updated_at)
                           ON CONFLICT(key) DO UPDATE SET file=excluded.file, type=excluded.type, source=excluded.source, url=excluded.url, updated_at=excluded.updated_at`),
      del: db.raw.prepare("DELETE FROM label_logos WHERE key = ?")
    };
  }

  note(line) {
    const s = new Date().toISOString().slice(11, 19) + " " + line;
    this.lines.push(s);
    if (this.lines.length > 400) this.lines.shift();
    this.log("[labels] " + line);
  }
  discogsToken() { return String(this.db.setting("discogsToken", "") || ""); }
  fanartKey() { return String(this.db.setting("fanartKey", "") || ""); }

  /* The logo kept for a label key: { file, type, url, source, updated_at } or null. */
  get(key) {
    const r = this.q.get.get(key);
    if (!r) return null;
    const file = path.join(this.dir, r.file);
    if (!fs.existsSync(file)) return null;
    return { file, type: r.type, url: `/api/image/label-${key}?v=${r.updated_at}`, source: r.source, updated_at: r.updated_at };
  }
  /* Every label key that has a logo, with its address. */
  urls() {
    const m = new Map();
    for (const r of this.q.all.all()) m.set(r.key, `/api/image/label-${r.key}?v=${r.updated_at}`);
    return m;
  }

  // ------------------------------------------------------------ fetching

  async json(url, headers) {
    return META.httpJson(url, Object.assign({ "User-Agent": UA, Accept: "application/json" }, headers || {}), 15000);
  }
  async discogs(pathAndQuery) {
    const token = this.discogsToken();
    if (!token) throw new Error("Discogs token needed (Settings → API Keys)");
    return this.json(this.discogsBase + pathAndQuery, { Authorization: "Discogs token=" + token });
  }

  /* Discogs' label images for a name: [{ img, title, id }], the best match first. */
  async candidates(name) {
    const j = await this.discogs(`/database/search?type=label&q=${encodeURIComponent(name)}&per_page=25`);
    const want = labelKey(name);
    const rows = (j.results || []).filter(r => r.cover_image || r.thumb);
    rows.sort((a, b) => (labelKey(a.title) === want ? 0 : 1) - (labelKey(b.title) === want ? 0 : 1));
    return rows.map(r => ({ img: r.cover_image || r.thumb, title: r.title, id: r.id }))
      .filter(c => c.img && !/spacer\.gif$/.test(c.img));
  }

  /* The logo Discogs has for this label, by its own page: the primary image. */
  async fromDiscogs(name) {
    const cands = await this.candidates(name);
    const hit = cands.find(c => labelKey(c.title) === labelKey(name));
    if (!hit) return null;
    try {
      const page = await this.discogs(`/labels/${hit.id}`);
      const img = (page.images || []).find(i => i.type === "primary") || (page.images || [])[0];
      if (img && (img.uri || img.resource_url)) return img.uri || img.resource_url;
    } catch (e) { /* the search's picture will do */ }
    return hit.img;
  }

  /* The label's MusicBrainz id, by name — exactly that name, by key. */
  async mbid(name) {
    if (!this.mb) return null;
    const j = await this.mb.get("label/", { query: `label:"${name.replace(/["\\]/g, "\\$&")}"`, limit: 5 });
    const want = labelKey(name);
    const hit = (j.labels || []).find(l => labelKey(l.name) === want) || null;
    return hit ? hit.id : null;
  }

  /* FanArt.tv's logo for the label: HD first. */
  async fromFanart(name) {
    const key = this.fanartKey();
    if (!key) return null;
    const id = await this.mbid(name);
    if (!id) return null;
    let j;
    try { j = await this.json(`${this.fanartBase}/v3/music/labels/${encodeURIComponent(id)}?api_key=${encodeURIComponent(key)}`); }
    catch (e) { if (/HTTP 404/.test(e.message)) return null; throw e; }
    const pick = (j.hdmusiclogo || [])[0] || (j.musiclogo || [])[0];
    return pick && pick.url ? pick.url : null;
  }

  /* Fetch an image and keep it as the label's logo. → its address on this server. */
  async save(key, url, source) {
    if (!/^https?:\/\//i.test(url)) throw new Error("A web address is needed");
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let res;
    try {
      res = await fetch(url, { headers: { "User-Agent": UA, Accept: "image/*" }, signal: ctl.signal, redirect: "follow" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length || buf.length > MAX_IMAGE) throw new Error("Not an image this server keeps (empty or over 8 MB)");
      const t = typeOf(buf, res.headers.get("content-type"));
      if (!t) throw new Error("That address isn't an image");
      fs.mkdirSync(this.dir, { recursive: true });
      const file = `${key}.${t[1]}`;
      const tmp = path.join(this.dir, file + ".tmp");
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, path.join(this.dir, file));
      // Any other extension this key had before.
      for (const f of fs.readdirSync(this.dir)) if (f.startsWith(key + ".") && f !== file && !f.endsWith(".tmp")) { try { fs.unlinkSync(path.join(this.dir, f)); } catch (e) { /* gone */ } }
      const now = Date.now();
      this.q.put.run({ key, file, type: t[0], source: source || "manual", url, updated_at: now });
      this.db.cacheDel && this.db.cacheDel("labellogo-miss", key);
      return `/api/image/label-${key}?v=${now}`;
    } finally { clearTimeout(timer); }
  }

  remove(key) {
    const r = this.q.get.get(key);
    if (r) { try { fs.unlinkSync(path.join(this.dir, r.file)); } catch (e) { /* gone */ } }
    this.q.del.run(key);
  }

  // --------------------------------------------------------- the pass

  /*
   * Find logos for the labels that have none: [labels] is [{ key, title }].
   * One at a time, Discogs then FanArt.tv, a pause between calls. A miss is
   * remembered for a week so the pass doesn't ask about the same label every
   * time the wall opens; [force] forgets the misses.
   */
  fetchMissing(labels, { force = false } = {}) {
    if (this.state.running) return false;
    const have = this.urls();
    const todo = labels.filter(l => !have.has(l.key) && (force || this.db.cacheGet("labellogo-miss", l.key, MISS_TTL) === undefined));
    if (!todo.length) return false;
    if (!this.discogsToken() && !this.fanartKey()) {
      this.note(`${todo.length} label(s) without a logo; no Discogs token or FanArt.tv key to look with (Settings → API Keys)`);
      return false;
    }
    this.state = { running: true, done: 0, total: todo.length, startedAt: Date.now() };
    this.note(`logos: looking for ${todo.length} label(s)` + (this.discogsToken() ? " on Discogs" : "") + (this.fanartKey() ? (this.discogsToken() ? " and" : " on") + " FanArt.tv" : ""));
    (async () => {
      let found = 0, consecutiveErrors = 0;
      for (const l of todo) {
        let url = null, source = null;
        try {
          if (this.discogsToken()) { url = await this.fromDiscogs(l.title); source = "discogs"; }
          if (!url && this.fanartKey()) { url = await this.fromFanart(l.title); source = "fanart"; }
          if (url) {
            await this.save(l.key, url, source);
            found++;
            this.note(`${l.title}: logo from ${source === "discogs" ? "Discogs" : "FanArt.tv"}`);
          } else {
            this.db.cachePut("labellogo-miss", l.key, 1);
            this.note(`${l.title}: no logo found`);
          }
          consecutiveErrors = 0;
        } catch (e) {
          this.note(`${l.title}: ${e.message}`);
          if (/HTTP 429/.test(e.message)) { await new Promise(r => setTimeout(r, 30000)); }
          if (++consecutiveErrors >= 5) { this.note("logos: five errors in a row — stopping; next time the wall opens it tries again"); break; }
        }
        this.state.done++;
        if (this.pauseMs) await new Promise(r => setTimeout(r, this.pauseMs));
      }
      this.note(`logos: done, ${found} of ${this.state.total} found`);
      this.state.running = false;
      if (this.onDone) this.onDone();
    })().catch(e => { this.note("logos: " + e.message); this.state.running = false; });
    return true;
  }
}

module.exports = { LabelLogos, typeOf };
