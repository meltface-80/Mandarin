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
  "\n;({ scanPercent, scanProgressWords, scanNowWords, scanReasons, scanOtherName, scanSoundNote, scanSoundTally })", {});

test("To confirm's words (item 414b): a verdict's reasons, and another release in place of the one proposed", () => {
  assert.strictEqual(words.scanReasons(["found by its barcode", "4 of 4 tracks' lengths agree", null, ""]), "found by its barcode · 4 of 4 tracks' lengths agree");
  assert.strictEqual(words.scanReasons(undefined), "");
  assert.strictEqual(words.scanOtherName({ mbid: "o1", artist: "Someone Else", title: "Near Miss", year: 1980, edition: null, source: "musicbrainz", similarity: 40 }),
    "Someone Else — Near Miss (1980) · 40 %");
  assert.strictEqual(words.scanOtherName({ mbid: "o2", artist: "", title: "Near Miss", year: null, source: "itunes", similarity: 31 }), "Near Miss · iTunes · 31 %");
  assert.strictEqual(words.scanOtherName({ artist: "A", title: "B", edition: "deluxe", similarity: null }), "A — B · deluxe");
});

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

test("matching by sound (item 414c): the step on the Now line, and why the albums left unsure aren't matched by it", () => {
  const at = (step) => words.scanNowWords({ now: { reason: "working", step, album: { offset: 7, artist: "U2", title: "Pop" } } });
  assert.strictEqual(at("matching by sound"), "Now: U2 — Pop · matching by sound");
  assert.strictEqual(at("fingerprinting"), "Now: U2 — Pop · fingerprinting");
  // Its key Mandarin's own since item 491: nothing for the owner to paste, so nowhere to send them.
  assert.strictEqual(words.scanSoundNote({ sound: "needs-key" }), "This build of Mandarin carries no AcoustID key, so albums aren't matched by sound.");
  assert.strictEqual(words.scanSoundNote({ sound: "refused" }), "AcoustID refused Mandarin's key, so albums aren't matched by sound for now.");
  assert.strictEqual(words.scanSoundNote({ sound: "limited" }), "AcoustID asked to wait: matching by sound rests a few minutes.");
  assert.strictEqual(words.scanSoundNote({ sound: "unreachable" }), "AcoustID can't be reached: matching by sound rests a few minutes.");
  assert.strictEqual(words.scanSoundNote({ sound: null }), "", "matched by sound, or nothing left unsure: nothing said");
  assert.strictEqual(words.scanSoundNote(null), "");
});

test("paused while music plays, and where (item 417b): the rooms and phones by name, else the track made and its room", () => {
  const at = holding => words.scanNowWords({ now: { reason: "playing", holding } });
  const room = (name, kind = "room") => ({ kind, name, state: "playing", since: 1, heard: 2, track: null });
  assert.strictEqual(at([room("Living room")]), "Paused while music plays in Living room");
  assert.strictEqual(at([room("Kitchen"), room("Living room")]), "Paused while music plays in Kitchen and Living room");
  assert.strictEqual(at([room("Den"), room("Pixel 8", "phone"), room("Living room")]), "Paused while music plays in Den, Pixel 8 and Living room");
  // A making beside a room: the room is what plays.
  assert.strictEqual(at([room("Lounge"), { kind: "making", name: "Lounge", state: "making", track: "01 Long" }]), "Paused while music plays in Lounge");
  assert.strictEqual(at([{ kind: "making", name: "Lounge", state: "making", track: "01 Long" }]), "Paused while a track is made for Lounge");
  assert.strictEqual(at([{ kind: "making", name: null, state: "making", track: "01 Long" }]), "Paused while a track is made as it plays");
  // A server from before it says nothing of what plays.
  assert.strictEqual(at(undefined), "Paused while music plays");
  assert.strictEqual(at([]), "Paused while music plays");
});

test("how far matching by sound has got, on the Album Scanner's page since its key is Mandarin's own (item 491)", () => {
  assert.strictEqual(words.scanSoundTally({ matched: 13, waiting: 848, held: "off" }), "By sound: 13 albums matched so far, 848 still to look at, when the Album Scanner is on.");
  assert.strictEqual(words.scanSoundTally({ matched: 1, waiting: 3, held: "hours" }), "By sound: 1 album matched so far, 3 still to look at, in the Album Scanner's hours.");
  assert.strictEqual(words.scanSoundTally({ matched: 5, waiting: 0, held: null }), "By sound: 5 albums matched so far, 0 still to look at.");
  assert.strictEqual(words.scanSoundTally(null), "", "no key: nothing said of it");
  // The page shows it beside why the albums aren't matched by sound, as the app does (ScannerTest.kt).
  const blocks = fs.readFileSync(path.join(__dirname, "..", "public", "app", "settings-scanner-blocks.js"), "utf8");
  assert.match(blocks, /tally = scanSoundTally\(scan\.sound_tally\)/);
  assert.match(blocks, /\(tally \? '<div class="settings-note" data-parity="settings-scanner\.note">' \+ scanEsc\(tally\)/);
});
