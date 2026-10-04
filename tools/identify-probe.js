"use strict";
/*
 * identify-probe.js — does a barcode-first identification have legs? (v0.6.4
 * investigation). For a sample of your albums that carry a barcode, it asks:
 *
 *   1. MusicBrainz, by the barcode exactly as tagged, and in its other form
 *      (a 13-digit EAN with its leading 0 dropped, or a 12-digit UPC with
 *      one added) — how many does each find, and is the release found the
 *      album (its tracks scored as the scan scores them)?
 *   2. Apple's iTunes, by the same barcode.
 *   3. Qobuz, by the Qobuz IDs in the files' own tags (a Qobuz download
 *      carries its track ID), if there are any.
 *
 * And, for the whole library, which tags the files carry and how often —
 * the IDs worth reading. It changes nothing: a copy of the database is read,
 * and each service is asked politely (MusicBrainz once a second, Apple and
 * Qobuz every three).
 *
 *   docker exec -i musicd-server node - < identify-probe.js > identify-probe.json
 *   docker exec -i musicd-server node - --sample=300 < identify-probe.js > identify-probe.json
 *
 * --sample (default 150): albums asked about — all those waiting or not
 * found first, then ones the scan matched by name, then ones not yet looked
 * at. A summary is printed at the end; the details go to the file.
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
const SAMPLE = Number(args.sample || 150);
const say = (...a) => process.stderr.write(a.join(" ") + "\n");
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* The barcode in its other common form: EAN-13 with a leading 0 ↔ UPC-A. */
function otherForm(code) {
  const d = String(code || "").replace(/\D/g, "");
  if (d.length === 13 && d[0] === "0") return d.slice(1);
  if (d.length === 12) return "0" + d;
  return null;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "identify-probe-"));
  for (const f of ["musicd.db", "musicd.db-wal", "musicd.db-shm"]) {
    const src = path.join(dataDir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, f));
  }
  const DB = req("lib/library/db");
  const { Library } = req("lib/library");
  const { Identifier, MIN_TRACKS } = req("lib/identify/identifier");
  const { MusicBrainz } = req("lib/identify/musicbrainz");
  const { ITunes } = req("lib/identify/itunes");
  const SCORE = req("lib/identify/score");
  const db = DB.open(tmp, { log: () => {} });
  const library = new Library(db, { musicRoot: musicDir, log: () => {} });
  library.reload();
  const mb = new MusicBrainz({ baseUrl: args.mb || undefined, log: () => {} });
  const itunes = new ITunes({ baseUrl: args.itunes || undefined, log: () => {} });
  const identifier = new Identifier({ db, library, mb, itunes: null, log: () => {} });

  // ---------------------------------------------------------- the tag census
  // Every tag name across the library, how many tracks carry it, and an
  // example — the IDs (UPC, QBZ:TID, ISRC…) the files offer.
  const census = new Map();
  const tagsByTrack = new Map();
  for (const r of db.raw.prepare("SELECT track_id, tags FROM track_tags").all()) {
    let tags = {};
    try { tags = JSON.parse(r.tags || "{}"); } catch (e) { continue; }
    tagsByTrack.set(r.track_id, tags);
    for (const [k, v] of Object.entries(tags)) {
      const key = k.toUpperCase();
      const c = census.get(key) || { tracks: 0, example: null };
      c.tracks++;
      if (!c.example) c.example = String([].concat(v)[0]).slice(0, 80);
      census.set(key, c);
    }
  }
  const trackCount = db.raw.prepare("SELECT COUNT(*) AS n FROM tracks").get().n;
  const tagNames = [...census.entries()].sort((a, b) => b[1].tracks - a[1].tracks)
    .map(([k, c]) => ({ tag: k, tracks: c.tracks, share: Math.round(c.tracks / trackCount * 1000) / 10, example: c.example }));
  const qobuzTags = tagNames.filter(t => /QBZ|QOBUZ/.test(t.tag));
  say(`${trackCount} tracks; ${tagNames.length} different tags; Qobuz tags: ${qobuzTags.map(t => t.tag + " " + t.share + "%").join(", ") || "none"}`);

  // ---------------------------------------------------------- the sample
  const rows = identifier.rows();
  const albums = library.albums.filter(al => al.tracks >= MIN_TRACKS || library.tracks(al.id).length >= MIN_TRACKS);
  const withCode = albums.filter(al => identifier.idsOf(al).barcode);
  const status = al => { const r = rows.get(al.key); if (!r) return "unchecked"; if (r.status !== "applied") return r.status; let c = {}; try { c = JSON.parse(r.candidate || "{}"); } catch (e) {} return c.matched_by ? "applied by " + c.matched_by : "applied by name"; };
  const rank = { proposed: 0, unidentified: 1, rejected: 2, "applied by name": 3, unchecked: 4 };
  const shuffled = withCode.slice().sort(() => Math.random() - 0.5);
  const picked = shuffled.filter(al => (rank[status(al)] ?? 9) <= 2)
    .concat(shuffled.filter(al => status(al) === "applied by name").slice(0, Math.ceil(SAMPLE / 3)))
    .concat(shuffled.filter(al => status(al) === "unchecked").slice(0, Math.ceil(SAMPLE / 3)))
    .slice(0, SAMPLE);
  say(`${albums.length} albums, ${withCode.length} with a barcode; asking about ${picked.length} (about ${Math.ceil(picked.length * 9 / 60)} minutes)…`);

  const results = [];
  let n = 0;
  for (const al of picked) {
    n++;
    const ids = identifier.idsOf(al);
    const input = identifier.input(al);
    const code = ids.barcode.replace(/\D/g, "");
    const alt = otherForm(code);
    const row = { artist: al.artist, title: al.title, tracks: input.tracks.length, status: status(al), barcode: code, mb: {}, itunes: null, qobuz: null };
    // MusicBrainz, both forms; the best release found, scored.
    for (const [form, c] of [["as tagged", code], ["other form", alt]]) {
      if (!c) continue;
      try {
        const found = await mb.byBarcode(c);
        let best = null;
        for (const f of found.slice(0, 3)) {
          const rel = await mb.release(f.mbid).catch(() => null);
          if (!rel) continue;
          const s = Math.round((1 - SCORE.distance(input, rel).distance) * 100);
          if (!best || s > best.similarity) best = { mbid: rel.mbid, title: rel.title, artist: rel.artist, tracks: rel.tracks.length, similarity: s };
        }
        row.mb[form] = { releases: found.length, best };
      } catch (e) { row.mb[form] = { error: e.message }; }
    }
    // iTunes by the barcode (it reads both forms itself).
    try {
      const c = await itunes.byUpc(code) || (alt ? await itunes.byUpc(alt) : null);
      row.itunes = c ? { title: c.title, artist: c.artist, tracks: c.tracks.length, similarity: Math.round((1 - SCORE.distance(input, c).distance) * 100) } : { found: false };
    } catch (e) { row.itunes = { error: e.message }; }
    // Qobuz: a track ID from the tags, and what its public page says.
    const tid = library.tracks(al.id).map(t => tagsByTrack.get(t.id) || {}).map(t => {
      for (const [k, v] of Object.entries(t)) if (/^(QBZ:TID|QOBUZ.*TRACK.*ID|QOBUZ_?ID)$/i.test(k)) return String([].concat(v)[0]);
      return null;
    }).find(Boolean);
    if (tid) {
      try {
        await sleep(3000);
        const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 15000);
        const res = await fetch("https://open.qobuz.com/track/" + encodeURIComponent(tid), { headers: { "User-Agent": "Mozilla/5.0 Mandarin-probe" }, signal: ctl.signal, redirect: "follow" });
        clearTimeout(t);
        const html = res.ok ? await res.text() : "";
        const albumId = (/\/album\/[^"'\s]*?\/([0-9a-z]{6,})/i.exec(html) || [])[1] || null;
        row.qobuz = { track_id: tid, status: res.status, names_album: html.toLowerCase().includes(String(al.title).toLowerCase().slice(0, 20)), album_id: albumId };
      } catch (e) { row.qobuz = { track_id: tid, error: e.message }; }
    }
    results.push(row);
    if (n % 10 === 0 || n === picked.length) say(`  ${n}/${picked.length}`);
  }

  // ---------------------------------------------------------- the summary
  const pct = (a, b) => b ? Math.round(a / b * 100) + "%" : "-";
  const hit = (r, f) => r.mb[f] && r.mb[f].releases > 0;
  const good = (r, f) => r.mb[f] && r.mb[f].best && r.mb[f].best.similarity >= 95;
  const summary = {
    albums_asked: results.length,
    musicbrainz: {
      found_as_tagged: pct(results.filter(r => hit(r, "as tagged")).length, results.length),
      found_other_form_only: pct(results.filter(r => !hit(r, "as tagged") && hit(r, "other form")).length, results.length),
      found_either: pct(results.filter(r => hit(r, "as tagged") || hit(r, "other form")).length, results.length),
      found_and_95_alike: pct(results.filter(r => good(r, "as tagged") || good(r, "other form")).length, results.length)
    },
    itunes: {
      found: pct(results.filter(r => r.itunes && r.itunes.title).length, results.length),
      found_and_95_alike: pct(results.filter(r => r.itunes && r.itunes.similarity >= 95).length, results.length)
    },
    qobuz: {
      albums_with_a_qobuz_track_id: pct(results.filter(r => r.qobuz).length, results.length),
      page_found: pct(results.filter(r => r.qobuz && r.qobuz.status === 200).length, results.filter(r => r.qobuz).length)
    },
    any_source_95_alike: pct(results.filter(r => good(r, "as tagged") || good(r, "other form") || (r.itunes && r.itunes.similarity >= 95)).length, results.length),
    by_status: Object.fromEntries([...new Set(results.map(r => r.status))].map(s => {
      const L = results.filter(r => r.status === s);
      return [s, { asked: L.length, mb_either: pct(L.filter(r => hit(r, "as tagged") || hit(r, "other form")).length, L.length),
        mb_95: pct(L.filter(r => good(r, "as tagged") || good(r, "other form")).length, L.length),
        itunes_95: pct(L.filter(r => r.itunes && r.itunes.similarity >= 95).length, L.length) }];
    }))
  };
  say("\n" + JSON.stringify(summary, null, 2));
  process.stdout.write(JSON.stringify({ made: new Date().toISOString(), version: req("package.json").version, summary, tags: tagNames.slice(0, 200), qobuz_tags: qobuzTags, albums: results }, null, 1) + "\n");
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { say(e.stack || e.message); process.exit(1); });
