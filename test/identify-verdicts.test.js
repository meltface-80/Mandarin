"use strict";
/*
 * identify-verdicts.test.js — your say on a match (v0.9.0, the audit's T1,
 * docs/specs/audit-b4-main.md): POST /api/identify/accept and
 * /api/identify/reject, which no test called before. A proposal waiting for
 * an album (as a version before v0.8.41 left them, or a scan that found it
 * between 85 % and 95 % then): accepted, its title, artist, year and track
 * names laid over the album, what was there kept; rejected once applied, all
 * of that put back; rejected while waiting, declined and nothing applied.
 * An album no longer there, and one with no verdict, say so.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg } = require("./fixtures");
const { built } = require("./server");
const { started, until } = require("./helpers");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");

test("a proposal accepted, then rejected: laid over the album, then put back; one declined while waiting", { skip, timeout: 90000 }, async (t) => {
  const { ctx, api, album } = await started(t);
  const raw = ctx.db.raw;
  const keyOf = title => raw.prepare("SELECT key FROM albums WHERE title = ?").get(title).key;
  const propose = (title, cand) => raw.prepare("INSERT INTO album_matches(key, mbid, distance, status, candidate, before, checked_at, applied_at) VALUES(?, ?, 0.1, 'proposed', ?, NULL, ?, NULL)")
    .run(keyOf(title), cand.mbid, JSON.stringify(cand), Date.now());
  const verdict = title => raw.prepare("SELECT status, before IS NOT NULL AS kept FROM album_matches WHERE key = ?").get(keyOf(title));
  const edit = title => raw.prepare("SELECT title, artist, year FROM album_edits WHERE key = ?").get(keyOf(title)) || null;
  const trackNames = title => raw.prepare("SELECT title FROM track_edits WHERE key = ? AND title IS NOT NULL ORDER BY pos").all(keyOf(title)).map(r => r.title);
  propose("Album One", { mbid: "m-one", artist: "Artist A & Friends", title: "Album One (Deluxe)", year: 1998, parts: {},
    tracks: [{ title: "First" }, { title: "Second" }, { title: "Third" }] });
  propose("Hi Res", { mbid: "m-hires", artist: "Artist B", title: "Not This One", year: 2001, parts: {}, tracks: [] });
  const one = await album("Album One"), hires = await album("Hi Res"), best = await album("Best Of");

  // Accepted: the release's names over the album's, what it had kept for an undo.
  let r = await api("identify/accept", { offset: one.offset });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(verdict("Album One"), { status: "applied", kept: 1 });
  assert.deepEqual(edit("Album One"), { title: "Album One (Deluxe)", artist: "Artist A & Friends", year: 1998 });
  assert.deepEqual(trackNames("Album One"), ["First", "Second", "Third"]);
  await until(async () => { const a = await album("Album One (Deluxe)"); return a?.year === 1998 && a.subtitle === "Artist A & Friends"; }, 15000, "the library to show the match");

  // Rejected once applied: put back as it was, and declined.
  r = await api("identify/reject", { offset: (await album("Album One (Deluxe)")).offset });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(verdict("Album One"), { status: "rejected", kept: 0 });
  assert.deepEqual(trackNames("Album One"), []);
  assert.equal(edit("Album One")?.title ?? null, null, "the title the files give");
  await until(async () => { const a = await album("Album One"); return a?.year === 1997 && a.subtitle === "Artist A"; }, 15000, "the library to show the album as it was");

  // Rejected while waiting: declined, nothing laid over it.
  r = await api("identify/reject", { offset: hires.offset });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(verdict("Hi Res"), { status: "rejected", kept: 0 });
  assert.equal(edit("Hi Res"), null);

  // No verdict to accept or reject; no such album.
  assert.deepEqual(await api("identify/accept", { offset: best.offset }), { status: 409, json: { error: "Nothing to accept for this album" } });
  assert.deepEqual(await api("identify/reject", { offset: best.offset }), { status: 409, json: { error: "Nothing to reject for this album" } });
  assert.deepEqual(await api("identify/accept", { offset: 987654 }), { status: 404, json: { error: "No such album" } });
});
