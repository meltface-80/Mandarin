"use strict";
/*
 * artist-report.js — for one artist: every tag the files carry, what
 * Mandarin's scanner reads from them, and what the server's database holds
 * — to see why an album shows as "Unknown Artist". Read-only: it opens the
 * files and the database, and writes neither.
 *
 * Run inside the Mandarin container (it has Node, the tag reader and the database):
 *   docker exec -i musicd-server node - "808 State" < artist-report.js > artist-report.txt
 * Optional third and fourth arguments: the music folder as the container sees
 * it (default $MUSIC_DIR, /music) and the database folder (default $DATA_DIR, /app/data).
 *
 * Folders are found by the artist's name in their path ("808 State",
 * "808-state" and "808State" all match), and the database by the artist and
 * album-artist it stored, and by path — so a file filed under the artist but
 * tagged with nothing still shows up.
 */
const fs = require("fs");
const path = require("path");

const artist = process.argv[2] || "808 State";
const root = process.argv[3] || process.env.MUSIC_DIR || "/music";
const dataDir = process.argv[4] || process.env.DATA_DIR || "/app/data";
const APP = process.cwd();
const AUDIO = new Set([".flac", ".mp3", ".m4a", ".mp4", ".aac", ".alac", ".ogg", ".oga", ".opus", ".wav", ".aif", ".aiff", ".aifc", ".dsf", ".dff", ".wv", ".ape", ".wma"]);
const fold = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const want = fold(artist);
const short = v => {
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  s = s.replace(/\s+/g, " ");
  return s.length > 140 ? s.slice(0, 137) + "…" : s;
};

/* Folders holding audio whose path names the artist. */
function folders(dir, out, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  const audio = entries.filter(e => e.isFile() && AUDIO.has(path.extname(e.name).toLowerCase()));
  if (audio.length && fold(path.relative(root, dir)).includes(want)) out.push({ dir, files: audio.map(e => path.join(dir, e.name)).sort() });
  if (depth > 8) return;
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) folders(path.join(dir, e.name), out, depth + 1);
}

/* The scanner's own choice of album artist, as lib/library/scanner.js groupDir makes it. */
function decided(rows) {
  const tagged = rows.find(r => r.album_artist);
  const artists = new Set(rows.map(r => fold(r.artist)).filter(Boolean));
  if (tagged) return `"${tagged.album_artist}" (from the album-artist tag)`;
  if (rows.some(r => r.compilation)) return `"Various Artists" (a file is flagged as a compilation)`;
  if (artists.size > 1) return `"Various Artists" (${artists.size} different artist tags, no album-artist tag)`;
  if (rows[0] && rows[0].artist) return `"${rows[0].artist}" (from the artist tag)`;
  return `"Unknown Artist" — no file has an artist or album-artist tag Mandarin can read`;
}

