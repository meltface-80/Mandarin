"use strict";
/*
 * Mandarin's server in C# (v0.8.1 on, server/): which server answers what.
 * Runs when the suite goes through the C# server (MANDARIN_FRONT=1, as CI
 * does on Node 22). Each part moved to C# is pinned here, so a part can't
 * quietly fall back to the Node server behind it.
 *   - v0.8.1: everything is passed on, through C#;
 *   - v0.8.2: sign-in, devices and the gate are answered by C#; a streamer's
 *     NOTIFY still reaches the Node server unsigned; /internal/ stops at the door;
 *   - v0.8.3: the page and its files (public/) are served by C#;
 *   - v0.8.4: the library's screens are read by C# (test/library-front.test.js
 *     checks they say what the Node server says);
 *   - v0.8.5: covers already drawn, and label logos, are sent by C# (the same test);
 *   - v0.8.6: Home's rows are read by C# (the same test);
 *   - v0.8.7: settings only kept and read, and dynamic playlists, by C# (the same test);
 *   - v0.8.8: your own playlists, made and changed by C# (the same test);
 *   - v0.8.9: music files sent as they are, by C# (the same test);
 *   - v0.8.10: conversions already made, sent by C# from the cache (the same test);
 *   - v0.8.11: conversions made by C#, as the Node server made them (the same test);
 *   - v0.8.12: the phone's downloads and its Opus away, made and sent by C# (the same test);
 *   - v0.8.13: tags read by C# as the scanner reads them (test/tags-front.test.js), and the
 *     processor's split kept to by C# (test/cpu.test.js);
 *   - v0.8.14: the scan's tags read by C#, the library the same (test/tags-front.test.js,
 *     test/tag-reader-switch.test.js);
 *   - v0.8.15: nothing new answered by C# (the tag check keeps its results across updates);
 *   - v0.8.16: hearts, Listen later, label merges and the label settings made by C#, the Node
 *     server told (test/library-front.test.js);
 *   - v0.8.17: nothing new answered by C# (the Library Scanner page drawn at once);
 *   - v0.8.18: the library scans made by C#, the database the same (test/scan-csharp.test.js,
 *     test/tags-front.test.js; every scanner test in this mode);
 *   - v0.8.19: the identification scan, the MusicBrainz pack, loudness measuring and waveforms
 *     made by C# (test/identify-csharp.test.js; every identify, pack, loudness and waveform test
 *     in this mode, which says so; and every test that loads index.js afresh);
 *   - v0.8.20: record labels whole (the wall, a label's albums, the lookups, the logos, the keys),
 *     the release days, Smart Picks and the share card's suggestions made by C#
 *     (test/extras-csharp.test.js; the label, release day, Smart Picks and similar tests in this mode);
 *   - v0.8.21: an album's write-ups and links, an artist's story, Pitchfork's lists, the Qobuz app's
 *     link, the share card's settings and a playlist shared as text, made by C#
 *     (test/writeups-csharp.test.js, test/share-csharp.test.js; the write-up and playlist tests in this mode);
 *   - v0.8.22: backup & restore, built-in Tailscale, Dynamic Playlists saved and deleted, the tag
 *     filter, the album editor (its cover search too) and covers drawn from an album's own picture,
 *     by C# (test/backup-csharp.test.js, test/artfind-csharp.test.js; the backup, Tailscale, playlist,
 *     end-to-end and library tests in this mode);
 *   - v0.8.25: nothing new answered by C#. In front of a Node server of another version (an update
 *     from Settings half done) C# answers nothing but /server-info and its work stays with Node,
 *     until the matching C# server, fetched by Node, starts itself again (test/csharp-update.test.js);
 *   - v0.8.26: Last.fm (the key, similar artists and albums), headphone profiles from AutoEq, and the
 *     phone's download lists and offline plays, by C# (test/lastfm.test.js, test/autoeq.test.js and
 *     test/library-front.test.js in this mode);
 *   - v0.8.28: Shelf's page (/shelf), by C#; Mandarin's version now comes with Shelf's list (C#'s since
 *     v0.8.23), so the page asks the Node server for nothing but playback (test/shelf.test.js in this mode).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");

const skip = process.env.MANDARIN_FRONT !== "1" && "the suite isn't going through the C# server (MANDARIN_FRONT=1)";

test("which server answers: sign-in, the gate, the page and the library in C#", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    const by = async (p, init) => { const r = await fetch(B + p, init); return { status: r.status, by: r.headers.get("x-mandarin-answered") || "Node", via: r.headers.get("x-mandarin-server") || "", r }; };
    const info = await (await fetch(B + "/server-info")).json();
    assert.equal(info.server, "C#");
    assert.equal(info.version, require("../package.json").version);

    let x = await by("/api/auth/status");
    assert.deepEqual([x.status, x.by], [200, "C#"], "the sign-in state");
    assert.equal((await x.r.json()).setup_required, true);
    assert.match(x.via, /^C# /, "every response comes through C#");
    x = await by("/api/library/albums");
    assert.deepEqual([x.status, x.by], [401, "C#"], "the gate, before an account");
    assert.equal((await x.r.json()).setup_required, true);
    x = await by("/", { redirect: "manual" });
    assert.deepEqual([x.status, x.by], [302, "C#"], "a page, to the sign-in page");

    const token = await signIn(B);   // setup and SRP, against C#
    const H = { Authorization: "Bearer " + token };
    x = await by("/api/auth/devices", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "C#"], "the devices");
    assert.equal((await x.r.json()).devices.length, 1);
    // The library read on first start (a 503 until then, from the Node server).
    for (let i = 0; i < 150; i++) { if ((await (await fetch(B + "/api/status", { headers: H })).json()).index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }
    x = await by("/api/library/albums", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "C#"], "the library: read by C# " + JSON.stringify([x.status, x.by]));
    assert.equal((await x.r.json()).total, 3);
    x = await by("/api/status", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "Node"], "the server's state: passed on, signed in by C#'s token");
    // The Node server's private address for the C# server: not from outside, and not without its key.
    x = await by("/internal/library", { headers: H });
    assert.deepEqual([x.status, x.by], [404, "C#"], "/internal/library answered 404 at the door");
    assert.equal((await fetch("http://127.0.0.1:" + ctx.listeningOn + "/internal/library", { headers: H })).status, 403, "the key, or nothing");
    x = await by("/api/library/albums", { headers: { Authorization: "Bearer not-a-token" } });
    assert.deepEqual([x.status, x.by], [401, "C#"], "a bad token stops at C#");
    // A streamer's NOTIFY (it can't sign in): passed on, as the Node server takes it before its gate.
    x = await by("/upnp/event/uuid:nobody", { method: "NOTIFY", headers: { "Content-Type": "text/xml", NT: "upnp:event", NTS: "upnp:propchange", SID: "uuid:x" }, body: "<e:propertyset xmlns:e=\"urn:schemas-upnp-org:event-1-0\"/>" });
    assert.deepEqual([x.status, x.by], [200, "Node"], "a renderer's event, not stopped at the gate");
    // The Node server's loopback-only routes: never through the front door.
    x = await by("/internal/dash/nope", { redirect: "manual" });
    assert.deepEqual([x.status, x.by], [404, "C#"], "/internal/ answered 404 at the door");
    // The page and its files (v0.8.3): C#, behind the gate; everything outside public/ passed on.
    for (const p of ["/", "/index.html", "/app.js", "/style.css", "/srp.js", "/manifest.json"]) {
      x = await by(p, { headers: H });
      assert.deepEqual([x.status, x.by], [200, "C#"], "the page's file " + p);
    }
    const page = await by("/", { headers: H });
    const again = await by("/", { headers: Object.assign({ "If-None-Match": page.r.headers.get("etag") }, H) });
    assert.equal(again.status, 304, "a copy still current: not modified");
    const app = { "User-Agent": "Mozilla/5.0 (Linux; Android 15; wv) MusicDAndroid/0.8.3", Authorization: H.Authorization };
    x = await by("/style.css", { headers: app });
    assert.deepEqual([x.status, x.by], [200, "C#"], "the app's stylesheet");
    const tag = x.r.headers.get("etag");
    assert.equal((await by("/style.css", { headers: Object.assign({ "If-None-Match": tag }, app) })).status, 304, "the app's offline copy, still current");
    // Shelf (v0.8.28): its page, the file as it is; and its list, with the version.
    for (const p of ["/shelf", "/shelf/"]) {
      x = await by(p, { headers: H });
      assert.deepEqual([x.status, x.by], [200, "C#"], "Shelf's page " + p);
      assert.match(x.r.headers.get("content-type"), /^text\/html; charset=utf-8$/i);
      assert.match(await x.r.text(), /<title>Mandarin Shelf<\/title>/);
    }
    const shelfPage = await by("/shelf", { headers: H });
    assert.equal((await by("/shelf", { headers: Object.assign({ "If-None-Match": shelfPage.r.headers.get("etag") }, H) })).status, 304, "Shelf's page, still current");
    x = await by("/shelf", { redirect: "manual" });
    assert.deepEqual([x.status, x.by, x.r.headers.get("location")], [302, "C#", "/login?next=%2Fshelf"], "Shelf signed out: to sign in, and back");
    x = await by("/api/shelf/albums", { headers: H });
    assert.deepEqual([x.status, x.by], [200, "C#"], "Shelf's list");
    assert.equal((await x.r.json()).version, require("../package.json").version, "with Mandarin's version");
    x = await by("/app.js");
    assert.equal(x.status, 401, "the page's files still behind the gate");
    for (const p of ["/login", "/display", "/library"]) {
      x = await by(p, { headers: H, redirect: "manual" });
      assert.equal(x.by, "Node", p + ": a Node route or the page for a deep link, passed on");
    }
    // v0.8.16: hearts, Listen later and label changes made by C# (an album that isn't there, said by C#).
    const J = Object.assign({ "Content-Type": "application/json" }, H);
    for (const p of ["/api/favourites", "/api/listen-later"]) {
      x = await by(p, { method: "POST", headers: J, body: JSON.stringify({ offset: -1, on: true }) });
      assert.deepEqual([x.status, x.by], [404, "C#"], p + ": made by C#");
    }
    x = await by("/api/labels/merge", { method: "POST", headers: J, body: JSON.stringify({ items: [] }) });
    assert.deepEqual([x.status, x.by], [400, "C#"], "a label merge, by C#");
    x = await by("/api/labels/merge/nothing", { method: "DELETE", headers: H });
    assert.deepEqual([x.status, x.by], [404, "C#"], "a merge let go, by C#");
    x = await by("/api/settings/label-folder-depth", { method: "POST", headers: J, body: JSON.stringify({ depth: -1 }) });
    assert.deepEqual([x.status, x.by], [400, "C#"], "the label folder depth, by C#");
    x = await by("/api/health");
    assert.deepEqual([x.status, x.by], [200, "Node"], "health, open, passed on");
  } finally { await srv.stop(); }
});

test("v0.8.19: the identification scan's work handed to C#; MusicBrainz asked on one timer by both servers", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const META = require("../lib/meta");
  const port = ports.port(), B = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    // Handed over when the C# server started: the Node server's loops stopped for good.
    assert.deepEqual([...(ctx.frontRuns || [])].sort(), ["days", "identify", "labels", "loudness", "mbpack", "tailscale", "taste"]);
    assert.equal(ctx.identifier.handedOver, true);
    ctx.identifier.start();
    assert.equal(ctx.identifier.timer, null, "not started again here");
    // The one timer: loopback with the key, a turn each, 1.1 s apart.
    const K = { "X-Mandarin-Front-Key": ctx.frontKey };
    assert.equal((await fetch(B + "/internal/mb/slot")).status, 404, "not without the key");
    const t0 = Date.now();
    const a = await fetch(B + "/internal/mb/slot", { headers: K });
    assert.deepEqual([a.status, await a.json()], [200, { ok: true }]);
    await fetch(B + "/internal/mb/slot", { headers: K });
    const t1 = Date.now();
    // And the Node server's own requests take the next turn on it.
    await META.mbWait();
    const t2 = Date.now();
    assert.ok(t1 - t0 >= 1050, `two turns ${t1 - t0} ms apart`);
    assert.ok(t2 - t1 >= 1050, `the Node server's turn ${t2 - t1} ms after`);
  } finally { await srv.stop(); }
});

test("v0.8.20: record labels, release days and the taste work handed to C#; the Node server's own never run", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const port = ports.port(), B = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    for (const [what, done] of [["label lookups", ctx.labelLookup.handedOver], ["label logos", ctx.labelLogos.handedOver], ["release days", ctx.releaseDays.handedOver], ["Smart Picks", ctx.features.handedOver]])
      assert.equal(done, true, what + ": handed over");
    // The Node server's own passes: never started again here.
    ctx.db.setSetting("labelsEnabled", true);
    ctx.library.setLabelRules({ enabled: true });
    assert.equal(ctx.labelLookup.run({ force: true }), false);
    assert.equal(ctx.labelLogos.fetchMissing([{ key: "x", title: "X" }], { force: true }), false);
    assert.equal(await ctx.releaseDays.run(), 0);
    ctx.features.kickSmartPicks(true);
    assert.equal(ctx.features.smartBuilding, null);
    // The C# server's own addresses for the Node server: loopback, with the key, or nothing.
    const K = { "X-Mandarin-Front-Key": ctx.frontKey };
    for (const p of ["/internal/jobs/after-scan", "/internal/jobs/taste"]) {
      assert.equal((await fetch(B + p, { method: "POST" })).status, 404, p + ": not without the key");
      assert.equal((await fetch(B + p, { headers: K })).status, 404, p + ": POST only");
    }
    assert.deepEqual(await (await fetch(B + "/internal/jobs/after-scan", { method: "POST", headers: K })).json(), { ok: true });
    const g = await (await fetch(B + "/internal/jobs/taste", { method: "POST", headers: K })).json();
    assert.deepEqual([g.ok, g.heavy, g.played], [true, [], []], "built again, from no plays");
    // The routes, answered by C# once signed in.
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (const p of ["/api/filters/labels", "/api/label-albums?label=Parlophone", "/api/labels-scan-status", "/api/labels-scan-log", "/api/settings/labels",
      "/api/settings/label-folder-depth", "/api/settings/fanart-key", "/api/settings/discogs-token", "/api/smart-picks", "/api/similar?artist=Artist%20A"]) {
      const r = await fetch(B + p, { headers: H });
      assert.deepEqual([r.status, r.headers.get("x-mandarin-answered")], [200, "C#"], p);
    }
    const r = await fetch(B + "/api/labels/logo-candidates?label=Parlophone", { headers: H });
    assert.deepEqual([r.status, r.headers.get("x-mandarin-answered"), (await r.json()).error], [400, "C#", "Discogs token needed (Settings → Setup → API Keys)"]);
  } finally { await srv.stop(); }
});

test("v0.8.21: write-ups, Pitchfork, the Qobuz link, the share card's settings and playlist sharing answered by C#", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const port = ports.port(), B = "http://127.0.0.1:" + port;
  // Every source a closed port on loopback: asked, and failing at once.
  const closed = "http://127.0.0.1:9";
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false,
    mbBaseUrl: closed, wikipediaBaseUrl: closed, pitchforkBaseUrl: closed, qobuzWebUrl: closed });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token }, J = Object.assign({ "Content-Type": "application/json" }, H);
    for (let i = 0; i < 150; i++) { if ((await (await fetch(B + "/api/status", { headers: H })).json()).index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }
    for (const p of ["/api/album/extras?fast=1&title=Album%20One&artist=Artist%20A", "/api/album/extras?title=Album%20One&artist=Artist%20A", "/api/artist-bio?artist=Artist%20A",
      "/api/pitchfork/review?url=" + encodeURIComponent("https://pitchfork.com/reviews/albums/x/") + "&album=Album%20One",
      "/api/settings/share-links", "/api/qobuz-link?album=Album%20One&artist=Artist%20A", "/api/search/external?q=album&parts=pitchfork"]) {
      const r = await fetch(B + p, { headers: H });
      assert.deepEqual([r.status, r.headers.get("x-mandarin-answered")], [200, "C#"], p);
    }
    // Pitchfork's lists with neither the page nor the feed to be had: the error, as the Node server gives it.
    for (const p of ["/api/pitchfork/reviews", "/api/pitchfork/reviews?type=best"]) {
      const r = await fetch(B + p, { headers: H });
      assert.deepEqual([r.status, r.headers.get("x-mandarin-answered"), await r.json()], [500, "C#", { error: "fetch failed" }], p);
    }
    let r = await fetch(B + "/api/search/external?q=album", { headers: H });
    assert.equal(r.headers.get("x-mandarin-answered"), null, "the search's services: still the Node server's");
    r = await fetch(B + "/api/settings/share-links", { method: "POST", headers: J, body: JSON.stringify({ card_review: false }) });
    assert.deepEqual([r.status, r.headers.get("x-mandarin-answered"), (await r.json()).card], [200, "C#", { review: false }], "the share card's settings, kept by C#");
    r = await fetch(B + "/api/share/encode", { method: "POST", headers: J, body: JSON.stringify({ name: "Mine", tracks: [{ title: "Song 1", artist: "Artist A", album: "Album One" }] }) });
    assert.deepEqual([r.status, r.headers.get("x-mandarin-answered")], [200, "C#"], "a playlist shared as text, by C#");
    const { blob } = await r.json();
    r = await fetch(B + "/api/share/import", { method: "POST", headers: J, body: JSON.stringify({ blob }) });
    assert.deepEqual([r.status, r.headers.get("x-mandarin-answered")], [200, "C#"], "and read back");
    assert.deepEqual((await r.json()).resolved.map(t => [t.title, t.album_title]), [["Song 1", "Album One"]]);
  } finally { await srv.stop(); }
});

test("v0.8.22: backups, built-in Tailscale, Dynamic Playlists saved, the tag filter, the album editor and covers answered by C#", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const port = ports.port(), B = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token }, J = Object.assign({ "Content-Type": "application/json" }, H);
    const by = r => r.headers.get("x-mandarin-answered");
    const post = (p, body) => fetch(B + p, { method: "POST", headers: J, body: JSON.stringify(body) });
    for (let i = 0; i < 150; i++) { if ((await (await fetch(B + "/api/status", { headers: H })).json()).index_count >= 3) break; await new Promise(r => setTimeout(r, 100)); }
    for (const p of ["/api/backup", "/api/tailscale", "/api/filters/tags"]) {
      const r = await fetch(B + p, { headers: H });
      assert.deepEqual([r.status, by(r)], [200, "C#"], p);
    }
    // The Node server's own Tailscale engine handed over, never started there.
    assert.ok(ctx.tailscale.front, "Tailscale handed to the C# server");
    // A backup kept here: made, downloaded and deleted by C#.
    let r = await post("/api/backup/save", { include: { settings: true } });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "a backup kept here");
    const kept = (await r.json()).backup;
    r = await fetch(B + "/api/backup/download/" + kept.id, { headers: H });
    assert.deepEqual([r.status, by(r), r.headers.get("content-type")], [200, "C#", "application/gzip"], "and downloaded");
    await r.arrayBuffer();
    r = await fetch(B + "/api/backup/" + kept.id, { method: "DELETE", headers: H });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "and deleted");
    // A Dynamic Playlist saved and deleted.
    r = await post("/api/smart-playlists", { name: "Rock", view: { genre: ["Rock"] } });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "a Dynamic Playlist saved");
    r = await post("/api/smart-playlists/delete", { id: (await r.json()).playlist.id });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "and deleted");

    // Covers: one with a picture of its own (Album One's cover.jpg) drawn by
    // C#; one with none (Hi Res) drawn by the Node server, sent by C# after.
    const albums = (await (await fetch(B + "/api/library/albums?sort=album", { headers: H })).json()).albums;
    const one = albums.find(a => a.title === "Album One"), hi = albums.find(a => a.title === "Hi Res");
    r = await fetch(B + "/api/image/" + one.image_key + "?size=120", { headers: H });
    assert.deepEqual([r.status, by(r), r.headers.get("content-type")], [200, "C#", "image/jpeg"], "a cover drawn by C#");
    const drawn = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([drawn[0], drawn[1]], [0xff, 0xd8], "a JPEG");
    assert.ok(fs.existsSync(path.join(lib.data, "art", one.image_key + "@120.jpg")), "kept with the others");
    r = await fetch(B + "/api/image/" + hi.image_key + "?size=120", { headers: H });
    assert.deepEqual([r.status, by(r)], [200, null], "no cover of its own: drawn by the Node server");
    await r.arrayBuffer();
    r = await fetch(B + "/api/image/" + hi.image_key + "?size=120", { headers: H });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "and sent by C# after");

    // The album editor: its view, the cover search, an edit with a cover from an address, and undoing it.
    r = await fetch(B + "/api/album/edit?offset=" + one.offset, { headers: H });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "the editor's view");
    assert.deepEqual((await r.json()).art, { own: true, found: false, source: null });
    r = await fetch(B + "/api/album/art-search?offset=" + one.offset, { headers: H });
    assert.deepEqual([r.status, by(r), await r.json()], [200, "C#", { sure: null, candidates: [] }], "the cover search (nothing off this machine here)");
    const artUrl = ctx.auth.signUrl(B + "/api/image/" + hi.image_key + "?size=300");
    r = await post("/api/album/edit", { offset: one.offset, title: "Album One (Fixed)", art_url: artUrl });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "an edit with a found cover");
    const saved = await r.json();
    assert.deepEqual([saved.title, saved.art.found, saved.art.source], ["Album One (Fixed)", true, artUrl]);
    assert.match(saved.image_key, /^al-\d+-e[0-9a-f]{12}$/);
    r = await fetch(B + "/api/image/" + saved.image_key + "?size=200", { headers: H });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "the found cover, drawn by C#");
    await r.arrayBuffer();
    r = await post("/api/album/edit", { offset: one.offset, art_url: "not a url" });
    assert.deepEqual([r.status, by(r), await r.json()], [400, "C#", { error: "That isn't a web address" }]);
    r = await post("/api/album/edit/reset", { offset: one.offset });
    assert.deepEqual([r.status, by(r)], [200, "C#"], "the edits undone");
    const reset = await r.json();
    assert.deepEqual([reset.title, reset.image_key, reset.edited], ["Album One", one.image_key, false]);
    assert.ok(!fs.readdirSync(path.join(lib.data, "art")).some(f => f.startsWith(saved.image_key + "@")), "the found cover's sizes gone");
  } finally { await srv.stop(); }
});

test("v0.8.26: Last.fm, headphone profiles and the phone's download lists answered by C#", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
  const srv = require("../index.js").createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1",
    sonosHosts: [], upnpMulticast: false, identify: false, lastfmKey: "" });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    const by = async (p, body) => {
      const r = await fetch(B + p, body ? { method: "POST", headers: H, body: JSON.stringify(body) } : { headers: H });
      return [r.status, r.headers.get("x-mandarin-answered") || "Node", await r.json()];
    };
    assert.deepEqual(await by("/api/settings/lastfm-key"), [200, "C#", { set: false, configured: false, masked: "", source: "", check: null }]);
    assert.deepEqual(await by("/api/lastfm/similar-artists?artist=Someone"), [200, "C#", { enabled: false }]);
    assert.deepEqual(await by("/api/lastfm/similar-albums?artist=Someone"), [200, "C#", { enabled: false }]);
    assert.deepEqual((await by("/api/dsp/headphones?q=")).slice(0, 2), [200, "C#"]);
    assert.deepEqual((await by("/api/dsp/headphones/profile?id=../x")).slice(0, 2), [404, "C#"]);
    assert.deepEqual((await by("/api/dsp/headphones/parse", { text: "Filter 1: ON PK Fc 100 Hz Gain 1 dB Q 1" })).slice(0, 2), [200, "C#"]);
    assert.deepEqual(await by("/api/download/auto"), [200, "C#", { albums: [] }]);
    assert.deepEqual(await by("/api/download/albums", { ids: [] }), [200, "C#", { albums: [] }]);
    assert.deepEqual(await by("/api/download/album?offset=999999"), [404, "C#", { error: "That album is no longer in the library" }]);
    assert.deepEqual(await by("/api/phone/plays", { plays: [] }), [200, "C#", { ok: true, recorded: 0 }]);
  } finally { await srv.stop(); }
});
