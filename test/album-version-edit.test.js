"use strict";
/*
 * Edit album's Version (bug list item 420): an album matched to the nearest pressing of its record shows that
 * release's version details (its version name, label, catalogue number, barcode, country, this pressing's year and
 * format), each from the match, else from the files; changed by hand, they are yours — the Versions tab says your name
 * and year, a rescan keeps them, another edition switched to later fills only the fields you left alone, Put back gives
 * the match's word again, Undo all edits takes them all, and a backup's collection brings them back. Your name for a
 * version never teaches the edition kind (item 414b): that is the release's. Against the fake MusicBrainz on loopback.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { FakeMusicBrainz } = require("./fake-musicbrainz");
const { createServer, built } = require("./server");

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

const GROUP = { id: "g-kob", title: "Kind of Blue", date: "1959-08-17" };
const TRACKS = [["So What", 3], ["Freddie Freeloader", 4]];
const RELEASES = [
  { id: "kob-blue", title: "Kind of Blue", artist: "Miles Davis", date: "1959-08-17", country: "US", disambiguation: "blue disc label", label: "Columbia", catno: "CL 1355",
    barcode: "0074646693528", format: "12\" Vinyl", group: GROUP, tracks: TRACKS },
  { id: "kob-mono", title: "Kind of Blue", artist: "Miles Davis", date: "2019-03-01", country: "JP", disambiguation: "mono", label: "Sony Music", catno: "SICP-31257",
    format: "SACD", group: GROUP, tracks: TRACKS }
];

/** The fields of Edit album's "version", as [value, from, edited] each. @param {any} v */
const fields = v => Object.fromEntries(Object.entries(v).map(([k, f]) => [k, [f.value, f.from, f.edited]]));

