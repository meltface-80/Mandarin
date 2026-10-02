"use strict";
/*
 * identifier.js — the scan that finds each album's right names.
 *
 * One album at a time, in the background: a MusicBrainz search for releases
 * with the album's title and track count (and its artist, where the tag can
 * be trusted), the likeliest few fetched in full, each scored against the
 * album's tracks and lengths (lib/identify/score.js). A match near enough is
 * applied — artist, title, year and the track titles written to the same
 * overlays the album editor uses, never to the files; a near miss is proposed
 * for one tap; anything else is left unidentified for you to match by hand.
 * Every verdict is kept in album_matches so an album is looked at once, and
 * an applied one can be undone.
 *
 * When it runs: whenever Scheduling is off; between the start and end times
 * when it is on (the server's clock). Never while the library scanner is
 * running, never on an album you edited by hand.
 *
 * An album MusicBrainz can't place is asked of iTunes too (v0.5.49; switch
 * on the page), whose catalogue has track lengths to the millisecond. What
 * iTunes finds is applied only when it fits exactly — every track there,
 * every length within the grace, every name the same — and proposed when
 * it's near; Apple's date is left out (it's often a remaster's), so the album
 * keeps its year. Albums unidentified before this asked iTunes once, by
 * themselves; one iTunes was too busy to answer is asked again later.
 */
const { MusicBrainz } = require("./musicbrainz");
const { ITunes } = require("./itunes");
const SCORE = require("./score");
const N = require("../library/normalize");

const DEFAULTS = { enabled: true, schedule: true, start: "01:00", end: "06:00", itunes: true };
const RETRY_UNIDENTIFIED_MS = 30 * 86400000;   // an unidentified album is looked at again after a month
const FETCH_MAX = 5;                            // releases fetched in full per album
const SEARCH_LIMIT = 40;                        // search results asked for (one request whatever the number)
const WIDEN_MAX = 3;                            // other pressings of the best fit's record fetched when the count is off
const MIN_TRACKS = 2;                           // a one-track "album" can't be told apart by its lengths

function minutes(hhmm, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ""));
  if (!m) return fallback;
  const h = Number(m[1]), mi = Number(m[2]);
  return h >= 0 && h < 24 && mi >= 0 && mi < 60 ? h * 60 + mi : fallback;
}

class Identifier {
  constructor({ db, library, scanner, mb, itunes, log = () => {}, tickMs = 5000, now = () => new Date() } = {}) {
    this.db = db;
    this.library = library;
    this.scanner = scanner;
    this.mb = mb || new MusicBrainz({ log });
    this.itunes = itunes === undefined ? new ITunes({ log }) : itunes;
    this.log = log;
    this.tickMs = tickMs;
    this.now = now;
    this.busy = null;
    this.current = null;
    this.failures = 0;
    this.pausedUntil = 0;
    this.timer = null;
    this.stopped = false;
    this.q = {
      all: db.raw.prepare("SELECT * FROM album_matches"),
      one: db.raw.prepare("SELECT * FROM album_matches WHERE key = ?"),
      put: db.raw.prepare(`INSERT INTO album_matches(key, mbid, distance, status, candidate, before, checked_at, applied_at, itunes)
                           VALUES(@key, @mbid, @distance, @status, @candidate, @before, @checked_at, @applied_at, @itunes)
                           ON CONFLICT(key) DO UPDATE SET mbid=excluded.mbid, distance=excluded.distance, status=excluded.status,
                             candidate=excluded.candidate, before=excluded.before, checked_at=excluded.checked_at, applied_at=excluded.applied_at,
                             itunes=excluded.itunes`),
      asked: db.raw.prepare("UPDATE album_matches SET itunes = ? WHERE key = ?"),
      del: db.raw.prepare("DELETE FROM album_matches WHERE key = ?")
    };
  }

  // ------------------------------------------------------------ settings

