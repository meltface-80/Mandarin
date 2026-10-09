"use strict";
/*
 * Settings → Library Scanner drawn at once (v0.8.17): the page's fixed words
 * are there the moment it opens, each block fills as its own answer comes
 * (nothing waits for GitHub or for the lists of albums), and while it stays
 * open only what moved is redrawn — the rest of the page is left as it is,
 * and the lists are asked for again only when their counts move. Opened a
 * second time, it shows what it showed last straight away. Skipped where no
 * Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3627;
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  // Every request the page makes, noted.
  const asked = [];
  const realFetch = window.fetch;
  window.fetch = (u, o) => { asked.push(String(u)); return realFetch(u, o); };
  const body = document.getElementById("identify-pane-body");
  const text = () => body.textContent;
  const out = {};
  document.getElementById("settings-toggle").click(); await sleep(400);
  document.querySelector('#settings-overlay .settings-nav-item[data-pane="identify"]').click();
  // At once, before any answer: the page's own words.
  out.at_once = ["Schedule", "Identify albums", "Ask iTunes too", "MusicBrainz pack", "Measure ReplayGain", "Scheduling", "Identification progress", "Clean up", "Processor"].filter(w => !text().includes(w));
  out.blocks = body.querySelectorAll("[data-blk]").length;
  // Then the numbers, as each comes.
  out.filled = await until(() => /\\d+ of \\d+ albums checked/.test(text()) && /tagged · /.test(text()) && /core/.test(body.querySelector('[data-blk="cpu"]').textContent));
  out.no_dots = !body.querySelector('[data-blk="progress"] .id-wait') && !body.querySelector('[data-blk="loudness"] .id-wait');
  // The schedule first, then what it runs in the order it runs it (v0.8.24),
  // with what is happening now.
  out.order = [...body.querySelectorAll("[data-blk]")].map(e => e.dataset.blk).slice(0, 5);
  out.schedTitle = body.querySelector('[data-blk="schedule"] .settings-block-title').textContent;
  out.now = await until(() => /^Now: /.test((body.querySelector("[data-sched-now]") || {}).textContent || "")) && body.querySelector("[data-sched-now]").textContent;
  // Left open through two refreshes: the fixed parts are the very same elements, not drawn again.
  const row = body.querySelector('[data-blk="identify"] .settings-row');
  row.__kept = true;
  const cleanRow = body.querySelector('[data-blk="cleanup"] .settings-row');
  cleanRow.__kept = true;
  const before = asked.length;
  await sleep(11000);
  out.kept = body.querySelector('[data-blk="identify"] .settings-row').__kept === true && body.querySelector('[data-blk="cleanup"] .settings-row').__kept === true;
  const since = asked.slice(before);
  out.light = since.filter(u => u.includes("/api/identify?lists=0")).length;
  out.lists_again = since.filter(u => /\\/api\\/identify\\?lists=[1-9]/.test(u)).length;
  out.github_again = since.filter(u => u.includes("check=1")).length;
  out.lists_on_open = asked.slice(0, before).filter(u => /\\/api\\/identify\\?lists=[1-9]/.test(u)).length;
  // Back, and open again: what it showed is there straight away, numbers and all.
  document.querySelector('#settings-overlay .settings-pane:not(.hidden) [data-settings-back]').click(); await sleep(200);
  document.querySelector('#settings-overlay .settings-nav-item[data-pane="identify"]').click();
  out.again_at_once = /\\d+ of \\d+ albums checked/.test(text());
  return out;
})()`;

test("Library Scanner: the page at once, each block as its answer comes, only what moved redrawn", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 100; i++) {
      const st = await (await fetch(B + "/api/status", { headers: H })).json();
      if (st.index_count >= 3 && !st.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const b = await Browser.launch({ width: 1180, height: 820 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      const r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
      assert.deepEqual(r.at_once, [], "the page's words, before any answer");
      assert.equal(r.blocks, 13, "laid out as its blocks");
      assert.equal(r.filled, true, "each block filled as its answer came");
      assert.equal(r.no_dots, true, "nothing left waiting");
      assert.deepEqual(r.order, ["schedule", "identify", "pack", "progress", "loudness"]);
      assert.equal(r.schedTitle, "Schedule");
      assert.ok(r.now, "the schedule says what is happening now");
      assert.equal(r.kept, true, "what didn't move wasn't drawn again");
      assert.ok(r.light >= 1, "the state asked for again, without the lists: " + r.light);
      assert.equal(r.lists_on_open, 1, "the lists asked for when the page opened");
      assert.equal(r.lists_again, 0, "and not again while their counts stood still");
      assert.equal(r.github_again, 0, "GitHub asked about only when the page opened");
      assert.equal(r.again_at_once, true, "opened again: what it showed, at once");
    } finally { await b.close(); }
  } finally {
    await srv.stop();
  }
});
