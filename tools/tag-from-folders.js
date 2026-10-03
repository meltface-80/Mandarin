"use strict";
/*
 * tag-from-folders.js — for FLAC files with no artist tag: the artist from
 * the folder above the album's, and what else is missing from the folder and
 * file names. Nothing a file already carries is changed.
 *
 *   Music/808 State/10x10 (1993)/01 - 10x10 (Radio Mix).flac
 *     ARTIST, ALBUMARTIST  808 State
 *     ALBUM                10x10
 *     DATE                 1993
 *     TRACKNUMBER          1
 *     TITLE                10x10 (Radio Mix)
 *   "1-01 - Pacific State.flac" also gives DISCNUMBER 1; a disc folder
 *   ("Disc 1", "CD2") gives its number, and the album and artist come from
 *   the folders above it.
 *
 * It only shows what it would do, unless --write is given. To see, inside
 * the Mandarin container:
 *   docker exec -i musicd-server node - --artist "808 State" < tag-from-folders.js
 * To write: the container has the music read-only, so a one-off container
 * from the same image with it writable (the host folder as in your docker run):
 *   docker run --rm -i -v /mnt/dietpi_userdata/MyMusic:/music --entrypoint node \
 *     ghcr.io/meltface-80/musicd-server:latest - --artist "808 State" --write < tag-from-folders.js
 * Without --artist, every album folder whose FLAC files have no artist tag.
 * A last argument names the folder to work in (default $MUSIC_DIR, /music).
 *
 * Each file is checked after writing — the tags read back, the audio the same
 * length — and put back as it was if anything is wrong. The tags are written
 * into the file's own padding where there is room (nothing else in the file
 * moves); otherwise the file is written afresh beside the old one and swapped
 * in only once it checks out. Mandarin reads the files again by itself.
 */
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf(n); if (i < 0) return null; args.splice(i, 1); return true; };
const opt = n => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const WRITE = !!flag("--write");
const ONLY = opt("--artist");
const root = path.resolve(args[0] || process.env.MUSIC_DIR || "/music");
const APP = process.cwd();
const DISC_DIR = /^(cd|disc|disk|side)\s*[-_.]?\s*(\d+)\b/i;
// Folders that hold artists rather than being one: never taken as an artist's name.
const NOT_ARTIST = /^(music|my ?music|music library|library|flac|hi-?res|lossless|albums?|artists?|downloads?|media|audio|\d+ ?[tg]b|[a-z]:?)$/i;
const fold = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// ------------------------------------------------------------------ FLAC metadata

/* The metadata blocks of a FLAC file: [{ type, last, start, length }], and where the audio begins. */
function flacBlocks(fd) {
  const head = Buffer.alloc(4);
  fs.readSync(fd, head, 0, 4, 0);
  if (head.toString("latin1") !== "fLaC") {
    // An ID3v2 tag in front of a FLAC stream is rare and left to a proper tagger.
    throw new Error("not a plain FLAC file (starts with " + JSON.stringify(head.toString("latin1")) + ")");
  }
  const blocks = [];
  let pos = 4;
  for (;;) {
    const h = Buffer.alloc(4);
    if (fs.readSync(fd, h, 0, 4, pos) !== 4) throw new Error("metadata ends early");
    const last = (h[0] & 0x80) !== 0, type = h[0] & 0x7f, length = h.readUIntBE(1, 3);
    blocks.push({ type, last, start: pos, length });
    pos += 4 + length;
    if (last) break;
    if (blocks.length > 1000) throw new Error("too many metadata blocks");
  }
  return { blocks, audioStart: pos };
}

function readBlock(fd, b) {
  const buf = Buffer.alloc(b.length);
  fs.readSync(fd, buf, 0, b.length, b.start + 4);
  return buf;
}

/* A Vorbis comment block's contents: { vendor, comments: ["KEY=value"] }. */
function parseVorbis(buf) {
  let p = 0;
  const vlen = buf.readUInt32LE(p); p += 4;
  const vendor = buf.toString("utf8", p, p + vlen); p += vlen;
  const n = buf.readUInt32LE(p); p += 4;
  const comments = [];
  for (let i = 0; i < n; i++) {
    const len = buf.readUInt32LE(p); p += 4;
    comments.push(buf.toString("utf8", p, p + len)); p += len;
  }
  return { vendor, comments };
}

function buildVorbis({ vendor, comments }) {
  const parts = [];
  const v = Buffer.from(vendor, "utf8");
  const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  parts.push(u32(v.length), v, u32(comments.length));
  for (const c of comments) { const b = Buffer.from(c, "utf8"); parts.push(u32(b.length), b); }
  return Buffer.concat(parts);
}

function blockHeader(type, last, length) {
  if (length > 0xffffff) throw new Error("a metadata block is too large");
  const h = Buffer.alloc(4);
  h[0] = (last ? 0x80 : 0) | type;
  h.writeUIntBE(length, 1, 3);
  return h;
}

