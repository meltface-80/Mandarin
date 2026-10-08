"use strict";
/*
 * tagfixtures.js — files for checking the C# tag reader against music-metadata
 * (test/tags-front.test.js): every format the scanner reads, made with ffmpeg,
 * and the tag layouts ffmpeg doesn't write built here byte by byte (ID3v2.2,
 * 2.3 and 2.4 frames of every kind the reader knows, APEv2, Lyrics3, Vorbis
 * comments, DSF, DSDIFF, Monkey's Audio), then each copied damaged a few ways.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { FFMPEG } = require("./fixtures");

const META = { title: "Song Title", artist: "The Artist", album: "The Album", album_artist: "Various Artists", date: "2019-05-03",
  track: "3/12", disc: "1/2", genre: "Rock;Pop", comment: "A comment", publisher: "Label Records" };

function ff(out, args, { seconds = 2, rate = 44100, ch = 2, tags = META } = {}) {
  const meta = Object.entries(tags || {}).flatMap(([k, v]) => ["-metadata", `${k}=${v}`]);
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i",
    `sine=frequency=440:duration=${seconds}:sample_rate=${rate}`, "-ac", String(ch), ...args, ...meta, out]);
  return r.status === 0;
}

const encoders = (() => {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-encoders"]);
  return r.status === 0 ? String(r.stdout) : "";
})();

// ---- byte builders ---------------------------------------------------------------
const u8 = (...a) => Buffer.from(a);
const be32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const le32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const syncsafe = n => u8((n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f);
const latin1 = s => Buffer.from(s, "latin1");
const utf16 = s => Buffer.concat([u8(0xff, 0xfe), Buffer.from(s, "utf16le")]);
const utf16be = s => { const b = Buffer.from(s, "utf16le"); for (let i = 0; i < b.length; i += 2) [b[i], b[i + 1]] = [b[i + 1], b[i]]; return b; };

const f22 = (id, body) => Buffer.concat([latin1(id), be32(body.length).subarray(1), body]);
const f23 = (id, body, flags = 0) => Buffer.concat([latin1(id), be32(body.length), u8(flags >> 8, flags & 0xff), body]);
const f24 = (id, body, flags = 0) => Buffer.concat([latin1(id), syncsafe(body.length), u8(flags >> 8, flags & 0xff), body]);
const tag = (major, frames, { flags = 0, ext = null, padding = 0 } = {}) => {
  const body = Buffer.concat([ext || Buffer.alloc(0), ...frames, Buffer.alloc(padding)]);
  return Buffer.concat([latin1("ID3"), u8(major, 0, flags), syncsafe(body.length), body]);
};
const txt = (enc, s) => Buffer.concat([u8(enc), enc === 0 ? latin1(s) : enc === 1 ? utf16(s) : enc === 2 ? utf16be(s) : Buffer.from(s, "utf8")]);

function rich23() {
  return [
    f23("TIT2", txt(1, "Rich Title ü")), f23("TPE1", txt(0, "AC/DC")), f23("TPE2", txt(0, "Album Artist")),
    f23("TALB", txt(1, "Album – Ünïcode")), f23("TRCK", txt(0, "4/10")), f23("TPOS", txt(0, "2/3")),
    f23("TCON", txt(0, "(17)Rock")), f23("TYER", txt(0, "2011")), f23("TORY", txt(0, "1977")), f23("TPUB", txt(1, "Big Label")),
    f23("TSRC", txt(0, "USRC17607839")), f23("TCMP", txt(0, "1")), f23("TBPM", txt(0, "120")), f23("TSO2", txt(0, "Artist, Album")),
    f23("TXXX", Buffer.concat([u8(1), utf16("MusicBrainz Album Id"), u8(0, 0), utf16("0b9d1a8f-5c2e-4b4d-9f8c-1a2b3c4d5e6f")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("BARCODE\x00"), latin1("0 39841 50052 3")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("CATALOGNUMBER\x00"), latin1("ABC/123")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("REPLAYGAIN_TRACK_GAIN\x00"), latin1("-7.21 dB")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("REPLAYGAIN_TRACK_PEAK\x00"), latin1("0.988159")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("REPLAYGAIN_ALBUM_GAIN\x00"), latin1("-6.50dB")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("RELEASECOUNTRY\x00"), latin1("GB")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("\x00"), latin1("no description")])),
    f23("TXXX", Buffer.concat([u8(0), latin1("LONG\x00"), latin1("x".repeat(5000))])),
    f23("UFID", Buffer.concat([latin1("http://musicbrainz.org\x00"), latin1("9ab1c2d3-e4f5-6789-abcd-ef0123456789")])),
    f23("POPM", Buffer.concat([latin1("Windows Media Player 9 Series\x00"), u8(196), be32(12)])),
    f23("PCNT", be32(1234567)),
    f23("COMM", Buffer.concat([u8(1), latin1("eng"), u8(0xff, 0xfe, 0, 0), utf16("Comment one")])),
    f23("COMM", Buffer.concat([u8(0), latin1("engiTunPGAP\x00"), latin1("1")])),
    f23("USLT", Buffer.concat([u8(0), latin1("eng\x00"), latin1("Line one\nLine two")])),
    f23("SYLT", Buffer.concat([u8(0), latin1("eng"), u8(2, 1), latin1("sync\x00La\x00"), be32(1000), latin1("Lo\x00"), be32(2000)])),
    f23("WXXX", Buffer.concat([u8(0), latin1("Site\x00https://example.com/x")])),
    f23("WOAR", latin1("https://artist.example.com")),
    f23("PRIV", Buffer.concat([latin1("AverageLevel\x00"), u8(0x10, 0x20, 0x30, 0x40)])),
    f23("PRIV", Buffer.concat([latin1("PeakValue\x00"), u8(1, 2, 3)])),
    f23("GEOB", Buffer.concat([u8(0), latin1("text/plain\x00a.txt\x00obj\x00hello")])),
    f23("MCDI", Buffer.from(Array.from({ length: 20 }, (_, i) => i))),
    f23("IPLS", txt(0, "producer\x00P One")),
    f23("APIC", Buffer.concat([u8(0), latin1("image/jpeg\x00"), u8(3), latin1("\x00"), u8(0xff, 0xd8, 0xff)]))
  ];
}

function rich24() {
  const chapTitle = f24("TIT2", txt(3, "Chapter 1"));
  const tocTitle = f24("TIT2", txt(3, "TOC"));
  return [
    f24("TIT2", txt(3, "UTF8 Tïtle")), f24("TPE1", txt(3, "First\x00Second")), f24("TALB", txt(2, "UTF16BE Älbum")),
    f24("TRCK", txt(0, "7")), f24("TDRC", txt(0, "2011-04-02")), f24("TDOR", txt(0, "1977")),
    f24("TCON", txt(0, "(17)Rock\x00Jazz")), f24("TIPL", txt(3, "producer\x00P One\x00engineer\x00E One,E Two")),
    f24("TMCL", txt(3, "guitar\x00G Player")), f24("TXXX", Buffer.concat([u8(3), Buffer.from("Artists\x00A\x00B")])),
    f24("TXXX", Buffer.concat([u8(0), latin1("MusicBrainz Release Group Id\x00"), latin1("11111111-2222-3333-4444-555555555555")])),
    // Unsynchronised, and with a data length indicator.
    f24("TPE2", Buffer.concat([u8(0), latin1("Un\xff\x00\x00sync")]), 0x0002),
    f24("TCOM", Buffer.concat([syncsafe(9), u8(0), latin1("Composer")]), 0x0001),
    f24("CHAP", Buffer.concat([latin1("ch1\x00"), be32(0), be32(1000), be32(0xffffffff), be32(0xffffffff), chapTitle])),
    f24("CTOC", Buffer.concat([latin1("toc\x00"), u8(3, 1), latin1("ch1\x00"), tocTitle])),
    f24("PCST", txt(0, "")), f24("TKEY", txt(0, "Am"))
  ];
}

// APEv2: items, with a header (and the footer) as most writers make them.
function ape(items, header = true) {
  const body = Buffer.concat(items.map(([k, v, flags = 0]) => { const vb = Buffer.isBuffer(v) ? v : Buffer.from(v, "utf8"); return Buffer.concat([le32(vb.length), le32(flags), latin1(k + "\x00"), vb]); }));
  const size = body.length + 32;
  const part = (isHeader) => Buffer.concat([latin1("APETAGEX"), le32(2000), le32(size), le32(items.length), le32((header ? 1 << 31 : 0) | (isHeader ? 1 << 29 : 0)), Buffer.alloc(8)]);
  return Buffer.concat([header ? part(true) : Buffer.alloc(0), body, part(false)]);
}

function id3v1(title = "V1 Title", track = 5) {
  const pad = (s, n) => Buffer.concat([latin1(s), Buffer.alloc(n)]).subarray(0, n);
  return Buffer.concat([latin1("TAG"), pad(title, 30), pad("V1 Artist", 30), pad("V1 Album", 30), latin1("1984"), pad("cmt", 28), u8(0, track, 17)]);
}

// FLAC: the metadata blocks of an ffmpeg-made file, its comment block replaced.
function vorbisComment(comments, vendor = "test vendor") {
  const parts = [le32(Buffer.byteLength(vendor)), Buffer.from(vendor), le32(comments.length)];
  for (const c of comments) { const b = Buffer.from(c, "utf8"); parts.push(le32(b.length), b); }
  return Buffer.concat(parts);
}
function flacWithComments(src, comments, extraBlocks = []) {
  const buf = fs.readFileSync(src);
  let off = 4;
  const blocks = [];
  for (;;) {
    const last = buf[off] & 0x80, type = buf[off] & 0x7f, len = buf.readUIntBE(off + 1, 3);
    if (type !== 4) blocks.push({ type, body: buf.subarray(off + 4, off + 4 + len) });
    off += 4 + len;
    if (last) break;
  }
  blocks.splice(1, 0, { type: 4, body: vorbisComment(comments) }, ...extraBlocks);
  const out = [latin1("fLaC")];
  blocks.forEach((b, i) => { const h = Buffer.alloc(4); h[0] = (i === blocks.length - 1 ? 0x80 : 0) | b.type; h.writeUIntBE(b.body.length, 1, 3); out.push(h, b.body); });
  out.push(buf.subarray(off));
  return Buffer.concat(out);
}
function flacPicture() {
  const mime = latin1("image/png"), data = Buffer.concat([u8(0x89, 0x50, 0x4e, 0x47), Buffer.alloc(32)]);
  return { type: 6, body: Buffer.concat([be32(3), be32(mime.length), mime, be32(0), be32(1), be32(1), be32(24), be32(0), be32(data.length), data]) };
}

function dsf(withTag, rate = 2822400) {
  const audio = Buffer.alloc(4096 * 2, 0x69), t = withTag ? tag(4, [f24("TIT2", txt(3, "DSD Title")), f24("TPE1", txt(3, "DSD Artist")), f24("TRCK", txt(3, "2"))]) : Buffer.alloc(0);
  const fmt = Buffer.alloc(52); fmt.write("fmt ", 0); fmt.writeBigUInt64LE(52n, 4);
  [1, 0, 2, 2, rate, 1].forEach((v, i) => fmt.writeUInt32LE(v, 12 + i * 4)); fmt.writeBigUInt64LE(BigInt(rate * 2), 36); fmt.writeUInt32LE(4096, 44);
  const data = Buffer.alloc(12); data.write("data", 0); data.writeBigUInt64LE(BigInt(12 + audio.length), 4);
  const total = 28 + 52 + 12 + audio.length + t.length;
  const hdr = Buffer.alloc(28); hdr.write("DSD ", 0); hdr.writeBigUInt64LE(28n, 4); hdr.writeBigUInt64LE(BigInt(total), 12);
  hdr.writeBigUInt64LE(withTag ? BigInt(28 + 52 + 12 + audio.length) : 0n, 20);
  return Buffer.concat([hdr, fmt, data, audio, t]);
}

function dff(withTag) {
  const chunk = (id, body) => { const h = Buffer.alloc(12); h.write(id, 0, "latin1"); h.writeBigInt64BE(BigInt(body.length), 4); return Buffer.concat([h, body]); };
  const prop = chunk("PROP", Buffer.concat([latin1("SND "), chunk("FS  ", be32(2822400)), chunk("CHNL", Buffer.concat([u8(0, 2), latin1("SLFTSRGT")])),
    chunk("CMPR", Buffer.concat([latin1("DSD "), u8(14), latin1("not compressed"), u8(0)])), chunk("ABSS", Buffer.alloc(8)), chunk("LSCO", u8(0, 0))]));
  let body = Buffer.concat([latin1("DSD "), chunk("FVER", be32(0x01050000)), prop, chunk("DSD ", Buffer.alloc(2822400 / 8 * 2, 0x69))]);
  if (withTag) { let t = tag(4, [f24("TIT2", txt(3, "DFF Title")), f24("TPE1", txt(3, "DFF Artist"))]); if (t.length % 2) t = Buffer.concat([t, u8(0)]); body = Buffer.concat([body, chunk("ID3 ", t)]); }
  return chunk("FRM8", body);
}

function monkeys(withTag) {
  const audio = Buffer.alloc(64);
  const desc = Buffer.concat([latin1("MAC "), le32(3990), le32(52), le32(24), le32(0), le32(0), le32(audio.length), le32(0), le32(0), Buffer.alloc(16)]);
  const hdr = Buffer.alloc(24); hdr.writeUInt16LE(2000, 0); hdr.writeUInt32LE(73728, 4); hdr.writeUInt32LE(1000, 8); hdr.writeUInt32LE(10, 12);
  hdr.writeUInt16LE(16, 16); hdr.writeUInt16LE(2, 18); hdr.writeUInt32LE(44100, 20);
  return Buffer.concat([desc, hdr, audio, withTag ? ape([["Title", "Monkey Title"], ["Artist", "Monkey Artist"], ["Track", "3/7"], ["Year", "2003"]]) : Buffer.alloc(0)]);
}

/* A seeded random source, so the damage is the same on every run. */
function prng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* Makes the files in dir; returns their paths. */
function build(dir, { damage = 8 } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const P = n => path.join(dir, n);
  const made = [];
  const add = (n, ok) => { if (ok !== false && fs.existsSync(P(n))) made.push(P(n)); };
  const write = (n, buf) => { fs.writeFileSync(P(n), buf); add(n); };
  const has = e => encoders.includes(" " + e + " ");

  // ffmpeg's own.
  if (has("libmp3lame")) {
    add("vbr_v24.mp3", ff(P("vbr_v24.mp3"), ["-c:a", "libmp3lame", "-q:a", "2"], { seconds: 5 }));
    add("cbr_v23_v1.mp3", ff(P("cbr_v23_v1.mp3"), ["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "3", "-write_id3v1", "1"], { seconds: 5 }));
    add("cbr_noxing.mp3", ff(P("cbr_noxing.mp3"), ["-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "0"], { seconds: 5 }));
    add("mpeg2_mono.mp3", ff(P("mpeg2_mono.mp3"), ["-c:a", "libmp3lame", "-b:a", "32k"], { seconds: 5, rate: 22050, ch: 1, tags: null }));
    add("mpeg25.mp3", ff(P("mpeg25.mp3"), ["-c:a", "libmp3lame", "-b:a", "16k"], { seconds: 5, rate: 8000, ch: 1, tags: null }));
    ff(P("_bare.mp3"), ["-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0"], { seconds: 3, tags: null });
  }
  if (has("mp2")) add("layer2.mp3", ff(P("layer2.mp3"), ["-c:a", "mp2", "-b:a", "192k", "-f", "mp2"], { seconds: 3 }));
  add("plain.flac", ff(P("plain.flac"), ["-c:a", "flac"]));
  add("hires.flac", ff(P("hires.flac"), ["-c:a", "flac", "-sample_fmt", "s32"], { rate: 96000 }));
  add("six.flac", ff(P("six.flac"), ["-c:a", "flac"], { ch: 6, rate: 48000, tags: null }));
  if (has("libvorbis")) { add("short.ogg", ff(P("short.ogg"), ["-c:a", "libvorbis"])); add("long.ogg", ff(P("long.ogg"), ["-c:a", "libvorbis"], { seconds: 30 })); }
  if (has("libopus")) {
    add("short.opus", ff(P("short.opus"), ["-c:a", "libopus", "-metadata", "R128_TRACK_GAIN=-1234", "-metadata", "R128_ALBUM_GAIN=512"]));
    add("long.opus", ff(P("long.opus"), ["-c:a", "libopus"], { seconds: 30 }));
    // A comment header over several pages.
    add("bigcomment.opus", ff(P("bigcomment.opus"), ["-c:a", "libopus", "-metadata", "lyrics=" + "la ".repeat(25000)]));
  }
  add("flac_in.oga", ff(P("flac_in.oga"), ["-c:a", "flac", "-f", "ogg"]));
  if (has("libspeex")) add("speex.ogg", ff(P("speex.ogg"), ["-c:a", "libspeex", "-f", "ogg"], { rate: 16000, ch: 1 }));
  add("aac.m4a", ff(P("aac.m4a"), ["-c:a", "aac", "-b:a", "128k", "-movflags", "+use_metadata_tags", "-metadata", "MusicBrainz Album Id=m4a-mbid", "-metadata", "BARCODE=5012345678900"]));
  add("alac.m4a", ff(P("alac.m4a"), ["-c:a", "alac"]));
  add("alac_hires.m4a", ff(P("alac_hires.m4a"), ["-c:a", "alac", "-sample_fmt", "s32p"], { rate: 96000 }));
  add("frag.m4a", ff(P("frag.m4a"), ["-c:a", "aac", "-movflags", "+frag_keyframe+empty_moov"]));
  add("plain.wav", ff(P("plain.wav"), ["-c:a", "pcm_s16le"]));
  add("hires24.wav", ff(P("hires24.wav"), ["-c:a", "pcm_s24le"], { rate: 96000 }));
  add("six.wav", ff(P("six.wav"), ["-c:a", "pcm_s16le"], { ch: 6, rate: 48000, tags: null }));
  add("bext.wav", ff(P("bext.wav"), ["-c:a", "pcm_s16le", "-write_bext", "1", "-metadata", "description=bext desc", "-metadata", "originator=me"], { tags: null }));
  add("plain.aif", ff(P("plain.aif"), ["-c:a", "pcm_s16be", "-write_id3v2", "1"]));
  add("hires.aif", ff(P("hires.aif"), ["-c:a", "pcm_s24be"], { rate: 96000, tags: null }));
  if (has("wavpack")) { add("plain.wv", ff(P("plain.wv"), ["-c:a", "wavpack"])); add("hires.wv", ff(P("hires.wv"), ["-c:a", "wavpack", "-sample_fmt", "s32p"], { rate: 96000 })); }
  if (has("wmav2")) add("plain.wma", ff(P("plain.wma"), ["-c:a", "wmav2", "-b:a", "128k"]));
  add("plain.aac", ff(P("plain.aac"), ["-c:a", "aac", "-f", "adts"]));

  // Built here.
  const mp3 = fs.existsSync(P("_bare.mp3")) ? fs.readFileSync(P("_bare.mp3")) : null;
  if (mp3) {
    write("rich_v23.mp3", Buffer.concat([tag(3, rich23()), mp3]));
    write("rich_v24.mp3", Buffer.concat([tag(4, rich24()), mp3]));
    write("v22.mp3", Buffer.concat([tag(2, [f22("TT2", txt(0, "Two Two")), f22("TP1", txt(0, "AC/DC")), f22("TAL", txt(1, "Alb")), f22("TRK", txt(0, "3/9")),
      f22("TCO", txt(0, "(13)")), f22("TYE", txt(0, "1995")), f22("COM", Buffer.concat([u8(0), latin1("engdesc\x00comment text")])), f22("TXX", txt(0, "BARCODE\x00123"))], { padding: 64 }), mp3]));
    write("v23_ext.mp3", Buffer.concat([tag(3, [f23("TIT2", txt(0, "Ext Title")), f23("TCON", txt(0, "Duo Cello/Piano"))], { flags: 0x40, ext: Buffer.concat([be32(6), u8(0, 0), be32(0)]) }), mp3]));
    write("v24_ext.mp3", Buffer.concat([tag(4, [f24("TIT2", txt(0, "Ext 24"))], { flags: 0x40, ext: Buffer.concat([be32(6), u8(1, 0)]) }), mp3]));
    write("two_tags.mp3", Buffer.concat([tag(3, [f23("TIT2", txt(0, "First"))]), tag(4, [f24("TPE1", txt(0, "Second"))]), mp3]));
    write("v25.mp3", Buffer.concat([tag(5, [f24("TIT2", txt(0, "x"))]), mp3]));
    write("toolarge.mp3", Buffer.concat([latin1("ID3"), u8(3, 0, 0), syncsafe(1e7), f23("TIT2", txt(0, "x"))]));
    write("utf16_odd.mp3", Buffer.concat([tag(3, [f23("TIT2", u8(1, 0xff, 0xfe, 0x41, 0, 0x42)), f23("TPE1", u8(1, 0xfe, 0xff, 0, 0x41, 0)), f23("TALB", u8(2, 0, 0x41, 0))]), mp3]));
    ["17", "(17)", "(17)(26)Rock", "Duo Cello/Piano", "((Escaped)", "(RX)(CR)", "Rock (live", "255", "(999)"].forEach((g, i) =>
      write(`genre${i}.mp3`, Buffer.concat([tag(3, [f23("TIT2", txt(0, "G" + i)), f23("TCON", txt(0, g))]), mp3])));
    write("ape_on.mp3", Buffer.concat([tag(3, [f23("TIT2", txt(0, "ID3 Title"))]), mp3,
      ape([["Title", "APE Title"], ["Artist", "APE Artist"], ["Year", "1999-02-03"], ["Track", "7"], ["REPLAYGAIN_TRACK_GAIN", "+1.50 dB"],
        ["Genre", "Electronic\x00Ambient"], ["MUSICBRAINZ_ALBUMID", "ape-mbid"], ["Cover Art (Front)", Buffer.from("x.jpg\x00\xff\xd8", "latin1"), 2]]), id3v1()]));
    const lyr = latin1("LYRICSBEGININD0000211LYR00005hello");
    write("lyrics3.mp3", Buffer.concat([mp3, lyr, latin1(String(lyr.length).padStart(6, "0") + "LYRICS200"), id3v1()]));
    write("id3v1.mp3", Buffer.concat([mp3, id3v1("Only V1", 0)]));
  }
  if (fs.existsSync(P("plain.flac"))) {
    write("vorbis_rich.flac", flacWithComments(P("plain.flac"), ["TITLE=Vorbis Title", "ARTIST=First Artist", "ARTIST=Second Artist",
      "ARTISTS=First Artist", "ALBUMARTIST=Album Artist", "ALBUM=Vorbis Album", "DATE=2011-04-02", "ORIGINALDATE=1977-02-04", "TRACKNUMBER=5",
      "TRACKTOTAL=11", "DISCNUMBER=1", "DISCTOTAL=2", "GENRE=Rock", "GENRE=rock", "GENRE=Pop; Jazz", "COMPILATION=1", "LABEL=Vorbis Label",
      "CATALOGNUMBER=CAT-001", "BARCODE=0039841500523", "ISRC=GBAYE0601690", "ISRC=GBAYE0601690", "MUSICBRAINZ_ALBUMID=f-mbid",
      "REPLAYGAIN_TRACK_GAIN=-3.20 dB", "REPLAYGAIN_TRACK_PEAK=0.95", "REPLAYGAIN_ALBUM_GAIN=-3.5 dB", "RELEASECOUNTRY=XE",
      "ALBUMARTISTSORT=Artist, Album", "RATING:user@example.com=0.8", "RATING=80", "UPC=123456789012", "1=numeric key", "ünïcode=key",
      "EMPTY=", "noequals", "COMMENT=  spaced  ", "METADATA_BLOCK_PICTURE=AAAA"], [flacPicture()]));
    write("id3_on.flac", Buffer.concat([tag(3, [f23("TIT2", txt(0, "ID3 on FLAC")), f23("TPE1", txt(0, "ID3 Artist"))]), fs.readFileSync(P("plain.flac"))]));
  }
  write("plain.dsf", dsf(true)); write("notag.dsf", dsf(false)); write("dsd128.dsf", dsf(true, 5644800));
  write("plain.dff", dff(true)); write("notag.dff", dff(false));
  write("monkey.ape", monkeys(true)); write("notag.ape", monkeys(false));

  // Names that send the reader to the file's first bytes instead.
  for (const [from, to] of [["plain.flac", "renamed.fla"], ["alac.m4a", "renamed.alac"], ["plain.aif", "renamed.aiff"], ["plain.aif", "renamed.aifc"], ["plain.wav", "renamed.wave"], ["id3_on.flac", "id3_renamed.fla"]]) {
    if (fs.existsSync(P(from))) { fs.copyFileSync(P(from), P(to)); add(to); }
  }
  try { fs.unlinkSync(P("_bare.mp3")); } catch (e) { /* none */ }

  // Each damaged a few ways: cut short, and bytes changed near the start.
  const rnd = prng(20261008);
  const whole = made.slice();
  for (const f of whole) {
    const data = fs.readFileSync(f);
    const ext = path.extname(f), base = path.basename(f, ext);
    for (let i = 0; i < damage; i++) {
      let b = Buffer.from(data);
      if (i % 2 === 0) b = b.subarray(0, Math.max(1, Math.floor(rnd() * Math.min(b.length, 8192 * (i + 1)))));
      else for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) { const pos = Math.floor(rnd() * Math.min(b.length, 4096)); b[pos] = rnd() < 0.3 ? 0 : rnd() < 0.5 ? 0xff : Math.floor(rnd() * 256); }
      write(`${base}.d${i}${ext}`, b);
    }
  }
  return made;
}

module.exports = { build };
