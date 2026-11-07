"use strict";
/*
 * The app's artist page asks who they are at every visit, and again while the server is still looking (item 341).
 * The page was kept for fifteen minutes and nothing of it asked again in that time: an artist the server had found
 * since to be another act than it first said (Airbag from Norway, not the Spanish band) stayed the other act on the
 * page. Who they are is asked even while the rest of the page is kept, and asked again every few seconds, a few
 * times, while the server answers that it is still looking ("pending"); a still-looking answer replaces what was shown.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SCREEN = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/ArtistScreen.kt"), "utf8");
const PAGE = fs.readFileSync(path.join(__dirname, "..", "public/app/artist-about.js"), "utf8");

test("who they are is asked at every visit, the rest of a recent page kept", () => {
  assert.match(SCREEN, /if \(kept\?\.albums != null && ArtistPages\.kept\.fresh\(key\)\) \{ whoTheyAre\(\); return@LaunchedEffect \}/);
  assert.doesNotMatch(SCREEN, /ArtistPages\.kept\.fresh\(key\)\) return@LaunchedEffect/, "never left out because the page is recent");
});

test("asked again every few seconds while the server is still looking, its answer shown", () => {
  const who = SCREEN.slice(SCREEN.indexOf("suspend fun whoTheyAre()"), SCREEN.indexOf("if (kept?.albums != null"));
  assert.match(who, /repeat\(5\) \{ n ->\s+if \(n > 0\) delay\(3000\)/);
  assert.match(who, /about = got; keep \{ it\.copy\(about = got\) \}/);
  assert.match(who, /if \(!got\.pending\) return/);
});

test("the page asks again too while the server is still looking", () => {
  assert.match(PAGE, /a && a\.pending && n < 4 && alive\(\) \? new Promise\(r => setTimeout\(r, 3000\)\)\.then\(\(\) => about\(n \+ 1\)\) : a/);
});