  settings() {
    const s = Object.assign({}, DEFAULTS, this.db.setting("identify", null) || {});
    return { enabled: !!s.enabled, schedule: !!s.schedule, start: s.start, end: s.end, itunes: s.itunes !== false };
  }
  setSettings(patch) {
    const s = this.settings();
    if (patch.enabled !== undefined) s.enabled = !!patch.enabled;
    if (patch.schedule !== undefined) s.schedule = !!patch.schedule;
    if (patch.itunes !== undefined) s.itunes = !!patch.itunes;
    if (patch.start !== undefined && minutes(patch.start, null) !== null) s.start = patch.start;
    if (patch.end !== undefined && minutes(patch.end, null) !== null) s.end = patch.end;
    this.db.setSetting("identify", s);
    return s;
  }

  /* Is now inside the night window? A window over midnight (22:00–04:00) counts. */
  inWindow(s = this.settings()) {
    const d = this.now();
    const t = d.getHours() * 60 + d.getMinutes();
    const a = minutes(s.start, 60), b = minutes(s.end, 360);
    if (a === b) return false;
    return a < b ? (t >= a && t < b) : (t >= a || t < b);
  }

  /* Why the scan is or isn't running right now. */
  state() {
    const s = this.settings();
    let reason;
    if (!s.enabled) reason = "off";
    else if (s.schedule && !this.inWindow(s)) reason = "waiting";
    else if (this.scanner && this.scanner.state && this.scanner.state.running) reason = "scanning";
    else if (Date.now() < this.pausedUntil) reason = "unreachable";
    else if (this.current) reason = "checking";
    else reason = this.next() ? "starting" : "done";
    return { settings: s, reason, current: this.current, active: !["off", "waiting", "scanning", "unreachable"].includes(reason) };
  }

  // ------------------------------------------------------------ the queue

  rows() {
    const m = new Map();
    for (const r of this.q.all.all()) m.set(r.key, r);
    return m;
  }
  row(key) { return this.q.one.get(key) || null; }

  /* Albums the scan can say something about: with enough tracks to tell by. */
  eligible() { return this.library.albums.filter(al => al.tracks >= MIN_TRACKS); }

  /* The next album to look at: one never looked at, or unidentified long
   * enough ago; never one you edited by hand. Suspect artists first, then the
   * newest additions. */
  next() {
    const rows = this.rows();
    const now = Date.now();
    let best = null, bestRank = null;
    const ask = this.itunesUsable();
    for (const al of this.eligible()) {
      const r = rows.get(al.key);
      // Unidentified, and iTunes not asked yet: asked now, after the albums never looked at.
      const itunesOnly = ask && this.itunesOnly(r);
      if (r && !itunesOnly && !(r.status === "unidentified" && now - r.checked_at > RETRY_UNIDENTIFIED_MS)) continue;
      if (al.edited && !(r && r.status === "unidentified")) continue;     // yours, not ours
      const rank = [itunesOnly ? 2 : SCORE.artistSuspect(al.artist, al.title) ? 0 : 1, -(al.added || 0)];
      if (!best || rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) { best = al; bestRank = rank; }
    }
    return best;
  }

  // ------------------------------------------------------------ one album

  /* What the scorer sees of an album: the names its files carry (an edit of
   * ours is not re-scored against itself) and each track's title and length. */
  input(al) {
    // Tag junk ("null: Line Up (null)") is set aside before anything is compared or searched for.
    const tracks = this.library.tracks(al.id).map(t => ({ title: SCORE.tidy(t.scanned_title || t.title || ""), length: t.duration || null }));
    return { title: SCORE.tidy(al.scanned.title || al.title), artist: SCORE.tidy(al.scanned.artist || al.artist), year: al.scanned.year || al.year || null, tracks };
  }

  /* The likeliest few of a search's results fetched in full: the nearest
   * track count first, then MusicBrainz's own score; none fetched twice. */
  async fetchBest(found, input, have, max = FETCH_MAX) {
    const off = f => Math.abs((f.track_count || 0) - input.tracks.length);
    found.sort((a, b) => off(a) - off(b) || b.score - a.score);
    const out = [];
    for (const f of found) {
      if (out.length >= max) break;
      if (have.has(f.mbid)) continue;
      have.add(f.mbid);
      const rel = await this.mb.release(f.mbid).catch(() => null);
      if (rel) out.push(rel);
    }
    return out;
  }

