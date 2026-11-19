"use strict";
/*
 * One tap, one play, on the Android app's album page (item 490). An album new to the library is answered after its
 * tracks' rates are read from iBroadcast (item 463), a second or more; the app showed nothing meanwhile, so the tap
 * was taken for one that did nothing and made again, and each tap started the album afresh: on the owner's phone
 * three taps on Pallas' XXV, three starts, and sound 8.8 s after the first. The web page has always dimmed its button
 * and shown "…" until the play is answered (album-extras.js invoke); the app now does as it does. Its module is built
 * only by CI, so its wiring is read here.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SCREEN = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/com/musicd/server/android/AlbumScreen.kt"), "utf8");
const PAGE = fs.readFileSync(path.join(ROOT, "public/app/album-extras.js"), "utf8");

test("a play sent and not yet answered: another tap sends nothing, and the album's Play Now and Queue show it is starting", () => {
  assert.match(SCREEN, /var starting by remember\(offset\) \{ mutableStateOf\(false\) \}/);
  const play = SCREEN.slice(SCREEN.indexOf("    fun play(said: String"), SCREEN.indexOf("    // Made on the app's lane"));
  assert.match(play, /if \(zone\.isEmpty\(\)\) \{ toast\("Pick a zone first"\); return \}\s+if \(starting\) return else starting = true\s+scope\.launch \{\s+try \{[\s\S]*?\} finally \{ starting = false \}/);
  for (const key of ["album.play-now", "album.queue"]) {
    const at = SCREEN.indexOf(`Modifier.parity("${key}"`);
    const button = SCREEN.slice(SCREEN.lastIndexOf("Button(onClick", at), at);
    assert.match(button, /enabled = !starting/, key);
  }
  // Every play the page sends goes through it: the album, a track, a work, a version.
  assert.ok((SCREEN.match(/\bplay\("/g) || []).length >= 6, "the album page's plays");
  assert.doesNotMatch(SCREEN, /scope\.launch \{\s+val r = withContext\(Dispatchers\.IO\) \{ runCatching \{ c\.play/, "no play sent beside it");
});

test("as the web page does", () => {
  const invoke = PAGE.slice(PAGE.indexOf("async function invoke(kind, btn)"), PAGE.indexOf("function zoneName("));
  assert.match(invoke, /btn\.disabled = true; btn\.textContent = "…";[\s\S]*finally \{\s+btn\.disabled = false; btn\.textContent = orig;/);
});
