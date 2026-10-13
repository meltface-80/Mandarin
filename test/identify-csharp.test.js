"use strict";
/*
 * The identification scan made by the C# server (v0.8.19, server/Mandarin.
 * Server/Identify/) decides what the Node server's decided: the scorer
 * (lib/identify/score.js) asked of both — `mandarin-server score` — over a
 * corpus of awkward names and hundreds of generated albums and candidate
 * releases, every number, part, pair and verdict compared; and a file's
 * waveform (lib/waveform.js) decoded both ways, bucket for bucket. The scan
 * itself, the pack and loudness measuring are run against the C# server by
 * their own tests. Skipped where the C# server isn't built.
 *
 * Since v0.8.50 (stage 7 part 5) the Node server's answers are kept
 * (test/golden.js's answers(), test/golden/identify-csharp.json), made with
 * RECORD_IDENTIFY=1 while lib/ was here; the cases are still made here,
 * seeded, and the C# program alone is held to them case for case. A waveform
 * is held to the Node server's rule as test/waveform-rule.js keeps it, on
 * this machine's ffmpeg.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { haveFfmpeg, gen } = require("./fixtures");
const { answers } = require("./golden");
const { waveformOf } = require("./waveform-rule");

const RECORD = process.env.RECORD_IDENTIFY === "1";
// The Node server's scorer, asked while recording (lib/, until v0.8.50).
const SCORE = RECORD ? require("../lib/identify/score") : null;
const kept = answers("identify-csharp", RECORD);

const BIN = process.env.MANDARIN_SERVER_BIN || path.join(__dirname, "..", "server", "bin", "mandarin-server");
const skip = (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!RECORD && !kept.exists() && "no recording of the Node server's answers (RECORD_IDENTIFY=1 made it)");
test.after(() => { if (!skip) kept.done(); });

/* Ask the C# scorer: one line of JSON per job, one back per job. */
function csharp(jobs) {
  const r = spawnSync(BIN, ["score"], { input: jobs.map(j => JSON.stringify(j)).join("\n") + "\n", maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, String(r.stderr));
  const lines = String(r.stdout).split("\n").filter(Boolean).map(l => JSON.parse(l));
  assert.equal(lines.length, jobs.length);
  for (const l of lines) assert.ok(!l.error, l.error);
  return lines;
}
const plain = v => JSON.parse(JSON.stringify(v));
/* Each answer the Node server's (kept), the first that isn't shown with its case. */
const same = (what, labels, cases, got, want) => kept.same(what, labels, cases, got, RECORD && (() => plain(want())));

// A small seeded generator, so a failure can be run again.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NAMES = [
  "Kid A", "Kid A (2015 Remaster)", "OK Computer OKNOTOK 1997 2017", "Abbey Road (Super Deluxe Edition)", "The Wall [Disc 1]", "The Wall - CD2",
  "Greatest Hits, Vol. II", "Greatest Hits Volume 2", "Part III", "Pt. 3", "Symphony No. 9 in D minor, Op. 125", "Symphony Nr. 9",
  "null: Line Up (null)", "undefined", "N/A", "NaN - none", "unknown (unknown)", "Rock'n'Roll", "Rock and Roll", "Rock + Roll", "Rock & Roll",
  "Rockin' All Over the World", "Rocking All Over The World", "Livin' on a Prayer", "Living On A Prayer", "Kickin", "Kicking'",
  "Song (feat. Someone)", "Song feat. Someone", "Song ft. X", "Song featuring Y", "Song [Live]", "Song - Live", "Song (Live)", "Song - 2011 Remaster",
  "Song (Remastered 2009)", "Song - Remastered", "Song - Remix", "Song (Demo)", "Song (Instrumental)", "Song (Album Version (Explicit))",
  "Tales From Topographic Oceans (Steven Wilson Remix)", "Tales From Topographic Oceans", "CD2", "Disc 03", "disk 1", "cd 10", "Disc 1 of 2",
  "Ænima", "Sigur Rós", "ΣΩΣ", "ΟΔΥΣΣΕΑΣ", "Ὀδυσσεύς", "Straße", "STRASSE", "İstanbul", "istanbul", "ﬀ", "ﬁne", "K-pop", "AC/DC", "Guns N' Roses",
  "Simon & Garfunkel", "Simon and Garfunkel", "Earth, Wind + Fire", "Mr. Bungle", "Dr. Dre", "St. Vincent", "vs.", "Artist A vs. Artist B",
  "4 Your Eyez Only", "1999", "Vol. 1 & 2", "Live at Leeds", "Unplugged in New York", "MTV Unplugged", "Acoustic", "Karaoke Hits", "Re-mixed", "remixes",
  "Demos", "", "   spaced   out  ", "Tab\tchar", "new\nline", "Ünïcode 😀", " nbsp ", "Zero​width", "Full－width", "ＡＢＣ", "Ⅳ", "IV", "xii",
  "Deluxe", "The Deluxe Edition", "Expanded Edition", "25th Anniversary Edition", "Bonus Track Version", "Mono", "Stereo", "Explicit", "Clean",
  "Collector's Edition", "Collectors Edition", "Legacy Edition", "Redux", "Digital Remaster", "Special Edition", "Limited", "Super Deluxe",
  "Various Artists", "VA", "V.A.", "Unknown Artist", "Original Soundtrack", "Soundtrack", "Compilation", "artist", "Ⓒ Copyright", "(Untitled)", "[]", "()",
  "Untitled", "Track 1", "Track 01", "01", "Intro", "Outro", "Interlude", "Pt. II", "Part 2", "Chapter One", "Act I", "Book 2", "Movement III", "Opus 64",
  "Side A", "Suite No. 1", "Symphony No.5", "Mozart: Requiem", "Bach - Goldberg Variations, BWV 988: Aria", "Prelude & Fugue",
  "SÕNG", "ŞARKI", "ǅungla", "ǈjubav", "ﬃ", "Ϊ", "ΐ", "ß", "ẞ", "ŉ", "Ⅻ", "½", "²", "١٢٣", "٣ Arabic digits", "日本語のアルバム", "한국어", "Привет", "Ёлка"
];

