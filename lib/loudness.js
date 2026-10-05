"use strict";
/*
 * loudness.js — ReplayGain (v0.6.0-RC5): how loud each track is, and how
 * much to turn it up or down so one record follows another at an even level.
 *
 * Where the number comes from, in order:
 *   1. the files' own ReplayGain tags (REPLAYGAIN_TRACK_GAIN / _ALBUM_GAIN and
 *      their peaks, or Opus's R128 gains, as the scanner stored them);
 *   2. what this server measured itself (EBU R128 integrated loudness and
 *      true peak, by ffmpeg's ebur128 filter), for files with no tags —
 *      only when "Measure loudness" is on, one file at a time in the
 *      background. An album's gain is worked out from its tracks once every
 *      one of them is known.
 * The reference is ReplayGain 2.0's: -18 LUFS.
 *
 * Volume Levelling is set per audio device (v0.6.0-RC7, levelling below,
 * kept in the device register): Off, Track, Album or Auto decides which gain
 * a track gets. Auto takes the album's gain when a record is played in order
 * and the track's own when tracks from different records follow one another
 * (a shuffle, a playlist, radio). The target level (-14 to -25 LUFS) moves
 * every gain by its distance from ReplayGain's -18; a track whose loudness
 * isn't known gets the fixed adjustment instead. The peak caps the gain, so
 * turning a track up never clips it.
 *
 * A gain is applied where the audio is: on Sonos and renderers the stream is
 * converted to FLAC with the gain in it (lib/stream.js), so Off — the default
 * — leaves every file untouched; on the phone the app applies it itself.
 */
const { spawn } = require("child_process");
const os = require("os");
const FF = require("./ffmpeg");

const REF = -18;
const MODES = ["off", "track", "album", "auto"];
const DEFAULTS = { measure: false };
const LEVELLING = { mode: "off", target: -14, unknown: -5 };
const TARGETS = { min: -25, max: -14 };
const UNKNOWN = { min: -12, max: 0 };

/* A device's Volume Levelling as stored, checked: { mode, target, unknown }. */
function levelling(v) {
  const o = v && typeof v === "object" ? v : {};
  const int = (n, lo, hi, d) => { const x = Math.round(Number(n)); return Number.isFinite(x) && x >= lo && x <= hi ? x : d; };
  return {
    mode: MODES.includes(o.mode) ? o.mode : LEVELLING.mode,
    target: int(o.target, TARGETS.min, TARGETS.max, LEVELLING.target),
    unknown: int(o.unknown, UNKNOWN.min, UNKNOWN.max, LEVELLING.unknown)
  };
}

/* A change to it, refused when out of range. */
function levellingPatch(cur, patch) {
  const bad = m => { const e = new Error(m); e.status = 400; throw e; };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) bad("levelling must be an object");
  const next = Object.assign({}, levelling(cur));
  if (patch.mode !== undefined) { if (!MODES.includes(patch.mode)) bad("mode is off, track, album or auto"); next.mode = patch.mode; }
  if (patch.target !== undefined) {
    const n = Number(patch.target);
    if (!Number.isInteger(n) || n < TARGETS.min || n > TARGETS.max) bad(`target is a whole number of LUFS from ${TARGETS.max} to ${TARGETS.min}`);
    next.target = n;
  }
  if (patch.unknown !== undefined) {
    const n = Number(patch.unknown);
    if (!Number.isInteger(n) || n < UNKNOWN.min || n > UNKNOWN.max) bad(`unknown is a whole number of dB from ${UNKNOWN.max} to ${UNKNOWN.min}`);
    next.unknown = n;
  }
  return next;
}

/* How loud a measured stretch is, from ebur128's summary. */
function parseEbur128(text) {
  const s = String(text || "");
  const at = s.lastIndexOf("Summary:");
  const tail = at >= 0 ? s.slice(at) : s;
  const i = /I:\s*(-?[\d.]+|-inf)\s*LUFS/.exec(tail);
  const p = /Peak:\s*(-?[\d.]+|-inf)\s*dBFS/.exec(tail);
  const lufs = i && i[1] !== "-inf" ? Number(i[1]) : null;
  const peakDb = p && p[1] !== "-inf" ? Number(p[1]) : null;
  return {
    lufs: Number.isFinite(lufs) && lufs > -70 ? lufs : null,
    peak: Number.isFinite(peakDb) ? Math.pow(10, peakDb / 20) : null
  };
}

