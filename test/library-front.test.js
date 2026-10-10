"use strict";
/*
 * The library read in C# (v0.8.4, server/Mandarin.Server/Library.cs): every
 * screen it answers gives what the Node server gives, asked the same thing.
 * Runs when the suite goes through the C# server (MANDARIN_FRONT=1). Each
 * question is put to both — through the front door (C#) and straight to the
 * Node server behind it — and the answers must be the same, field for field;
 * then the library changes (a heart, Listen later, an edit, labels switched
 * on, a merge, a play) and they must still be.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const fs = require("fs");
const os = require("os");

const skip = process.env.MANDARIN_FRONT !== "1" && "the suite isn't going through the C# server (MANDARIN_FRONT=1)";

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

test("the library in C# answers as the Node server does", { skip, timeout: 120000 }, async () => {
  const lib = library();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  const N = "http://127.0.0.1:" + ctx.listeningOn;
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 300; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count > 0 && !st.scan.running) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const post = async (p, body) => { const r = await fetch(B + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(body) }); assert.equal(r.status, 200, p); return r.json(); };

    const ids = (await (await fetch(N + "/api/library/albums?count=200", { headers: H })).json()).albums.map(a => a.offset);
    assert.equal(ids.length, 12, "the library read");
    const same = async (p, label) => {
      const [c, n] = await Promise.all([fetch(B + p, { headers: H }), fetch(N + p, { headers: H })]);
      const cj = await c.json(), nj = await n.json();
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", (label || "") + p + ": answered by C#");
      assert.equal(c.status, n.status, p + ": the same status");
      assert.deepStrictEqual(cj, nj, (label || "") + p + ": the same answer");
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
      assert.deepStrictEqual(await same("/api/shelf/albums?sig=" + shelf.sig, label), { same: true, sig: shelf.sig });
      await same("/api/shelf/albums?sig=0000000000000000", label);
      // Home's rows (v0.8.6).
      for (const p of ["/api/home/album-of-the-day", "/api/home/label-of-the-week", "/api/home/history", "/api/home/history?count=1"]) await same(p, label);
      for (const q of ["", "?months=1&count=3", "?months=0", "?months=99&count=500"]) {
        const [c, n] = await Promise.all([B, N].map(async b => (await fetch(b + "/api/home/unplayed" + q, { headers: H })).json()));
        const shape = j => ({ n: j.albums.length, total: j.total, months: j.months, no_history: j.no_history, ready_at: j.ready_at });
        assert.deepStrictEqual(shape(c), shape(n), label + "/api/home/unplayed" + q);
      }
      // Drawn at random: the same pool, whichever answers.
      const r = await (await fetch(B + "/api/random-albums?count=4", { headers: H })).json();
      assert.equal(r.albums.length, 4);
      assert.equal(r.total, ids.length);
    };

    await battery("as scanned: ");
    // The library changes. Hearts, Listen later and labels are made by C# (v0.8.16), which tells
    // the Node server (its copy must follow: the battery asks both); an edit is still the Node server's.
    const change = async (p, body, method = "POST") => {
      const r = await fetch(B + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, H), body: body === undefined ? undefined : JSON.stringify(body) });
      assert.equal(r.headers.get("x-mandarin-answered"), "C#", p + ": made by C#");
      return { status: r.status, body: await r.json() };
    };
    assert.deepEqual(await change("/api/favourites", { offset: ids[2], on: true }), { status: 200, body: { ok: true, offset: ids[2], favourite: true } });
    assert.deepEqual((await change("/api/favourites", { offset: ids[0], on: 1 })).body, { ok: true, offset: ids[0], favourite: true });
    assert.deepEqual(await change("/api/favourites", { offset: 99999, on: true }), { status: 404, body: { error: "That album is no longer in the library" } });
    assert.deepEqual((await change("/api/listen-later", { offsets: [ids[1], ids[4], 99999], on: true })).body, { ok: true, offset: ids[4], later: true, count: 2 });
    assert.ok(ctx.library.isFavourite(ctx.library.album(ids[2])) && ctx.library.isLater(ctx.library.album(ids[4])), "the Node server's copy told");
    await post("/api/album/edit", { offset: ids[3], title: "Edited Title", artist: "The Edited", year: 1988 });
    assert.deepEqual((await change("/api/settings/labels", {})).body, { error: "enabled required" });
    assert.deepEqual((await change("/api/settings/labels", { enabled: true })).body, { ok: true, enabled: true });
    assert.equal(ctx.library.labelsOn(), true);
    assert.deepEqual(await change("/api/labels/merge", { items: [{ key: "columbia" }] }), { status: 400, body: { error: "Two or more labels are needed" } });
    assert.deepEqual((await change("/api/labels/merge", { items: [{ key: "columbia", display: "Columbia" }, { key: "impulse", display: "Impulse!" }, { key: "BAD!" }] })).body,
      { ok: true, target: "columbia", merged: ["impulse"] });
    assert.equal(ctx.library.mergedKey("impulse"), "columbia", "the Node server's merges read again");
    assert.deepEqual(await change("/api/settings/label-folder-depth", { depth: 9 }), { status: 400, body: { ok: false, error: "depth must be 0–6" } });
    assert.deepEqual((await change("/api/settings/label-folder-depth", { depth: "0" })).body, { ok: true, depth: 0, rescanning: false });
    const now = Date.now();
    const ins = ctx.db.raw.prepare("INSERT INTO plays(album_id, track_id, ts) VALUES(?, NULL, ?)");
    ins.run(ids[5], now - 1000); ins.run(ids[5], now - 2000); ins.run(ids[6], now - 400 * 86400000);
    await battery("after changes: ");
    // Album of the day, played today: gone from Home on both.
    const today = await same("/api/home/album-of-the-day");
    assert.ok(today.album, "an album of the day");
    ins.run(today.album.offset, Date.now());
    const after = await same("/api/home/album-of-the-day");
    assert.deepEqual([after.album, after.played], [null, true]);
    const week = await same("/api/home/label-of-the-week");
    assert.ok(week.label && week.albums.length >= 3, "a label of the week, labels on");
    // A merge let go, by C#; one that isn't there, said so.
    assert.deepEqual(await change("/api/labels/merge/nothing", undefined, "DELETE"), { status: 404, body: { error: "Not a merged label" } });
    assert.deepEqual(await change("/api/labels/merge/impulse", undefined, "DELETE"), { status: 200, body: { ok: true } });
    assert.equal(ctx.library.mergedKey("impulse"), "impulse");
    await same("/api/library/facets", "unmerged: ");
    await post("/api/labels/merge", { items: [{ key: "columbia", display: "Columbia" }, { key: "impulse", display: "Impulse!" }] });
    // Settings kept and read (v0.8.7): saved through C#, read the same by both.
    for (const p of ["/api/settings/display", "/api/settings/smart-picks", "/api/settings/home-rows"]) await same(p, "as set: ");
    let r = await post("/api/settings/display", { enabled: false, seconds: "30" });
    assert.deepEqual(r, { ok: true, enabled: false, seconds: 30 });
    r = await post("/api/settings/display", { seconds: 99 });
    assert.equal(r.seconds, 30, "out of range: kept");
    r = await post("/api/settings/smart-picks", { hour: "7.9", enabled: 0 });
    assert.deepEqual([r.hour, r.enabled], [7, false]);
    assert.equal((await fetch(B + "/api/settings/smart-picks", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ hour: 24 }) })).status, 400);
    r = await post("/api/settings/home-rows", { rows: [{ id: "random" }, { id: "history", on: false }, { id: "nope" }, { id: "random" }] });
    assert.deepEqual(r.rows.slice(0, 4).map(x => x.id), ["downloads", "phone", "random", "history"], "the app's rows at the top, then as given");
    assert.equal((await fetch(B + "/api/settings/home-rows", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify({ rows: [{ id: "x" }] }) })).status, 400);
    for (const p of ["/api/settings/display", "/api/settings/smart-picks", "/api/settings/home-rows"]) await same(p, "after saving: ");
    // Dynamic playlists (saved Library views): made on the Node server, read by both.
    const mk = b => fetch(N + "/api/smart-playlists", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(b) }).then(x => x.json());
    const a1 = (await mk({ name: "Jazz", view: { genre: ["Jazz"], sort: "year", dir: "desc" }, limit: 3 })).playlist;
    const a2 = (await mk({ name: " Shuffled ", view: { sort: "random", seed: 9, decade: "1960", genre: ["!Pop", 7, null, {}] }, order: "random", mode: "tracks" })).playlist;
    await mk({ name: "All", view: "nonsense", limit: "9999" });
    await same("/api/smart-playlists");
    for (const sp of [a1, a2]) {
      for (const q of ["", "&offset=1&count=1", "&count=99"]) await same("/api/smart-playlist?id=" + sp.id + q);
      for (const q of ["", "&max=1", "&max=0"]) await same("/api/smart-playlist/albums?id=" + sp.id + q);
    }
    await same("/api/smart-playlist?id=nope");
    await same("/api/smart-playlist/albums");
    // Your own playlists (v0.8.8). Each change is made from the same saved state
    // once through C# and once on the Node server, and both the answer and what
    // was saved must agree (new ids and times aside).
    const one = (await (await fetch(N + "/api/album?offset=" + ids[0], { headers: H })).json());
    const start = [
      { id: "p1", name: "Kept", tracks: [{ album_offset: ids[0], album_title: one.album.title, album_subtitle: one.album.subtitle, track_index: 0, title: one.tracks[0].title, subtitle: "", image_key: one.album.image_key, track_no: 1 }], created_at: 1, updated_at: 2, extra: "kept as is" },
      { id: "q1", name: "From Qobuz", service: "qobuz", tracks: [], created_at: 1, updated_at: 1 },
      { id: "p2", name: "Empty", tracks: [], created_at: 1, updated_at: 3 }
    ];
    const norm = v => JSON.parse(JSON.stringify(v), (k, x) => (k === "created_at" || k === "updated_at") && x > 1e12 ? "now"
      : k === "id" && typeof x === "string" && /^[0-9a-f]{12}$/.test(x) ? "new" : x);
    const both = async (p, body) => {
      const out = [];
      for (const base of [B, N]) {
        ctx.db.setSetting("userPlaylists", start);
        const r = await fetch(base + p, { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(body) });
        out.push({ by: r.headers.get("x-mandarin-answered"), status: r.status, body: norm(await r.json()), saved: norm(ctx.db.setting("userPlaylists", null)) });
      }
      assert.equal(out[0].by, "C#", p + " answered by C#");
      assert.deepStrictEqual(out[0], Object.assign({}, out[1], { by: "C#" }), p + " " + JSON.stringify(body).slice(0, 120));
      return out[0];
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
    // Covers (v0.8.5): drawn by the Node server the first time, sent by C# after.
    const albums = (await (await fetch(N + "/api/library/albums?count=200", { headers: H })).json()).albums;
    for (const al of albums) {
      const p = "/api/image/" + al.image_key + "?size=300";
      const first = await fetch(B + p, { headers: H });
      assert.equal(first.status, 200, p);
      const drawn = Buffer.from(await first.arrayBuffer());
      const [c, n] = await Promise.all([fetch(B + p, { headers: H }), fetch(N + p, { headers: H })]);
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", p + ": a cover already drawn, sent by C#");
      assert.deepEqual(Buffer.from(await c.arrayBuffer()), drawn, p + ": the same picture");
      assert.deepEqual(Buffer.from(await n.arrayBuffer()), drawn);
      for (const h of ["content-type", "cache-control", "etag", "last-modified"]) assert.equal(c.headers.get(h), n.headers.get(h), p + ": " + h);
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
    fs.mkdirSync(path.join(lib.data, "labels"), { recursive: true });
    fs.writeFileSync(path.join(lib.data, "labels", "columbia.png"), Buffer.from("89504e470d0a1a0a", "hex"));
    ctx.db.raw.prepare("INSERT INTO label_logos(key, file, type, source, url, updated_at) VALUES('columbia', 'columbia.png', 'image/png', 'manual', NULL, 1)").run();
    const [lc, ln] = await Promise.all([fetch(B + "/api/image/label-columbia?v=1", { headers: H }), fetch(N + "/api/image/label-columbia?v=1", { headers: H })]);
    assert.deepEqual([lc.status, lc.headers.get("x-mandarin-answered"), lc.headers.get("content-type")], [200, "C#", "image/png"]);
    assert.deepEqual(Buffer.from(await lc.arrayBuffer()), Buffer.from(await ln.arrayBuffer()));
    assert.equal(lc.headers.get("cache-control"), ln.headers.get("cache-control"));
    assert.equal((await fetch(B + "/api/image/label-nobody", { headers: H })).status, 404, "no such logo");

    // Music files sent as they are (v0.8.9): byte for byte and range for range
    // the Node server's; a conversion still the Node server's.
    let sentByCsharp = 0, converted = 0;
    for (const id of ids) {
      const page = await (await fetch(N + "/api/album?offset=" + id, { headers: H })).json();
      for (const tr of page.tracks) {
        const row = ctx.db.raw.prepare("SELECT path FROM tracks WHERE id = ?").get(tr.track_id);
        const ext = path.extname(row.path).slice(1).toLowerCase();
        for (const addr of ["/stream/t" + tr.track_id + "." + ext, "/stream/t" + tr.track_id + ".orig." + ext, "/stream/t" + tr.track_id + ".orig.dsf?m=audio/x-dsf"]) {
          const plain = await fetch(B + addr, { headers: H });
          const body = Buffer.from(await plain.arrayBuffer());
          assert.equal(plain.headers.get("x-mandarin-answered"), "C#", addr + ": sent by C#, as it is or converted");
          // A conversion, made as it is sent (no length yet): checked on its own below.
          if (!plain.headers.get("content-length")) { converted++; assert.ok(/\.(flac|mp3|wav)$/.test(addr) && !addr.includes(".orig."), addr + ": only a Sonos address is converted"); continue; }
          sentByCsharp++;
          if (!addr.includes(".dsf")) assert.deepEqual(body, fs.readFileSync(row.path), addr + ": the file itself");
          for (const range of [null, "bytes=0-99", "bytes=100-199", "bytes=-50", "bytes=1000-", "bytes=99999999-", "bytes=5-2"]) {
            for (const method of ["GET", "HEAD"]) {
              const h = Object.assign(range ? { Range: range } : {}, H);
              const [c, n] = await Promise.all([fetch(B + addr, { method, headers: h }), fetch(N + addr, { method, headers: h })]);
              const what = method + " " + addr + " " + (range || "whole");
              assert.equal(c.headers.get("x-mandarin-answered"), "C#", what);
              assert.equal(c.status, n.status, what + ": status");
              for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control", "etag", "last-modified"]) {
                // Past the end of the file: no content either way (C# says length 0 to a HEAD, the Node server says nothing).
                if (c.status === 416 && (k === "content-type" || (k === "content-length" && method === "HEAD"))) continue;
                assert.equal(c.headers.get(k), n.headers.get(k), what + ": " + k);
              }
              if (c.status < 300) assert.deepEqual(Buffer.from(await c.arrayBuffer()), Buffer.from(await n.arrayBuffer()), what + ": the same bytes");
              else { await c.arrayBuffer(); await n.arrayBuffer(); }
            }
          }
          const tag = plain.headers.get("etag");
          assert.equal((await fetch(B + addr, { headers: Object.assign({ "If-None-Match": tag }, H) })).status, 304);
        }
      }
    }
    assert.ok(sentByCsharp >= 20 && converted >= 1, `files sent by C# (${sentByCsharp}) and conversions made by C# (${converted})`);
    const tid = (await (await fetch(N + "/api/album?offset=" + ids[0], { headers: H })).json()).tracks[0].track_id;
    const tpath = ctx.db.raw.prepare("SELECT path FROM tracks WHERE id = ?").get(tid).path;
    const s1 = ctx.auth.signUrl("/stream/t" + tid + ".orig" + path.extname(tpath));
    x = await fetch(B + s1);
    assert.deepEqual([x.status, x.headers.get("x-mandarin-answered")], [200, "C#"], "a signed address, no sign-in (a speaker)");
    await x.arrayBuffer();
    x = await fetch(B + "/stream/t" + tid + ".orig" + path.extname(tpath));
    assert.equal(x.status, 401, "neither signed nor signed in: refused");
    for (const conv of ["/stream/t" + tid + ".flac?g=-3", "/stream/t999999.flac"]) {
      x = await fetch(B + conv, { headers: H });
      assert.equal(x.headers.get("x-mandarin-answered"), null, conv + ": the Node server's");
      await x.arrayBuffer();
    }

    // Conversions (v0.8.11): made by C# as they are sent, then from the cache,
    // range for range; and the very file ffmpeg makes with the Node server's
    // own settings (lib/stream.js), byte for byte.
    const STREAM = require("../lib/stream");
    const { spawnSync } = require("child_process");
    const nodeMade = (t, plan) => {
      const out = path.join(lib.root, "node-made-" + t.id + "-" + plan.rate + "-" + plan.bits + ".flac");
      const r = spawnSync(require("../lib/ffmpeg").info().bin, STREAM.ffmpegArgs(t.path, plan, out));
      assert.equal(r.status, 0, String(r.stderr));
      return fs.readFileSync(out);
    };
    const planOf = t => STREAM.plan({ path: t.path, codec: t.codec, sampleRate: t.sample_rate, bitsPerSample: t.bits, channels: t.channels });
    const rowOf = title => ctx.db.raw.prepare("SELECT * FROM tracks WHERE title = ?").get(title);
    const expected = {
      ["/stream/t" + rowOf("So What").id + ".flac"]: nodeMade(rowOf("So What"), planOf(rowOf("So What"))),
      ["/stream/t" + rowOf("Take").id + ".wav"]: nodeMade(rowOf("Take"), planOf(rowOf("Take"))),
      ["/stream/t" + rowOf("Something").id + ".44100-24.flac"]: nodeMade(rowOf("Something"), { transcode: true, hq: true, rate: 44100, bits: 24 }),
    };
    assert.equal(planOf(rowOf("Take")).exact, true, "the WAV is a repack, the same samples");
    const trackOf = title => ctx.db.raw.prepare("SELECT id, path FROM tracks WHERE title = ?").get(title);
    const conversions = [
      "/stream/t" + trackOf("So What").id + ".flac",            // 24/96: the 24/48 rule
      "/stream/t" + trackOf("Take").id + ".wav",                // 24-bit WAV: repacked, the same samples
      "/stream/t" + trackOf("Something").id + ".44100-24.flac", // what a streamer was promised
    ];
    for (const addr of conversions) {
      let r = await fetch(B + addr, { headers: H });
      assert.equal(r.status, 200, addr);
      assert.equal(r.headers.get("x-mandarin-answered"), "C#", addr + ": converted by C#");
      const first = Buffer.from(await r.arrayBuffer());
      assert.deepEqual(first, expected[addr], addr + ": the same file ffmpeg makes with the Node server's settings");
      for (let i = 0; i < 100 && r.headers.get("x-mandarin-answered") !== "C#"; i++) {
        await new Promise(res => setTimeout(res, 100));
        r = await fetch(B + addr, { headers: H });
        await r.arrayBuffer();
      }
      assert.equal(r.headers.get("x-mandarin-answered"), "C#", addr + ": once made, sent by C# from the cache");
      for (const range of [null, "bytes=0-99", "bytes=500-1499", "bytes=-64"]) {
        const h = Object.assign(range ? { Range: range } : {}, H);
        const c = await fetch(B + addr, { headers: h }), cb = Buffer.from(await c.arrayBuffer());
        const n = await fetch(N + addr, { headers: h }), nb = Buffer.from(await n.arrayBuffer());
        const what = addr + " " + (range || "whole");
        assert.equal(c.headers.get("x-mandarin-answered"), "C#", what);
        assert.equal(c.status, n.status, what);
        for (const k of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"]) assert.equal(c.headers.get(k), n.headers.get(k), what + ": " + k);
        assert.deepEqual(cb, nb, what + ": the same bytes");
        if (!range) assert.deepEqual(cb, first, what + ": what was made the first time");
      }
    }
    // The Node server's "make these next" (a queue being played): made by C#, not there.
    const ahead = rowOf("Hunter");
    const aheadPlan = { transcode: true, hq: true, rate: 48000, bits: 24, reason: "made ahead" };
    const aheadFile = ctx.transcoder.finalPath(ctx.transcoder.keyFor(ahead, aheadPlan));
    assert.equal(ctx.transcoder.status(ahead, aheadPlan), "none");
    ctx.transcoder.prefetch([{ track: ahead, plan: aheadPlan }]);
    assert.equal(ctx.transcoder.jobs.size, 0, "nothing made by the Node server");
    assert.equal(ctx.transcoder.status(ahead, aheadPlan), "running", "handed over: on its way");
    for (let i = 0; i < 100 && !fs.existsSync(aheadFile); i++) await new Promise(res => setTimeout(res, 100));
    assert.ok(fs.existsSync(aheadFile), "made by C# in the cache");
    assert.equal(ctx.transcoder.status(ahead, aheadPlan), "ready");
    assert.deepEqual(fs.readFileSync(aheadFile), nodeMade(ahead, aheadPlan), "as the Node server would have made it");
    // The phone's downloads and its Opus away (v0.8.12): made by C#, the
    // same audio as ffmpeg makes with the Node server's settings (Opus is
    // compared decoded: its Ogg wrapper is numbered afresh each time).
    const DL = require("../lib/server/downloads").Downloads;
    const decodedBuf = buf => { const f = path.join(lib.root, "decode-" + Date.now() + ".opus"); fs.writeFileSync(f, buf); return decoded(f); };
    const decoded = file => spawnSync(require("../lib/ffmpeg").info().bin, ["-v", "error", "-i", file, "-f", "f32le", "-"], { maxBuffer: 1 << 28 }).stdout;
    const nodeDownload = (t, quality) => {
      const p = ctx.downloads.plan(t, quality);
      const out = path.join(lib.root, "node-dl-" + t.id + "." + p.ext);
      const r = spawnSync(require("../lib/ffmpeg").info().bin, ctx.downloads.args(t, p, out));
      assert.equal(r.status, 0, String(r.stderr));
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
        const p = ctx.downloads.plan(t, quality);
        assert.equal(c.headers.get("x-download-ext"), p.ext, addr);
        assert.equal(c.headers.get("content-type"), p.mime, addr);
        if (p.file) { assert.deepEqual(body, fs.readFileSync(t.path), addr + ": the file itself"); continue; }
        // Kept under the Node server's own name for it: the Node server finds it, makes nothing.
        const kept = path.join(lib.data, "download-cache", ctx.downloads.keyFor(t, p) + "." + p.ext);
        assert.deepEqual(body, fs.readFileSync(kept), addr + ": kept under the Node server's name");
        const n = await fetch(N + addr, { headers: H });
        assert.deepEqual(Buffer.from(await n.arrayBuffer()), body, addr + ": the Node server sends the same, made once");
        assert.equal(ctx.downloads.jobs.size, 0);
        const theirs = nodeDownload(t, quality);
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
    assert.deepEqual(decoded(path.join(lib.data, "download-cache", ctx.downloads.keyFor(away, ctx.downloads.plan(away, "opus")) + ".opus")).length > 0, true);
    assert.deepEqual(decoded(nodeDownload(away, "opus")), decodedBuf(opusBody), "the same Opus audio as the Node server's settings make");
    const nextFile = path.join(lib.data, "download-cache", ctx.downloads.keyFor(awayNext, ctx.downloads.plan(awayNext, "opus")) + ".opus");
    for (let i = 0; i < 100 && !fs.existsSync(nextFile); i++) await new Promise(res => setTimeout(res, 100));
    assert.ok(fs.existsSync(nextFile), "the album's next track made ready behind it");
    o = await fetch(B + "/api/download/t999999", { headers: H });
    assert.deepEqual([o.status, (await o.json()).error], [404, "That track is no longer in the library"]);

    // The phone's download lists (v0.8.26): the same from either server, ReplayGain's sums among them.
    const raw = ctx.db.raw;
    const abbey = rowOf("Come Together"), something = rowOf("Something");
    raw.prepare("INSERT OR REPLACE INTO track_loudness(track_id, lufs, peak, measured_at) VALUES(?, ?, ?, 1)").run(abbey.id, -9.37, 0.81);
    raw.prepare("INSERT OR REPLACE INTO track_loudness(track_id, lufs, peak, measured_at) VALUES(?, ?, ?, 1)").run(something.id, -13.113, 0.47);
    raw.prepare("UPDATE tracks SET rg_track_gain = -4.25, rg_track_peak = 0.9 WHERE id = ?").run(rowOf("Hunter").id);
    for (const id of ids) for (const q of ["", "&quality=opus", "&quality=nonsense"]) await same("/api/download/album?offset=" + id + q, "download list: ");
    await same("/api/download/album?offset=999999", "download list: ");
    for (const q of ["?aotd=1&recent=5", "?picks=1&aotd=true&recent=50", "?recent=abc", "?recent=-3&aotd=0", ""]) await same("/api/download/auto" + q, "automatic downloads: ");
    const samePost = async (p, body, label) => {
      const opts = { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H), body: JSON.stringify(body) };
      const [c, n] = await Promise.all([fetch(B + p, opts), fetch(N + p, opts)]);
      const cj = await c.json(), nj = await n.json();
      assert.equal(c.headers.get("x-mandarin-answered"), "C#", label + p + ": answered by C#");
      assert.equal(c.status, n.status, label + p + ": the same status");
      assert.deepStrictEqual(cj, nj, label + p + ": the same answer");
      return cj;
    };
    await samePost("/api/download/albums", { ids: ids.concat([999999, String(ids[0]), null, 1.5, "x", true]) }, "the phone's albums: ");
    await samePost("/api/download/albums", {}, "the phone's albums: ");
    // Plays made with no server: written by C# as the Node server writes them (its corrected title too).
    const before = raw.prepare("SELECT COUNT(*) AS n FROM plays").get().n;
    const at = Date.now() - 3600000;
    const played = await post("/api/phone/plays", { plays: [{ track_id: abbey.id, ts: at }, { track_id: something.id, ts: 1 }, { track_id: 999999, ts: at }, { track_id: rowOf("Hunter").id }, "junk"] });
    assert.deepEqual(played, { ok: true, recorded: 3 });
    const rows = raw.prepare("SELECT album_id, track_id, title, artist, album, zone, ts FROM plays ORDER BY id DESC LIMIT 3").all().reverse();
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM plays").get().n, before + 3);
    const expect = (t, ts) => { const tr = ctx.library.track(t.id); const al = ctx.library.album(tr.album_id); return { album_id: al.id, track_id: tr.id, title: tr.title, artist: tr.artist, album: al.title, zone: rows[0].zone, ts }; };
    assert.match(rows[0].zone, /^PHONE_/);
    assert.deepEqual(rows[0], expect(abbey, at));
    assert.ok(rows[1].ts >= Date.now() - 90 * 86400000 - 60000 && rows[1].ts <= Date.now() - 90 * 86400000 + 60000, "kept to the last 90 days");
    assert.ok(Math.abs(rows[2].ts - Date.now()) < 60000, "no time given: now");

    // Not made yet, or not this side's: the Node server's.
    for (const conv of ["/stream/t" + trackOf("Something").id + ".48000-24.flac?o=x", "/stream/t" + trackOf("Something").id + ".44100-32.flac"]) {
      x = await fetch(B + conv, { headers: H });
      assert.equal(x.headers.get("x-mandarin-answered"), null, conv + ": the Node server's");
      await x.arrayBuffer();
    }

    // What hasn't moved is still passed on.
    const st = await fetch(B + "/api/status", { headers: H });
    assert.equal(st.headers.get("x-mandarin-answered"), null, "the status: still the Node server's");
  } finally { await srv.stop(); }
});
