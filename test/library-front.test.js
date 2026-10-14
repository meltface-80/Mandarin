"use strict";
/*
 * The library read in C# (v0.8.4, server/Mandarin.Server/Library.cs): every
 * screen it answers gives what the Node server gave, asked the same thing —
 * then the library changes (a heart, Listen later, an edit, labels switched
 * on, a merge, a play) and it must still. Files are sent as the Node server
 * sent them, range for range; conversions and the phone's downloads are the
 * very files ffmpeg makes with the Node server's own arguments.
 *
 * Since v0.8.50 (stage 7) the Node server's side is a recording
 * (test/golden/library-node.json, test/golden.js), made through the C#
 * server with the Node server behind it while index.js was still there, each
 * answer put to both and the Node server's kept; every run starts the program
 * alone and holds it to the recording. What depends on the machine is kept by rule, not as it was there:
 * a file's length (ffmpeg's versions make the fixtures a few bytes apart) in
 * the range headers, said from the file's own; ETag and Last-Modified as send
 * makes them from the file; ffmpeg's arguments with this ffmpeg's resampler.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { spawnSync } = require("child_process");
const { gen, haveSoxr, haveFlac32, FFMPEG } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { built } = require("./server");
const { recording } = require("./golden");
const fs = require("fs");
const os = require("os");

const rec = recording("library-node");
const skip = built() || (!rec.exists() && "no recording of the Node server's answers");
const SOXR = haveSoxr();

function library() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-libfront-"));
  const music = path.join(root, "music");
  const one = (dir, file, tags, opts = {}) => gen(path.join(music, dir, file), Object.assign({ seconds: 1, tags }, opts));
  one("The Beatles/Abbey Road", "01 Come Together.flac", { title: "Come Together", artist: "The Beatles", album: "Abbey Road", track: 1, date: "1969-09-26", genre: "Rock", label: "Apple Records" });
  one("The Beatles/Abbey Road", "02 Something.flac", { title: "Something", artist: "The Beatles", album: "Abbey Road", track: 2, date: "1969-09-26", genre: "Rock", label: "Apple Records" });
  one("Beatles/Help", "01 Help.flac", { title: "Help!", artist: "Beatles", album: "Help!", track: 1, date: "1965", genre: "rock", label: "Parlophone" });
  one("Bjork/Homogenic", "01 Hunter.flac", { title: "Hunter", artist: "Björk", album: "Homogenic", track: 1, date: "1997", genre: "Electronic", label: "One Little Indian" });
  one("Simon/Bridge", "01 Bridge.flac", { title: "Bridge Over Troubled Water", artist: "Simon & Garfunkel", album: "Bridge Over Troubled Water", track: 1, date: "1970", genre: "Folk Rock", label: "Columbia" });
  one("Daft/Discovery", "01 One More Time.flac", { title: "One More Time", artist: "Daft Punk", album: "Discovery", track: 1, date: "2001-03", genre: "Dance; Electronic", label: "Virgin Records" });
  one("Miles/Kind of Blue", "01 So What.flac", { title: "So What", artist: "Miles Davis", album: "Kind of Blue", track: 1, date: "1959", genre: "Jazz", label: "Columbia Records" },
    { rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"] });
  one("Coltrane/A Love Supreme", "01 Acknowledgement.flac", { title: "Acknowledgement", artist: "John Coltrane feat. McCoy Tyner", album: "A Love Supreme", track: 1, date: "1965", genre: "Jazz", label: "Impulse!" });
  one("Box/Yes - The Remixes (2018)/Disc 1 - The Yes Album (1971)", "01 Yours.flac", { title: "Yours Is No Disgrace", artist: "Yes", album: "The Yes Album", track: 1, date: "1971", genre: "Prog Rock" });
  one("Box/Yes - The Remixes (2018)/Disc 2 - Fragile (1971)", "01 Roundabout.flac", { title: "Roundabout", artist: "Yes", album: "Fragile", track: 1, date: "1971", genre: "Prog Rock" });
  one("Comp/Now 1", "01 A.mp3", { title: "A", artist: "Daft Punk", album: "Now 1", album_artist: "Various Artists", track: 1, compilation: 1, date: "2001", genre: "Pop" }, { fmt: null, codecArgs: ["-b:a", "192k"] });
  one("Comp/Now 1", "02 B.mp3", { title: "B", artist: "Björk", album: "Now 1", album_artist: "Various Artists", track: 2, compilation: 1, date: "2001", genre: "Pop" }, { fmt: null, codecArgs: ["-b:a", "192k"] });
  // 24-bit WAV: repacked as FLAC, the samples exactly as they are (a cache name of its own).
  one("Misc/Studio", "01 Take.wav", { title: "Take", artist: "Studio", album: "Studio", track: 1, date: "2015" }, { fmt: null, codecArgs: ["-c:a", "pcm_s24le"] });
  one("Misc/Untitled", "01 x.flac", { title: "x", artist: "anonymous", album: "( )", track: 1 });
  return { root, music, data: path.join(root, "data") };
}

/* Each fixture's length, and each album's, said as the track or album it is (a download list names them; ffmpeg's versions make them a few bytes apart). */
const fileSizes = new Map();
/*
 * What changes from one run to the next made the same: the day, an id made new (a dynamic playlist's), a cover's
 * key (its hash the files' own, made afresh each run) and what follows from it — a speaker's signature, Shelf's
 * signature of the list — the port, a file's length, and Mandarin's version where an answer says it (Shelf's,
 * recorded as 0.8.50 and named here as the version this checkout is).
 */
const VERSION = require("../package.json").version;
const steady = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v, (k, x) => {
  if (k === "day" && typeof x === "string") return "<day>";
  if (k === "version" && x === VERSION) return "<Mandarin's version>";
  if (k === "size" && typeof x === "number" && fileSizes.has(x)) return fileSizes.get(x);
  if (k === "id" && typeof x === "string" && /^[0-9a-f]{12}$/.test(x)) return "<new id>";
  if (k === "sig" && typeof x === "string") return "<sig>";
  if (typeof x === "string") return x.replace(/\bal-(\d+)-[0-9a-f]{10}\b/g, "al-$1-<art>").replace(/([?&])s=[A-Za-z0-9_-]{22}(?=$|&|")/g, "$1s=<sig>").replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>");
  return x;
}));

