"use strict";
/*
 * Export library as the files say it (item 442), for Mandarin Migration (musicd-migrate's docs/library-csv.md), each
 * of what a real export of 14,524 albums got wrong:
 *   1. album_artist the album-artist tag exactly as tagged, never Mandarin's name rebuilt from the acts in it ("Art
 *      Blakey & Art Blakey & The Jazz Messengers"); none: the track artist, "Various Artists" where they differ. Nor
 *      does Mandarin itself show the band so any more (Credits/SameArtists.cs).
 *   2. a value no tag said, from a folder's name, read as one ("_" for ":", "REM - Discography") and said in from_path;
 *   3. the album column the title alone: a year, a copy's "(2)", a disc ("CD2", "Disc 1"), "(12 tracks)", "(Original)",
 *      a format, "(2015 release)", a catalogue number stripped and said in stripped; the year in year, the disc in disc,
 *      a set ripped a disc an album one album again; an edition's own words kept;
 *   4. each album once: two copies merged into one album, one copy;
 *   5. a barcode however the files carry it: UPC in an MP3 (TXXX:UPC), read again from the files' own tags where the
 *      scan didn't, and the barcode of the MusicBrainz release the files name, from the MusicBrainz pack.
 * Then the checks the migration app's author asked for, over the whole file.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");
const { build } = require("../tools/mbpack/build");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 60000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}

/** The CSV as rows of cells (RFC 4180). @param {string} text */
function rows(text) {
  const out = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (q && ch === '"') q = false;
    else if (q) cell += ch;
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\r") { /* the line's end */ } else if (ch === "\n") { row.push(cell); cell = ""; out.push(row); row = []; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

// A MusicBrainz dump of one release with a barcode (an EAN-13 with its leading 0), as tools/mbpack/build reads one.
const G = n => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
function writeDump(dir) {
  const N = "\\N";
  const t = (name, r) => fs.writeFileSync(path.join(dir, name), r.map(x => x.join("\t")).join("\n") + "\n");
  t("artist_credit", [[1, "Yes", 1, 1, "2000", 0, G(901)]]);
  t("release_group_primary_type", [[1, "Album", N, 1, N, G(801)]]);
  t("release_group_secondary_type", [[7, "Remix", N, 1, N, G(802)]]);
  t("release_group_secondary_type_join", [[10, 7, "2000"]]);
  t("release_status", [[1, "Official", N, 1, N, G(803)]]);
  t("iso_3166_1", [[221, "GB"]]);
  t("medium_format", [[1, "CD", N, 0, 1982, "t", N, G(804)]]);
  t("release_group", [[10, G(10), "Tales From Topographic Oceans", 1, 1, "", 0, "2000"]]);
  t("release", [[100, G(100), "Tales From Topographic Oceans", 1, 10, 1, N, N, N, "0081227934019", "", 0, -1, "2000"]]);
  t("release_country", [[100, 221, 2016, 10, 21]]);
  t("release_unknown_country", []);
  t("medium", [[500, 100, 1, 1, "", 0, "2000", 1, G(500)]]);
  t("track", [[1, G(1001), 1, 500, 1, "1", "The Revealing Science of God", 1, 1221000, 0, "2000", "f"]]);
  fs.writeFileSync(path.join(dir, "TIMESTAMP"), "2026-10-01 00:00:00+00\n");
}

test("item 442: Export library writes each album as its files say it", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  let f = 0;
  const put = (dir, file, tags, ext = "flac") => gen(path.join(lib.music, dir, `${file}.${ext}`), { seconds: 1, freq: 200 + 20 * (++f), fmt: ext === "mp3" ? null : "s16", tags });

  // 1. The band, its album-artist tag as tagged (MusicBrainz files "The Jazz Messengers" under the band's own id).
  const BAND = "Art Blakey & The Jazz Messengers";
  for (const n of [1, 2]) put("Jazz/Moanin", `0${n}`, { track: n, title: "Moanin " + n, artist: BAND, album_artist: BAND, album: "Moanin'", date: "1959" });
  // Tagged "Beatles", which Mandarin shows as "The Beatles" (another album's tag): as tagged.
  put("Beatles/Help", "01", { track: 1, title: "Help!", artist: "Beatles", album_artist: "Beatles", album: "Help!" });
  put("The Beatles/Revolver", "01", { track: 1, title: "Taxman", artist: "The Beatles", album_artist: "The Beatles", album: "Revolver" });
  // No album-artist tag: the track artist; two artists, Various Artists.
  put("Miles Davis/Kind Of Blue", "01", { track: 1, title: "So What", artist: "Miles Davis", album: "Kind Of Blue" });
  put("Comp/Jazz Hits", "01", { track: 1, title: "One", artist: "Someone", album: "Jazz Hits" });
  put("Comp/Jazz Hits", "02", { track: 2, title: "Two", artist: "Someone Else", album: "Jazz Hits" });
  // 2. No artist or album tag: the folders' names.
  put("REM - Discography/REM - Murmur (MFSL) 1983", "01 Radio Free Europe", { track: 1, title: "Radio Free Europe" });
  put("Hozier/Boots No. 1_ The Official Revival Bootleg", "01", { track: 1, title: "Boots", artist: "Hozier" });
  // 3. Notes in the album tag.
  const tagged = (dir, album, extra = {}) => put(dir, "01", Object.assign({ track: 1, title: album + " one", artist: "Act", album }, extra));
  tagged("Act/A", "Still Coming Down (2026)");
  tagged("Act/B", "Brilliant (12 tracks)", { date: "2001" });
  tagged("Act/C", "Abbey Road (Original)", { date: "1969" });
  tagged("Act/D", "Vienna (16 bit – 44.1 kHz)", { date: "1980" });
  tagged("Act/E", "Pictures (2015 release)");
  tagged("Act/F", "Classics (395 136-2)", { date: "1990" });
  tagged("Act/G", "Rumours (Remastered)", { date: "1977" });
  for (const d of [1, 2]) for (const n of [1, 2]) put(`Funk/Under A Groove CD${d}`, `0${n}`, { track: n, title: `Groove ${d}.${n}`, artist: "Funk Band", album: `Under A Groove CD${d}`, date: "1978" });
  put("Prince/Sign O The Times/Disc 1", "01", { track: 1, title: "Sign O The Times", artist: "Prince", album: "Disc 1", date: "1987" });
  // 4. Two copies in one album, at 48 kHz (two tracks) and 44.1 kHz (three): one copy, whole, never a track of each.
  for (const [c, rate, n] of [["a", 48000, 2], ["b", 44100, 3]]) for (let i = 1; i <= n; i++)
    gen(path.join(lib.music, "Bon Iver/Holocene", `0${i} ${c}.flac`), { seconds: 1, rate, freq: 200 + 20 * (++f), tags: { track: i, title: `Holocene ${i}${c}`, artist: "Bon Iver", album: "Holocene", date: "2011" } });
  // 5. A UPC in an MP3's own frame; a MusicBrainz release id only.
  put("Daft Punk/Discovery", "01", { track: 1, title: "One More Time", artist: "Daft Punk", album: "Discovery", UPC: "724384960650" }, "mp3");
  put("Yes/Tales", "01", { track: 1, title: "The Revealing Science of God", artist: "Yes", album: "Tales From Topographic Oceans", MUSICBRAINZ_ALBUMID: G(100) });

  const dump = fs.mkdtempSync(path.join(os.tmpdir(), "export-pack-"));
  writeDump(dump);
  fs.mkdirSync(lib.data, { recursive: true });
  await build({ dump, out: path.join(lib.data, "mbpack.sqlite") });
  fs.rmSync(dump, { recursive: true, force: true });

  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token };
  const get = async p => (await fetch(base + p, { headers: H })).json();
  try {
    // Every file in (28 tracks), the scan done.
    await until(async () => { const s = await get("/api/status"); return !s.scanning && ctx.db.raw.prepare("SELECT COUNT(*) AS n FROM tracks").get().n === 28; }, 90000, "the library");

    // The band's credit, as MusicBrainz lookups keep it: "The Jazz Messengers" filed under the band's id.
    const db = ctx.db.raw;
    db.exec("CREATE TABLE IF NOT EXISTS artist_info (key TEXT PRIMARY KEY, name TEXT NOT NULL, mbid TEXT, type TEXT, about TEXT NOT NULL DEFAULT '{}', photo TEXT, photo_source TEXT, fetched INTEGER NOT NULL)");
    const info = db.prepare("INSERT OR REPLACE INTO artist_info(key, name, mbid, about, fetched) VALUES(?, ?, ?, ?, 0)");
    info.run("art blakey and the jazz messengers", BAND, "mb-band", JSON.stringify({ mb_name: BAND }));
    info.run("jazz messengers", "The Jazz Messengers", "mb-band", "{}");
    // 5. The UPC read from the MP3's TXXX:UPC by the scan.
    assert.equal(db.prepare("SELECT barcode FROM tracks WHERE title = 'One More Time'").get().barcode, "724384960650", "TXXX:UPC read as the barcode");
    // A library scanned before that: the barcode found in the files' own tags all the same.
    db.prepare("UPDATE tracks SET barcode = NULL WHERE title = 'One More Time'").run();
    db.prepare("UPDATE albums SET barcode = NULL WHERE title = 'Discovery'").run();
    await ctx.library.reload();

    // Mandarin's own name for the band, not the band twice.
    const list = await get("/api/library/albums?limit=200");
    const shown = (Array.isArray(list) ? list : list.albums || list.items || []).find(a => a.title === "Moanin'");
    assert.equal(shown && shown.subtitle, BAND, "the band's albums under its own name: " + JSON.stringify(shown));

    const r = await fetch(base + "/api/export/library.csv", { headers: H });
    assert.equal(r.status, 200);
    const t = rows(await r.text());
    assert.deepEqual(t[0], ["album_artist", "album", "disc", "track", "title", "artist", "barcode", "isrc", "duration", "year", "from_path", "stripped"]);
    const body = t.slice(1);
    const of = album => body.filter(x => x[1] === album);
    const one = album => { const a = of(album); assert.ok(a.length > 0, "exported: " + album + " in " + JSON.stringify([...new Set(body.map(x => x[1]))])); return a[0]; };

    // 1.
    for (const x of of("Moanin'")) assert.equal(x[0], BAND, "the album-artist tag as tagged");
    assert.equal(one("Help!")[0], "Beatles", "as tagged, not as Mandarin shows it");
    assert.equal(one("Kind Of Blue")[0], "Miles Davis", "no album-artist tag: the track artist");
    assert.equal(one("Jazz Hits")[0], "Various Artists");
    assert.equal(one("Kind Of Blue")[10], "", "tags: nothing from a folder");

    // 2.
    const murmur = one("Murmur (MFSL)");
    assert.equal(murmur[0], "REM");
    assert.equal(murmur[9], "1983");
    assert.match(murmur[10], /album_artist/);
    assert.match(murmur[10], /\balbum\b/);
    const boots = one("Boots No. 1: The Official Revival Bootleg");
    assert.equal(boots[0], "Hozier");
    assert.equal(boots[10], "album");
    assert.match(boots[11], /"_" read as ":"/);

    // 3.
    const still = one("Still Coming Down");
    assert.equal(still[9], "2026", "the year in the year column");
    assert.equal(still[11], "album: (2026)");
    for (const [album, note] of [["Brilliant", "(12 tracks)"], ["Abbey Road", "(Original)"], ["Vienna", "(16 bit – 44.1 kHz)"], ["Pictures", "(2015 release)"], ["Classics", "(395 136-2)"]])
      assert.equal(one(album)[11], "album: " + note, album);
    assert.equal(one("Pictures")[9], "2015");
    assert.equal(one("Rumours (Remastered)")[11], "", "an edition's own words kept");
    assert.deepEqual(of("Under A Groove").map(x => [x[2], x[3], x[4]]), [["1", "1", "Groove 1.1"], ["1", "2", "Groove 1.2"], ["2", "1", "Groove 2.1"], ["2", "2", "Groove 2.2"]],
      "a set ripped a disc an album: one album, its discs");
    const sign = one("Sign O The Times");
    assert.equal(sign[2], "1");
    assert.match(sign[10], /\balbum\b/);

    // 4.
    assert.deepEqual(of("Holocene").map(x => [x[3], x[4]]), [["1", "Holocene 1b"], ["2", "Holocene 2b"], ["3", "Holocene 3b"]], "one copy, the bigger");
    assert.match(r.headers.get("x-mandarin-export") || "", /copies=1\b/);

    // 5.
    assert.equal(one("Discovery")[6], "724384960650", "UPC from the files' own tags");
    assert.equal(one("Tales From Topographic Oceans")[6], "081227934019", "the MusicBrainz release's barcode, from the pack");

    // The checks asked for, over the whole file.
    const acts = a => a.split(/\s*(?:&|,|;|\/|\band\b|\bfeat\.?)\s*/i).map(s => s.trim().toLowerCase()).filter(Boolean);
    for (const x of body) {
      assert.equal(new Set(acts(x[0])).size, acts(x[0]).length, "an act twice: " + x[0]);
      assert.doesNotMatch(x[1], /\((?:\d{4}|\d+|\d+ tracks|Original)\)$|\b(?:CD|Disc)\s*\d+$/i, x[1]);
      assert.ok(!(/bit/i.test(x[1]) && /khz/i.test(x[1])), x[1]);
      assert.ok(!/Discography|_ /.test(x[0] + "|" + x[1]), x[0] + " — " + x[1]);
    }
    const pairs = new Set();
    for (const x of body) {
      const k = [x[0], x[1], x[2], x[3]].join("\u0001");
      assert.ok(!pairs.has(k), "a disc and track twice: " + k);
      pairs.add(k);
    }
  } finally {
    await srv.stop();
  }
});