/*
 * The file's metadata with these comments added: STREAMINFO first, the other
 * blocks as they were (pictures, seek table…), the comments, and padding.
 * room: the bytes the metadata may take, to fit where the old metadata was.
 */
function newMetadata(fd, info, add, room) {
  const keep = [];
  let vorbis = { vendor: "Mandarin tag-from-folders", comments: [] };
  for (const b of info.blocks) {
    if (b.type === 1) continue;                                   // padding: made again below
    if (b.type === 4) { vorbis = parseVorbis(readBlock(fd, b)); continue; }
    keep.push({ type: b.type, data: readBlock(fd, b) });
  }
  if (!keep.length || keep[0].type !== 0) throw new Error("no STREAMINFO block first");
  vorbis.comments = vorbis.comments.concat(Object.entries(add).map(([k, v]) => `${k}=${v}`));
  const blocks = keep.slice(0, 1).concat([{ type: 4, data: buildVorbis(vorbis) }], keep.slice(1));
  const size = blocks.reduce((n, b) => n + 4 + b.data.length, 0);
  // Into the old space when it fits, padded out to fill it exactly; else 4 KB of padding for next time.
  let pad;
  if (room != null && size === room) pad = null;
  else if (room != null && room - size >= 4) pad = room - size - 4;
  else pad = 4096;
  const out = [Buffer.from("fLaC", "latin1")];
  blocks.forEach((b, i) => out.push(blockHeader(b.type, pad == null && i === blocks.length - 1, b.data.length), b.data));
  if (pad != null) out.push(blockHeader(1, true, pad), Buffer.alloc(pad));
  return { buf: Buffer.concat(out) };
}

/* Add these tags to one FLAC file, checked; put back as it was if anything is wrong. */
async function writeTags(file, add, check) {
  const st = fs.statSync(file);
  let fd = fs.openSync(file, "r+");
  try {
    const info = flacBlocks(fd);
    const room = info.audioStart - 4;                   // what the metadata takes now, after "fLaC"
    const m = newMetadata(fd, info, add, room);
    if (m.buf.length === info.audioStart) {
      // In place: only the metadata is rewritten; the audio isn't touched.
      const before = Buffer.alloc(info.audioStart);
      fs.readSync(fd, before, 0, info.audioStart, 0);
      fs.writeSync(fd, m.buf, 0, m.buf.length, 0);
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = null;
      const bad = await check(file);
      if (bad) {
        const back = fs.openSync(file, "r+");
        fs.writeSync(back, before, 0, before.length, 0);
        fs.closeSync(back);
        throw new Error("check failed (" + bad + "), file put back as it was");
      }
      return "in place";
    }
    // Afresh: the new metadata, then the audio as it is, beside the old file; swapped in once checked.
    const tmp = path.join(path.dirname(file), "." + path.basename(file) + ".mandarin-tmp");
    const meta = newMetadata(fd, info, add, null).buf;
    const out = fs.openSync(tmp, "w", st.mode);
    try {
      fs.writeSync(out, meta);
      const chunk = Buffer.alloc(1 << 20);
      let pos = info.audioStart, n;
      while ((n = fs.readSync(fd, chunk, 0, chunk.length, pos)) > 0) { fs.writeSync(out, chunk, 0, n); pos += n; }
      fs.fsyncSync(out);
    } finally { fs.closeSync(out); }
    fs.closeSync(fd); fd = null;
    const bad = await check(tmp);
    if (bad) { fs.unlinkSync(tmp); throw new Error("check failed (" + bad + "), file left as it was"); }
    try { fs.chownSync(tmp, st.uid, st.gid); } catch (e) { /* not allowed: the owner is whoever runs this */ }
    fs.renameSync(tmp, file);
    return "rewritten";
  } finally {
    if (fd != null) fs.closeSync(fd);
  }
}

// ------------------------------------------------------------------ folders and names

function albumFolders(dir, out, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  const flacs = entries.filter(e => e.isFile() && /\.flac$/i.test(e.name) && !e.name.startsWith("."));
  if (flacs.length) out.push({ dir, files: flacs.map(e => path.join(dir, e.name)).sort() });
  if (depth > 10) return;
  for (const e of entries) if (e.isDirectory() && !e.name.startsWith(".")) albumFolders(path.join(dir, e.name), out, depth + 1);
}

