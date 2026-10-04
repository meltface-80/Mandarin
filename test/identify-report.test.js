"use strict";
/*
 * tools/identify-report.js (v0.6.3): the scan's work on a library as JSON,
 * for trying changes to the scoring against real albums — each album's
 * tracks, folder and box, what was decided and what you did, and with
 * --fetch the releases MusicBrainz offers. It works on a copy of the
 * database and changes nothing.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const DB = require("../lib/library/db");
const { Scanner } = require("../lib/library/scanner");
const { FakeMusicBrainz } = require("./fake-musicbrainz");

const skip = !haveFfmpeg() && "ffmpeg is not installed";
const TOOL = path.join(__dirname, "..", "tools", "identify-report.js");

function run(args) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, ["-"].concat(args), { cwd: path.join(__dirname, "..") });
    let out = "", err = "";
    c.stdout.on("data", d => { out += d; }); c.stderr.on("data", d => { err += d; });
    c.on("close", code => resolve({ code, out, err }));
    c.stdin.end(fs.readFileSync(TOOL));
  });
}

test("the identify report: every album with its tracks, folder and decision; candidates with --fetch", { skip, timeout: 60000 }, async () => {
  const lib = makeLibrary();
  const db = DB.open(lib.data, { log: () => {} });
  await new Scanner({ db, root: lib.music, log: () => {} }).scan();
  const before = db.raw.prepare("SELECT COUNT(*) AS n FROM album_matches").get().n;
  db.close();
  const mb = await new FakeMusicBrainz([{ id: "r1", title: "Album One", artist: "Artist A", date: "1997", tracks: [["Song 1", 3], ["Song 2", 3], ["Song 3", 3]] }]).start();
  try {
    let r = await run(["--music=" + lib.music, "--data=" + lib.data]);
    assert.equal(r.code, 0, r.err);
    let j = JSON.parse(r.out);
    assert.equal(j.fetched, false);
    const one = j.albums.find(a => a.title === "Album One");
    assert.ok(one);
    assert.equal(one.tracks.length, 3);
    assert.equal(one.tracks[0].no, 1);
    assert.ok(one.tracks[0].length > 2);
    assert.deepEqual(one.folders, [path.join(path.basename(lib.music), "Artist A", "Album One")]);
    assert.equal(one.candidates, undefined);

    r = await run(["--fetch", "--mb=" + mb.baseUrl, "--music=" + lib.music, "--data=" + lib.data]);
    assert.equal(r.code, 0, r.err);
    j = JSON.parse(r.out);
    const c = j.albums.find(a => a.title === "Album One").candidates;
    assert.equal(c[0].mbid, "r1");
    assert.equal(c[0].similarity, 100);
    assert.equal(c[0].tracks.length, 3);
    assert.equal(c[0].tracks[0].disc, 1);
    // Nothing was written to the library's own database.
    const db2 = DB.open(lib.data, { log: () => {} });
    assert.equal(db2.raw.prepare("SELECT COUNT(*) AS n FROM album_matches").get().n, before);
    db2.close();
  } finally { await mb.stop(); }
});
