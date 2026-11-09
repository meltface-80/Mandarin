"use strict";
/*
 * An artist's page follows the library (item 357). The page and the app keep an artist's page a quarter of an hour, so
 * one opened again is drawn at once (item 140); an album deleted from the music folders stayed on it that long, and
 * opening it said it was no longer in the library. When the library's mark moves, the page's kept albums and who they
 * are (/api/artist-albums, /api/artist) are let go, so the page asks afresh when next opened; what other services said
 * (similar artists and albums) is kept. The app marks its kept pages stale (TimedCache.stale, tested in the core's own
 * tests) and an open artist page reads its albums again in place.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// The page's two parts run as the page runs them: library-mark.js wraps fetch, artist-foot.js keeps the answers.
function page() {
  const asked = [];
  let mark = "m1";
  const timers = [];
  const window = {
    fetch: (url) => { asked.push(String(url)); return Promise.resolve({ ok: true, headers: { get: (h) => (h === "x-mandarin-library" ? mark : null) }, json: async () => ({ url }) }); },
    __libraryChanged: () => { window.changed = (window.changed || 0) + 1; },
  };
  // The page's window is its global, as in a browser: a part's own fetch is the wrapped one.
  const ctx = Object.assign(window, { window, document: { hidden: true }, setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {}, Date, Promise, Map });
  vm.createContext(ctx);
  vm.runInContext(read("public/app/library-mark.js"), ctx);
  vm.runInContext(read("public/app/artist-foot.js"), ctx);
  const flush = async () => { await new Promise((r) => setImmediate(r)); while (timers.length) timers.shift()(); };
  return { window, asked, move: (m) => { mark = m; }, flush };
}

test("the library's mark moved: an artist's albums and who they are asked afresh, the rest kept", async () => {
  const p = page();
  const albums = "/api/artist-albums?artist=Dua%20Lipa", about = "/api/artist?name=Dua%20Lipa", similar = "/api/artist/similar?name=Dua%20Lipa";
  for (const u of [albums, about, similar]) await p.window.__artistJson(u);
  await p.flush();
  for (const u of [albums, about, similar]) await p.window.__artistJson(u);
  assert.equal(p.asked.length, 3, "kept: opened again, nothing asked");
  // A scan took an album away: the next answer carries another mark.
  p.move("m2");
  await p.window.fetch("/api/status");
  await p.flush();
  assert.equal(p.window.changed, 1, "the rows told, as before");
  const before = p.asked.length;
  for (const u of [albums, about, similar]) await p.window.__artistJson(u);
  assert.deepEqual(p.asked.slice(before), [albums, about], "the albums and who they are asked afresh; similar artists kept");
});

test("the app: a library change marks the kept pages stale, and an open artist page reads its albums again", () => {
  const live = read("android/app/src/main/java/com/musicd/server/android/LibraryLive.kt");
  assert.match(live.slice(live.indexOf("fun moved()")), /^fun moved\(\) \{\s+LibraryWall\.fallBehind\(\)\s+ArtistPages\.kept\.stale\(\)\s+moves\+\+/);
  const screen = read("android/app/src/main/java/com/musicd/server/android/ArtistScreen.kt");
  const eff = screen.slice(screen.indexOf("LaunchedEffect(asked, LibraryLive.moves)"));
  assert.match(eff, /^LaunchedEffect\(asked, LibraryLive\.moves\) \{\s+if \(LibraryLive\.moves == movesSeen\) return@LaunchedEffect/);
  assert.match(eff.slice(0, 900), /lib\.artistAlbums\(asked\)[\s\S]*albums = got/);
});
