"use strict";
/*
 * Capitals don't make a different thing (v0.6.3): "Rock" and "rock" are one
 * genre, "If I Fell" and "if i fell" one title to the match score, "The A
 * Team" and "the a team" one album and one artist.
 *
 * On the C# server (v0.8.50, stage 7 part 5; lib/library and
 * lib/identify/score.js before): its lists asked as the pages ask them, its
 * scorer asked through `mandarin-server score`.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { built } = require("./server");
const { libraryServer } = require("./library-server");
const { score } = require("./score");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const fold = (s) => s.toLowerCase();

test("one genre whatever its capitals, shown as most of the library writes it", { skip, timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  const s = await libraryServer(t, lib);
  const ids = s.db.raw.prepare("SELECT id FROM albums ORDER BY id").pluck().all();
  assert.ok(ids.length >= 3);
  const set = s.db.raw.prepare("UPDATE albums SET genres = ? WHERE id = ?");
  set.run(JSON.stringify(["Rock", "Jazz"]), ids[0]);
  set.run(JSON.stringify(["rock"]), ids[1]);
  set.run(JSON.stringify(["Rock", "ROCK"]), ids[2]);
  await s.reload();
  const rock = (await s.getJ("/api/filters/genres")).genres.filter(g => fold(g.title) === "rock");
  assert.deepEqual(rock.map(g => [g.title, g.subtitle]), [["Rock", "3 albums"]]);
  assert.deepEqual((await s.album(ids[2])).album.genres, ["Rock"], "one album's two spellings are one genre");
  const facet = (await s.getJ("/api/library/facets")).facets.find(f => f.id === "genre");
  assert.deepEqual(facet.values.filter(v => fold(v.value) === "rock").map(v => [v.value, v.count]), [["Rock", 3]]);
});

test("names to the match score", { skip: built() }, () => {
  const { pairs } = score({ fn: "pairs", pairs: [["If I Fell", "if i fell"], ["Tales From Topographic Oceans", "Tales from Topographic Oceans"]] });
  assert.equal(pairs[0].title, 0);
  assert.equal(pairs[1].string, 0);
});

test("names to the library's identity: one album, one artist", { skip, timeout: 60000 }, async (t) => {
  const lib = makeLibrary();
  const T = (p, tags) => gen(path.join(lib.music, p), { seconds: 1, tags });
  T("Siouxsie/A Team/01.flac", { title: "One", artist: "Siouxsie And The Banshees", album: "The A Team", track: 1 });
  T("Siouxsie/A Team/02.flac", { title: "Two", artist: "siouxsie and the banshees", album: "the a team", track: 2 });
  T("Siouxsie/Other/01.flac", { title: "Three", artist: "SIOUXSIE AND THE BANSHEES", album: "Other", track: 1 });
  const s = await libraryServer(t, lib);
  const team = (await s.albums()).filter(a => fold(a.title) === "the a team");
  assert.equal(team.length, 1, "one album");
  assert.equal((await s.album(team[0].offset)).tracks.length, 2);
  const { primary } = await s.getJ("/api/artist-albums?artist=" + encodeURIComponent("siouxsie and the banshees"));
  assert.deepEqual(primary.map(a => fold(a.title)).sort(), ["other", "the a team"], "one artist");
});