(async () => {
  let mm;
  try { mm = await import("music-metadata"); }
  catch (e) { mm = await import(require("url").pathToFileURL(path.join(APP, "node_modules/music-metadata/lib/index.js")).href); }
  let readTags = null;
  try { readTags = require(path.join(APP, "lib/library/scanner.js")).readTags; } catch (e) { /* the raw tags still show */ }

  console.log(`Mandarin artist report · ${new Date().toISOString()}`);
  console.log(`Artist: ${artist} · music: ${root} · database: ${dataDir}\n`);

  // ---------------------------------------------------------------- the database
  let db = null;
  try {
    const Database = require(path.join(APP, "node_modules/better-sqlite3"));
    db = new Database(path.join(dataDir, "musicd.db"), { readonly: true, fileMustExist: true });
  } catch (e) { console.log(`(Database not read: ${e.message})\n`); }
  if (db) {
    const unknown = db.prepare("SELECT COUNT(*) AS n FROM albums WHERE artist = 'Unknown Artist'").get().n;
    const all = db.prepare("SELECT COUNT(*) AS n FROM albums").get().n;
    console.log(`Library: ${all} albums, ${unknown} of them "Unknown Artist".`);
    // What the unknown ones have in common: their file types.
    const kinds = db.prepare(`SELECT t.container AS c, t.codec AS k, COUNT(DISTINCT a.id) AS n FROM albums a JOIN tracks t ON t.album_id = a.id
      WHERE a.artist = 'Unknown Artist' GROUP BY t.container, t.codec ORDER BY n DESC`).all();
    if (kinds.length) console.log("Unknown Artist albums by file type: " + kinds.map(x => `${x.c || "?"}/${x.k || "?"} ${x.n}`).join(" · "));
    console.log("");

    const rows = db.prepare(`SELECT a.id, a.title, a.artist AS album_artist_shown, a.dir, t.path, t.artist, t.album_artist, t.album, t.title AS ttitle, t.codec, t.container
      FROM tracks t JOIN albums a ON a.id = t.album_id ORDER BY a.dir, t.disc_no, t.track_no, t.path`).all()
      .filter(r => [r.artist, r.album_artist, r.album_artist_shown].some(v => fold(v).includes(want)) || fold(path.relative(root, r.path)).includes(want));
    const byAlbum = new Map();
    for (const r of rows) { if (!byAlbum.has(r.id)) byAlbum.set(r.id, []); byAlbum.get(r.id).push(r); }
    console.log("═".repeat(78));
    console.log(`IN THE DATABASE: ${byAlbum.size} albums for ${artist}\n`);
    for (const [id, tr] of byAlbum) {
      const a = tr[0];
      console.log(`• "${a.title}" — shown as by "${a.album_artist_shown}"   (album ${id}, ${tr.length} tracks)`);
      console.log(`  folder: ${path.relative(root, a.dir) || a.dir}`);
      const sample = tr.slice(0, 3);
      for (const t of sample) console.log(`    ${path.basename(t.path)} · artist "${t.artist || ""}" · album artist "${t.album_artist || ""}" · album "${t.album || ""}" · ${t.container || "?"}/${t.codec || "?"}`);
      if (tr.length > sample.length) console.log(`    … ${tr.length - sample.length} more`);
    }
    console.log("");
  }

  // ---------------------------------------------------------------- the files
  const list = [];
  folders(root, list);
  console.log("═".repeat(78));
  console.log(`IN THE FILES: ${list.length} folders with "${artist}" in their path\n`);
  if (!list.length) console.log("None found — give the music folder as the container sees it (see docker inspect).\n");
  for (const [n, al] of list.entries()) {
    console.log("─".repeat(78));
    console.log(`Folder ${n + 1}: ${path.relative(root, al.dir)}  (${al.files.length} files)`);
    const read = [];
    for (const [i, f] of al.files.entries()) {
      let md;
      try { md = await mm.parseFile(f, { skipCovers: true, duration: false }); }
      catch (e) { console.log(`  ! ${path.basename(f)}: ${e.message}`); continue; }
      let mine = null;
      if (readTags) { try { mine = await readTags(f); } catch (e) { mine = { error: e.message }; } }
      if (mine) read.push(mine);
      // Every file's names, as Mandarin reads them; the first two files' tags in full.
      const c = md.common || {};
      console.log(`  ${path.basename(f)} · ${md.format.container || "?"}/${md.format.codec || "?"} · tag types: ${(md.format.tagTypes || []).join(", ") || "none"}`);
      console.log(`    read as: artist "${c.artist || ""}" · album artist "${c.albumartist || ""}" · album "${c.album || ""}" · title "${c.title || ""}"${c.compilation ? " · compilation" : ""}`);
      if (mine && !mine.error) console.log(`    Mandarin stores: artist "${mine.artist || ""}" · album artist "${mine.album_artist || ""}" · album "${mine.album || ""}"`);
      if (i < 2) {
        for (const [type, tags] of Object.entries(md.native || {})) {
          const shown = tags.filter(t => !(t.value && (t.value.data || t.value instanceof Uint8Array)));
          console.log(`    ${type} (${shown.length} tags):`);
          for (const t of shown) console.log(`      ${t.id} = ${short(t.value)}`);
        }
        if (!Object.keys(md.native || {}).length) console.log("    no tags at all in this file");
      }
    }
    if (read.length) console.log(`  → Mandarin would show this folder as by ${decided(read)}`);
    console.log("");
  }
  if (db) db.close();
})().catch(e => { console.error(e); process.exit(1); });
