"use strict";
/*
 * tag-report.js — what tags, identifiers and loudness (ReplayGain) the music files carry, for a
 * sample of albums. Read-only: it opens files, never writes them.
 *
 * Run inside the Mandarin container (it has Node and the tag reader):
 *   docker exec -i musicd-server node - [folder] [albums] < tag-report.js > tag-report.txt
 * folder: the music folder as the container sees it (default: $MUSIC_DIR, /music)
 * albums: how many album folders to sample (default 10), spread across the library.
 */
const fs = require("fs");
const path = require("path");

const root = process.argv[2] || process.env.MUSIC_DIR || "/music";
const want = Math.max(1, parseInt(process.argv[3], 10) || 10);
const AUDIO = new Set([".flac", ".mp3", ".m4a", ".mp4", ".aac", ".alac", ".ogg", ".oga", ".opus", ".wav", ".aif", ".aiff", ".aifc", ".dsf", ".dff", ".wv", ".ape", ".wma"]);
// The tags that say which release or recording a file is — what identification could use first.
// Loudness: ReplayGain (track and album gain and peak), R128 and iTunes' own.
const LOUD = /replaygain|r128|itunnorm|loudness/i;
const IDS = /musicbrainz|mbid|barcode|upc|ean|catalog|isrc|discogs|qobuz|tidal|deezer|spotify|apple|itunes|acoustid|asin|label|releasecountry|releasestatus|releasetype|media|originaldate|originalyear|script|totaltracks|totaldiscs|tracktotal|disctotal/i;

function albumFolders(dir, out, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  const audio = entries.filter(e => e.isFile() && AUDIO.has(path.extname(e.name).toLowerCase()));
  if (audio.length) out.push({ dir, files: audio.map(e => path.join(dir, e.name)).sort() });
  if (depth > 6) return;
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) albumFolders(path.join(dir, e.name), out, depth + 1);
}

const short = v => {
  let s = typeof v === "object" ? JSON.stringify(v) : String(v);
  s = s.replace(/\s+/g, " ");
  return s.length > 120 ? s.slice(0, 117) + "…" : s;
};

(async () => {
  let mm;
  try { mm = await import("music-metadata"); }
  catch (e) { mm = await import(require("url").pathToFileURL(path.join(process.cwd(), "node_modules/music-metadata/lib/index.js")).href); }
  const all = [];
  albumFolders(root, all);
  console.log(`Mandarin tag report · ${new Date().toISOString()} · ${root}`);
  console.log(`${all.length} album folders found; sampling ${Math.min(want, all.length)}, spread across the library.\n`);
  if (!all.length) { console.log("No music found here — give the folder as the container sees it (see docker inspect)."); return; }
  const step = all.length / Math.min(want, all.length);
  const picks = [];
  for (let i = 0; i < Math.min(want, all.length); i++) picks.push(all[Math.floor(i * step)]);

  const seenKeys = new Map();   // "FORMAT:TAG" → albums it appeared in
  for (const [n, al] of picks.entries()) {
    console.log("═".repeat(78));
    console.log(`Album ${n + 1}: ${path.relative(root, al.dir) || "."}  (${al.files.length} files)`);
    let first = null;
    const albumKeys = new Set();
    for (const f of al.files) {
      let md;
      try { md = await mm.parseFile(f, { skipCovers: true, duration: false }); }
      catch (e) { console.log(`  ! ${path.basename(f)}: ${e.message}`); continue; }
      if (!first) first = { f, md };
      for (const [fmt, tags] of Object.entries(md.native || {})) for (const t of tags) albumKeys.add(fmt + ":" + t.id);
    }
    for (const k of albumKeys) seenKeys.set(k, (seenKeys.get(k) || 0) + 1);
    if (!first) continue;
    const { f, md } = first;
    const fm = md.format || {};
    console.log(`  First file: ${path.basename(f)}`);
    console.log(`  Format: ${fm.container || "?"} · ${fm.codec || "?"} · ${fm.sampleRate || "?"} Hz · ${fm.bitsPerSample || "?"}-bit · ${fm.numberOfChannels || "?"} ch · tag types: ${(fm.tagTypes || []).join(", ") || "none"}`);
    const c = md.common || {};
    const ids = Object.entries(c).filter(([k, v]) => (IDS.test(k) || LOUD.test(k)) && v != null && !(Array.isArray(v) && !v.length));
    console.log("  Identifiers and loudness (as the tag reader names them):");
    if (!ids.length) console.log("    — none");
    for (const [k, v] of ids) console.log(`    ${k}: ${short(v)}`);
    console.log("  Every tag in the file:");
    for (const [fmt, tags] of Object.entries(md.native || {})) {
      for (const t of tags) {
        if (/^(APIC|PIC|covr|METADATA_BLOCK_PICTURE|PICTURE)$/i.test(t.id) || (t.value && t.value.data)) continue;
        console.log(`    [${fmt}] ${t.id}${IDS.test(t.id) ? "  ◆" : LOUD.test(t.id) ? "  ♪" : ""}: ${short(t.value)}`);
      }
    }
    console.log("");
  }
  console.log("═".repeat(78));
  console.log("Tags across the sampled albums (in how many of them):");
  for (const [k, n] of [...seenKeys].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    console.log(`  ${String(n).padStart(3)}  ${k}${IDS.test(k) ? "  ◆ identifier" : LOUD.test(k) ? "  ♪ loudness" : ""}`);
  }
})().catch(e => { console.error("tag-report failed:", e.message); process.exit(1); });
