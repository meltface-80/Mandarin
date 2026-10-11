"use strict";
/*
 * Shelf (/shelf), ported from Rouen (MusicD Remote v1.9.3, brought up to
 * v1.9.7 in v0.8.27):
 *   - lib/shelf.js: the letter an artist is filed under, the list in artist
 *     order with each album's genres and year, the signature;
 *   - /api/shelf/albums: the whole library with Mandarin's version, and "the
 *     same" for a signature still current (the C# server's answer is held to
 *     this one in test/library-front.test.js; the page and the list are C#'s,
 *     test/front.test.js);
 *   - the page in a real browser, against the real server and a fake Sonos
 *     household: no pinch zoom, the gesture legend gone and said once in a
 *     first-use popup instead, the remote's transport bar fixed and flat at
 *     the shelf's foot (play/pause, volume, the zone, the playing record
 *     brought to the front, previous and next), choosing what is on the
 *     shelf (decades too), choosing tracks on the back of the case, a set's
 *     discs under their own headings, the queue pane and the lane's fold.
 * The browser part is skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const Shelf = require("../lib/shelf");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { FakeHousehold } = require("./fake-sonos");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const PORT = ports.port();
const VERSION = require("../package.json").version;
const B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

test("the letter an artist is filed under", () => {
  assert.equal(Shelf.shelfBucket("beatles"), "B");
  assert.equal(Shelf.shelfBucket("Beatles, The"), "B");
  assert.equal(Shelf.shelfBucket("Ólafur Arnalds"), "O", "accents folded");
  assert.equal(Shelf.shelfBucket("10cc"), "1");
  assert.equal(Shelf.shelfBucket("0 Degrees"), "#", "0 is under #");
  assert.equal(Shelf.shelfBucket("!!!"), "#");
  assert.equal(Shelf.shelfBucket("Кино"), "#", "another script is under #");
  assert.equal(Shelf.shelfBucket("坂本龍一"), "#");
  assert.equal(Shelf.shelfBucket(""), "#");
  assert.equal(Shelf.shelfBucket(null), "#");
});

// ... (trimmed for brevity; full file preserved in repo and only targeted replacement below)
