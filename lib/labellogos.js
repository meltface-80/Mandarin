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

  /*
   * Does the key work (v0.6.1)? "ok" the service took it, "invalid" it
   * refused it, "unknown" no answer either way (offline, timed out, the
   * service erring, a bare 403 from a proxy or CDN), null no key. Remembered
   * per key: ok for 12 hours, a refusal for an hour, no answer for 10
   * minutes. fresh asks again now (a key just saved).
   */
  async checkKey(kind, fresh) {
    const key = kind === "discogs" ? this.discogsToken() : this.fanartKey();
    if (!key) return null;
    if (!this.keyChecks) this.keyChecks = new Map();
    const id = kind + ":" + key;
    const hit = this.keyChecks.get(id);
    const age = hit ? Date.now() - hit.at : Infinity;
    // A refusal is asked again too, an hour on: a 403 can come from a CDN
    // challenge or a rate limit as well as from a bad key, and a good key must
    // not wear a red ✕ until the server restarts.
    const stale = !hit || (hit.state === "ok" ? age > 12 * 3600000 : hit.state === "invalid" ? age > 3600000 : age > 600000);
    if (!fresh && !stale) return hit.state;
    if (hit && hit.pending) return hit.pending;
    const pending = this.probeKey(kind, key).then((state) => {
      this.keyChecks.set(id, { state, at: Date.now() });
      if (state !== "ok") this.log(`[settings] ${kind} key check: ${state}`);
      return state;
    });
    this.keyChecks.set(id, Object.assign({}, hit || { state: null, at: 0 }, { pending }));
    return pending;
  }
  async probeKey(kind, key) {
    // Discogs: the token's own identity — 200 with the account, 401 without.
    // FanArt.tv: one well-known artist (Radiohead's MusicBrainz id). A good
    // key gets 200, or 404 if the artist had no art; a bad one gets 401.
    const url = kind === "discogs"
      ? this.discogsBase + "/oauth/identity"
      : this.fanartBase + "/v3/music/a74b1b7f-71a5-4011-9441-d0b5e4122711?api_key=" + encodeURIComponent(key);
    const headers = { "User-Agent": UA, Accept: "application/json" };
    if (kind === "discogs") headers.Authorization = "Discogs token=" + key;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { headers, signal: ctl.signal });
      // 401 is the key. A 403 is only taken as one when the service says so in
      // its own words; a bare 403 (a CDN page, a proxy) says nothing about it.
      if (r.status === 401) return "invalid";
      if (r.status === 403) {
        const body = await r.text().catch(() => "");
        return /invalid|unauthori[sz]ed|not authori[sz]ed|api key/i.test(body) ? "invalid" : "unknown";
      }
      if (r.ok || (kind === "fanart" && r.status === 404)) return "ok";
      return "unknown";
    } catch (e) {
      return "unknown";   // offline or timed out — not evidence the key is wrong
    } finally {
      clearTimeout(timer);
    }
  }

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
    if (!token) throw new Error("Discogs token needed (Settings → Setup → API Keys)");
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

  /* Which keys a lookup has to ask with, as a digest: never the keys themselves. */
  keysSig() {
    return require("crypto").createHash("sha1").update(this.discogsToken() + "\n" + this.fanartKey()).digest("hex").slice(0, 12);
  }
  runAgain() {
    const a = this.again;
    this.again = null;
    if (a) this.fetchMissing(a.labels, { force: a.force });
  }

  /*
   * Find logos for the labels that have none: [labels] is [{ key, title }].
   * One at a time, Discogs then FanArt.tv, a pause between calls. A miss is
   * remembered for a week so the pass doesn't ask about the same label every
   * time the wall opens; [force] forgets the misses.
   */
  fetchMissing(labels, { force = false } = {}) {
    // Asked for while a pass runs (a key saved mid-pass, Look again): it runs
    // straight after, rather than being dropped (v0.6.1).
    if (this.state.running) {
      this.again = { labels, force: force || !!(this.again && this.again.force) };
      return true;
    }
    const have = this.urls();
    // A miss stands only for the keys it was asked with: a label not found on
    // Discogs alone is asked again once a FanArt.tv key is given (v0.6.1).
    const sig = this.keysSig();
    const todo = labels.filter(l => !have.has(l.key) && (force || this.db.cacheGet("labellogo-miss", l.key, MISS_TTL) !== sig));
    if (!todo.length) return false;
    if (!this.discogsToken() && !this.fanartKey()) {
      this.note(`${todo.length} label(s) without a logo; no Discogs token or FanArt.tv key to look with (Settings → Setup → API Keys)`);
      return false;
    }
    this.state = { running: true, done: 0, total: todo.length, startedAt: Date.now() };
    this.note(`logos: looking for ${todo.length} label(s)` + (this.discogsToken() ? " on Discogs" : "") + (this.fanartKey() ? (this.discogsToken() ? " and" : " on") + " FanArt.tv" : ""));
    (async () => {
      let found = 0, consecutiveErrors = 0;
      for (const l of todo) {
        let url = null, source = null;
        const asked = this.keysSig();
        try {
          if (this.discogsToken()) { url = await this.fromDiscogs(l.title); source = "discogs"; }
          if (!url && this.fanartKey()) { url = await this.fromFanart(l.title); source = "fanart"; }
          if (url) {
            await this.save(l.key, url, source);
            found++;
            this.note(`${l.title}: logo from ${source === "discogs" ? "Discogs" : "FanArt.tv"}`);
          } else {
            this.db.cachePut("labellogo-miss", l.key, asked);
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
      this.runAgain();
      if (this.onDone) this.onDone();
    })().catch(e => { this.note("logos: " + e.message); this.state.running = false; this.runAgain(); });
    return true;
  }
}

module.exports = { LabelLogos, typeOf };
