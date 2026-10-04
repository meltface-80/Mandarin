"use strict";
/*
 * The MusicBrainz pack (v0.6.4): tools/mbpack/build.js turns a MusicBrainz
 * data dump into one SQLite file of the releases with a barcode, and
 * lib/identify/mbpack.js answers the scan's barcode and release questions
 * from it, as musicbrainz.org would. Here a dump of a few rows, written in
 * the dump's own COPY text, escapes and \N included.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { build, columnsFrom, field, codeOf } = require("../tools/mbpack/build");
const { MbPack, withPack } = require("../lib/identify/mbpack");
const SCORE = require("../lib/identify/score");

const G = n => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const N = "\\N";

function writeDump(dir) {
  const t = (name, rows) => fs.writeFileSync(path.join(dir, name), rows.map(r => r.join("\t")).join("\n") + "\n");
  t("artist_credit", [[1, "Yes", 1, 1, "2000", 0, G(901)], [2, "Steven Wilson", 1, 1, "2000", 0, G(902)], [3, "Simon & Garfunkel", 1, 1, "2000", 0, G(903)]]);
  t("release_group_primary_type", [[1, "Album", N, 1, N, G(801)]]);
  t("release_group_secondary_type", [[7, "Remix", N, 1, N, G(802)]]);
  t("release_group_secondary_type_join", [[10, 7, "2000"]]);
  t("release_status", [[1, "Official", N, 1, N, G(803)]]);
  t("iso_3166_1", [[221, "GB"], [222, "US"]]);
  t("medium_format", [[1, "CD", N, 0, 1982, "t", N, G(804)], [12, "Digital Media", N, 0, N, "f", N, G(805)]]);
  t("release_group", [
    [10, G(10), "Tales From Topographic Oceans", 1, 1, "Steven Wilson remix", 0, "2000"],
    [11, G(11), "Tales From Topographic Oceans", 1, 1, "", 0, "2000"],
    [12, G(12), "Bridge Over Troubled Water", 3, 1, "", 0, "2000"]]);
  t("release", [
    // EAN-13 with its leading 0, a tab escaped in the note.
    [100, G(100), "Tales From Topographic Oceans", 1, 10, 1, N, N, N, "0081227934019", "2016\\tremix", 0, -1, "2000"],
    [101, G(101), "Tales From Topographic Oceans", 1, 11, 1, N, N, N, "075679082424", "", 0, -1, "2000"],
    // No barcode: not in the pack, but its 1973 date is its group's first.
    [102, G(102), "Tales From Topographic Oceans", 1, 11, 1, N, N, N, N, "", 0, -1, "2000"],
    [103, G(103), "Bridge Over Troubled Water", 3, 12, 1, N, N, N, "", "", 0, -1, "2000"]]);
  t("release_country", [[100, 221, 2016, 10, 21], [100, 222, 2017, N, N], [101, 222, 1989, N, N], [102, 221, 1973, 12, 7]]);
  t("release_unknown_country", [[103, 1970, 1, 26]]);
  t("medium", [[500, 100, 1, 1, "", 0, "2000", 2, G(500)], [501, 100, 2, 1, "", 0, "2000", 2, G(501)], [502, 101, 1, 12, "", 0, "2000", 1, G(502)], [503, 102, 1, 1, "", 0, "2000", 1, G(503)]]);
  t("track", [
    [1, G(1001), 1, 500, 2, "2", "The Revealing Science of God", 1, 1221000, 0, "2000", "f"],
    [2, G(1002), 2, 500, 1, "1", "Dance of the Dawn", 2, 60000, 0, "2000", "f"],
    [3, G(1003), 3, 501, 1, "1", "The Ancient", 1, 1100000, 0, "2000", "f"],
    [4, G(1004), 4, 501, 2, "2", "Ritual", 1, N, 0, "2000", "f"],
    [5, G(1005), 5, 502, 1, "1", "Whole album", 1, 4000000, 0, "2000", "f"],
    [6, G(1006), 6, 503, 1, "1", "Not packed", 1, 1, 0, "2000", "f"]]);
  fs.writeFileSync(path.join(dir, "TIMESTAMP"), "2026-10-01 00:00:00+00\n");
}

test("COPY text fields and barcodes", () => {
  assert.equal(field("\\N"), null);
  assert.equal(field("a\\tb\\\\c\\nd"), "a\tb\\c\nd");
  assert.equal(field("\\x41\\101"), "AA");
  assert.equal(codeOf("0081227934019"), codeOf("081227934019"));
  assert.equal(codeOf("none"), null);
  const cols = columnsFrom("CREATE TABLE release_country ( -- replicate (verbose)\n  release INTEGER NOT NULL, -- PK\n  country INTEGER,\n  CHECK (x > 0)\n);\n");
  assert.deepEqual(cols.release_country, ["release", "country"]);
});

test("the pack: built from a dump, read by the scan", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbpack-"));
  writeDump(dir);
  const out = path.join(dir, "mbpack.sqlite");
  const r = await build({ dump: dir, out });
  assert.equal(r.releases, 2, "the two releases with a barcode (an empty one is none)");
  const pack = MbPack.open(out);
  try {
    assert.ok(pack);
    assert.equal(pack.info().releases, 2);
    // Both forms of the barcode find it.
    for (const code of ["0081227934019", "081227934019", "81227934019"]) {
      assert.deepEqual(pack.byBarcode(code).map(f => f.mbid), [G(100)], code);
    }
    assert.deepEqual(pack.byBarcode("0075679082424").map(f => f.mbid), [G(101)]);
    assert.deepEqual(pack.byBarcode("123"), []);

    const rel = pack.release(G(100));
    assert.equal(rel.title, "Tales From Topographic Oceans");
    assert.equal(rel.group_mbid, G(10));
    assert.equal(rel.group_note, "Steven Wilson remix");
    assert.equal(rel.edition, "2016\tremix");
    assert.equal(rel.type, "Album + Remix");
    assert.equal(rel.release_date, "2016-10-21");
    assert.equal(rel.country, "GB", "the earliest release event's");
    assert.equal(rel.discs, 2);
    assert.deepEqual(rel.tracks, [
      { disc: 1, no: 1, title: "Dance of the Dawn", artist: "Steven Wilson", length: 60 },
      { disc: 1, no: 2, title: "The Revealing Science of God", artist: "", length: 1221 },
      { disc: 2, no: 1, title: "The Ancient", artist: "", length: 1100 },
      { disc: 2, no: 2, title: "Ritual", artist: "", length: null }]);
    // The group's first date is its earliest release's, packed or not.
    const old = pack.release(G(101));
    assert.equal(old.year, 1973);
    assert.equal(old.date, "1973-12-07");
    assert.equal(old.release_year, 1989);
    assert.equal(pack.release(G(102)), null, "no barcode, not packed");
    // Scored as a release from musicbrainz.org would be.
    const input = { title: "Tales From Topographic Oceans", artist: "Yes", year: 2016, tracks: rel.tracks.map(t => ({ title: t.title, length: t.length || 600, disc: t.disc, no: t.no })) };
    assert.ok(SCORE.distance(input, rel).distance < 0.2);
  } finally { pack.close(); }

  // The scan's MusicBrainz, the pack first.
  const asked = [];
  const mb = { byBarcode: async c => { asked.push("barcode " + c); return [{ mbid: "x" }]; }, release: async m => { asked.push("release " + m); return { mbid: m }; }, search: async () => { asked.push("search"); return []; } };
  const p = MbPack.open(out);
  const both = withPack(mb, () => p);
  assert.deepEqual((await both.byBarcode("081227934019")).map(f => f.mbid), [G(100)]);
  assert.equal((await both.release(G(100))).from_pack, true);
  assert.deepEqual(await both.byBarcode("999"), [{ mbid: "x" }], "not in the pack: musicbrainz.org");
  assert.deepEqual(await both.release(G(102)), { mbid: G(102) });
  await both.search({});
  assert.deepEqual(asked, ["barcode 999", "release " + G(102), "search"]);
  p.close();
  assert.equal(MbPack.open(path.join(dir, "none.sqlite")), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the pack downloaded from where it's published, checked, kept up to date, removed", async () => {
  const http = require("http");
  const zlib = require("zlib");
  const crypto = require("crypto");
  const { PackStore, FORMAT } = require("../lib/identify/mbpack");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbpack-store-"));
  const dumpDir = path.join(dir, "dump"); fs.mkdirSync(dumpDir);
  writeDump(dumpDir);
  const built = path.join(dir, "built.sqlite");
  await build({ dump: dumpDir, out: built });
  const gz = zlib.gzipSync(fs.readFileSync(built));
  let desc = { format: FORMAT, built: "2026-10-01T00:00:00Z", releases: "2", file: `mbpack-${FORMAT}.sqlite.gz`, gz_size: gz.length, size: fs.statSync(built).size, sha256: crypto.createHash("sha256").update(gz).digest("hex") };
  let served = gz;
  const srv = http.createServer((req, res) => {
    if (req.url.endsWith(".json")) return res.end(JSON.stringify(desc));
    if (req.url.endsWith(".gz")) return res.end(served);
    res.statusCode = 404; res.end();
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const settings = {};
  const db = { setting: (k, d) => (k in settings ? settings[k] : d), setSetting: (k, v) => { settings[k] = v; } };
  const store = new PackStore({ dataDir: dir, db, url: `http://127.0.0.1:${srv.address().port}` });
  try {
    assert.equal(store.get(), null);
    assert.equal(store.status().installed, null);
    await store.describe();
    assert.equal(store.status().latest.gz_size, gz.length);

    // A download that doesn't match its checksum is thrown away.
    served = Buffer.from(gz); served[served.length - 1] ^= 1;
    await store.download(); await store.running;
    assert.match(store.status().job.error, /checksum|unexpected end|incorrect|invalid/i);
    assert.equal(store.get(), null);
    assert.ok(!fs.existsSync(store.file + ".download"));

    served = gz;
    await store.download(); await store.running;
    assert.equal(store.status().job.phase, "done");
    assert.equal(store.status().installed.releases, 2);
    assert.deepEqual(store.get().byBarcode("081227934019").map(f => f.mbid), [G(100)]);
    assert.equal(settings.mbpack, true);
    assert.equal(store.status().newer, false, "built before the one here");

    // A newer one published is seen.
    desc = Object.assign({}, desc, { built: "2099-01-01T00:00:00Z" });
    await store.describe();
    assert.equal(store.status().newer, true);

    // Kept in another folder (another drive): the pack moves there and is still read.
    const other = path.join(dir, "elsewhere"); fs.mkdirSync(other);
    await assert.rejects(store.setDir(path.join(dir, "missing")), /Can't write/);
    const st = await store.setDir(other);
    assert.equal(st.dir, other);
    assert.equal(settings.mbpack_dir, other);
    assert.ok(fs.existsSync(path.join(other, "mbpack.sqlite")));
    assert.ok(!fs.existsSync(path.join(dir, "mbpack.sqlite")));
    assert.equal(store.get().info().releases, 2);
    assert.ok(st.free > 0);
    // And back to the data folder.
    assert.equal((await store.setDir(null)).dir, path.resolve(dir));
    assert.equal(settings.mbpack_dir, null);
    assert.ok(fs.existsSync(path.join(dir, "mbpack.sqlite")));
    // MBPACK_DIR on the server decides, and can't be changed from Settings.
    const fixed = new PackStore({ dataDir: dir, dir: other, db, url: "http://127.0.0.1:9" });
    assert.equal(fixed.status().dir, other);
    assert.equal(fixed.status().dir_fixed, true);
    await assert.rejects(fixed.setDir(dir), /MBPACK_DIR/);

    store.remove();
    assert.equal(store.get(), null);
    assert.ok(!fs.existsSync(store.file));
    assert.equal(settings.mbpack, false);
  } finally {
    store.stop();
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
