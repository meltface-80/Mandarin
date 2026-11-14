"use strict";
/*
 * Settings → Library Scanner at a phone's size (bug list item 411): the Album Scanner's one switch, and while it is
 * on its six sections in order — Progress (one readout: the albums with every step done, a bar, what it is doing
 * now), the albums to place by hand as folders, Schedule (its own switch, the times only while it is on), the
 * MusicBrainz pack, Library clean-up and the Processor — all of it on one screen of 412 by 800 without scrolling.
 * The Unidentified folder shows its count and opens its albums with their actions, To confirm likewise; no list of
 * applied albums anywhere. Off, the switch and its note alone; the switch kept by the server either way. Drawn at
 * once from what it showed last, each section as its own answer comes (v0.8.17), only what moved redrawn.
 * Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const OPEN = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  const asked = [];
  const realFetch = window.fetch;
  window.fetch = (u, o) => { asked.push(String(u)); return realFetch(u, o); };
  const body = document.getElementById("identify-pane-body");
  const shown = e => !!e && e.getClientRects().length > 0;
  const text = () => body.innerText.replace(/\\s+/g, " ").trim();
  const server = async () => (await realFetch("/api/album-scanner", { cache: "no-store" })).json();
  const navItem = () => document.querySelector('#settings-overlay .settings-nav-item[data-pane="identify"]');
  document.getElementById("settings-toggle").click(); for (let i = 0; i < 200 && !(navItem() && navItem().offsetParent); i++) await sleep(25);
  navItem().click();
  const out = {};`;

const DRIVER = `(async () => {${OPEN}
  out.filled = await until(() => /of 3 albums/.test(text()) && /Remove|Nothing to remove/.test(text()) && /core/.test(text()) && !body.querySelector(".id-wait"));
  // The sections in order, each under its rule, named by the first words in it.
  out.sections = [...body.querySelectorAll(".scan-sec")].filter(shown).map(s => s.querySelector(".scan-lab").textContent.replace("ⓘ", "").trim());
  out.switch = { name: body.querySelector(".scan-title").textContent.replace("ⓘ", "").trim(), on: body.querySelector("[data-scan-on]").checked, label: body.querySelector("[data-scan-on]").getAttribute("aria-label") };
  out.note = body.querySelector(".scan-top .settings-note").textContent;
  // One progress readout: the albums with every step done, its bar, and what it is doing now.
  out.readouts = [...body.querySelectorAll(".id-progress")].filter(shown).map(e => e.textContent);
  out.bar = body.querySelectorAll(".scan-bar").length;
  out.now = body.querySelector("[data-parity='settings-scanner.now']").textContent;
  out.gone = ["Identify albums", "Ask iTunes too", "Measure ReplayGain", "Find covers", "Applied", "Declined", "tagged ·", "Covers found automatically", "Identification progress"].filter(w => text().includes(w));
  // The folders: Unidentified with its count, To confirm with its own.
  const folder = k => body.querySelector('[data-scan-folder="' + k + '"]');
  out.folders = ["unidentified", "proposed"].map(k => folder(k) && [folder(k).getAttribute("aria-label"), folder(k).querySelector(".scan-fico-n").textContent, folder(k).querySelector(".scan-sub").textContent]);
  // All of it on one screen, once the pane has slid into place.
  const end = () => Math.ceil(body.querySelector('[data-blk="cpu"]').getBoundingClientRect().bottom);
  for (let last = -1, i = 0; i < 40 && end() !== last; i++) { last = end(); await sleep(150); }
  out.bottom = end();
  out.height = innerHeight;
  out.width = document.documentElement.scrollWidth <= innerWidth;
  // Schedule on: its times; off: hidden, and it runs any time; on again: back.
  const times = () => [...body.querySelectorAll("[data-scan-time]")].filter(shown).map(t => t.getAttribute("aria-label") + " " + t.value);
  const sched = () => body.querySelector("[data-scan-sched]");
  out.timesOn = times();
  out.schedNoteOn = sched().closest(".scan-row").innerText.trim();
  sched().click();
  await until(() => sched() && !sched().disabled && !sched().checked && times().length === 0);
  out.timesOff = times();
  out.schedNoteOff = sched().closest(".scan-row").innerText.trim();
  out.serverSchedOff = (await server()).schedule.on;
  sched().click();
  await until(() => sched() && !sched().disabled && sched().checked && times().length === 2);
  out.timesAgain = times();
  // Unidentified opened: its albums, Check again and Barcode…, and Back.
  folder("unidentified").click();
  await until(() => body.querySelector(".id-row"));
  out.unidentified = { title: body.querySelector(".settings-block-title").textContent, rows: [...body.querySelectorAll(".id-row .id-name")].map(e => e.textContent),
    buttons: [...body.querySelectorAll(".id-row .id-btn")].map(b => b.textContent), back: body.querySelector("[data-scan-folder-close]").getAttribute("aria-label"),
    readout: !!body.querySelector(".scan-bar"), applied: /Applied|Undo/.test(text()) };
  body.querySelector("[data-scan-folder-close]").click();
  await until(() => folder("proposed"));
  folder("proposed").click();
  await until(() => body.querySelector(".id-row"));
  out.proposed = { title: body.querySelector(".settings-block-title").textContent, rows: [...body.querySelectorAll(".id-row .id-name")].map(e => e.textContent),
    buttons: [...body.querySelectorAll(".id-row .id-btn")].map(b => b.textContent) };
  body.querySelector("[data-scan-folder-close]").click();
  await until(() => body.querySelector(".scan-bar"));
  // Left open through two refreshes: what didn't move is the very same element, not drawn again.
  const row = body.querySelector('[data-blk="schedule"] .scan-row');
  row.__kept = true;
  const before = asked.length;
  await sleep(11000);
  out.kept = body.querySelector('[data-blk="schedule"] .scan-row').__kept === true;
  const since = asked.slice(before);
  out.light = since.filter(u => u.includes("/api/album-scanner")).length;
  out.github_again = since.filter(u => u.includes("check=1")).length;
  // Back, and open again: what it showed is there straight away, numbers and all.
  document.querySelector('#settings-overlay .settings-pane:not(.hidden) [data-settings-back]').click();
  for (let i = 0; i < 200 && !navItem().offsetParent; i++) await sleep(25);
  navItem().click();
  out.again_at_once = /of 3 albums/.test(text());
  return out;
})()`;

const OFF = `(async () => {${OPEN}
  const sw = () => body.querySelector("[data-scan-on]");
  await until(() => sw() && !sw().disabled && /of 3 albums/.test(text()));
  sw().click();
  await until(() => sw() && !sw().disabled && !sw().checked && !body.querySelector(".scan-sec"));
  out.text = text();
  out.blocks = [...body.querySelectorAll("[data-blk]")].filter(b => b.innerHTML.trim()).map(b => b.dataset.blk);
  out.controls = [...body.querySelectorAll("button, input")].filter(shown).map(b => b.getAttribute("aria-label") || b.textContent);
  out.server = (await server()).on;
  // Opened again while off: still the switch alone.
  document.querySelector('#settings-overlay .settings-pane:not(.hidden) [data-settings-back]').click();
  for (let i = 0; i < 200 && !navItem().offsetParent; i++) await sleep(25);
  navItem().click();
  await sleep(1500);
  out.again = text();
  sw().click();
  await until(() => sw() && !sw().disabled && sw().checked && body.querySelector(".scan-bar"));
  out.onAgain = [(await server()).on, [...body.querySelectorAll(".scan-sec")].filter(shown).length];
  return out;
})()`;

async function withPage(lib, fn) {
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 3 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    // Album One left unidentified, Hi Res proposed, Best Of applied, as the scan would have them.
    const key = t => ctx.db.raw.prepare("SELECT key FROM albums WHERE title = ?").get(t).key;
    const put = ctx.db.raw.prepare("INSERT INTO album_matches(key, mbid, distance, status, candidate, checked_at, applied_at, itunes) VALUES(?, ?, ?, ?, ?, ?, ?, 'asked')");
    const cand = (title, artist) => JSON.stringify({ mbid: "11111111-2222-3333-4444-555555555555", title, artist, year: 2020, track_count: 2, tracks: [] });
    put.run(key("Album One"), null, null, "unidentified", null, Date.now(), null);
    put.run(key("Hi Res"), "11111111-2222-3333-4444-555555555555", 0.2, "proposed", cand("Hi Resolution", "Artist B"), Date.now(), null);
    put.run(key("Best Of"), "11111111-2222-3333-4444-555555555556", 0.01, "applied", cand("The Best Of", "X"), Date.now(), Date.now());
    // On, Scheduling on (the switch counts afresh).
    await fetch(B + "/api/album-scanner", { method: "POST", headers: H, body: JSON.stringify({ on: true, schedule: true, start: "01:00", end: "06:00" }) });
    const b = await Browser.launch({ width: 412, height: 800 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true });
      await fn(page);
    } finally { await b.close(); }
  } finally {
    await srv.stop();
  }
}

test("Library Scanner on, at a phone's size: the six sections in order on one screen, one readout, the folders, Schedule's own switch", { skip, timeout: 180000 }, async () => {
  await withPage(makeLibrary(), async (page) => {
    const r = await page.eval(DRIVER);
    assert.deepEqual(page.errors, []);
    assert.equal(r.filled, true, "each section filled as its answer came");
    assert.deepEqual(r.switch, { name: "Album Scanner", on: true, label: "Album Scanner" });
    assert.equal(r.note, "Identifies albums, measures ReplayGain and finds missing covers, while nothing plays.");
    assert.deepEqual(r.sections, ["Progress", "Unidentified", "Schedule", "MusicBrainz pack", "Library clean-up", "Processor"]);
    // One readout: no album has every step done yet (nothing measured, no cover looked for).
    assert.deepEqual(r.readouts, ["0 of 3 albums · 0%"]);
    assert.equal(r.bar, 1);
    assert.match(r.now, /^(Waiting for 01:00|Now: .+|Paused while .+|The rest are .+)$/);
    assert.deepEqual(r.gone, [], "no separate switch, readout or list of the old page");
    assert.deepEqual(r.folders, [["Unidentified", "1", "Tap to place them by hand"], ["To confirm", "1", "Found, but not sure enough to apply unasked"]]);
    assert.ok(r.bottom <= r.height, `everything on one screen: the processor ends at ${r.bottom} of ${r.height}`);
    assert.equal(r.width, true, "nothing wider than the phone");
    assert.match(r.schedNoteOn, /^Schedule\s+Runs only between these times$/);
    assert.equal(r.timesOn.length, 2);
    assert.match(r.timesOn[0], /^From 01:00$/);
    assert.match(r.timesOn[1], /^To 06:00$/);
    assert.deepEqual(r.timesOff, [], "Schedule off: no times");
    assert.match(r.schedNoteOff, /^Schedule\s+Off: runs any time, day and night$/);
    assert.equal(r.serverSchedOff, false, "kept by the server");
    assert.deepEqual(r.timesAgain, r.timesOn, "on again: the times as they were");
    assert.deepEqual(r.unidentified, { title: "Unidentified (1)", rows: ["Artist A — Album One"], buttons: ["Check again", "Barcode…"], back: "Back to Library Scanner", readout: false, applied: false });
    assert.deepEqual(r.proposed, { title: "To confirm (1)", rows: ["Artist B — Hi Res"], buttons: ["Accept", "Reject", "Barcode…"] });
    assert.equal(r.kept, true, "what didn't move wasn't drawn again");
    assert.ok(r.light >= 1, "the readout asked for again: " + r.light);
    assert.equal(r.github_again, 0, "GitHub asked about only when the page opened");
    assert.equal(r.again_at_once, true, "opened again: what it showed, at once");
  });
});

test("Library Scanner off: the switch and its note alone, kept by the server; on again, the sections back", { skip, timeout: 180000 }, async () => {
  await withPage(makeLibrary(), async (page) => {
    const r = await page.eval(OFF);
    assert.deepEqual(page.errors, []);
    assert.equal(r.text, "Album Scanner ⓘ Identifies albums, measures ReplayGain and finds missing covers, while nothing plays. Off: none of this is done.");
    assert.deepEqual(r.blocks, ["switch"]);
    assert.deepEqual(r.controls, ["About Album Scanner", "Album Scanner"]);
    assert.equal(r.server, false, "kept off by the server");
    assert.equal(r.again, r.text, "opened again: still the switch alone");
    assert.deepEqual(r.onAgain, [true, 6]);
  });
});
