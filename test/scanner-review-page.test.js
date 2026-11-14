"use strict";
/*
 * Settings → Library Scanner's folders as a review (bug list item 414b), at a phone's size: To confirm's rows each with
 * the album, the release proposed (its artist, title, year and edition), how sure the scan is and why, Apply, Not this
 * and Find…, and the other releases or editions it kept a tap each; Not this and a release picked take the row off and
 * the count down at once. Unidentified's rows: Find… opens Edit album's own match search for the album. Nothing wider
 * than the phone. Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { FakeMusicBrainz } = require("./fake-musicbrainz");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  const body = document.getElementById("identify-pane-body");
  const shown = e => !!e && e.getClientRects().length > 0;
  const navItem = () => document.querySelector('#settings-overlay .settings-nav-item[data-pane="identify"]');
  document.getElementById("settings-toggle").click(); for (let i = 0; i < 200 && !(navItem() && navItem().offsetParent); i++) await sleep(25);
  navItem().click();
  const out = {};
  const folder = k => body.querySelector('[data-scan-folder="' + k + '"]');
  await until(() => folder("proposed"));
  folder("proposed").click();
  await until(() => body.querySelectorAll(".id-row").length === 2);
  const rowOf = name => [...body.querySelectorAll(".id-row")].find(r => r.querySelector(".id-name").textContent === name);
  const said = r => r && { sub: r.querySelector(".id-sub").textContent, why: (r.querySelector("[data-parity='settings-scanner.reasons']") || {}).textContent || null,
    buttons: [...r.querySelectorAll(".id-actions .id-btn")].map(b => b.textContent), choices: [...r.querySelectorAll("[data-parity='settings-scanner.choice']")].map(b => b.textContent) };
  out.title = body.querySelector(".settings-block-title").textContent;
  out.hi = said(rowOf("Artist B — Hi Res"));
  out.best = said(rowOf("Y — Best Of") || rowOf("X — Best Of") || [...body.querySelectorAll(".id-row")].find(r => /Best Of/.test(r.textContent)));
  out.wide = document.documentElement.scrollWidth <= innerWidth && [...body.querySelectorAll(".id-row")].every(r => r.getBoundingClientRect().right <= innerWidth);
  // Not this: the row gone, the count down.
  [...body.querySelectorAll(".id-row")].find(r => /Best Of/.test(r.textContent)).querySelector("[data-id-act='reject']").click();
  await until(() => body.querySelectorAll(".id-row").length === 1 && /\\(1\\)/.test(body.querySelector(".settings-block-title").textContent));
  out.afterNot = [body.querySelector(".settings-block-title").textContent, body.querySelectorAll(".id-row").length];
  // Another release, picked: applied, the row gone.
  rowOf("Artist B — Hi Res").querySelector("[data-id-pick='hi-alt']").click();
  await until(() => body.querySelectorAll(".id-row").length === 0 && /\\(0\\)/.test(body.querySelector(".settings-block-title").textContent));
  out.afterPick = [body.querySelector(".settings-block-title").textContent, body.querySelectorAll(".id-row").length];
  // Unidentified: Find… opens Edit album's match search for it.
  body.querySelector("[data-scan-folder-close]").click();
  await until(() => folder("unidentified"));
  folder("unidentified").click();
  await until(() => body.querySelector(".id-row"));
  out.unidentified = said(body.querySelector(".id-row"));
  body.querySelector("[data-id-find]").click();
  const ed = document.getElementById("album-edit-overlay");
  await until(() => shown(ed) && !document.getElementById("ae-match").classList.contains("hidden") && document.querySelectorAll(".ae-mcand").length > 0);
  out.editor = { open: shown(ed), title: document.getElementById("ae-title").value, searched: document.getElementById("ae-match-search-status").textContent,
    releases: [...document.querySelectorAll(".ae-mcand .ae-mcand-t")].map(e => e.textContent) };
  return out;
})()`;

test("To confirm and Unidentified as a review at a phone's size: how sure and why, Apply, Not this, another release, Find…", { skip, timeout: 180000 }, async () => {
  const lib = makeLibrary();
  const mb = await new FakeMusicBrainz([
    { id: "hi-alt", title: "Hi Res", artist: "Someone", date: "1999-01-01", tracks: [["Hi 1", 4], ["Hi 2", 4]] },
    { id: "album-one-x", title: "Album One", artist: "Artist A", date: "1997-01-01", tracks: [["Song 1", 3], ["Song 2", 3], ["Song 3", 3]] }
  ]).start();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false, mbBaseUrl: mb.baseUrl });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 3 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    // As the scan would have them since item 414b: two proposals with their confidence, reasons and the releases kept; one unidentified.
    const key = t => ctx.db.raw.prepare("SELECT key FROM albums WHERE title = ?").get(t).key;
    const put = ctx.db.raw.prepare("INSERT INTO album_matches(key, mbid, distance, status, candidate, checked_at, applied_at, itunes) VALUES(?, ?, ?, ?, ?, ?, ?, 'asked')");
    const hi = { mbid: "hi-prop", title: "Hi Resolution", artist: "Artist B", year: 2020, edition: "remaster", track_count: 2, tracks: [], parts: {},
      confidence: 71, reasons: ["found by name only", "2 of 2 tracks' lengths agree", "track names differ"],
      editions: [{ mbid: "hi-jp", edition: "deluxe", country: "JP", release_year: 2021, track_count: 2 }],
      others: [{ mbid: "hi-alt", artist: "Someone", title: "Hi Res", year: 1999, source: "musicbrainz", similarity: 40 }] };
    put.run(key("Hi Res"), "hi-prop", 0.29, "proposed", JSON.stringify(hi), Date.now(), null);
    put.run(key("Best Of"), "best-prop", 0.3, "proposed", JSON.stringify({ mbid: "best-prop", title: "The Best Of", artist: "Various Artists", year: 2001, track_count: 2, tracks: [], parts: {},
      confidence: 70, reasons: ["found by name only"] }), Date.now(), null);
    put.run(key("Album One"), null, 0.6, "unidentified", JSON.stringify({ mbid: "far", title: "Album Won", artist: "Nobody", year: 1970, track_count: 3, tracks: [], parts: {},
      confidence: 40, reasons: ["found by name only", "0 of 3 tracks' lengths agree"] }), Date.now(), null);
    await fetch(B + "/api/album-scanner", { method: "POST", headers: H, body: JSON.stringify({ on: true, schedule: true, start: "01:00", end: "06:00" }) });
    const b = await Browser.launch({ width: 412, height: 800 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      const r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
      assert.equal(r.title, "To confirm (2)");
      assert.deepEqual(r.hi, { sub: "→ Artist B — Hi Resolution (2020) · remaster · 71 % sure", why: "found by name only · 2 of 2 tracks' lengths agree · track names differ",
        buttons: ["Apply", "Not this", "Find…"], choices: ["deluxe · JP · 2021 · 2 tracks", "Someone — Hi Res (1999) · 40 %"] });
      assert.deepEqual(r.best.buttons, ["Apply", "Not this", "Find…"]);
      assert.deepEqual(r.best.choices, [], "nothing kept: no other releases offered");
      assert.equal(r.wide, true, "nothing wider than the phone");
      assert.deepEqual(r.afterNot, ["To confirm (1)", 1]);
      assert.deepEqual(r.afterPick, ["To confirm (0)", 0]);
      assert.deepEqual(r.unidentified, { sub: "nearest: Nobody — Album Won · 40 %", why: "found by name only · 0 of 3 tracks' lengths agree", buttons: ["Find…", "Check again"], choices: [] });
      assert.equal(r.editor.open, true, "Edit album open over the folder");
      assert.equal(r.editor.title, "Album One");
      assert.ok(r.editor.releases.includes("Artist A — Album One"), JSON.stringify(r.editor));
    } finally { await b.close(); }
    // On the server: the one turned down declined, the one picked applied by hand.
    const status = t => ctx.db.raw.prepare("SELECT m.status, m.mbid FROM album_matches m WHERE m.key = ?").get(key(t));
    assert.deepEqual(status("Best Of"), { status: "rejected", mbid: "best-prop" });
    assert.deepEqual(status("Hi Res"), { status: "applied", mbid: "hi-alt" });
  } finally {
    await srv.stop();
    await mb.stop();
  }
});