  /*
   * The releases that could be this album, and the verdict on them. Three
   * questions at most, each only when the one before fell short:
   *
   * 1. A search for the album's name — without its edition ("Kid A", not
   *    "Kid A (2015 Remaster)": MusicBrainz files a pressing under the
   *    album's name and keeps what sets it apart aside) and with its artist
   *    where the tag can be trusted. Not by track count: a copy with a track
   *    missing, or a pressing with a bonus track, is still the record. The
   *    count only orders the results.
   * 2. When nothing near was found: the words of the title in any order,
   *    with no artist (a compilation's artist tag may be a label's name; a
   *    title may be the pressing's own, or have its parts the other way).
   * 3. When the best fit hasn't the copy's track count: the other pressings
   *    of its record (the release group), and those with the copy's count
   *    fetched too — the deluxe edition the search didn't list.
   */
  async resolve(input) {
    const suspect = SCORE.artistSuspect(input.artist, input.title);
    const plain = SCORE.bare(input.title) || input.title;
    const have = new Set();
    let cands = await this.fetchBest(await this.mb.search({ title: plain, artist: suspect ? "" : input.artist, limit: SEARCH_LIMIT }), input, have);
    let verdict = SCORE.decide(input, cands);
    if (!verdict.best || verdict.best.distance > SCORE.PROPOSE) {
      const found = await this.mb.search({ title: plain, artist: "", limit: SEARCH_LIMIT, loose: true });
      cands = cands.concat(await this.fetchBest(found, input, have));
      verdict = SCORE.decide(input, cands);
    }
    const best = verdict.best;
    if (best && best.candidate.group_mbid && (best.parts.missing_tracks || best.parts.extra_tracks)) {
      const others = (await this.mb.groupReleases(best.candidate.group_mbid).catch(() => []))
        .filter(r => r.track_count === input.tracks.length && !have.has(r.mbid));
      if (others.length) {
        cands = cands.concat(await this.fetchBest(others, input, have, WIDEN_MAX));
        verdict = SCORE.decide(input, cands);
      }
    }
    return { cands, verdict };
  }

  /* iTunes is on, there, and not asking us to wait. */
  itunesUsable() { return !!(this.itunes && this.settings().itunes && !this.itunes.paused); }
  /* A verdict that only lacks iTunes's opinion: unidentified within its month, iTunes not asked. */
  itunesOnly(r) {
    return !!(r && r.status === "unidentified" && r.itunes !== "asked" && Date.now() - r.checked_at <= RETRY_UNIDENTIFIED_MS);
  }

  /*
   * iTunes's albums for this one, and the verdict on them. By artist and
   * title (the title alone when the artist tag can't be trusted, or when
   * that finds nothing); the two nearest in track count fetched in full.
   * Applied only on an exact fit (SCORE.exact); near is proposed.
   */
  async itunesResolve(input) {
    const suspect = SCORE.artistSuspect(input.artist, input.title);
    const plain = SCORE.bare(input.title) || input.title;
    let found = await this.itunes.search({ title: plain, artist: suspect ? "" : input.artist });
    if (!found.length && !suspect) found = await this.itunes.search({ title: plain, artist: "" });
    const off = f => Math.abs((f.track_count || 0) - input.tracks.length);
    found.sort((a, b) => off(a) - off(b));
    const cands = [];
    for (const f of found.slice(0, 2)) {
      const c = await this.itunes.album(f.id).catch(e => { if (e.paused) throw e; return null; });
      if (c) cands.push(c);
    }
    const verdict = SCORE.decide(input, cands);
    if (verdict.status === "applied" && !SCORE.exact(verdict.best)) verdict.status = "proposed";
    return verdict;
  }

