"use strict";
/*
 * library-kept.test.js — answers kept once made (v0.9.3, the audit's P1 and
 * P2, docs/specs/audit-b4-main.md; LibraryRoutes.Kept.cs, Pages.Kept.cs). The
 * library's lists are made once for a copy of the library and the hearts it
 * shows, then sent as kept (X-Mandarin-Kept), a 304 for a copy still current;
 * a heart changed or an album edited makes them afresh. The Android app's page
 * and stylesheet are made once for the files they come from; a file changed
 * makes them afresh.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg } = require("./fixtures");
const { built } = require("./server");
const { started, until } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("the library's lists: kept for the copy and the hearts they were made from, made afresh when either moves", { skip, timeout: 120000 }, async (t) => {
  const { base, H, api, album } = await started(t);
  const ask = async (p, headers = {}) => {
    const r = await fetch(base + p, { headers: Object.assign({}, H, headers) });
    return { status: r.status, kept: r.headers.get("x-mandarin-kept"), tag: r.headers.get("etag"), text: r.status === 200 ? await r.text() : "" };
  };
  for (const p of ["/api/shelf/albums", "/api/library/albums?sort=album", "/api/artists?sort=az", "/api/library/facets"]) {
    const first = await ask(p);
    assert.equal(first.status, 200, p);
    assert.equal(first.kept, null, p + ": made the first time");
    const again = await ask(p);
    assert.deepEqual([again.status, again.kept, again.tag, again.text], [200, "1", first.tag, first.text], p + ": sent as kept");
    const current = await ask(p, { "If-None-Match": first.tag });
    assert.deepEqual([current.status, current.kept], [304, "1"], p + ": a copy still current");
  }
  // Another query is another answer, made for itself.
  const byYear = await ask("/api/library/albums?sort=year");
  assert.equal(byYear.kept, null, "another query");

  // A heart: the lists show it, made afresh.
  const before = await ask("/api/library/albums?sort=album");
  assert.equal(before.kept, "1");
  const one = await album("Album One");
  assert.equal(one.favourite, undefined);
  assert.equal((await api("favourites", { offset: one.offset, on: true })).status, 200);
  const hearted = await until(async () => { const r = await ask("/api/library/albums?sort=album"); return r.kept === null && r; }, 15000, "the list made again");
  assert.notEqual(hearted.tag, before.tag);
  assert.equal(JSON.parse(hearted.text).albums.find(a => a.title === "Album One").favourite, true);
  assert.equal((await ask("/api/library/albums?sort=album")).kept, "1", "and kept again");

  // An album edited: a new copy of the library, every list made afresh.
  assert.equal((await ask("/api/shelf/albums")).kept, null, "made again for the heart, as every list is");
  const shelf = await ask("/api/shelf/albums");
  assert.equal(shelf.kept, "1");
  assert.equal((await api("album/edit", { offset: one.offset, title: "Album One, Edited" })).status, 200);
  const edited = await until(async () => { const r = await ask("/api/shelf/albums"); return r.text.includes("Album One, Edited") && r; }, 15000, "the Shelf made again");
  assert.equal(edited.kept, null);
  assert.notEqual(edited.tag, shelf.tag);
});

test("what the play history decides isn't kept past a play: Most played, the Played filter, the facets", { skip, timeout: 120000 }, async (t) => {
  const { base, H, ctx, album } = await started(t);
  const ask = async (p) => {
    const r = await fetch(base + p, { headers: H });
    return { kept: r.headers.get("x-mandarin-kept"), json: await r.json() };
  };
  const titles = (r) => r.json.albums.map(a => a.title);
  // Nothing played yet: each answered twice, as the page asks.
  for (const p of ["/api/library/albums?sort=plays&dir=desc", "/api/library/albums?sort=album&played=played", "/api/library/facets"]) { await ask(p); await ask(p); }
  assert.equal((await ask("/api/library/facets")).json.hasPlays, false);
  assert.equal((await ask("/api/library/facets")).kept, "1", "the facets kept while nothing changes");
  assert.deepEqual(titles(await ask("/api/library/albums?sort=album&played=played")), []);
  // A play (as the server writes one): no scan, no heart, so the library's copy is the same.
  const hi = await album("Hi Res");
  ctx.features.insertPlay.run(hi.offset, null, "Song", "Artist B", "Hi Res", "TEST", Date.now());
  const most = await ask("/api/library/albums?sort=plays&dir=desc");
  assert.equal(most.kept, null, "Most played is never sent as kept");
  assert.equal(titles(most)[0], "Hi Res", "the album just played comes first");
  assert.deepEqual(titles(await ask("/api/library/albums?sort=album&played=played")), ["Hi Res"], "the Played filter has it");
  const facets = await ask("/api/library/facets");
  assert.equal(facets.json.hasPlays, true, "the facets know something has been played");
  assert.equal(facets.kept, null);
  assert.equal((await ask("/api/library/facets")).kept, "1", "and are kept again for that");
});

test("the Android app's page and stylesheet: kept for the files they come from, made afresh when one changes", { skip, timeout: 120000 }, async (t) => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "mandarin-app-"));
  t.after(() => fs.rmSync(app, { recursive: true, force: true }));
  fs.cpSync(path.join(__dirname, "..", "public"), path.join(app, "public"), { recursive: true });
  const { base, H } = await started(t, { appDir: app });
  const asApp = Object.assign({ "User-Agent": "Mozilla/5.0 MusicDAndroid/0.9.3" }, H);
  const ask = async (p) => {
    const r = await fetch(base + p, { headers: asApp });
    return { status: r.status, kept: r.headers.get("x-mandarin-kept"), tag: r.headers.get("etag"), text: await r.text() };
  };
  for (const p of ["/style.css", "/"]) {
    const first = await ask(p);
    assert.equal(first.status, 200, p);
    assert.equal(first.kept, null, p + ": made the first time");
    const again = await ask(p);
    assert.deepEqual([again.kept, again.tag, again.text], ["1", first.tag, first.text], p + ": sent as kept");
  }
  // The app's own rules changed (an update puts new files in place): made afresh, with them.
  const before = await ask("/style.css");
  fs.appendFileSync(path.join(app, "public", "android.css"), "\n.kept-test { color: red; }\n");
  const after = await ask("/style.css");
  assert.equal(after.kept, null);
  assert.notEqual(after.tag, before.tag);
  assert.match(after.text, /\.kept-test \{ color: red; \}/);
  assert.equal((await ask("/style.css")).kept, "1", "and kept again");
});