/* Several tracks' loudness as one: their energy, weighted by length. */
function combine(parts) {
  let e = 0, w = 0;
  for (const { lufs, seconds } of parts) {
    const d = seconds > 0 ? seconds : 1;
    e += d * Math.pow(10, lufs / 10);
    w += d;
  }
  return w > 0 && e > 0 ? 10 * Math.log10(e / w) : null;
}

class Loudness {
  constructor({ db, log = () => {}, tickMs = 2000 }) {
    this.db = db;
    this.raw = db.raw;
    this.log = log;
    this.tickMs = tickMs;
    this.timer = null;
    this.busy = false;
    this.current = null;
    this.q = {
      measured: this.raw.prepare("SELECT lufs, peak FROM track_loudness WHERE track_id = ? AND lufs IS NOT NULL"),
      album: this.raw.prepare(`SELECT t.id, t.duration, t.rg_track_gain, t.rg_track_peak, l.lufs, l.peak
        FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id WHERE t.album_id = ?`),
      next: this.raw.prepare(`SELECT t.id, t.path FROM tracks t LEFT JOIN track_loudness l ON l.track_id = t.id
        WHERE t.rg_track_gain IS NULL AND l.track_id IS NULL AND t.path NOT LIKE 'qobuz://%' ORDER BY t.id LIMIT 1`),
      put: this.raw.prepare(`INSERT INTO track_loudness(track_id, lufs, peak, measured_at, error) VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(track_id) DO UPDATE SET lufs = excluded.lufs, peak = excluded.peak, measured_at = excluded.measured_at, error = excluded.error`),
      counts: this.raw.prepare(`SELECT
          (SELECT COUNT(*) FROM tracks) AS tracks,
          (SELECT COUNT(*) FROM tracks WHERE rg_track_gain IS NOT NULL) AS tagged,
          (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NOT NULL) AS measured,
          (SELECT COUNT(*) FROM track_loudness l JOIN tracks t ON t.id = l.track_id WHERE t.rg_track_gain IS NULL AND l.lufs IS NULL) AS failed`)
    };
  }

  // ------------------------------------------------------------ the setting

  /* The server's own switch: measuring files without ReplayGain tags. */
  settings() {
    const s = this.db.setting("replaygain", {}) || {};
    return { measure: !!s.measure };
  }

  /* Measure ReplayGain switched on or off (Settings → Library Scanner). */
  set(patch) {
    const s = this.settings();
    if (patch.measure !== undefined) s.measure = !!patch.measure;
    this.db.setSetting("replaygain", Object.assign({}, this.db.setting("replaygain", {}) || {}, s));
    if (s.measure) this.start(); else this.stop();
    return s;
  }

  // ------------------------------------------------------------ the gains

  /* An album's loudness from its tracks — tagged or measured — once all are known. */
  albumOf(albumId) {
    const rows = this.q.album.all(albumId);
    if (!rows.length) return null;
    const parts = [];
    let peak = null;
    for (const r of rows) {
      const lufs = r.rg_track_gain != null ? REF - r.rg_track_gain : r.lufs;
      if (lufs == null) return null;
      parts.push({ lufs, seconds: r.duration });
      const p = r.rg_track_gain != null ? r.rg_track_peak : r.peak;
      if (p != null) peak = Math.max(peak || 0, p);
    }
    const lufs = combine(parts);
    return lufs == null ? null : { gain: REF - lufs, peak };
  }

  /* A track's four numbers, from its tags or else from what was measured. */
  infoOf(t, albums = new Map()) {
    let tg = t.rg_track_gain, tp = t.rg_track_peak;
    if (tg == null) {
      const m = this.q.measured.get(t.id);
      if (m) { tg = REF - m.lufs; tp = m.peak; }
    }
    let ag = t.rg_album_gain, ap = t.rg_album_peak;
    if (ag == null && t.album_id != null) {
      if (!albums.has(t.album_id)) albums.set(t.album_id, this.albumOf(t.album_id));
      const a = albums.get(t.album_id);
      if (a) { ag = a.gain; ap = a.peak; }
    }
    return { track_gain: num(tg), track_peak: num(tp), album_gain: num(ag), album_peak: num(ap) };
  }