test("the scorer's names: tidied, bare, clean, compared, edition years, disc marks — the same both ways", { skip }, () => {
  const [c] = csharp([{ fn: "names", names: NAMES }]);
  same("names", NAMES, NAMES, c.names, () => NAMES.map(n => ({ tidy: SCORE.tidy(n), bare: SCORE.bare(n), clean: SCORE.clean(n), cmp: SCORE.cmp(n), edition_year: SCORE.editionYear(n), disc: SCORE.discOf(n) })));
});

test("the scorer's distances between names, and suspect artists — the same both ways", { skip }, () => {
  const r = rng(7);
  const pairs = [];
  for (let i = 0; i < NAMES.length; i++) pairs.push([NAMES[i], NAMES[(i + 1) % NAMES.length]], [NAMES[i], NAMES[i]], [NAMES[i], NAMES[Math.floor(r() * NAMES.length)]]);
  const [c] = csharp([{ fn: "pairs", pairs }]);
  same("pairs", pairs.map(() => "pair"), pairs, c.pairs, () => pairs.map(([a, b]) => ({ string: SCORE.stringDist(a, b), title: SCORE.titleDist(a, b), levenshtein: SCORE.levenshtein(a, b), suspect: SCORE.artistSuspect(a, b) })));
});

/* Albums and the releases that could be them: the same record, other pressings, near misses and strangers. */
function cases(seed, n) {
  const r = rng(seed);
  const pick = a => a[Math.floor(r() * a.length)];
  const words = ["Love", "Night", "Song", "Blue", "River", "Fire", "Dream", "Heart", "City", "Light", "Rain", "Gold", "Wild", "Home", "Time"];
  const tail = ["", "", "", " (Live)", " (Remastered 2011)", " - Remix", " (feat. Guest)", " [Demo]", " (Instrumental)", " - Radio Edit", " Pt. 2", " (Album Version)"];
  const title = () => pick(words) + (r() < 0.5 ? " " + pick(words) : "") + pick(tail);
  const out = [];
  for (let k = 0; k < n; k++) {
    const count = 1 + Math.floor(r() * 12);
    const discs = r() < 0.15 ? 2 : 1;
    const tracks = [];
    for (let i = 0; i < count; i++) tracks.push({ title: r() < 0.05 ? pick(NAMES) : title(), length: r() < 0.08 ? null : Math.round((60 + r() * 400) * 1000) / 1000 });
    const albumTitle = r() < 0.3 ? pick(NAMES) : pick(words) + " " + pick(words) + pick(["", "", " (Deluxe Edition)", " (2015 Remaster)", " CD2", " [Disc 1]", " Vol. 2"]);
    const artist = r() < 0.15 ? pick(["Various Artists", "", "Unknown", albumTitle]) : pick(["Radiohead", "The Beatles", "Beatles", "Björk", "Simon & Garfunkel", "AC/DC", "ΣΩΣ"]);
    const album = { title: albumTitle, artist, year: r() < 0.2 ? null : 1960 + Math.floor(r() * 60), tracks,
      ids: {}, context: pick(["", "Album · Artist", "CD2 · Box", "Remixes · Folder", "Live at the BBC", "Disc 1 · The Box"]) };
    const candidates = [];
    const m = 1 + Math.floor(r() * 4);
    for (let c = 0; c < m; c++) {
      let ts = tracks.map((t, i) => ({ disc: discs > 1 && i >= count / 2 ? 2 : 1, no: i + 1, title: r() < 0.85 ? t.title : title(), artist: "",
        length: t.length == null || r() < 0.05 ? null : t.length + (r() < 0.7 ? 0 : (r() - 0.5) * pick([6, 20, 34, 80])) }));
      if (r() < 0.2 && ts.length > 1) ts.splice(Math.floor(r() * ts.length), 1);                 // a track missing
      if (r() < 0.2) ts.splice(Math.floor(r() * (ts.length + 1)), 0, { disc: 1, no: 99, title: title(), artist: "", length: 100 + r() * 200 });   // one more
      if (r() < 0.1) ts = ts.map(t => Object.assign({}, t, { length: null }));                   // no lengths known
      if (r() < 0.1) ts = ts.slice().reverse();
      const group = r() < 0.6 ? "g-" + Math.floor(r() * 3) : null;
      candidates.push({
        mbid: "m-" + k + "-" + c, group_mbid: group,
        title: r() < 0.7 ? albumTitle.replace(/ \(.*\)$/, "") : pick(NAMES),
        artist: r() < 0.8 ? artist || "Someone" : pick(["Somebody Else", "The Beatles", "Various Artists"]),
        year: r() < 0.2 ? null : 1960 + Math.floor(r() * 60), date: r() < 0.5 ? "2001-02-03" : null,
        release_title: r() < 0.5 ? albumTitle : "", release_year: r() < 0.5 ? 2015 : null, release_date: r() < 0.3 ? pick(["2015-06-01", "1999", "2001-05"]) : null,
        edition: pick(["", "", "2015 remaster", "deluxe edition", "live", "demo"]), group_note: pick(["", "", "Steven Wilson remix", "live"]),
        type: pick(["Album", "Album + Live", null]), country: pick(["GB", "US", null]), discs, track_count: ts.length, tracks: ts,
        source: r() < 0.1 ? "itunes" : undefined
      });
    }
    out.push({ album, candidates });
  }
  return out;
}

