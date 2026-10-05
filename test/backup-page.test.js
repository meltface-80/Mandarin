"use strict";
/*
 * Settings → Backup & restore (v0.6.14) in a real browser, phone-sized:
 * back up to the server (database left out), change things, then restore the
 * settings and this device's screen settings from the list: both come back,
 * the server restarts, and the page shows it's restoring.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = 3626;
const B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = id => document.getElementById(id);
  const out = {};
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  localStorage.setItem("rra-ui-text", "1.25");
  $("settings-toggle").click(); await sleep(300);
  document.querySelector('.settings-nav-item[data-pane="backup"]').click();
  await until(() => document.querySelectorAll("#backup-parts input").length);
  out.parts = [...document.querySelectorAll("#backup-parts input")].map(i => i.dataset.part);
  out.file_buttons = !$("backup-to-file").hidden || !$("restore-from-file").hidden;
  document.querySelector('#backup-parts input[data-part="database"]').click();
  $("backup-to-server").click();
  await until(() => document.querySelector(".backup-item"));
  out.listed = document.querySelector(".backup-item b").textContent;
  out.listed_meta = document.querySelector(".backup-item span").textContent;
  out.listed_parts = document.querySelector(".backup-item small").textContent;
  localStorage.setItem("rra-ui-text", "1");
  out.changed = (await (await fetch("/api/settings/smart-picks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hour: 1 }) })).json()).hour;
  document.querySelector('.backup-item [data-act="restore"]').click(); await sleep(100);
  for (const i of document.querySelectorAll(".backup-item .backup-restore input")) if (!["settings", "page"].includes(i.dataset.part)) i.click();
  window.__confirmDialog = () => Promise.resolve(true);
  document.querySelector('.backup-item [data-act="go"]').click();
  await until(() => document.getElementById("power-cover"));
  out.cover = document.getElementById("power-cover") && document.getElementById("power-cover").innerText;
  out.page_back = localStorage.getItem("rra-ui-text");
  return out;
})()`;

test("Backup & restore in a browser: back up to the server, restore settings and this device's", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const exits = [];
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [],
    upnpMulticast: false, identify: false, exitProcess: c => exits.push(c), powerEnv: {}, powerPlatform: "linux" });
  const ctx = await srv.start();
  // The server's setting at the backup; the page moves it afterwards.
  ctx.db.setSetting("smartPicksHour", 6);
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 100; i++) {
      const s = await (await fetch(B + "/api/status", { headers: H })).json();
      if (s.index_count >= 3 && !s.library_importing) break;
      await new Promise(r => setTimeout(r, 100));
    }
    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.deepEqual(r.parts, ["settings", "devices", "collection", "keys", "database", "page"], "no app part in a browser");
    assert.equal(r.file_buttons, false, "the file buttons are the Android app's");
    assert.equal(r.listed, "On the server", "the card says where the backup is");
    assert.match(r.listed_meta, /v0\.6\.\d+ · \d+ KB · from /, "and what it was made from");
    assert.match(r.listed_parts, /Settings.*This device's screen settings/);
    assert.doesNotMatch(r.listed_parts, /database/i, "the database was left out");
    assert.equal(r.changed, 1, "changed after the backup");
    assert.match(r.cover, /Restoring/);
    assert.equal(r.page_back, "1.25", "this device's screen settings put back");
    assert.equal(ctx.db.setting("smartPicksHour"), 6, "the server's settings put back");
    for (let i = 0; i < 20 && !exits.length; i++) await new Promise(res => setTimeout(res, 100));
    assert.deepEqual(exits, [75], "and the server restarted");
  } finally {
    try { await srv.stop(); } catch (e) { /* stopped by the restart */ }
  }
});
