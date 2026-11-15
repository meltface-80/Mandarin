"use strict";
/*
 * Export library (item 436): the library's own files as the CSV Mandarin Migration reads to add them to a Qobuz account
 * (musicd-migrate's docs/library-csv.md): one row per track, its header first, each album's album and album artist and
 * barcode on every row of it, a title holding a comma quoted; two versions of one
 * record told apart by their versions' words, as the migration app would otherwise make one album of them; how many
 * albums, tracks and barcodes went in said in X-Mandarin-Export; saved under the server's name for it.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { createServer, built } = require("./server");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function until(fn, ms = 60000, what = "") {
  const t0 = Date.now();
  for (;;) {
    const v = await Promise.resolve().then(fn).catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting" + (what ? " for " + what : ""));
    await sleep(100);
  }
}

/** The CSV as rows of cells (RFC 4180). @param {string} text */
function rows(text) {
  const out = []; let row = []; let cell = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q && ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (q && ch === '"') q = false;
    else if (q) cell += ch;
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\r") { /* the line's end */ } else if (ch === "\n") { row.push(cell); cell = ""; out.push(row); row = []; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

test("item 436: Export library writes the migration app's CSV of the library's own files", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const put = (dir, n, tags) => gen(path.join(lib.music, dir, `0${n}.flac`), { seconds: 2, freq: 300 + 40 * n, tags: Object.assign({ track: n }, tags) });
  // An album with a barcode, one of its titles holding a comma.
  put("Metallica/Master Of Puppets", 1, { title: "Battery", artist: "Metallica", album: "Master Of Puppets", date: "1986", BARCODE: "075992736121", ISRC: "USEE10001992" });
  put("Metallica/Master Of Puppets", 2, { title: "Welcome Home (Sanitarium), Live", artist: "Metallica", album: "Master Of Puppets", date: "1986", BARCODE: "075992736121" });
  // Two versions of one record: one title, one artist, one release group.
  const G = { MUSICBRAINZ_RELEASEGROUPID: "g-moanin" };
  put("Art Blakey/Moanin (1959)", 1, Object.assign({ title: "Moanin'", artist: "Art Blakey", album: "Moanin'", date: "1959" }, G));
  put("Art Blakey/Moanin (2014)", 1, Object.assign({ title: "Moanin'", artist: "Art Blakey", album: "Moanin'", date: "2014", BARCODE: "0602537000001" }, G));
  // No barcode at all: its track listing is what the migration app matches it by.
  put("Miles Davis/Kind Of Blue", 1, { title: "So What", artist: "Miles Davis", album: "Kind Of Blue", date: "1959" });

  const port = ports.port(), base = "http://127.0.0.1:" + port;
  const srv = createServer({ port, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  const token = await signIn(base);
  const H = { Authorization: "Bearer " + token };
  try {
    await until(async () => { const s = await (await fetch(base + "/api/status", { headers: H })).json(); return s.index_count === 4 && !s.scanning; }, 60000, "the library");

    const r = await fetch(base + "/api/export/library.csv", { headers: H });
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type") || "", /^text\/csv/);
    assert.match(r.headers.get("content-disposition") || "", /attachment; filename="mandarin-library-\d{4}-\d{2}-\d{2}\.csv"/);
    assert.equal(r.headers.get("x-mandarin-export"), "albums=4; tracks=5; barcodes=2");
    const text = await r.text();
    const t = rows(text);
    assert.deepEqual(t[0], ["album_artist", "album", "disc", "track", "title", "artist", "barcode", "isrc", "duration", "year"]);
    assert.equal(t.length, 6, "a header and a row a track");

    const mop = t.filter(x => x[1] === "Master Of Puppets");
    assert.equal(mop.length, 2);
    for (const x of mop) {
      assert.equal(x[0], "Metallica");
      assert.equal(x[6], "075992736121", "the album's barcode on every row of it, its leading 0 kept");
      assert.equal(x[9], "1986");
    }
    assert.deepEqual(mop.map(x => [x[2], x[3], x[4]]), [["1", "1", "Battery"], ["1", "2", "Welcome Home (Sanitarium), Live"]]);
    assert.match(text, /,"Welcome Home \(Sanitarium\), Live",/, "a title holding a comma quoted");
    assert.equal(mop[0][7], "USEE10001992");
    assert.ok(Number(mop[0][8]) >= 1 && Number(mop[0][8]) <= 3, "the length in seconds: " + mop[0][8]);

    // Two versions of one record: two albums to the migration app, each with its version's words.
    const moanin = t.filter(x => x[0] === "Art Blakey").map(x => x[1]);
    assert.equal(moanin.length, 2);
    assert.notEqual(moanin[0], moanin[1], "told apart: " + moanin.join(" / "));
    for (const m of moanin) assert.match(m, /^Moanin' \(.+\)$/);
    assert.ok(t.some(x => x[0] === "Art Blakey" && x[6] === "0602537000001"));

    const so = t.find(x => x[1] === "Kind Of Blue");
    assert.equal(so[6], "", "no barcode: none made up");
    assert.equal(so[4], "So What");
  } finally {
    await srv.stop();
  }
});