  /* The gain for one track as `kind` ("track" | "album"), in dB; null for none.
   * offset: the target's distance from -18 LUFS; unknown: dB for a track with no loudness known. */
  gainOf(info, kind, offset = 0, unknown = 0) {
    const albumFirst = kind === "album";
    let g, p;
    if (albumFirst) { g = info.album_gain != null ? info.album_gain : info.track_gain; p = info.album_gain != null ? info.album_peak : info.track_peak; }
    else { g = info.track_gain != null ? info.track_gain : info.album_gain; p = info.track_gain != null ? info.track_peak : info.album_peak; }
    if (g == null) return unknown ? Math.max(-24, Math.min(0, unknown)) : null;
    g += offset;
    if (p != null && p > 0) g = Math.min(g, -20 * Math.log10(p));
    g = Math.max(-24, Math.min(12, Math.round(g * 10) / 10));
    return Math.abs(g) < 0.05 ? null : g;
  }

  /*
   * The gain for each of a list of tracks about to be played, in dB (null
   * for none). Auto: the album's gain for a track whose neighbour is from
   * the same record, unless the list is shuffled; the track's own otherwise.
   */
  gainsFor(tracks, { shuffled = false, levelling: lv } = {}) {
    const s = levelling(lv);
    if (s.mode === "off") return tracks.map(() => null);
    const albums = new Map();
    return tracks.map((t, i) => {
      let kind = s.mode;
      if (kind === "auto") {
        const same = x => x && x.album_id != null && x.album_id === t.album_id;
        kind = !shuffled && (same(tracks[i - 1]) || same(tracks[i + 1])) ? "album" : "track";
      }
      return this.gainOf(this.infoOf(t, albums), kind, s.target - REF, s.unknown);
    });
  }

  // ------------------------------------------------------------ measuring

  start() {
    if (this.timer || !this.settings().measure) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    if (this.timer.unref) this.timer.unref();
    setImmediate(() => this.tick());
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current && this.current.proc) { try { this.current.proc.kill("SIGKILL"); } catch (e) { /* gone */ } }
  }

  async tick() {
    if (this.busy || !this.timer) return;
    const row = this.q.next.get();
    if (!row) return;
    this.busy = true;
    try {
      const r = await this.measure(row.path);
      this.q.put.run(row.id, r.lufs, r.peak, Date.now(), r.lufs == null ? (r.error || "no loudness found") : null);
    } catch (e) {
      // Stopped on purpose: measured again next time.
      if (this.timer) this.q.put.run(row.id, null, null, Date.now(), String(e.message || e).slice(0, 200));
    } finally {
      this.busy = false;
      this.current = null;
    }
    if (this.timer) setImmediate(() => this.tick());
  }

  /* One file's integrated loudness and true peak, decoded in full. */
  measure(file) {
    return new Promise((resolve, reject) => {
      const proc = spawn(FF.info().bin, ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-map", "0:a:0", "-vn",
        "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
      // Below whatever is playing.
      try { os.setPriority(proc.pid, 10); } catch (e) { /* not allowed here */ }
      this.current = { proc, file };
      let err = "";
      proc.stderr.on("data", d => { err += d; if (err.length > 64 * 1024) err = err.slice(-16 * 1024); });
      proc.on("error", reject);
      proc.on("close", code => {
        if (code !== 0) return reject(new Error((err.trim().split("\n").pop() || `ffmpeg exited ${code}`).slice(0, 200)));
        resolve(parseEbur128(err));
      });
    });
  }

  /* For the settings page. */
  status() {
    const c = this.q.counts.get();
    const left = Math.max(0, c.tracks - c.tagged - c.measured - c.failed);
    return {
      settings: this.settings(),
      tracks: c.tracks, tagged: c.tagged, measured: c.measured, failed: c.failed, left,
      measuring: !!this.timer && left > 0
    };
  }
}

function num(v) { return v == null || !Number.isFinite(Number(v)) ? null : Number(v); }

module.exports = { Loudness, parseEbur128, combine, levelling, levellingPatch, REF, MODES, DEFAULTS, LEVELLING, TARGETS, UNKNOWN };
