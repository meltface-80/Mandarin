"use strict";
/*
 * Capitals don't make a different thing (v0.6.3): "Rock" and "rock" are one
 * genre, "If I Fell" and "if i fell" one title to the match score, "The A
 * Team" and "the a team" one album and one artist.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const DB = require("../lib/library/db");
const { Library } = require("../lib/library");
const { Scanner } = require("../lib/library/scanner");
const N = require("../lib/library/normalize");
const SCORE = require("../lib/identify/score");

const skip = !haveFfmpeg() && "ffmpeg is not installed";

test("one genre whatever its capitals, shown as most of the library writes it", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const db = DB.open(lib.data, { log: () => {} });
  const library = new Library(db, { musicRoot: lib.music, log: () => {} });
  await new Scanner({ db, root: lib.music, log: () => {} }).scan();
  const ids = db.raw.prepare("SELECT id FROM albums ORDER BY id").all().map(r => r.id);
  assert.ok(ids.length >= 3);
  const set = db.raw.prepare("UPDATE albums SET genres = ? WHERE id = ?");
  set.run(JSON.stringify(["Rock", "Jazz"]), ids[0]);
  set.run(JSON.stringify(["rock"]), ids[1]);
  set.run(JSON.stringify(["Rock", "ROCK"]), ids[2]);
  library.reload();
  const rock = library.genres().filter(g => N.fold(g.title) === "rock");
  assert.deepEqual(rock.map(g => [g.title, g.count]), [["Rock", 3]]);
  assert.deepEqual(library.album(ids[2]).genres, ["Rock"], "one album's two spellings are one genre");
  const facet = library.facets().facets.find(f => f.id === "genre");
  assert.deepEqual(facet.values.filter(v => N.fold(v.value) === "rock").map(v => [v.value, v.count]), [["Rock", 3]]);
  db.close();
});

test("names to the match score and the library's identity", () => {
  assert.equal(SCORE.titleDist("If I Fell", "if i fell"), 0);
  assert.equal(SCORE.stringDist("Tales From Topographic Oceans", "Tales from Topographic Oceans"), 0);
  assert.equal(N.key("The A Team"), N.key("the a team"));
  assert.equal(N.artistKey("Siouxsie And The Banshees"), N.artistKey("siouxsie and the banshees"));
});