/* What the folders and the file name say: { artist, album, date, disc, track, title }. */
function fromNames(file) {
  let dir = path.dirname(file);
  let disc = null;
  const dm = DISC_DIR.exec(path.basename(dir));
  if (dm) { disc = Number(dm[2]); dir = path.dirname(dir); }
  const albumDir = path.basename(dir);
  const artistDir = path.dirname(dir);
  const artist = artistDir.length > root.length && !NOT_ARTIST.test(path.basename(artistDir)) ? path.basename(artistDir) : null;
  const y = /\s*[([](\d{4})[)\]]\s*$/.exec(albumDir);
  const album = (y ? albumDir.slice(0, y.index) : albumDir).trim();
  const base = path.basename(file, path.extname(file));
  const fm = /^(?:(\d{1,2})[-.](\d{1,3})|(\d{1,3}))(?:\s*[-._]\s*|\s+)(.+)$/.exec(base);
  return {
    artist, album: album || null, date: y ? y[1] : null,
    disc: disc || (fm && fm[1] ? Number(fm[1]) : null),
    track: fm ? Number(fm[2] || fm[3]) : null,
    title: fm ? fm[4].trim() : base
  };
}

// ------------------------------------------------------------------ the run

(async () => {
  let mm;
  try { mm = await import("music-metadata"); }
  catch (e) { mm = await import(require("url").pathToFileURL(path.join(APP, "node_modules/music-metadata/lib/index.js")).href); }
  const read = async f => { try { return await mm.parseFile(f, { skipCovers: true }); } catch (e) { return null; } };

  console.log(`Mandarin tag-from-folders · ${new Date().toISOString()} · ${root}${ONLY ? ` · artist "${ONLY}"` : ""} · ${WRITE ? "WRITING" : "showing only (add --write to write)"}\n`);
  if (WRITE) {
    try { fs.accessSync(root, fs.constants.W_OK); }
    catch (e) {
      console.log(`${root} can't be written from here (it is mounted read-only into the container).`);
      console.log("Run it from a one-off container with the music mounted writable — see the instructions with this tool.");
      process.exit(2);
    }
  }
  const folders = [];
  albumFolders(root, folders);
  let planned = 0, done = 0, failed = 0, skipped = 0;
  for (const al of folders) {
    const names0 = fromNames(al.files[0]);
    if (ONLY && fold(names0.artist) !== fold(ONLY)) continue;
    const jobs = [];
    for (const f of al.files) {
      const md = await read(f);
      if (!md) { console.log(`  ! ${path.relative(root, f)}: can't be read`); skipped++; continue; }
      const c = md.common || {};
      if (c.artist || c.albumartist || (c.artists && c.artists.length)) continue;   // tagged: left alone
      const n = fromNames(f);
      if (!n.artist) { skipped++; continue; }
      const add = { ARTIST: n.artist, ALBUMARTIST: n.artist };
      if (!c.album && n.album) add.ALBUM = n.album;
      if (!c.title && n.title) add.TITLE = n.title;
      if (!(c.track && c.track.no) && n.track) add.TRACKNUMBER = String(n.track);
      if (!(c.disk && c.disk.no) && n.disc) add.DISCNUMBER = String(n.disc);
      if (!c.year && !c.date && n.date) add.DATE = n.date;
      jobs.push({ f, add, seconds: md.format.duration || 0 });
    }
    if (!jobs.length) continue;
    console.log("─".repeat(78));
    console.log(`${path.relative(root, al.dir)}  (${jobs.length} of ${al.files.length} files untagged)`);
    const a = jobs[0].add;
    console.log(`  ARTIST / ALBUMARTIST "${a.ARTIST}"${a.ALBUM ? ` · ALBUM "${a.ALBUM}"` : ""}${a.DATE ? ` · DATE ${a.DATE}` : ""}`);
    for (const j of jobs) {
      planned++;
      const t = j.add;
      const line = `    ${path.basename(j.f)} → ${t.DISCNUMBER ? "disc " + t.DISCNUMBER + " " : ""}${t.TRACKNUMBER ? "track " + t.TRACKNUMBER + " " : ""}${t.TITLE ? `"${t.TITLE}"` : ""}`;
      if (!WRITE) { console.log(line); continue; }
      // Read back: the artist there, and the audio the same length as before.
      const check = async file => {
        const md = await read(file);
        if (!md) return "can't be read";
        if ((md.common.artist || "") !== t.ARTIST) return "artist not read back";
        if (j.seconds && Math.abs((md.format.duration || 0) - j.seconds) > 0.05) return "length changed";
        return null;
      };
      try { const how = await writeTags(j.f, t, check); done++; console.log(line + `   ✓ ${how}`); }
      catch (e) { failed++; console.log(line + `   ✗ ${e.message}`); }
    }
  }
  console.log("\n" + "═".repeat(78));
  if (WRITE) console.log(`${done} files tagged, ${failed} failed (left as they were), ${skipped} skipped. Mandarin reads them again by itself; or tap Rescan in its menu.`);
  else console.log(`${planned} files would be tagged; ${skipped} skipped (no artist folder above them, or unreadable). Nothing written — add --write to write.`);
})().catch(e => { console.error(e); process.exit(1); });
