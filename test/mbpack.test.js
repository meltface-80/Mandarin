"use strict";
/*
 * The MusicBrainz pack (v0.6.4): tools/mbpack/build.js turns a MusicBrainz
 * data dump into one SQLite file of the releases with a barcode, and the
 * server (Identify/Pack.cs; lib/identify/mbpack.js until v0.8.50) answers the
 * scan's barcode and release questions from it, as musicbrainz.org would —
 * read here through `mandarin-server score` { fn: "mbpack" }, kept up to date
 * through the server's Settings routes. A dump of a few rows, written in the
 * dump's own COPY text, escapes and \N included.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { build, columnsFrom, field, codeOf } = require("../tools/mbpack/build");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { createServer, built: notBuilt } = require("./server");
const { score, scoreAsync } = require("./score");

const rules = notBuilt();
/* The pack format this server reads. */
const FORMAT = rules ? 0 : score({ fn: "mbpack" }).format;

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

test("the pack: built from a dump, read by the scan", { skip: rules }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbpack-"));
  writeDump(dir);
  const out = path.join(dir, "mbpack.sqlite");
  const r = await build({ dump: dir, out });
  assert.equal(r.releases, 2, "the two releases with a barcode (an empty one is none)");
  // musicbrainz.org, for what the pack hasn't.
  const mb = await new FakeMusicBrainz([{ id: "x", title: "Something Else", artist: "Someone", barcode: "999", tracks: [["One", 100]] },
    { id: G(102), title: "Tales From Topographic Oceans", artist: "Yes", tracks: [["Not packed", 1]] }]).start();
  t.after(() => mb.stop());
  const p = await scoreAsync({ fn: "mbpack", file: out, barcodes: ["0081227934019", "081227934019", "81227934019", "0075679082424", "123"],
    releases: [G(100), G(101), G(102)], mb: mb.baseUrl,
    // The scan's MusicBrainz, the pack first.
    first: [{ barcode: "081227934019" }, { release: G(100) }, { barcode: "999" }, { release: G(102) }, { search: ["Tales From Topographic Oceans", "Yes"] }] });
  assert.equal(p.opened, true);
  assert.equal(p.info.releases, 2);
  // Both forms of the barcode find it.
  for (let i = 0; i < 3; i++) assert.deepEqual(p.barcodes[i].map(f => f.mbid), [G(100)], String(i));
  assert.deepEqual(p.barcodes[3].map(f => f.mbid), [G(101)]);
  assert.deepEqual(p.barcodes[4], []);

  const [rel, old, none] = p.releases;
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
  assert.equal(old.year, 1973);
  assert.equal(old.date, "1973-12-07");
  assert.equal(old.release_year, 1989);
  assert.equal(none, null, "no barcode, not packed");
  // Scored as a release from musicbrainz.org would be.
  const input = { title: "Tales From Topographic Oceans", artist: "Yes", year: 2016, tracks: rel.tracks.map(t => ({ title: t.title, length: t.length || 600, disc: t.disc, no: t.no })) };
  assert.ok(score({ fn: "scorecall", calls: [["distance", input, rel]] }).results[0].distance < 0.2);

  // What the pack has, from it; the rest from musicbrainz.org.
  const [byPack, fromPack, byMb, fromMb] = p.first;
  assert.deepEqual(byPack.map(f => f.mbid), [G(100)]);
  assert.equal(fromPack.from_pack, true);
  assert.deepEqual(byMb.map(f => f.mbid), ["x"], "not in the pack: musicbrainz.org");
  assert.equal(fromMb.mbid, G(102));
  assert.equal(fromMb.from_pack, undefined);
  const asked = mb.requests.map(u => decodeURIComponent(u));
  assert.equal(asked.length, 3, JSON.stringify(asked));
  assert.ok(/barcode:999/.test(asked[0]) && asked[1].startsWith("/ws/2/release/" + G(102)) && /release:"Tales From Topographic Oceans"/.test(asked[2]), JSON.stringify(asked));
  assert.equal(score({ fn: "mbpack", file: path.join(dir, "none.sqlite") }).opened, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the pack from Settings: what's published (and a newer one), downloaded, kept in another folder (or the one MBPACK_DIR sets), removed — a bad download, or a folder that has gone, said", { skip: rules, timeout: 120000 }, async () => {
  const http = require("http");
  const zlib = require("zlib");
  const crypto = require("crypto");
  const { signIn } = require("./auth-helper");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mbpack-api-"));
  const dumpDir = path.join(dir, "dump"); fs.mkdirSync(dumpDir);
  writeDump(dumpDir);
  const built = path.join(dir, "built.sqlite");
  await build({ dump: dumpDir, out: built });
  const gz = zlib.gzipSync(fs.readFileSync(built));
  const desc = { format: FORMAT, built: "2026-10-01T00:00:00Z", releases: "2", file: `mbpack-${FORMAT}.sqlite.gz`, gz_size: gz.length, size: fs.statSync(built).size, sha256: crypto.createHash("sha256").update(gz).digest("hex") };
  let served = gz;
  const pub = http.createServer((req, res) => {
    if (req.url.endsWith(".json")) return res.end(JSON.stringify(desc));
    if (req.url.endsWith(".gz")) return res.end(served);
    res.statusCode = 404; res.end();
  });
  await new Promise(r => pub.listen(0, "127.0.0.1", r));
  const music = path.join(dir, "music"), data = path.join(dir, "data");
  fs.mkdirSync(music); fs.mkdirSync(data);
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const options = { port, musicDir: music, dataDir: data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, mbpackUrl: `http://127.0.0.1:${pub.address().port}` };
  let srv = createServer(options);
  const ctx = await srv.start();
  let token = await signIn(base);
  const api = async (p, body) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) } : { headers: { Authorization: "Bearer " + token } });
    return Object.assign({ status: r.status }, await r.json());
  };
  const until = async (fn, ms = 20000) => {
    const t0 = Date.now();
    for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await new Promise(r => setTimeout(r, 100)); }
  };
  try {
    // The pack is kept by the C# server (v0.8.19).
    const h = await fetch(base + "/api/identify/pack", { headers: { Authorization: "Bearer " + token } });
    assert.equal(h.headers.get("x-mandarin-answered"), "C#", "the pack is the C# server's");
    let s = await api("identify/pack");
    assert.equal(s.installed, null);
    assert.equal(s.dir, path.resolve(data));
    assert.equal(s.dir_fixed, false);
    assert.equal(s.dir_problem, null);
    assert.ok(s.free > 0);
    // What's published, asked in the background.
    await api("identify/pack?check=1");
    s = await until(async () => { const j = await api("identify/pack"); return j.latest && !j.checking && j; });
    assert.ok(s, "what's published, read");
    assert.deepEqual([s.latest.built, s.latest.releases, s.latest.gz_size], [desc.built, 2, gz.length]);
    assert.equal(s.check_error, null);

    // Downloaded, checked, put in place.
    s = await api("identify/pack/download", {});
    assert.ok(s.job && ["checking", "downloading", "done"].includes(s.job.phase), JSON.stringify(s.job));
    s = await until(async () => { const j = await api("identify/pack"); return j.job && (j.job.phase === "done" || j.job.error) && j; });
    assert.deepEqual([s.job.phase, s.job.error, s.job.done], ["done", null, gz.length]);
    assert.equal(s.installed.releases, 2);
    assert.equal(s.newer, false, "built after the one published");
    assert.ok(fs.existsSync(path.join(data, "mbpack.sqlite")));

    // Kept in another folder: moved there, read there; one that isn't there is refused.
    const other = path.join(dir, "elsewhere"); fs.mkdirSync(other);
    const bad = await api("identify/pack/folder", { dir: path.join(dir, "missing") });
    assert.equal(bad.status, 400);
    assert.match(bad.error, /Can't write/);
    s = await api("identify/pack/folder", { dir: other });
    assert.equal(s.status, 200, JSON.stringify(s));
    assert.equal(s.dir, other);
    assert.ok(fs.existsSync(path.join(other, "mbpack.sqlite")));
    assert.ok(!fs.existsSync(path.join(data, "mbpack.sqlite")));
    assert.equal(s.installed.releases, 2);
    s = await api("identify/pack/folder", { dir: null });
    assert.equal(s.dir, path.resolve(data));
    assert.ok(fs.existsSync(path.join(data, "mbpack.sqlite")));

    // A newer one published is seen: asked again before each download (the background check
    // keeps to once in ten minutes), and newer than the one here, which was built from its dump.
    desc.built = "2099-01-01T00:00:00Z";
    await api("identify/pack/download", {});
    s = await until(async () => { const j = await api("identify/pack"); return j.job && (j.job.phase === "done" || j.job.error) && j; });
    assert.deepEqual([s.job.error, s.latest.built, s.newer], [null, desc.built, true]);

    // Removed.
    s = await api("identify/pack/remove", {});
    assert.equal(s.installed, null);
    assert.ok(!fs.existsSync(path.join(data, "mbpack.sqlite")));

    // A download that doesn't match its checksum is thrown away.
    served = Buffer.from(gz); served[served.length - 1] ^= 1;
    await api("identify/pack/download", {});
    s = await until(async () => { const j = await api("identify/pack"); return j.job && (j.job.phase === "done" || j.job.error) && j; });
    assert.match(String(s.job.error), /checksum|unexpected end|incorrect|invalid/i);
    assert.equal(s.installed, null);
    assert.ok(!fs.existsSync(path.join(data, "mbpack.sqlite.download")));

    // A chosen folder that has gone (a container started without its mount):
    // said in words, before any download, not an ENOENT from it.
    served = gz;
    ctx.db.setSetting("mbpack_dir", path.join(dir, "gone"));
    assert.match((await api("identify/pack")).dir_problem, /gone isn't there/);
    await api("identify/pack/download", {});
    s = await until(async () => { const j = await api("identify/pack"); return j.job && j.job.error && j; });
    assert.match(String(s.job.error), /isn't there/);
    ctx.db.setSetting("mbpack_dir", null);
    assert.equal((await api("identify/pack")).dir_problem, null);

    // MBPACK_DIR on the server decides, and can't be changed from Settings.
    await srv.stop();
    srv = createServer(Object.assign({ mbpackDir: other }, options));
    await srv.start();
    token = await signIn(base);
    s = await api("identify/pack");
    assert.deepEqual([s.dir, s.dir_fixed], [other, true]);
    const refused = await api("identify/pack/folder", { dir: data });
    assert.equal(refused.status, 409);
    assert.match(refused.error, /MBPACK_DIR/);
  } finally {
    await srv.stop();
    pub.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