  /* Look one album up, decide, record — and apply when it's near enough. */
  async identify(al) {
    const input = this.input(al);
    const prev = this.row(al.key);
    // Unidentified already, iTunes not asked yet: only iTunes is asked.
    const only = this.itunesOnly(prev);
    let verdict = only ? null : (await this.resolve(input)).verdict;
    let itunes = null;
    if ((!verdict || verdict.status === "unidentified") && this.itunesUsable()) {
      try {
        const v = await this.itunesResolve(input);
        itunes = "asked";
        // iTunes's answer when it has one; else whichever came nearer, for the page to name.
        const nearer = v.best && (!verdict || !verdict.best || v.best.distance < verdict.best.distance);
        if (v.status !== "unidentified" || (!only && nearer)) verdict = v;
      } catch (e) {
        // Too busy, or not answering: asked again later. Either way iTunes
        // rests a while, so the same album isn't asked again every few seconds.
        itunes = "skipped";
        if (!e.paused && this.itunes) this.itunes.pausedUntil = Date.now() + 10 * 60 * 1000;
      }
    }
    if (!verdict || (only && verdict.status === "unidentified")) {
      // Nothing new: the MusicBrainz verdict stands, and its month runs on.
      if (prev && itunes) this.q.asked.run(itunes, al.key);
      return prev;
    }
    const best = verdict.best;
    const row = {
      key: al.key, mbid: best ? best.candidate.mbid : null, distance: best ? best.distance : null,
      status: verdict.status, candidate: best ? JSON.stringify(Object.assign({}, best.candidate, { parts: best.parts, pairs: best.pairs, ambiguous: verdict.ambiguous })) : null,
      before: null, checked_at: Date.now(), applied_at: null, itunes
    };
    if (verdict.status === "applied") {
      row.before = JSON.stringify(this.snapshot(al));
      row.applied_at = row.checked_at;
      this.q.put.run(row);
      this.apply(al.id, best.candidate);
      this.log(`[identify] ${al.artist} — ${al.title} → ${best.candidate.artist} — ${best.candidate.title} (${Math.round((1 - best.distance) * 100)} %${best.candidate.source === "itunes" ? ", iTunes" : ""})`);
    } else {
      this.q.put.run(row);
    }
    return row;
  }

  /*
   * The releases that could be this album, scored, best first — for the
   * album editor's Find match, where you choose. Nothing is written.
   */
  async suggest(key) {
    const al = this.albumFor(key);
    if (!al) return null;
    const input = this.input(al);
    let { verdict } = await this.resolve(input);
    if (verdict.status === "unidentified" && this.itunesUsable()) {
      const v = await this.itunesResolve(input).catch(() => null);
      if (v && v.scored.length) {
        const scored = verdict.scored.concat(v.scored).sort((a, b) => a.distance - b.distance);
        verdict = v.status !== "unidentified" ? Object.assign({}, v, { scored }) : Object.assign({}, verdict, { scored });
      }
    }
    return {
      verdict: verdict.status, ambiguous: !!verdict.ambiguous,
      candidates: verdict.scored.map(s => {
        const c = s.candidate;
        return {
          mbid: c.mbid, title: SCORE.clean(c.title), artist: c.artist, year: c.year,
          release_title: c.release_title || null, release_year: c.release_year || null, edition: c.edition || null,
          country: c.country || null, type: c.type || null, track_count: c.track_count, source: c.source || "musicbrainz",
          similarity: Math.round((1 - s.distance) * 100), distance: s.distance,
          missing_tracks: s.parts.missing_tracks || 0, extra_tracks: s.parts.extra_tracks || 0
        };
      })
    };
  }

  /*
   * A match you name: a barcode off the sleeve, or a MusicBrainz release or
   * release-group link. The release is scored so the page can say how alike
   * it is, then applied whatever the score — you said so. Nothing found is an
   * error the page shows.
   */
  async match(key, { barcode, mbid, group, how } = {}) {
    const al = this.albumFor(key);
    if (!al) return null;
    const input = this.input(al);
    let found;
    if (mbid && /^itunes:\d+$/.test(mbid)) {
      if (!this.itunes) throw Object.assign(new Error("iTunes isn't available"), { status: 409 });
      const c = await this.itunes.album(mbid.slice(7)).catch(() => null);
      if (!c) throw Object.assign(new Error("iTunes didn't give that album"), { status: 502 });
      return this.applyChosen(al, key, input, [c], how || "pick");
    }
    if (mbid) found = [{ mbid, track_count: 0, score: 0 }];
    else if (group) found = await this.mb.groupReleases(group);
    else found = await this.mb.byBarcode(barcode);
    if (!found.length) throw Object.assign(new Error(barcode ? "No release on MusicBrainz carries that barcode" : "Nothing at that MusicBrainz link"), { status: 404 });
    const off = f => Math.abs((f.track_count || 0) - input.tracks.length);
    found.sort((a, b) => off(a) - off(b) || b.score - a.score);
    const cands = [];
    for (const f of found.slice(0, 3)) {
      const rel = await this.mb.release(f.mbid).catch(() => null);
      if (rel) cands.push(rel);
    }
    if (!cands.length) throw Object.assign(new Error("MusicBrainz didn't give that release"), { status: 502 });
    return this.applyChosen(al, key, input, cands, how || (barcode ? "barcode" : "link"));
  }

