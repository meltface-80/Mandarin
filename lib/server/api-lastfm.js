"use strict";
/*
 * api-lastfm.js — Last.fm, read-only (lib/lastfm.js; from Rouen, MusicD
 * Remote v1.9.3): the album view's similar artists and similar albums, and
 * the key they need (Settings → Setup → API Keys).
 *
 * With no key both routes answer { enabled: false } and the album view shows
 * nothing of Last.fm. A key refused by Last.fm (its errors 10 and 26) is said
 * so, the one failure the user can fix; anything else leaves the sections out.
 *
 * Whether an artist or an album is in the library is decided here, before the
 * tap, so the page can show which tiles open in Mandarin and which on
 * Last.fm. Pictures from Last.fm come through this server's image address
 * (Artwork.foreignKey), as a station's do, so the page never asks Last.fm
 * itself.
 */
const N = require("../library/normalize");
const { Artwork } = require("../library/artwork");
const { createLastfm } = require("../lastfm");

const UA = "Mandarin/" + require("../../package.json").version + " (+https://github.com/meltface-80/Mandarin)";
const API = "https://ws.audioscrobbler.com/2.0/";

module.exports = function (app, ctx) {
  const { db, library } = ctx;
  const config = ctx.config || {};
  const wrap = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (e) { if (!res.headersSent) res.status(e.status || 500).json({ error: e.message || String(e) }); }
  };

  // The key: one saved in Settings, else LASTFM_KEY from the environment. A
  // saved one wins from the moment it is saved, even an empty one.
  const savedKey = () => db.setting("lastfmKey", null);
  const key = () => {
    const s = savedKey();
    return String(s !== null && s !== undefined ? s : (config.lastfmKey || "")).trim();
  };
  const source = () => (!key() ? "" : savedKey() !== null && savedKey() !== undefined ? "settings" : "env");

  const LASTFM = createLastfm({ fetch: (url, init) => fetch(url, init), getKey: key, userAgent: UA, baseUrl: config.lastfmBaseUrl || undefined });

  // Does the key work? "ok", "invalid", "unknown" (no answer either way) or
  // null (none). Remembered per key: ok for 12 hours, a refusal for an hour,
  // no answer for 10 minutes; fresh asks again now (a key just saved).
  const checks = new Map();
  async function probe(k) {
    const url = (config.lastfmBaseUrl ? String(config.lastfmBaseUrl).replace(/\/?$/, "/") : API) +
      "?method=artist.getInfo&artist=Radiohead&format=json&api_key=" + encodeURIComponent(k);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
      if (r.ok) return "ok";
      // Last.fm refuses a bad key with 403 and its own words; a bare 403 (a
      // proxy, a CDN) says nothing about the key.
      const body = await r.text().catch(() => "");
      if (/invalid api key|"error"\s*:\s*(10|26)\b/i.test(body)) return "invalid";
      return "unknown";
    } catch (e) {
      return "unknown";   // offline or timed out: not evidence the key is wrong
    } finally {
      clearTimeout(timer);
    }
  }
  async function checkKey(fresh) {
    const k = key();
    if (!k) return null;
    const hit = checks.get(k);
    const age = hit ? Date.now() - hit.at : Infinity;
    const stale = !hit || (hit.state === "ok" ? age > 12 * 3600000 : hit.state === "invalid" ? age > 3600000 : age > 600000);
    if (!fresh && !stale) return hit.state;
    if (hit && hit.pending) return hit.pending;
    const pending = probe(k).then((state) => {
      checks.set(k, { state, at: Date.now() });
      if (state !== "ok") ctx.log(`[settings] last.fm key check: ${state}`);
      return state;
    });
    checks.set(k, Object.assign({}, hit || { state: null, at: 0 }, { pending }));
    return pending;
  }
  const masked = () => (key() ? "••••" + key().slice(-4) : "");

  app.get("/api/settings/lastfm-key", wrap(async (req, res) => {
    res.json({ set: !!key(), configured: !!key(), masked: masked(), source: source(), check: key() ? await checkKey(false) : null });
  }));
  app.post("/api/settings/lastfm-key", wrap(async (req, res) => {
    db.setSetting("lastfmKey", String((req.body || {}).key || "").trim());
    // A new key may see a different catalogue: nothing kept from the old one.
    LASTFM.clear();
    res.json({ ok: true, set: !!key(), masked: masked(), source: source(), check: key() ? await checkKey(true) : null });
  }));

  // What to tell the page when Last.fm could not answer.
  function failure(e) {
    const code = e && e.code;
    if (code === "nokey") return { enabled: false };
    const keyBad = code === 10 || code === 26;
    if (!keyBad) ctx.log("[lastfm] " + (e && e.message ? e.message : e));
    return { enabled: true, error: keyBad ? "Last.fm refused the API key" : "Last.fm did not answer" };
  }
  // The album's lead artist: the first of the credit's names, as the album
  // view's first artist link.
  const leadOf = credit => N.splitArtists(credit)[0] || credit;
  const picture = url => (url ? Artwork.foreignKey(url) : null);

  // An artist as the page shows it: what Last.fm says, plus whether the
  // library has them — by or with them — and if so a cover of theirs.
  function artistJson(a) {
    const { primary, featured } = library.artistAlbums(a.name);
    const own = primary[0] || featured[0] || null;
    return {
      name: a.name,
      url: a.url,
      image: a.image || "",
      in_library: !!own,
      image_key: own ? own.image_key : picture(a.image)
    };
  }

  // The library by title, made once per library version: nine albums are
  // looked up for every album opened.
  let titles = null;
  function byTitle() {
    if (titles && titles.version === library.version) return titles;
    const strict = new Map(), loose = new Map();
    const add = (m, k, al) => { if (!k) return; const l = m.get(k); if (l) l.push(al); else m.set(k, [al]); };
    for (const al of library.albums) { add(strict, N.fold(al.title), al); add(loose, N.loose(al.title), al); }
    titles = { version: library.version, strict, loose };
    return titles;
  }
  // A Last.fm album in the library: the same title (edition words aside) and
  // a credited name in common — never the title alone.
  function inLibrary(title, artist) {
    const want = new Set([N.artistKey(artist)].concat(N.splitArtists(artist).map(N.artistKey)).filter(Boolean));
    if (!want.size) return null;
    const theirs = al => [N.artistKey(al.artist)].concat(al.artistNames.map(x => N.artistKey(x.name)));
    const t = byTitle();
    for (const hits of [t.strict.get(N.fold(title)), t.loose.get(N.loose(title))]) {
      const al = (hits || []).find(a => theirs(a).some(n => want.has(n)));
      if (al) return al;
    }
    return null;
  }

  app.get("/api/lastfm/similar-artists", wrap(async (req, res) => {
    const credit = String(req.query.artist || "").trim();
    if (!credit) return res.status(400).json({ error: "artist required" });
    if (!key()) return res.json({ enabled: false });
    try {
      const sim = await LASTFM.similarArtists(leadOf(credit));
      res.json({ enabled: true, artist: sim.artist, url: sim.url, artists: sim.artists.slice(0, 12).map(artistJson) });
    } catch (e) {
      res.json(failure(e));
    }
  }));

  app.get("/api/lastfm/similar-albums", wrap(async (req, res) => {
    const credit = String(req.query.artist || "").trim();
    if (!credit) return res.status(400).json({ error: "artist required" });
    if (!key()) return res.json({ enabled: false });
    // A page that has moved on to another album aborts this request. Each of
    // the nine is a call queued behind the last, so a request nobody is
    // waiting for stops asking — or a run of quick swipes would queue ahead of
    // the album on screen.
    let gone = false;
    res.on("close", () => { if (!res.writableEnded) gone = true; });
    try {
      const r = await LASTFM.similarAlbums(leadOf(credit), 9, () => !gone);
      if (gone) return;
      res.json({ enabled: true, albums: r.albums.map(al => {
        const own = inLibrary(al.title, al.artist);
        return { title: al.title, artist: al.artist, url: al.url, image: al.image || "", image_key: picture(al.image),
          album: own ? library.json(own) : null };
      }) });
    } catch (e) {
      if (!gone) res.json(failure(e));
    }
  }));

  ctx.lastfm = LASTFM;
};