test("the scorer's verdicts over generated albums: every distance, part, pair and verdict the same both ways", { skip }, () => {
  const all = cases(19, 700);
  const got = csharp(all.map(c => ({ fn: "decide", album: c.album, candidates: c.candidates })));
  same("decide", all.map((c, i) => "case " + i), all.map(c => c.album), got, () => all.map(c => {
    const v = SCORE.decide(plain(c.album), plain(c.candidates));
    return {
      status: v.status, ambiguous: !!v.ambiguous,
      scored: v.scored.map(s => ({ candidate: Object.assign({}, s.candidate, { parts: s.parts, pairs: s.pairs }), distance: s.distance })),
      why: v.best ? SCORE.why(v.best.parts, { year: c.album.year }) : [],
      exact: !!(v.best && SCORE.exact(v.best)), unasked: !!(v.best && SCORE.appliesUnasked(v.best))
    };
  }));
});

test("a waveform decoded by the C# server is the Node server's, bucket for bucket", { skip: (!fs.existsSync(BIN) && "the C# server isn't built (server/build.sh)") || (!haveFfmpeg() && "ffmpeg is not installed"), timeout: 60000 }, async () => {
  // The Node server's own decoder while recording, beside the rule kept from it: the two alike.
  const decodeWaveform = RECORD ? require("../lib/waveform-decode").decodeWaveform : null;
  const node = async (f, expectSeconds) => {
    const kept = waveformOf(f, expectSeconds);
    if (RECORD) { const w = await decodeWaveform(f, { expectSeconds }); assert.equal(kept, w == null ? null : Buffer.from(w).toString("base64"), "the rule kept is the Node server's: " + f); }
    return kept;
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-wave-"));
  try {
    const files = [
      ["sine.flac", { freq: 440, seconds: 4 }],
      ["short.flac", { freq: 220, seconds: 0.3 }],
      ["hires.flac", { freq: 1000, seconds: 3, rate: 96000, fmt: "s32", codecArgs: ["-bits_per_raw_sample", "24"] }],
      ["lossy.mp3", { freq: 330, seconds: 5, fmt: null, codecArgs: ["-b:a", "128k"] }]
    ];
    for (const [name, opts] of files) {
      const f = path.join(dir, name);
      gen(f, opts);
      const want = await node(f, 0);
      const r = spawnSync(BIN, ["waveform", f, "0"]);
      assert.ok(want, name + ": a waveform");
      assert.equal(String(r.stdout).trim(), want, name);
    }
    // One said to be far longer than it is: no waveform either way.
    const f = path.join(dir, "sine.flac");
    assert.equal(await node(f, 60), null);
    assert.equal(String(spawnSync(BIN, ["waveform", f, "60"]).stdout).trim(), "null");
    // Not audio at all.
    fs.writeFileSync(path.join(dir, "junk.flac"), "not audio");
    assert.equal(await node(path.join(dir, "junk.flac"), 0), null);
    assert.equal(String(spawnSync(BIN, ["waveform", path.join(dir, "junk.flac")]).stdout).trim(), "null");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