test("item 420: a match fills the version, yours win on the Versions tab, kept through a rescan, an edition switch, Put back, Undo all and a backup", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const kob = (dir, date, extra = {}) => TRACKS.forEach(([title, seconds], i) => gen(path.join(lib.music, "Miles Davis", dir, `0${i + 1}.flac`), { seconds, freq: 300 + 60 * i,
    tags: Object.assign({ title, artist: "Miles Davis", album: "Kind of Blue", track: i + 1, date, MUSICBRAINZ_RELEASEGROUPID: GROUP.id }, extra) }));
  // The owner's copy (tags of another pressing) and an older one: two versions of one record.
  kob("Kind of Blue (HDTT)", "2015", { label: "Analogue Productions", CATALOGNUMBER: "CAPJ 8163" });
  kob("Kind of Blue (1959)", "1959");
  // An album nothing matches: its version from its files alone.
  for (const i of [1, 2]) gen(path.join(lib.music, "Artist C", "Sketches", `0${i}.flac`), { seconds: 2, freq: 500 + 40 * i,
    tags: { title: "S" + i, artist: "Artist C", album: "Sketches (Remastered)", track: i, date: "2001", label: "Label C", CATALOGNUMBER: "LC-1", BARCODE: "5012345678900", RELEASECOUNTRY: "GB" } });
  const mb = await new FakeMusicBrainz(RELEASES).start();
  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, mbBaseUrl: mb.baseUrl });
  const ctx = await srv.start();
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token };
  const api = async (p, body, headers = {}) => {
    const r = await fetch(base + "/api/" + p, body ? { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H, headers), body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) } : { headers: H });
    return { status: r.status, ...(await r.json().catch(() => ({}))) };
  };
  const boot = async () => { try { return (await (await fetch(base + "/server-info")).json()).boot; } catch (e) { return null; } };
  try {
    await until(async () => { const s = await api("status"); return s.index_count === 3 && !s.scanning; }, 60000, "the library");
    const all = (await api("library/albums?sort=album&count=100")).albums;
    const sketches = all.find(a => a.title === "Sketches (Remastered)");
    const kobs = all.filter(a => a.title === "Kind of Blue");
    assert.equal(kobs.length, 1, "two versions, one tile");
    const page0 = await api("album?offset=" + kobs[0].offset);
    assert.equal(page0.versions.length, 2);
    const hdtt = page0.versions.find(v => v.year === 2015).offset;
    const row = async () => (await api("album?offset=" + hdtt)).versions.find(v => v.offset === hdtt);

    // Nothing matched: each field the files' (the title's version words, the tags).
    const c = (await api("album/edit?offset=" + sketches.offset)).version;
    assert.deepEqual(fields(c), { name: ["Remastered", "files", false], label: ["Label C", "files", false], catno: ["LC-1", "files", false],
      barcode: ["5012345678900", "files", false], country: ["GB", "files", false], year: [null, null, false], format: [null, null, false] });
    // A version name alone is an edit: Undo all edits is offered for it, and takes it.
    let s = await api("album/edit", { offset: sketches.offset, version: { name: "2009 Remaster" } });
    assert.deepEqual([s.version.name.value, s.version.name.edited, s.version.label.value, s.edited], ["2009 Remaster", true, "Label C", true]);
    s = await api("album/edit/reset", { offset: sketches.offset });
    assert.deepEqual([s.version.name.value, s.version.name.edited, s.edited], ["Remastered", false, false]);

    // The nearest pressing chosen by hand: its version details fill the section, from the match.
    let r = await api("identify/match", { offset: hdtt, query: "kob-blue", how: "pick" });
    assert.equal(r.status, 200, JSON.stringify(r));
    let ed = await api("album/edit?offset=" + hdtt);
    assert.deepEqual(fields(ed.version), { name: ["blue disc label", "match", false], label: ["Columbia", "match", false], catno: ["CL 1355", "match", false],
      barcode: ["0074646693528", "match", false], country: ["US", "match", false], year: ["1959", "match", false], format: ["12\" Vinyl", "match", false] });
    assert.equal((await row()).edition, "blue disc label");

    // Yours: the name, the label and the year; the rest sent as shown stay the match's.
    const mine = { name: "Deluxe stereo reissue HDTT", label: "HDTT", catno: "CL 1355", barcode: "0074646693528", country: "US", year: "2016", format: "12\" Vinyl" };
    assert.equal((await api("album/edit", { offset: hdtt, title: ed.title, artist: ed.artist, year: ed.year, version: Object.assign({}, mine, { year: "16" }) })).status, 400,
      "this pressing's year is four digits");
    r = await api("album/edit", { offset: hdtt, title: ed.title, artist: ed.artist, year: ed.year, version: mine });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.deepEqual([r.version.name.value, r.version.name.was, r.version.name.edited, r.version.catno.edited, r.edited], ["Deluxe stereo reissue HDTT", "blue disc label", true, false, true]);
    const key = ctx.db.raw.prepare("SELECT key FROM albums WHERE id = ?").get(hdtt).key;
    const kept = () => (ctx.db.raw.prepare("SELECT version FROM album_edits WHERE key = ?").get(key) || {}).version;
    assert.deepEqual(JSON.parse(kept()), { name: "Deluxe stereo reissue HDTT", label: "HDTT", year: "2016" }, "only what differs from the match is kept");
    // The Versions tab says your name and year, and so does its label.
    let v = await row();
    assert.deepEqual([v.edition, v.release_year, v.label], ["Deluxe stereo reissue HDTT", 2016, "Deluxe stereo reissue HDTT · 16/44.1"]);

    // A rescan keeps them.
    await api("library/rescan", {});
    await sleep(300);
    await until(async () => { const s = await api("status"); return s && !s.scanning; }, 60000, "the scan");
    assert.equal((await row()).edition, "Deluxe stereo reissue HDTT", "kept across a scan");
    assert.deepEqual(fields((await api("album/edit?offset=" + hdtt)).version).label, ["HDTT", "match", true]);

    // Another edition switched to: every field you left alone is its, yours stay.
    r = await api("identify/match", { offset: hdtt, query: "kob-mono", how: "edition" });
    assert.equal(r.status, 200, JSON.stringify(r));
    ed = await api("album/edit?offset=" + hdtt);
    assert.deepEqual(fields(ed.version), { name: ["Deluxe stereo reissue HDTT", "match", true], label: ["HDTT", "match", true], catno: ["SICP-31257", "match", false],
      barcode: [null, null, false], country: ["JP", "match", false], year: ["2016", "match", true], format: ["SACD", "match", false] });
    assert.equal(ed.version.name.was, "mono");
    // The edition kind learnt for the artist is the release's ("mono"), never your name's words.
    const kind = JSON.parse(ctx.db.raw.prepare("SELECT kind FROM edition_choices").get().kind);
    assert.deepEqual([kind.words, kind.country], [["mono"], "jp"]);

    // Put back: the match's word again, yours no more.
    r = await api("album/edit", { offset: hdtt, title: ed.title, artist: ed.artist, year: ed.year, version: Object.assign({}, mine, { name: "mono", catno: "SICP-31257", barcode: "", country: "JP", format: "SACD" }) });
    assert.deepEqual([r.version.name.value, r.version.name.edited, r.version.label.edited], ["mono", false, true]);
    assert.equal((await row()).edition, "mono");

    // A backup of the collection, then Undo all edits: the version is the match's again, nothing of yours kept.
    const file = await fetch(base + "/api/backup/file", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ include: ["collection"] }) });
    assert.equal(file.status, 200);
    const tar = Buffer.from(await file.arrayBuffer());
    r = await api("album/edit/reset", { offset: hdtt });
    assert.equal(r.status, 200, JSON.stringify(r));
    assert.ok(Object.values(r.version).every(f => !f.edited), JSON.stringify(r.version));
    assert.deepEqual([r.version.label.value, r.version.year.value, r.edited], ["Sony Music", "2019", false]);
    assert.equal(kept(), undefined);
    v = await row();
    assert.deepEqual([v.edition, v.release_year], ["mono", 2019]);

    // The backup put back: yours again.
    const boot0 = await boot();
    const back = await fetch(base + "/api/backup/restore?parts=collection", { method: "POST", headers: Object.assign({ "Content-Type": "application/gzip" }, H), body: tar });
    assert.equal(back.status, 200, await back.text());
    assert.deepEqual(JSON.parse(kept()), { label: "HDTT", year: "2016" });
    await until(async () => { const b = await boot(); return b && b !== boot0; }, 30000, "the restart");
    await until(async () => { const s = await api("status"); return s.index_count === 3 && !s.scanning; }, 60000, "the library again");
    assert.deepEqual(fields((await api("album/edit?offset=" + hdtt)).version).label, ["HDTT", "match", true]);
    assert.equal((await row()).release_year, 2016);
  } finally {
    await srv.stop();
    await mb.stop();
  }
});
