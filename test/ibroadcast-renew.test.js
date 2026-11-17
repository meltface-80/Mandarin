"use strict";
/*
 * When the iBroadcast sign-in's token is renewed (item 456): with ten minutes left, longer than a file takes to upload.
 * A night's upload had two files an hour refused as they finished, each given the token with less than a minute left
 * (then the rule) and finishing after it ran out. A token shorter-lived than twenty minutes at half its life, so a
 * fresh one is never renewed at once; one kept without its life (signed in before), at its last minute, as before.
 */
const test = require("node:test");
const assert = require("node:assert");
const { score } = require("./score");
const { built } = require("./server");

const MIN = 60 * 1000, HOUR = 60 * MIN;

test("item 456: iBroadcast's token renewed ten minutes before it runs out, never a fresh one", { skip: built() }, () => {
  const cases = [
    { now: 0, expires: HOUR, life: HOUR },                       // fresh: kept
    { now: 49 * MIN, expires: HOUR, life: HOUR },                 // eleven minutes left: kept
    { now: 51 * MIN, expires: HOUR, life: HOUR },                 // nine minutes left: renewed (the minute's rule kept it, and files were refused)
    { now: 59.5 * MIN, expires: HOUR, life: HOUR },               // the last minute: renewed
    { now: 0, expires: 5 * MIN, life: 5 * MIN },                  // a five-minute token, fresh: kept (not renewed at once, as ten minutes would)
    { now: 3 * MIN, expires: 5 * MIN, life: 5 * MIN },            // past half its life: renewed
    { now: 51 * MIN, expires: HOUR, life: null },                 // its life not known: the last minute only, as before
    { now: 59.5 * MIN, expires: HOUR, life: null },
  ];
  assert.deepEqual(score({ fn: "ibroadcastrenew", cases }).due, [false, false, true, true, false, true, false, true]);
});
