"use strict";
/*
 * Edit album's Match by sound on the page (bug list item 419), at a phone's size: reached from Settings → Library
 * Scanner's Unidentified row (Find…, which opens Edit album), Match by sound beside Find match; tapped, it says how far
 * it has got (the tracks fingerprinted, AcoustID asked), then lists the releases the tracks are on by sound — each
 * with its year and tracks, how many of the album's tracks are on it, how sure the scan is and why; one tapped is
 * applied as yours, and the match line says it was matched by sound. Against a slow fake AcoustID and the fake
 * MusicBrainz. Settings → API Keys' AcoustID row then says how many albums are matched by sound. Nothing wider than
 * the phone. Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { haveFfmpeg, makeLibrary, gen } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { FakeMusicBrainz, release } = require("./fake-musicbrainz");
const { FakeAcoustId } = require("./fake-acoustid");
const { createServer, built } = require("./server");
const { score } = require("./score");

const skip = built() || (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(40); } return true; };
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  const body = document.getElementById("identify-pane-body");
  const shown = e => !!e && e.getClientRects().length > 0;
  const navItem = p => document.querySelector('#settings-overlay .settings-nav-item[data-pane="' + p + '"]');
  document.getElementById("settings-toggle").click(); for (let i = 0; i < 200 && !(navItem("identify") && navItem("identify").offsetParent); i++) await sleep(25);
  navItem("identify").click();
  const out = {};
  await until(() => body.querySelector('[data-scan-folder="unidentified"]'));
  body.querySelector('[data-scan-folder="unidentified"]').click();
  await until(() => body.querySelector(".id-row [data-id-find]"));
  body.querySelector(".id-row [data-id-find]").click();
  const ed = document.getElementById("album-edit-overlay");
  const btn = document.getElementById("ae-match-sound");
  await until(() => shown(ed) && shown(btn) && !btn.disabled && document.getElementById("ae-title").value);
  out.button = { text: btn.textContent, beside: btn.parentElement === document.getElementById("ae-match-find").parentElement, parity: btn.getAttribute("data-parity") };
  // Tapped: how far it has got, said as it goes, then the releases.
  btn.click();
  const status = document.getElementById("ae-sound-status");
  const said = new Set();
  const cands = () => [...document.querySelectorAll("#ae-sound-cands .ae-mcand")];
  out.disabled = btn.disabled;
  await until(() => { said.add(status.textContent); return cands().length > 0; }, 60000);
  said.add(status.textContent);
  out.said = [...said].filter(Boolean);
  out.box = shown(document.getElementById("ae-sound"));
  out.releases = cands().map(b => ({ name: b.querySelector(".ae-mcand-t").textContent, sure: b.querySelector(".ae-mcand-pc").textContent,
    line: b.querySelector(".ae-cand-s").textContent, why: (b.querySelector(".ae-mreasons") || {}).textContent || null, parity: b.getAttribute("data-parity") }));
  out.wide = document.documentElement.scrollWidth <= innerWidth && cands().every(b => b.getBoundingClientRect().right <= innerWidth + 1);
  // One tapped: applied, the names in the fields, the match line saying how it was found.
  cands()[0].click();
  await until(() => /Real One/.test(document.getElementById("ae-match-status").textContent) && document.getElementById("ae-title").value === "Real One");
  out.applied = { status: document.getElementById("ae-match-status").textContent, reasons: document.getElementById("ae-match-reasons").textContent,
    title: document.getElementById("ae-title").value, picked: cands()[0].classList.contains("is-picked") };
  return out;
})()`;

// Each track a chord of its own, so each has a fingerprint of its own (as test/identify-sound.test.js makes them).
function album(music, artist, title, lengths) {
  const dir = path.join(music, artist, title);
  return lengths.map((seconds, i) => {
    const n = 80 + i;
    const hz = k => (220 * Math.pow(2, k / 12)).toFixed(3);
    const [a, b, c] = [n % 12, 12 + (n * 5 + 3) % 12, 24 + (n * 7 + 1 + 2 * Math.floor(n / 12)) % 12];
    const file = path.join(dir, `0${i + 1}.flac`);
    gen(file, { seconds, expr: `0.35*sin(2*PI*${hz(a)}*t)+0.25*sin(2*PI*${hz(b)}*t)+0.15*sin(2*PI*${hz(c)}*t)`,
      tags: { track: i + 1, title: "Track " + (i + 1), artist, album: title } });
    return file;
  });
}

test("Edit album's Match by sound at a phone's size: beside Find match, how far it has got, the releases by sound, one applied", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  fs.rmSync(lib.music, { recursive: true, force: true });
  const files = album(lib.music, "Unknown Artist", "Rip 9", [4, 5, 6]);
  const fps = score({ fn: "scorecall", calls: files.map(file => ["fingerprint", { file }]) }).results;
  const realSpec = { id: "real-one", title: "Real One", artist: "Real Artist", date: "2004-01-01", tracks: [["One", 4], ["Two", 5], ["Three", 6]] };
  const compSpec = { id: "comp-one", title: "Big Compilation", artist: "Various Artists", date: "2011-01-01", tracks: [["One", 4], ["Else", 200], ["More", 180]] };
  const mb = await new FakeMusicBrainz([realSpec, compSpec]).start();
  const aid = await new FakeAcoustId().start();
  fps.forEach((f, i) => aid.know(f, i === 0 ? [[release(realSpec), 1], [release(compSpec), 1]] : [[release(realSpec), i + 1]]));
  aid.delayMs = 500;    // slow enough to see it asked
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false,
    identify: false, mbBaseUrl: mb.baseUrl, acoustidBaseUrl: aid.baseUrl });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 1 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    ctx.db.setSetting("acoustidKey", "good-key");
    // As the scan left it: unidentified, nothing near by name.
    const key = ctx.db.raw.prepare("SELECT key FROM albums WHERE title = 'Rip 9'").get().key;
    ctx.db.raw.prepare("INSERT INTO album_matches(key, mbid, distance, status, candidate, checked_at, applied_at, itunes) VALUES(?, NULL, 0.7, 'unidentified', ?, ?, NULL, 'asked')")
      .run(key, JSON.stringify({ mbid: "far", title: "Far Off", artist: "Nobody", year: 1970, track_count: 9, tracks: [], parts: {}, confidence: 20, reasons: ["found by name only"] }), Date.now());
    const b = await Browser.launch({ width: 412, height: 800 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      const r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
      assert.deepEqual(r.button, { text: "Match by sound", beside: true, parity: "album-edit.match-sound" });
      assert.equal(r.disabled, true, "not asked twice while it works");
      assert.equal(r.box, true);
      assert.equal(r.said[0], "Fingerprinting the tracks… On the server, a track at a time.");
      assert.ok(!r.said.some(s => / 0 of 0 /.test(s)), JSON.stringify(r.said));
      assert.ok(r.said.some(s => /^Asking AcoustID… \d of 3 tracks \(three a second\)\.$/.test(s)), JSON.stringify(r.said));
      assert.equal(r.said.at(-1), "By sound: the releases these tracks are on. Tap the right one to apply.");
      assert.deepEqual(r.releases.map(x => [x.name, x.parity]), [["Real Artist — Real One", "album-edit.sound-release"], ["Various Artists — Big Compilation", "album-edit.sound-release"]]);
      assert.equal(r.releases[0].sure, "95 % sure");
      assert.equal(r.releases[0].line, "2004 · XW · 3 tracks · 3 of 3 tracks by sound");
      assert.match(r.releases[0].why, /^3 of 3 tracks' lengths agree/);
      assert.match(r.releases[1].line, / · 1 of 3 tracks by sound$/);
      assert.equal(r.wide, true, "nothing wider than the phone");
      assert.equal(r.applied.title, "Real One");
      assert.equal(r.applied.status, "Matched: Real Artist — Real One (2004) · 95 % sure", "as sure as it was offered");
      assert.match(r.applied.reasons, /^matched by sound: 3 of 3 tracks, chosen by you · 3 of 3 tracks' lengths agree/);
      assert.equal(r.applied.picked, true);
      // Settings → API Keys' AcoustID row: one album matched by sound.
      const tally = await page.eval(`(async () => {
        document.getElementById("album-edit-overlay").querySelector("[data-ae-close]").click();
        await loadAcoustIdKey();
        const el = document.getElementById("acoustid-sound");
        return { text: el.textContent, parity: el.getAttribute("data-parity"), hidden: el.classList.contains("hidden") };
      })()`);
      assert.deepEqual(tally, { text: "By sound: 1 album matched so far, 0 still to look at.", parity: "settings-keys.sound", hidden: false });
    } finally { await b.close(); }
    const row = ctx.db.raw.prepare("SELECT status, mbid, candidate FROM album_matches WHERE key = ?").get(key);
    assert.deepEqual([row.status, row.mbid, JSON.parse(row.candidate).manual, JSON.parse(row.candidate).sound_of], ["applied", "real-one", "sound", "3/3"]);
  } finally {
    await srv.stop();
    await Promise.all([mb.stop(), aid.stop()]);
  }
});
