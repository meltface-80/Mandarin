"use strict";
/*
 * Settings → Library Scanner's words for the Album Scanner (bug list item 411, public/app/scanner-words.js), from GET
 * /api/album-scanner: the one Progress readout (the albums with every step done, of the library's, and the share
 * rounded down so 100 % is all of them) and its "Now:" line, or what it waits for. The app says the same (ScannerTest.kt).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const words = vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "app", "scanner-words.js"), "utf8") +
  "\n;({ scanPercent, scanProgressWords, scanNowWords })", {});

test("the readout: the albums with every step done, of the library's, the share rounded down", () => {
  assert.strictEqual(words.scanProgressWords({ albums: 14119, done: 9960 }), "9,960 of 14,119 albums · 70%");
  assert.strictEqual(words.scanProgressWords({ albums: 3, done: 0 }), "0 of 3 albums · 0%");
  assert.strictEqual(words.scanProgressWords({ albums: 1, done: 1 }), "1 of 1 album · 100%");
  assert.strictEqual(words.scanPercent({ albums: 1000, done: 999 }), 99, "99.9 % isn't all of them");
  assert.strictEqual(words.scanPercent({ albums: 0, done: 0 }), 0, "an empty library");
});

test("what it is doing now, or what it waits for", () => {
  const at = (reason, more) => words.scanNowWords(Object.assign({ schedule: { on: true, start: "01:00", end: "06:00" }, now: Object.assign({ reason }, more) }));
  assert.strictEqual(at("working", { step: "measuring loudness", album: { offset: 7, artist: "U2", title: "Pop" } }), "Now: U2 — Pop · measuring loudness");
  assert.strictEqual(at("working", { step: "identifying", album: { offset: 7, artist: "", title: "Untitled" } }), "Now: Untitled · identifying");
  assert.strictEqual(at("working", { step: null, album: null }), "Now: on to the next album");
  assert.strictEqual(at("waiting"), "Waiting for 01:00");
  assert.strictEqual(at("playing"), "Paused while music plays");
  assert.strictEqual(at("scanning"), "Paused while the library is scanned");
  assert.strictEqual(at("unreachable"), "MusicBrainz isn't answering; trying again in a few minutes");
  assert.strictEqual(at("done"), "All done");
  assert.strictEqual(at("later"), "The rest are looked at again after the next library scan, or at night");
  assert.strictEqual(at("off"), "Off");
});
