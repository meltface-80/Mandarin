"use strict";
/*
 * identify-report.js — the identification scan's work on your library, as
 * one JSON file (v0.6.3), so changes to how matches are scored can be
 * tried against real albums and your own decisions before they reach the
 * server.
 *
 * For every album the scan looks at: its tracks (name, length, disc,
 * number), its folder and box set, the tags that say what pressing it is
 * (comments, version, remixer…), what the scan decided and what you did
 * about it — accepted, rejected, matched by hand, or edited yourself. With
 * --fetch, also every release MusicBrainz offers for it, with its tracks
 * and its notes ("Steven Wilson remix"), as the scan sees them.
 *
 * Read-only: it works on a copy of the database and changes nothing.
 * Run inside the Mandarin container:
 *
 *   docker exec -i musicd-server node - < identify-report.js > identify-report.json
 *   docker exec -i musicd-server node - --fetch < identify-report.js > identify-report.json
 *
 * --fetch asks MusicBrainz about each album (one request a second, as the
 * scan does), which takes a while — about five seconds an album. To keep it
 * short:
 *   --only=proposed,unidentified,rejected,manual,edited,unchecked   (the default)
 *   --sample-applied=100     also this many albums the scan applied by itself
 *   --limit=300              at most this many albums asked about
 * Progress goes to the terminal; the JSON to the file.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP = fs.existsSync("/app/lib") ? "/app" : process.cwd();
const req = m => require(path.join(APP, m));
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  return m ? [m[1], m[2] === undefined ? true : m[2]] : [a, true];
}));
const dataDir = args.data || process.env.DATA_DIR || "/app/data";
const musicDir = args.music || process.env.MUSIC_DIR || "/music";
const say = (...a) => process.stderr.write(a.join(" ") + "\n");

const HINT = /comment|version|subtitle|grouping|description|remix|mixer|edition|setsubtitle|discsubtitle/i;

(async () => {
  // A copy, so nothing about the running server's database changes.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "identify-report-"));
  for (const f of ["musicd.db", "musicd.db-wal", "musicd.db-shm"]) {
    const src = path.join(dataDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, f));
  }
  const DB = req("lib/library/db");
  const { Library } = req("lib/library");
  const { Scanner } = req("lib/library/scanner");
  const { Identifier, MIN_TRACKS } = req("lib/identify/identifier");
  const SCORE = req("lib/identify/score");
  const db = DB.open(tmp, { log: () => {} });
  const library = new Library(db, { musicRoot: musicDir, log: () => {} });
  library.reload();
  const folders = () => { const v = db.setting("music_folders", null); return Array.isArray(v) && v.length ? v : [musicDir]; };
  const scanner = new Scanner({ db, root: musicDir, roots: folders, log: () => {} });
  const { MusicBrainz } = req("lib/identify/musicbrainz");
  const mb = new MusicBrainz({ baseUrl: args.mb || undefined, log: () => {} });   // --mb: another MusicBrainz (the tests' fake)
  const identifier = new Identifier({ db, library, scanner, mb, itunes: null, log: () => {} });

  const edits = new Map(db.raw.prepare("SELECT * FROM album_edits").all().map(r => [r.key, r]));
  const rows = identifier.rows();
  const tagsOf = db.raw.prepare("SELECT tags FROM track_tags WHERE track_id = ?");
  const roots = scanner.roots();
  const rel = d => { const r = roots.find(x => d === x || d.startsWith(x + path.sep)); return r ? path.join(path.basename(r), path.relative(r, d)) : d; };

  const albums = [];
  for (const al of library.albums) {
    const tracks = library.tracks(al.id);
    if (tracks.length < MIN_TRACKS) continue;
    const r = rows.get(al.key) || null;
    let cand = null;
    try { cand = r && r.candidate ? JSON.parse(r.candidate) : null; } catch (e) { /* none */ }
    const e = edits.get(al.key);
    // What you did: the ground truth a change in scoring is judged by.
    let decision = null;
    if (e && (e.title || e.artist || e.year)) decision = "edited";
    else if (r && r.status === "rejected") decision = "rejected";
    else if (r && r.status === "applied" && cand && cand.manual) decision = "manual";
    else if (r && r.status === "applied" && r.applied_at && r.applied_at > r.checked_at) decision = "accepted";
    else if (r && r.status === "applied") decision = "auto";
    const hints = new Set();
    for (const t of tracks) {
      let tags = {};
      try { tags = JSON.parse((tagsOf.get(t.id) || {}).tags || "{}"); } catch (err) { /* none */ }
      for (const [k, v] of Object.entries(tags)) {
        if (!HINT.test(k)) continue;
        for (const x of [].concat(v)) { const s = String(x).trim(); if (s && s.length < 200) hints.add(k + ": " + s); }
      }
    }
    const dirs = [...new Set(tracks.map(t => path.dirname(t.path)))];
    albums.push({
      key: al.key, title: al.scanned.title, artist: al.scanned.artist, year: al.scanned.year,
      shown: { title: al.title, artist: al.artist, year: al.year },
      folders: dirs.map(rel), box: al.box ? { name: al.box.name, disc: al.box.disc, of: al.box.of } : null,
      hints: [...hints].slice(0, 20),
      ids: identifier.idsOf(al),
      tracks: tracks.map(t => ({ title: t.scanned_title || t.title, length: t.duration || null, disc: t.disc_no || null, no: t.track_no || null })),
      scan: r ? { status: r.status, similarity: r.distance == null ? null : Math.round((1 - r.distance) * 100), itunes: r.itunes || null,
        candidate: cand ? { mbid: cand.mbid, group_mbid: cand.group_mbid || null, source: cand.source || "musicbrainz", artist: cand.artist, title: cand.title,
          year: cand.year, release_title: cand.release_title, release_year: cand.release_year, edition: cand.edition || "", group_note: cand.group_note || "",
          type: cand.type || null, country: cand.country || null, ambiguous: !!cand.ambiguous, manual: cand.manual || null, matched_by: cand.matched_by || null,
          tracks: (cand.tracks || []).map(t => ({ title: t.title, length: t.length, disc: t.disc || null, no: t.no || null })), parts: cand.parts || null } : null } : null,
      decision,
      edit: e ? { title: e.title || null, artist: e.artist || null, year: e.year || null } : null
    });
  }
  say(`${albums.length} albums the scan looks at`);

  if (args.fetch) {
    const only = new Set(String(args.only || "proposed,unidentified,rejected,manual,edited,unchecked").split(","));
    const want = a => only.has(a.decision) || (!a.scan && only.has("unchecked")) ||
      (a.scan && only.has(a.scan.status) && a.decision !== "auto");
    let picked = albums.filter(want);
    const sample = Number(args["sample-applied"] || 0);
    if (sample) picked = picked.concat(albums.filter(a => a.decision === "auto").sort(() => Math.random() - 0.5).slice(0, sample));
    if (args.limit) picked = picked.slice(0, Number(args.limit));
    say(`asking MusicBrainz about ${picked.length} (about ${Math.ceil(picked.length * 5 / 60)} minutes)…`);
    const byKey = new Map(library.albums.map(al => [al.key, al]));
    let n = 0;
    for (const a of picked) {
      n++;
      const al = byKey.get(a.key);
      try {
        const { cands } = await identifier.resolve(identifier.input(al));
        a.candidates = (cands || []).slice(0, 12).map(c => ({
          mbid: c.mbid, group_mbid: c.group_mbid || null, artist: c.artist, title: c.title, year: c.year,
          release_title: c.release_title, release_year: c.release_year, edition: c.edition || "", group_note: c.group_note || "",
          type: c.type || null, country: c.country || null, discs: c.discs || null,
          similarity: Math.round((1 - SCORE.distance(identifier.input(al), c).distance) * 100),
          tracks: (c.tracks || []).map(t => ({ title: t.title, length: t.length, disc: t.disc || null, no: t.no || null }))
        }));
      } catch (e) {
        a.candidates_error = e.message;
      }
      if (n % 10 === 0 || n === picked.length) say(`  ${n}/${picked.length}`);
    }
  }

  process.stdout.write(JSON.stringify({ made: new Date().toISOString(), version: req("package.json").version, fetched: !!args.fetch, albums }, null, 1) + "\n");
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { say(e.stack || e.message); process.exit(1); });