  /* The release you chose written to the album, whatever its score. */
  applyChosen(al, key, input, cands, how) {
    const verdict = SCORE.decide(input, cands);
    const best = verdict.best;
    const prev = this.row(key);
    if (prev && prev.status === "applied") this.undo(key);
    const now = Date.now();
    this.q.put.run({
      key, mbid: best.candidate.mbid, distance: best.distance, status: "applied",
      candidate: JSON.stringify(Object.assign({}, best.candidate, { parts: best.parts, pairs: best.pairs, manual: how })),
      before: JSON.stringify(this.snapshot(this.albumFor(key))), checked_at: now, applied_at: now,
      itunes: prev ? prev.itunes || null : null
    });
    this.apply(al.id, best.candidate);
    this.log(`[identify] ${al.artist} — ${al.title} → ${best.candidate.artist} — ${best.candidate.title} (by ${how}, ${Math.round((1 - best.distance) * 100)} %)`);
    return this.row(key);
  }

  /* The album's edit and track titles as they are, for undo. */
  snapshot(al) {
    const cur = this.db.raw.prepare("SELECT title, artist, year FROM album_edits WHERE key = ?").get(al.key) || {};
    return { edit: { title: cur.title || null, artist: cur.artist || null, year: cur.year || null }, tracks: this.library.trackEditsOf(al) };
  }

  /* Write a candidate's names over the album: the overlays the album editor
   * uses, so the album shows them everywhere at once. */
  apply(id, cand) {
    const lib = this.library;
    // The album's name and the year it first came out (the group's), never
    // the pressing's: "Kid A", 2000 — not "Kid A (2015 Remaster)", 2015.
    // Track names likewise lose a remaster tail; a "(Live)" or a featured
    // artist is part of the name and stays.
    lib.saveEdit(id, { title: SCORE.clean(cand.title), artist: cand.artist, year: cand.year || "" });
    // Each track takes the name of the release track it was paired with
    // (a copy missing track 3 has the release's 4 as its 3); one paired with
    // nothing keeps its tag.
    const rows = lib.tracks(id);
    const pairs = Array.isArray(cand.pairs) ? cand.pairs : rows.map((t, i) => i);
    const titles = {};
    rows.forEach((t, i) => {
      const r = pairs[i] != null ? cand.tracks[pairs[i]] : null;
      if (r && r.title) titles[lib.trackPos(t, i)] = SCORE.clean(r.title);
    });
    lib.saveTrackEdits(id, titles);
  }

  /* Forget every verdict that wasn't applied, so the scan looks at those
   * albums again — after the scoring changes, say. Declined ones stay declined. */
  recheckAll() {
    return this.db.raw.prepare("DELETE FROM album_matches WHERE status IN ('unidentified', 'proposed')").run().changes;
  }

  // ------------------------------------------------------------ your say

  albumFor(key) { return this.library.albums.find(al => al.key === key) || null; }