/* A number in a header said from the file's own length when it is nearer the end (a file another ffmpeg made is a few bytes longer or shorter). */
const rel = (n, size) => n < size / 2 ? String(n) : "size-" + (size - n);
/* A file's answer as headers say it; past its end, the type and a HEAD's length aside (C# says length 0 to a HEAD, the Node server nothing). */
const shapeOf = (r, size, method) => {
  const h = (k) => r.headers.get(k);
  const s = {
    status: r.status, type: h("content-type"), ranges: h("accept-ranges"), cache: h("cache-control"),
    length: h("content-length") == null ? null : rel(Number(h("content-length")), size),
    range: h("content-range") == null ? null : h("content-range").replace(/\d+/g, d => rel(Number(d), size))
  };
  if (r.status === 416) { s.type = null; if (method === "HEAD") s.length = null; }
  return s;
};
/* The bytes a range of the file is: the whole file, or what Content-Range names; nothing to a HEAD. */
const sliceOf = (file, r, method) => {
  if (method === "HEAD") return Buffer.alloc(0);
  const m = /^bytes (\d+)-(\d+)\//.exec(r.headers.get("content-range") || "");
  return m ? file.subarray(Number(m[1]), Number(m[2]) + 1) : file;
};
/* send's ETag and Last-Modified for a file (Express): its length and time, in hex. */
const fileTag = (file) => { const st = fs.statSync(file); return { etag: `W/"${st.size.toString(16)}-${st.mtime.getTime().toString(16)}"`, modified: st.mtime.toUTCString() }; };
/* The same rule for a file whose path the test doesn't know (a cover drawn): the ETag's length the body's, Last-Modified the ETag's time. */
const tagged = (r, len, what) => {
  const m = /^W\/"([0-9a-f]+)-([0-9a-f]+)"$/.exec(r.headers.get("etag") || "");
  assert.ok(m, what + ": a weak ETag: " + r.headers.get("etag"));
  assert.equal(parseInt(m[1], 16), len, what + ": the ETag's length, the picture's");
  assert.equal(r.headers.get("last-modified"), new Date(parseInt(m[2], 16)).toUTCString(), what + ": Last-Modified, the ETag's time");
};

/*
 * The Node server's ffmpeg arguments for a conversion, recorded as a template (the file in and out marked, as an
 * ffmpeg with soxr asks), played back as this machine's ffmpeg has it or not.
 */
const argsFor = (tpl, input, out) => tpl.map(a => a === "<in>" ? input : a === "<out>" ? out : SOXR ? a : a.replace(/resampler=soxr:precision=\d+:/, ""));

