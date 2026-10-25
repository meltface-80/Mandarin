"use strict";
/*
 * Shuffle on the phone's own player (bug list item 194): an album of the phone's music, or a download in the phone's
 * room offline. It went onto the player in its order from track 1 with the player's shuffle switched on, so the first
 * track was always track 1 and every album played after it was shuffled too. It goes on in a shuffled order now (core
 * PhoneShuffle, tested in PhoneShuffleTest), the player's own shuffle left as it was.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const svc = fs.readFileSync(path.join(__dirname, "..", "android/app/src/main/java/com/musicd/server/android/PhonePlayerService.kt"), "utf8");

test("a shuffle never switches the player's own shuffle on", () => {
  assert.doesNotMatch(svc, /shuffleModeEnabled = true/);
  const mode = svc.match(/shuffleModeEnabled = [^\n]*/g) || [];
  assert.deepStrictEqual(mode, ["shuffleModeEnabled = c.shuffle"], "only Now playing's button sets it");
});

test("the phone's album and a download go on in a shuffled order", () => {
  const album = svc.slice(svc.indexOf("private fun playPhoneAlbum("), svc.indexOf("private fun localPlay("));
  assert.match(album, /localPlay\(com\.musicd\.server\.client\.PhoneShuffle\.order\(items, k\), start, /);
  const offline = svc.slice(svc.indexOf("fun offlinePlay("), svc.indexOf("class OfflineItem("));
  assert.match(offline, /items = com\.musicd\.server\.client\.PhoneShuffle\.order\([^\n]*, kind\)/);
});