  accept(key) {
    const r = this.row(key), al = this.albumFor(key);
    if (!r || !al || !r.candidate) return null;
    const cand = JSON.parse(r.candidate);
    this.q.put.run(Object.assign({}, r, { status: "applied", before: JSON.stringify(this.snapshot(al)), applied_at: Date.now() }));
    this.apply(al.id, cand);
    return this.row(key);
  }
  reject(key) {
    const r = this.row(key);
    if (!r) return null;
    if (r.status === "applied") return this.undo(key);
    this.q.put.run(Object.assign({}, r, { status: "rejected", applied_at: null }));
    return this.row(key);
  }
  /* Put back what the album had before the match was applied. */
  undo(key) {
    const r = this.row(key), al = this.albumFor(key);
    if (!r || !al || r.status !== "applied") return null;
    let before = null;
    try { before = JSON.parse(r.before || "null"); } catch (e) { /* none */ }
    const e = (before && before.edit) || {};
    this.library.saveEdit(al.id, { title: e.title || "", artist: e.artist || "", year: e.year || "" });
    this.library.clearTrackEdits(al.id);
    if (before && before.tracks && Object.keys(before.tracks).length) this.library.saveTrackEdits(al.id, before.tracks);
    this.q.put.run(Object.assign({}, r, { status: "rejected", before: null, applied_at: null }));
    return this.row(key);
  }
  /* Forget the verdict: the scan looks at the album again. */
  recheck(key) {
    const r = this.row(key);
    if (r && r.status === "applied") this.undo(key);
    this.q.del.run(key);
  }

  // ------------------------------------------------------------ the loop

  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    if (this.timer.unref) this.timer.unref();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    if (this.busy || this.stopped || !this.library.count) return null;
    if (!this.state().active) return null;
    const al = this.next();
    if (!al) return null;
    this.current = { id: al.id, title: al.title, artist: al.artist };
    this.busy = this.identify(al).then(() => { this.failures = 0; }).catch(e => {
      // MusicBrainz down or unreachable: leave it ten minutes rather than
      // knock on the door every few seconds.
      if (++this.failures >= 3) {
        this.pausedUntil = Date.now() + 10 * 60 * 1000;
        this.failures = 0;
        this.log(`[identify] MusicBrainz isn't answering (${e.message}); trying again in ten minutes`);
      }
    }).finally(() => { this.busy = null; this.current = null; });
    return this.busy;
  }

  // ------------------------------------------------------------ the page

  progress() {
    const counts = { applied: 0, proposed: 0, unidentified: 0, rejected: 0 };
    const rows = this.rows();
    const keys = new Set(this.eligible().map(al => al.key));
    let checked = 0;
    for (const [key, r] of rows) {
      if (!keys.has(key)) continue;
      checked++;
      if (counts[r.status] !== undefined) counts[r.status]++;
    }
    return Object.assign({ eligible: keys.size, checked }, counts);
  }

  /* The albums in one state, newest verdict first, each with its candidate. */
  list(status, limit = 500) {
    const byKey = new Map(this.library.albums.map(al => [al.key, al]));
    const out = [];
    for (const r of this.q.all.all()) {
      if (r.status !== status) continue;
      const al = byKey.get(r.key);
      if (!al) continue;
      let cand = null;
      try { cand = r.candidate ? JSON.parse(r.candidate) : null; } catch (e) { /* none */ }
      out.push({
        album: this.library.json(al, { artist: al.artist }),
        scanned: al.scanned,
        distance: r.distance,
        similarity: r.distance == null ? null : Math.round((1 - r.distance) * 100),
        checked_at: r.checked_at, applied_at: r.applied_at,
        ambiguous: !!(cand && cand.ambiguous),
        candidate: cand ? {
          mbid: cand.mbid, title: SCORE.clean(cand.title), artist: cand.artist, year: cand.year, track_count: cand.track_count,
          release_title: cand.release_title || null, release_year: cand.release_year || null, edition: cand.edition || null, manual: cand.manual || null,
          type: cand.type || null, country: cand.country || null, source: cand.source || "musicbrainz",
          tracks: (cand.tracks || []).map(t => t.title), parts: cand.parts || null
        } : null
      });
    }
    out.sort((a, b) => (b.applied_at || b.checked_at) - (a.applied_at || a.checked_at));
    return out.slice(0, limit);
  }
}

module.exports = { Identifier, DEFAULTS, minutes, MIN_TRACKS, RETRY_UNIDENTIFIED_MS };