test("the library in C# answers as the Node server did", { skip, timeout: 180000 }, async () => {
  const lib = library();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  // The database, read straight.
  const raw = ctx.db.raw;
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    await fetch(B + "/api/settings/shelf", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ enabled: true }) });   // a new install: Shelf off until switched on (v1.0.2)
    for (let i = 0; i < 300; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count > 0 && !st.scan.running) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const JH = Object.assign({ "Content-Type": "application/json" }, H);
    const post = async (p, body) => { const r = await fetch(B + p, { method: "POST", headers: JH, body: JSON.stringify(body) }); assert.equal(r.status, 200, p); return r.json(); };
    const getJ = async (p) => (await fetch(B + p, { headers: H })).json();

    const ids = (await getJ("/api/library/albums?count=200")).albums.map(a => a.offset);
    assert.equal(ids.length, 12, "the library read");
    for (const t of raw.prepare("SELECT id, size FROM tracks ORDER BY id").all()) if (t.size > 1000 && !fileSizes.has(t.size)) fileSizes.set(t.size, "<the length of t" + t.id + ">");
    for (const a of raw.prepare("SELECT album_id, SUM(size) AS size FROM tracks GROUP BY album_id ORDER BY album_id").all()) if (a.size > 1000 && !fileSizes.has(a.size)) fileSizes.set(a.size, "<the length of album " + a.album_id + ">");
    /* The same question: the C# server's answer, the Node server's as recorded (or asked now). */
    const same = async (p, label = "", step = p) => {
      const c = await fetch(B + p, { headers: H });
      const cj = await c.json();
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", label + p + ": answered by C#");
      const want = await rec.want(label + step);
      assert.equal(c.status, want.status, label + p + ": the same status");
      assert.deepStrictEqual(steady(cj), want.j, label + p + ": the same answer");
      return cj;
    };
    const battery = async (label) => {
      const qs = ["", "?sort=artist", "?sort=year&dir=desc", "?sort=year", "?sort=added&dir=desc", "?sort=random&seed=42", "?sort=plays&dir=desc",
        "?sort=lastplayed", "?genre=Rock", "?genre=!Rock&genre=Jazz", "?decade=1960", "?format=FLAC&rate=96000", "?bits=24", "?letter=A",
        "?added=7", "?prefix=the", "?prefix=b", "?played=never", "?played=played", "?played=6", "?label=Columbia", "?offset=3&count=2", "?count=0"];
      for (const q of qs) await same("/api/library/albums" + q, label);
      await same("/api/library/facets", label);
      for (const q of ["beatles", "the beatles", "bjork", "björk", "abbey", "abby rd", "a", "jazz", "dark moon", "simon garfunkel", "&", "columbia", "  ", "zzzz", "kndblue"])
        await same("/api/search?q=" + encodeURIComponent(q), label);
      for (const q of ["", "?sort=albums", "?sort=random&seed=7", "?offset=2&limit=3"]) await same("/api/artists" + q, label);
      for (const a of ["The Beatles", "Beatles", "Björk", "Daft Punk", "McCoy Tyner", "Garfunkel", "nobody"]) await same("/api/artist-albums?artist=" + encodeURIComponent(a), label);
      await same("/api/artist-albums", label);
      for (const id of ids) await same("/api/album?offset=" + id, label);
      await same("/api/album?offset=999999", label);
      await same("/api/album", label);
      for (const p of ["/api/filters/genres", "/api/filters/decades", "/api/favourites", "/api/listen-later", "/api/home/genre-groups", "/api/library-stats",
        "/api/random-albums?seed=3&count=5", "/api/random-albums?seed=3&filter_type=genre&filter_value=rock", "/api/random-albums?seed=1&filter_type=decade&filter_value=1960"])
        await same(p, label);
      // Shelf (/shelf): the whole list, and "the same" for the signature it gave.
      const shelf = await same("/api/shelf/albums", label);
      assert.equal(shelf.albums.length, ids.length, label + "the shelf holds the library");
      assert.deepStrictEqual(await same("/api/shelf/albums?sig=" + shelf.sig, label, "/api/shelf/albums?sig=<sig>"), { same: true, sig: shelf.sig });
      await same("/api/shelf/albums?sig=0000000000000000", label);
      // Home's rows (v0.8.6).
      for (const p of ["/api/home/album-of-the-day", "/api/home/label-of-the-week", "/api/home/history", "/api/home/history?count=1"]) await same(p, label);
      for (const q of ["", "?months=1&count=3", "?months=0", "?months=99&count=500"]) {
        const shape = j => ({ n: j.albums.length, total: j.total, months: j.months, no_history: j.no_history, ready_at: j.ready_at });
        const want = await rec.want(label + "/api/home/unplayed" + q);
        assert.deepStrictEqual(shape(await getJ("/api/home/unplayed" + q)), want, label + "/api/home/unplayed" + q);
      }
      // Drawn at random: the same pool, whichever answers.
      const r = await getJ("/api/random-albums?count=4");
      assert.equal(r.albums.length, 4);
      assert.equal(r.total, ids.length);
    };

    // The day's album fixed for the recording: Abbey Road kept as today's (the setting album_of_the_day, which both servers keep it in).
    const day = (await getJ("/api/home/album-of-the-day")).day;
    const abbeyRoad = raw.prepare("SELECT id, key FROM albums WHERE title = 'Abbey Road'").get();
    ctx.db.setSetting("album_of_the_day", { day, key: abbeyRoad.key, id: abbeyRoad.id, at: 1 });
    await battery("as scanned: ");
    // The library changes: hearts, Listen later and labels made by C# (v0.8.16); the Node server's copy told (recording).
    const change = async (p, body, method = "POST") => {
      const r = await fetch(B + p, { method, headers: JH, body: body === undefined ? undefined : JSON.stringify(body) });
      assert.equal(r.headers.get("x-mandarin-answered"), "C#", p + ": made by C#");
      return { status: r.status, body: await r.json() };
    };
    assert.deepEqual(await change("/api/favourites", { offset: ids[2], on: true }), { status: 200, body: { ok: true, offset: ids[2], favourite: true } });
    assert.deepEqual((await change("/api/favourites", { offset: ids[0], on: 1 })).body, { ok: true, offset: ids[0], favourite: true });
    assert.deepEqual(await change("/api/favourites", { offset: 99999, on: true }), { status: 404, body: { error: "That album is no longer in the library" } });
    // Two hearts a request apart can still share a millisecond: a millisecond apart, the later one newer.
    const favAt = raw.prepare("SELECT MIN(added_at) AS t FROM favourites").get().t;
    [ids[2], ids[0]].forEach((id, k) => raw.prepare("UPDATE favourites SET added_at = ? WHERE key = (SELECT key FROM albums WHERE id = ?)").run(favAt + k, id));
    assert.deepEqual((await change("/api/listen-later", { offsets: [ids[1], ids[4], 99999], on: true })).body, { ok: true, offset: ids[4], later: true, count: 2 });
    // Written in one request, the two can share a millisecond or not (the list is newest first, a tie in the library's order):
    // a millisecond apart, as they were written, so the answer is the same on any machine.
    const laterAt = raw.prepare("SELECT MIN(added_at) AS t FROM listen_later").get().t;
    [ids[1], ids[4]].forEach((id, i) => raw.prepare("UPDATE listen_later SET added_at = ? WHERE key = (SELECT key FROM albums WHERE id = ?)").run(laterAt + i, id));
    await ctx.library.reload();
    await post("/api/album/edit", { offset: ids[3], title: "Edited Title", artist: "The Edited", year: 1988 });
    assert.deepEqual((await change("/api/settings/labels", {})).body, { error: "enabled required" });
    assert.deepEqual((await change("/api/settings/labels", { enabled: true })).body, { ok: true, enabled: true });
    assert.deepEqual(await change("/api/labels/merge", { items: [{ key: "columbia" }] }), { status: 400, body: { error: "Two or more labels are needed" } });
    assert.deepEqual((await change("/api/labels/merge", { items: [{ key: "columbia", display: "Columbia" }, { key: "impulse", display: "Impulse!" }, { key: "BAD!" }] })).body,
      { ok: true, target: "columbia", merged: ["impulse"] });
    assert.deepEqual(await change("/api/settings/label-folder-depth", { depth: 9 }), { status: 400, body: { ok: false, error: "depth must be 0–6" } });
    assert.deepEqual((await change("/api/settings/label-folder-depth", { depth: "0" })).body, { ok: true, depth: 0, rescanning: false });
    const now = Date.now();
    const ins = raw.prepare("INSERT INTO plays(album_id, track_id, ts) VALUES(?, NULL, ?)");
    ins.run(ids[5], now - 1000); ins.run(ids[5], now - 2000); ins.run(ids[6], now - 400 * 86400000);
    await battery("after changes: ");
    // Album of the day, played today: gone from Home.
    const today = await same("/api/home/album-of-the-day");
    assert.equal(today.album && today.album.offset, abbeyRoad.id, "the day's album, as kept");
    ins.run(today.album.offset, Date.now());
    const after = await same("/api/home/album-of-the-day");
    assert.deepEqual([after.album, after.played], [null, true]);
    const week = await same("/api/home/label-of-the-week");
    assert.ok(week.label && week.albums.length >= 3, "a label of the week, labels on");
    // A merge let go, by C#; one that isn't there, said so.
    assert.deepEqual(await change("/api/labels/merge/nothing", undefined, "DELETE"), { status: 404, body: { error: "Not a merged label" } });
    assert.deepEqual(await change("/api/labels/merge/impulse", undefined, "DELETE"), { status: 200, body: { ok: true } });
    await same("/api/library/facets", "unmerged: ");
    await post("/api/labels/merge", { items: [{ key: "columbia", display: "Columbia" }, { key: "impulse", display: "Impulse!" }] });
    // Settings kept and read (v0.8.7).
    for (const p of ["/api/settings/display", "/api/settings/smart-picks", "/api/settings/home-rows"]) await same(p, "as set: ");
    let r = await post("/api/settings/display", { enabled: false, seconds: "30" });
    assert.deepEqual(r, { ok: true, enabled: false, seconds: 30 });
    r = await post("/api/settings/display", { seconds: 99 });
    assert.equal(r.seconds, 30, "out of range: kept");
    r = await post("/api/settings/smart-picks", { hour: "7.9", enabled: 0 });
    assert.deepEqual([r.hour, r.enabled], [7, false]);
    assert.equal((await fetch(B + "/api/settings/smart-picks", { method: "POST", headers: JH, body: JSON.stringify({ hour: 24 }) })).status, 400);
    r = await post("/api/settings/home-rows", { rows: [{ id: "random" }, { id: "history", on: false }, { id: "nope" }, { id: "random" }] });
    assert.deepEqual(r.rows.slice(0, 4).map(x => x.id), ["downloads", "phone", "random", "history"], "the app's rows at the top, then as given");
    assert.equal((await fetch(B + "/api/settings/home-rows", { method: "POST", headers: JH, body: JSON.stringify({ rows: [{ id: "x" }] }) })).status, 400);
    for (const p of ["/api/settings/display", "/api/settings/smart-picks", "/api/settings/home-rows"]) await same(p, "after saving: ");
    // Dynamic playlists (saved Library views): made, then read; their ids new each time.
    const mk = b => post("/api/smart-playlists", b).then(x => x.playlist);
    const a1 = await mk({ name: "Jazz", view: { genre: ["Jazz"], sort: "year", dir: "desc" }, limit: 3 });
    const a2 = await mk({ name: " Shuffled ", view: { sort: "random", seed: 9, decade: "1960", genre: ["!Pop", 7, null, {}] }, order: "random", mode: "tracks" });
    await mk({ name: "All", view: "nonsense", limit: "9999" });
    const lists = await same("/api/smart-playlists");
    assert.deepEqual(lists.playlists.map(x => x.name), ["Jazz", "Shuffled", "All"], "made");
    for (const [n, sp] of [[1, a1], [2, a2]]) {
      for (const q of ["", "&offset=1&count=1", "&count=99"]) await same("/api/smart-playlist?id=" + sp.id + q, "", "/api/smart-playlist?id=<" + n + ">" + q);
      for (const q of ["", "&max=1", "&max=0"]) await same("/api/smart-playlist/albums?id=" + sp.id + q, "", "/api/smart-playlist/albums?id=<" + n + ">" + q);
    }
    await same("/api/smart-playlist?id=nope");
    await same("/api/smart-playlist/albums");
    // Your own playlists (v0.8.8): each change made from the same saved state; the answer and what was saved
    // the Node server's (new ids and times aside).
    const one = await getJ("/api/album?offset=" + ids[0]);
    const start = [
      { id: "p1", name: "Kept", tracks: [{ album_offset: ids[0], album_title: one.album.title, album_subtitle: one.album.subtitle, track_index: 0, title: one.tracks[0].title, subtitle: "", image_key: one.album.image_key, track_no: 1 }], created_at: 1, updated_at: 2, extra: "kept as is" },
      { id: "q1", name: "From Qobuz", service: "qobuz", tracks: [], created_at: 1, updated_at: 1 },
      { id: "p2", name: "Empty", tracks: [], created_at: 1, updated_at: 3 }
    ];
    const norm = v => JSON.parse(JSON.stringify(v), (k, x) => (k === "created_at" || k === "updated_at") && x > 1e12 ? "now"
      : k === "id" && typeof x === "string" && /^[0-9a-f]{12}$/.test(x) ? "new" : x);
    const made = async (base, p, body) => {
      ctx.db.setSetting("userPlaylists", start);
      const x = await fetch(base + p, { method: "POST", headers: JH, body: JSON.stringify(body) });
      return { by: x.headers.get("x-mandarin-answered"), status: x.status, body: steady(norm(await x.json())), saved: steady(norm(ctx.db.setting("userPlaylists", null))) };
    };
    const both = async (p, body) => {
      const mine = await made(B, p, body);
      assert.equal(mine.by, "C#", p + " answered by C#");
      const want = await rec.want("your playlists: " + p + " " + JSON.stringify(body).slice(0, 120));
      assert.deepStrictEqual({ status: mine.status, body: mine.body, saved: mine.saved }, want, p + " " + JSON.stringify(body).slice(0, 120));
      return mine;
    };
    ctx.db.setSetting("userPlaylists", start);
    for (const p of ["/api/user-playlists", "/api/user-playlist?id=p1", "/api/user-playlist?id=q1", "/api/user-playlist?id=nope", "/api/playlists", "/api/playlist?id=x"]) await same(p);
    await both("/api/user-playlists", { name: "  Late   Night  " });
    await both("/api/user-playlists", { name: "" });
    await both("/api/user-playlists", { id: "p2", name: "Renamed" });
    await both("/api/user-playlists", { id: "nope", name: "X" });
    await both("/api/user-playlists/delete", { id: "p1" });
    await both("/api/user-playlists/delete", { id: "q1" });
    const t0 = one.tracks[0], t1 = one.tracks[1] || one.tracks[0];
    await both("/api/user-playlists/add", { id: "p1", tracks: [
      { album_offset: ids[0], album_title: one.album.title, track_index: 0, title: "  " + t0.title + "  " },
      { album_offset: ids[0], title: t1.title },
      { album_offset: ids[0], track_index: 0, title: "not on it" },
      { album_title: one.album.title, album_subtitle: one.album.subtitle, title: t0.title },
      { album_title: "Nothing Like It", title: "x" },
      { album_offset: "999999", track_index: 0 }, null, 5, "x", {}, []
    ] });
    await both("/api/user-playlists/add", { name: "Made by adding", tracks: [{ album_offset: ids[1], track_index: 0, title: "" }] });
    await both("/api/user-playlists/add", { id: "nope", tracks: [{}] });
    await both("/api/user-playlists/add", { tracks: [{}] });
    await both("/api/user-playlists/add", { id: "p1", tracks: [] });
    await both("/api/user-playlists/add-albums", { id: "p2", albums: [{ offset: ids[2] }, { offset: ids[3], title: "x" }, { offset: 999999, title: "Gone" }, 5, null, {}] });
    await both("/api/user-playlists/add-albums", { name: "Albums", albums: ids.slice(0, 3).map(offset => ({ offset })) });
    await both("/api/user-playlists/add-albums", { id: "p1", albums: [] });
    ctx.db.setSetting("userPlaylists", []);
    const fav = await same("/api/favourites");
    assert.deepEqual(fav.albums.map(a => a.offset), [ids[0], ids[2]], "hearts, newest first");
    const s = await same("/api/search?q=columbia");
    assert.ok(s.labels.length >= 1, "labels found by search once on");

    // Covers (v0.8.5): drawn the first time, sent from the cache after, as send sends a file.
    const albums = (await getJ("/api/library/albums?count=200")).albums;
    for (const al of albums) {
      const p = "/api/image/" + al.image_key + "?size=300";
      const first = await fetch(B + p, { headers: H });
      assert.equal(first.status, 200, p);
      const drawn = Buffer.from(await first.arrayBuffer());
      const c = await fetch(B + p, { headers: H });
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", p + ": a cover already drawn, sent by C#");
      assert.deepEqual(Buffer.from(await c.arrayBuffer()), drawn, p + ": the same picture");
      tagged(c, drawn.length, p);
      const want = await rec.want("cover: " + al.title);
      assert.deepEqual({ type: c.headers.get("content-type"), cache: c.headers.get("cache-control") }, want, p + ": its type and caching");
      assert.equal((await fetch(B + p, { headers: Object.assign({ "If-None-Match": c.headers.get("etag") }, H) })).status, 304);
      // An address from before a cover change: the current cover, not kept.
      const old = await fetch(B + "/api/image/al-" + al.offset + "-stale?size=300", { headers: H });
      assert.equal(old.headers.get("x-mandarin-answered"), "C#");
      assert.equal(old.headers.get("cache-control"), "no-cache");
      assert.deepEqual(Buffer.from(await old.arrayBuffer()), drawn, "an old address: the current cover");
    }
    const key = albums[0].image_key;
    const signed = ctx.auth.signUrl("/api/image/" + key) + "&size=300";
    let x = await fetch(B + signed);
    assert.deepEqual([x.status, x.headers.get("x-mandarin-answered")], [200, "C#"], "a signed address, with no sign-in (a speaker)");
    x = await fetch(B + "/api/image/" + key + "?size=300");
    assert.equal(x.status, 401, "neither signed nor signed in: still refused");
    x = await fetch(B + "/api/image/" + key + "?size=300&s=" + "A".repeat(22));
    assert.equal(x.status, 401, "a wrong signature: refused");
    // A label's logo, as kept in <data>/labels.
    const logo = Buffer.from("89504e470d0a1a0a", "hex");
    fs.mkdirSync(path.join(lib.data, "labels"), { recursive: true });
    fs.writeFileSync(path.join(lib.data, "labels", "columbia.png"), logo);
    raw.prepare("INSERT INTO label_logos(key, file, type, source, url, updated_at) VALUES('columbia', 'columbia.png', 'image/png', 'manual', NULL, 1)").run();
    const lc = await fetch(B + "/api/image/label-columbia?v=1", { headers: H });
    assert.deepEqual([lc.status, lc.headers.get("x-mandarin-answered"), lc.headers.get("content-type")], [200, "C#", "image/png"]);
    assert.deepEqual(Buffer.from(await lc.arrayBuffer()), logo);
    const logoCache = await rec.want("a label's logo");
    assert.equal(lc.headers.get("cache-control"), logoCache);
    assert.equal((await fetch(B + "/api/image/label-nobody", { headers: H })).status, 404, "no such logo");

    // Music files sent as they are (v0.8.9): byte for byte and range for range as the Node server sent them.
    let sentByCsharp = 0, converted = 0;
    for (const id of ids) {
      const page = await getJ("/api/album?offset=" + id);
      for (const tr of page.tracks) {
        const row = raw.prepare("SELECT path FROM tracks WHERE id = ?").get(tr.track_id);
        const file = fs.readFileSync(row.path);
        const tag = fileTag(row.path);
        const ext = path.extname(row.path).slice(1).toLowerCase();
        for (const addr of ["/stream/t" + tr.track_id + "." + ext, "/stream/t" + tr.track_id + ".orig." + ext, "/stream/t" + tr.track_id + ".orig.dsf?m=audio/x-dsf"]) {
          const plain = await fetch(B + addr, { headers: H });
          const body = Buffer.from(await plain.arrayBuffer());
          assert.equal(plain.headers.get("x-mandarin-answered"), "C#", addr + ": sent by C#, as it is or converted");
          // A conversion, made as it is sent (no length yet): checked on its own below.
          if (!plain.headers.get("content-length")) { converted++; assert.ok(/\.(flac|mp3|wav)$/.test(addr) && !addr.includes(".orig."), addr + ": only a Sonos address is converted"); continue; }
          sentByCsharp++;
          if (!addr.includes(".dsf")) assert.deepEqual(body, file, addr + ": the file itself");
          for (const range of [null, "bytes=0-99", "bytes=100-199", "bytes=-50", "bytes=1000-", "bytes=99999999-", "bytes=5-2"]) {
            for (const method of ["GET", "HEAD"]) {
              const h = Object.assign(range ? { Range: range } : {}, H);
              const c = await fetch(B + addr, { method, headers: h });
              const what = method + " " + addr + " " + (range || "whole");
              const cb = Buffer.from(await c.arrayBuffer());
              assert.equal(c.headers.get("x-mandarin-answered"), "C#", what);
              const want = await rec.want("file: " + what);
              assert.deepEqual(shapeOf(c, file.length, method), want, what + ": status and headers");
              assert.deepEqual([c.headers.get("etag"), c.headers.get("last-modified")], [tag.etag, tag.modified], what + ": ETag and Last-Modified, the file's");
              if (c.status < 300) assert.deepEqual(cb, sliceOf(file, c, method), what + ": the bytes");
            }
          }
          assert.equal((await fetch(B + addr, { headers: Object.assign({ "If-None-Match": plain.headers.get("etag") }, H) })).status, 304);
        }
      }
    }
    assert.ok(sentByCsharp >= 20 && converted >= 1, `files sent by C# (${sentByCsharp}) and conversions made by C# (${converted})`);
    const tid = (await getJ("/api/album?offset=" + ids[0])).tracks[0].track_id;
    const tpath = raw.prepare("SELECT path FROM tracks WHERE id = ?").get(tid).path;
    const s1 = ctx.auth.signUrl("/stream/t" + tid + ".orig" + path.extname(tpath));
    x = await fetch(B + s1);
    assert.deepEqual([x.status, x.headers.get("x-mandarin-answered")], [200, "C#"], "a signed address, no sign-in (a speaker)");
    await x.arrayBuffer();
    x = await fetch(B + "/stream/t" + tid + ".orig" + path.extname(tpath));
    assert.equal(x.status, 401, "neither signed nor signed in: refused");
    // A ReplayGain is converted here too since v0.8.40 (test/Mandarin.Tests/ConversionsCsharpTests.cs).
    x = await fetch(B + "/stream/t" + tid + ".flac?g=-3", { headers: H });
    assert.equal(x.headers.get("x-mandarin-answered"), "C#", "with a ReplayGain: converted by C#");
    await x.arrayBuffer();
    // A track that isn't there: the Node server's 404 (passed on to it while it was there; said here alone, Streams.cs).
    x = await fetch(B + "/stream/t999999.flac", { headers: H });
    assert.deepEqual([x.status, x.headers.get("x-mandarin-answered")], [404, "C#"], "no such track");
    await x.arrayBuffer();

    // Conversions (v0.8.11): made by C# as they are sent, then from the cache, range for range; the very file
    // ffmpeg makes with the Node server's own arguments (lib/stream.js), byte for byte.
    const rowOf = title => raw.prepare("SELECT * FROM tracks WHERE title = ?").get(title);
    /* The Node server's plan and arguments for a track's conversion, recorded. */
    const nodePlan = (title) => rec.want("conversion: " + title);
    const nodeMade = (t, tpl, name) => {
      const out = path.join(lib.root, "node-made-" + t.id + "-" + name);
      const r = spawnSync(FFMPEG, argsFor(tpl, t.path, out));
      assert.equal(r.status, 0, String(r.stderr));
      return fs.readFileSync(out);
    };
    const conversions = [];
    for (const [title, ext, plan] of [["So What", "flac"], ["Take", "wav"], ["Something", "44100-24.flac", { transcode: true, hq: true, rate: 44100, bits: 24 }]]) {
      const t = rowOf(title), np = await nodePlan(title, plan);
      if (title === "Take") assert.equal(np.plan.exact, true, "the WAV is a repack, the same samples");
      // 24/96: the 24/48 rule; a 24-bit WAV: repacked; what a streamer was promised.
      conversions.push({ addr: "/stream/t" + t.id + "." + ext, made: nodeMade(t, np.args, ext + ".flac") });
    }
    for (const { addr, made } of conversions) {
      let c = await fetch(B + addr, { headers: H });
      assert.equal(c.status, 200, addr);
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", addr + ": converted by C#");
      const first = Buffer.from(await c.arrayBuffer());
      assert.deepEqual(first, made, addr + ": the same file ffmpeg makes with the Node server's arguments");
      for (const range of [null, "bytes=0-99", "bytes=500-1499", "bytes=-64"]) {
        const h = Object.assign(range ? { Range: range } : {}, H);
        c = await fetch(B + addr, { headers: h });
        const cb = Buffer.from(await c.arrayBuffer());
        const what = addr + " " + (range || "whole");
        assert.equal(c.headers.get("x-mandarin-answered"), "C#", what + ": once made, sent by C# from the cache");
        const want = await rec.want("converted: " + what);
        assert.deepEqual(shapeOf(c, first.length, "GET"), want, what + ": status and headers");
        assert.deepEqual(cb, sliceOf(first, c, "GET"), what + ": the bytes");
        if (!range) assert.deepEqual(cb, first, what + ": what was made the first time");
      }
    }
    // The Node server's "make these next" (a queue being played): handed to C# while it was there (recording).
    // The phone's downloads and its Opus away (v0.8.12): made by C#, the same audio as ffmpeg makes with the
    // Node server's arguments (Opus compared decoded: its Ogg wrapper is numbered afresh each time).
    const decoded = file => spawnSync(FFMPEG, ["-v", "error", "-i", file, "-f", "f32le", "-"], { maxBuffer: 1 << 28 }).stdout;
    const decodedBuf = buf => { const f = path.join(lib.root, "decode-" + Date.now() + ".opus"); fs.writeFileSync(f, buf); return decoded(f); };
    /* The Node server's plan for a download (lib/server/downloads.js): its type, its cache name, its arguments; recorded. */
    const dlPlan = async (t, quality) => {
      const d = await rec.want("download: " + t.title + " " + quality);
      return Object.assign({}, d, { key: d.key.replace("<id>-<mtime>-", `${t.id}-${Math.floor(Number(t.mtime) || 0)}-`) });
    };
    const nodeDownload = (t, d) => {
      const out = path.join(lib.root, "node-dl-" + t.id + "." + d.plan.ext);
      const run = spawnSync(FFMPEG, argsFor(d.args, t.path, out));
      assert.equal(run.status, 0, String(run.stderr));
      return out;
    };
    for (const title of ["So What", "Take", "Hunter", "A"]) {
      const t = rowOf(title);
      for (const quality of ["original", "opus"]) {
        const addr = "/api/download/t" + t.id + "?quality=" + quality;
        const c = await fetch(B + addr, { headers: H });
        const body = Buffer.from(await c.arrayBuffer());
        assert.equal(c.status, 200, addr);
        assert.equal(c.headers.get("x-mandarin-answered"), "C#", addr + ": made and sent by C#");
        const d = await dlPlan(t, quality);
        assert.equal(c.headers.get("x-download-ext"), d.plan.ext, addr);
        assert.equal(c.headers.get("content-type"), d.plan.mime, addr);
        if (d.plan.file) { assert.deepEqual(body, fs.readFileSync(t.path), addr + ": the file itself"); continue; }
        // Kept under the Node server's own name for it.
        const kept = path.join(lib.data, "download-cache", d.key + "." + d.plan.ext);
        assert.deepEqual(body, fs.readFileSync(kept), addr + ": kept under the Node server's name");
        const theirs = nodeDownload(t, d);
        if (quality === "opus") assert.deepEqual(decoded(kept), decoded(theirs), addr + ": the same Opus audio");
        else assert.deepEqual(body, fs.readFileSync(theirs), addr + ": the same FLAC, byte for byte");
        // A range of it.
        const rc = await fetch(B + addr, { headers: Object.assign({ Range: "bytes=100-299" }, H) });
        assert.equal(rc.status, 206);
        assert.deepEqual(Buffer.from(await rc.arrayBuffer()), body.subarray(100, 300));
      }
    }
    // Away from home: the track as Opus, from the same cache, the album's next ones made ready.
    const away = rowOf("Come Together"), awayNext = rowOf("Something");
    let o = await fetch(B + "/stream/t" + away.id + ".flac?q=opus", { headers: H });
    assert.deepEqual([o.status, o.headers.get("x-mandarin-answered"), o.headers.get("content-type")], [200, "C#", "audio/ogg"]);
    const opusBody = Buffer.from(await o.arrayBuffer());
    const awayPlan = await dlPlan(away, "opus");
    assert.ok(decoded(path.join(lib.data, "download-cache", awayPlan.key + ".opus")).length > 0, "kept under the Node server's name");
    assert.deepEqual(decoded(nodeDownload(away, awayPlan)), decodedBuf(opusBody), "the same Opus audio as the Node server's arguments make");
    const nextFile = path.join(lib.data, "download-cache", (await dlPlan(awayNext, "opus")).key + ".opus");
    for (let i = 0; i < 100 && !fs.existsSync(nextFile); i++) await new Promise(res => setTimeout(res, 100));
    assert.ok(fs.existsSync(nextFile), "the album's next track made ready behind it");
    o = await fetch(B + "/api/download/t999999", { headers: H });
    assert.deepEqual([o.status, (await o.json()).error], [404, "That track is no longer in the library"]);

    // The phone's download lists (v0.8.26), ReplayGain's sums among them.
    const abbey = rowOf("Come Together"), something = rowOf("Something");
    raw.prepare("INSERT OR REPLACE INTO track_loudness(track_id, lufs, peak, measured_at) VALUES(?, ?, ?, 1)").run(abbey.id, -9.37, 0.81);
    raw.prepare("INSERT OR REPLACE INTO track_loudness(track_id, lufs, peak, measured_at) VALUES(?, ?, ?, 1)").run(something.id, -13.113, 0.47);
    raw.prepare("UPDATE tracks SET rg_track_gain = -4.25, rg_track_peak = 0.9 WHERE id = ?").run(rowOf("Hunter").id);
    for (const id of ids) for (const q of ["", "&quality=opus", "&quality=nonsense"]) await same("/api/download/album?offset=" + id + q, "download list: ");
    await same("/api/download/album?offset=999999", "download list: ");
    for (const q of ["?aotd=1&recent=5", "?picks=1&aotd=true&recent=50", "?recent=abc", "?recent=-3&aotd=0", ""]) await same("/api/download/auto" + q, "automatic downloads: ");
    const samePost = async (p, body, label) => {
      const opts = { method: "POST", headers: JH, body: JSON.stringify(body) };
      const c = await fetch(B + p, opts);
      const cj = await c.json();
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", label + p + ": answered by C#");
      const want = await rec.want(label + p + " " + JSON.stringify(body).slice(0, 80));
      assert.equal(c.status, want.status, label + p + ": the same status");
      assert.deepStrictEqual(steady(cj), want.j, label + p + ": the same answer");
      return cj;
    };
    await samePost("/api/download/albums", { ids: ids.concat([999999, String(ids[0]), null, 1.5, "x", true]) }, "the phone's albums: ");
    await samePost("/api/download/albums", {}, "the phone's albums: ");
    // What was left to the Node server until v0.8.48 (stage 5 part 3): a streamed album's list (its tracks
    // planned as FLAC; each then refused), a file gone from the disk, and what Express refused with its own
    // error page (ids or plays that can't be read as a list).
    {
      const at0 = Date.now();
      raw.prepare(`INSERT INTO albums(key, title, artist, dir, track_count, added_at, updated_at) VALUES('qobuz:77', 'Q', 'QA', 'qobuz://album/77', 2, ?, ?)`).run(at0, at0);
      const qal = raw.prepare("SELECT id FROM albums WHERE key = 'qobuz:77'").get().id;
      for (const [n, rate] of [[1, 44100], [2, 96000]]) raw.prepare(`INSERT INTO tracks(album_id, path, mtime, size, title, track_no, duration, sample_rate, bits, channels) VALUES(?, ?, 0, 0, ?, ?, 181.5, ?, 24, 2)`).run(qal, "qobuz://track/77" + n, "Q" + n, n, rate);
      await ctx.library.reload();
      for (const q of ["", "&quality=opus"]) await same("/api/download/album?offset=" + qal + q, "a streamed album's download list: ");
      const qt = raw.prepare("SELECT id FROM tracks WHERE path = 'qobuz://track/771'").get().id;
      const answer = async (base, p, init = {}) => {
        const res = await fetch(base + p, Object.assign({ headers: H }, init));
        return { status: res.status, by: res.headers.get("x-mandarin-answered") || "Node", type: res.headers.get("content-type"), ext: res.headers.get("x-download-ext"),
          cache: res.headers.get("cache-control"), csp: res.headers.get("content-security-policy"), body: await res.text() };
      };
      const theirs = (label) => rec.want(label);
      let c = await answer(B, "/api/download/t" + qt);
      let n = await theirs("a streamed track", "/api/download/t" + qt);
      assert.deepEqual([c.status, c.by, JSON.parse(c.body)], [403, "C#", { error: "Streamed tracks can't be downloaded" }]);
      assert.deepEqual([c.status, c.body], [n.status, n.body], "a streamed track refused, as the Node server refuses it");
      // A file gone: an MP3 the phone plays as it is, named in the library but not on the disk.
      const hunter = rowOf("Hunter");
      raw.prepare(`INSERT INTO tracks(album_id, path, mtime, size, title, track_no, duration, codec, sample_rate, bits, channels) VALUES(?, ?, 0, 0, 'Gone', 9, 1, 'MPEG 1 Layer 3', 44100, 16, 2)`)
        .run(hunter.album_id, path.join(lib.music, "Bjork", "Homogenic", "09 Gone.mp3"));
      const gone = raw.prepare("SELECT id FROM tracks WHERE title = 'Gone'").get().id;
      c = await answer(B, "/api/download/t" + gone + "?quality=original");
      n = await theirs("a file gone", "/api/download/t" + gone + "?quality=original");
      assert.equal(c.by, "C#");
      for (const k of ["status", "type", "ext", "cache", "body"]) assert.deepEqual(c[k], n[k], "a file gone: " + k);
      assert.equal(c.status, 404);
      raw.prepare("DELETE FROM tracks WHERE id = ?").run(gone);
      await ctx.library.reload();
      // Express's 500, as in the image (NODE_ENV=production: no stack in the page).
      const page = "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<title>Error</title>\n</head>\n<body>\n<pre>Internal Server Error</pre>\n</body>\n</html>\n";
      for (const [p, body] of [["/api/download/albums", { ids: "12" }], ["/api/download/albums", { ids: { 0: 1 } }], ["/api/phone/plays", { plays: { track_id: abbey.id } }], ["/api/phone/plays", { plays: true }]]) {
        const init = { method: "POST", headers: JH, body: JSON.stringify(body) };
        c = await answer(B, p, init);
        n = await theirs("Express's 500: " + p + " " + JSON.stringify(body).replace(String(abbey.id), "<id>"), p, init);
        assert.deepEqual([c.status, c.by, c.type, c.csp, c.body], [500, "C#", "text/html; charset=utf-8", "default-src 'none'", page], p + " " + JSON.stringify(body));
        assert.deepEqual([n.status, n.type, n.csp], [500, "text/html; charset=utf-8", "default-src 'none'"], "the Node server's: " + p);
      }
      // Text for plays is read letter by letter there: none of them a play.
      const init = { method: "POST", headers: JH, body: JSON.stringify({ plays: "abc" }) };
      c = await answer(B, "/api/phone/plays", init);
      n = await theirs("plays as text", "/api/phone/plays", init);
      assert.deepEqual([c.status, c.by, JSON.parse(c.body)], [200, "C#", { ok: true, recorded: 0 }]);
      assert.deepEqual([n.status, JSON.parse(n.body)], [200, { ok: true, recorded: 0 }]);
      raw.prepare("DELETE FROM tracks WHERE album_id = ?").run(qal);
      raw.prepare("DELETE FROM albums WHERE id = ?").run(qal);
      await ctx.library.reload();
    }
    // Plays made with no server: written by C# as the Node server wrote them (its corrected title too).
    const before = raw.prepare("SELECT COUNT(*) AS n FROM plays").get().n;
    const at = Date.now() - 3600000;
    const played = await post("/api/phone/plays", { plays: [{ track_id: abbey.id, ts: at }, { track_id: something.id, ts: 1 }, { track_id: 999999, ts: at }, { track_id: rowOf("Hunter").id }, "junk"] });
    assert.deepEqual(played, { ok: true, recorded: 3 });
    const rows = raw.prepare("SELECT album_id, track_id, title, artist, album, zone, ts FROM plays ORDER BY id DESC LIMIT 3").all().reverse();
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM plays").get().n, before + 3);
    // The play as the Node server's copy of the library names it (recorded).
    const named = await rec.want("a play named");
    assert.match(rows[0].zone, /^PHONE_/);
    assert.deepEqual(rows[0], Object.assign({ album_id: abbey.album_id, track_id: abbey.id }, named, { zone: rows[0].zone, ts: at }));
    assert.ok(rows[1].ts >= Date.now() - 90 * 86400000 - 60000 && rows[1].ts <= Date.now() - 90 * 86400000 + 60000, "kept to the last 90 days");
    assert.ok(Math.abs(rows[2].ts - Date.now()) < 60000, "no time given: now");

    // A zone's DSP (none for a zone that isn't one) and 32-bit output: this side's since v0.8.40, the
    // latter where ffmpeg writes 32-bit FLAC (else the Node server's 400 while it was there; said here alone).
    const flac32 = haveFlac32();
    for (const [conv, by] of [[".48000-24.flac?o=x", "C#"], [".44100-32.flac", "C#"]]) {
      x = await fetch(B + "/stream/t" + something.id + conv, { headers: H });
      assert.equal(x.headers.get("x-mandarin-answered"), by, conv);
      if (!flac32 && conv.includes("-32.")) assert.equal(x.status, 400, conv + ": no 32-bit FLAC from this ffmpeg");
      await x.arrayBuffer();
    }

    // The status is the C# server's since v0.8.48 (HousekeepingRoutes.cs); playback's zones since v0.8.49 (stage 6).
    const st = await fetch(B + "/api/status", { headers: H });
    assert.equal(st.headers.get("x-mandarin-answered"), "C#", "the status: the C# server's");
    const zs = await fetch(B + "/api/zones", { headers: H });
    assert.equal(zs.headers.get("x-mandarin-answered"), ctx.frontRuns.has("playback") ? "C#" : null, "the zones: the server that holds playback");
    rec.done();
  } finally { await srv.stop(); }
});
