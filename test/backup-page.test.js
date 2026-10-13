"use strict";
/*
 * Settings → Backup & restore (v0.6.14) in a real browser, phone-sized:
 * back up to the server (database left out), change things, then restore the
 * settings and this device's screen settings from the list: both come back,
 * the server restarts, and the page shows it's restoring.
 * A sealed backup (v0.9.0): the passphrase typed seals it, and its restore
 * asks for it. Skipped where no Chromium or Chrome is found (test/browser-harness.js).
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

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = id => document.getElementById(id);
  const out = {};
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  localStorage.setItem("rra-ui-text", "1.25");
  $("settings-toggle").click(); await until(() => (document.querySelector('.settings-nav-item[data-pane="backup"]') || {}).offsetParent);
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
  document.querySelector('.backup-item [data-act="restore"]').click(); await until(() => document.querySelector('.backup-item .backup-restore:not(.hidden) [data-act="go"]'));
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
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  const boot = async () => { try { return (await (await fetch(B + "/server-info")).json()).boot; } catch (e) { return null; } };
  const boot0 = await boot();
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
    assert.match(r.listed_meta, /v\d+\.\d+\.\d+ · \d+ KB · from /, "and what it was made from");
    assert.match(r.listed_parts, /Settings.*This device's screen settings/);
    assert.doesNotMatch(r.listed_parts, /database/i, "the database was left out");
    assert.equal(r.changed, 1, "changed after the backup");
    assert.match(r.cover, /Restoring/);
    assert.equal(r.page_back, "1.25", "this device's screen settings put back");
    // The server started again (in its own process, from the same file): another run of it answers.
    let boot1 = null;
    for (let i = 0; i < 150 && !(boot1 && boot1 !== boot0); i++) { await new Promise(res => setTimeout(res, 100)); boot1 = await boot(); }
    assert.ok(boot0 && boot1 && boot1 !== boot0, `the server started again: ${boot0} → ${boot1}`);
    ctx.db.close();
    assert.equal(ctx.db.setting("smartPicksHour"), 6, "the server's settings put back");
  } finally {
    await srv.stop();
  }
});

// A sealed backup (v0.9.0, the audit's S1): the passphrase typed, the card says "sealed", and its restore asks for it.
const SEALED_BACKUP = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = id => document.getElementById(id);
  await until(() => document.querySelector("#home-random .album, #home-today .album"));
  $("settings-toggle").click(); await until(() => (document.querySelector('.settings-nav-item[data-pane="backup"]') || {}).offsetParent);
  document.querySelector('.settings-nav-item[data-pane="backup"]').click();
  await until(() => document.querySelectorAll("#backup-parts input").length);
  for (const i of document.querySelectorAll("#backup-parts input")) if (i.dataset.part !== "keys") i.click();
  $("backup-pass").value = "a page's passphrase";
  $("backup-to-server").click();
  await until(() => document.querySelector(".backup-item"));
  return { meta: document.querySelector(".backup-item span").textContent, parts: document.querySelector(".backup-item small").textContent };
})()`;
const SEALED_RESTORE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const out = { toasts: [] };
  window.__showToast = m => out.toasts.push(m);
  window.__confirmDialog = () => Promise.resolve(true);
  document.querySelector('.backup-item [data-act="restore"]').click(); await until(() => document.querySelector('.backup-item .backup-restore:not(.hidden) [data-act="go"]'));
  const pass = document.querySelector(".backup-item .backup-pass-in");
  out.asks = pass ? pass.placeholder : null;
  document.querySelector('.backup-item [data-act="go"]').click();
  await until(() => out.toasts.length);
  pass.value = "not the passphrase";
  document.querySelector('.backup-item [data-act="go"]').click();
  await until(() => out.toasts.length > 1);
  pass.value = "a page's passphrase";
  document.querySelector('.backup-item [data-act="go"]').click();
  await until(() => document.getElementById("power-cover"));
  out.cover = document.getElementById("power-cover") && document.getElementById("power-cover").innerText;
  return out;
})()`;

test("a sealed backup in a browser: the passphrase seals it, and its restore asks for it", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const P = ports.port(), U = "http://127.0.0.1:" + P;
  const srv = createServer({ port: P, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  const ctx = await srv.start();
  const boot = async () => { try { return (await (await fetch(U + "/server-info")).json()).boot; } catch (e) { return null; } };
  const boot0 = await boot();
  ctx.db.setSetting("discogsToken", "page-secret");
  try {
    const token = await signIn(U);
    const b = await Browser.launch({ width: 390, height: 844 });
    let made, back;
    try {
      const page = await b.page(U + "/", { cookies: [{ name: "musicd_session", value: token, url: U }] });
      made = await page.eval(SEALED_BACKUP);
      assert.match(made.meta, / · sealed · from /, "the card says it is sealed");
      ctx.db.setSetting("discogsToken", "changed");
      back = await page.eval(SEALED_RESTORE);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.equal(made.parts, "API keys");
    assert.equal(back.asks, "Its passphrase (for the keys and the whole database)", "its restore asks for the passphrase");
    assert.deepEqual(back.toasts, ["This backup is sealed with a passphrase: enter it to restore the keys or the whole database", "That passphrase doesn't open this backup"]);
    assert.match(back.cover, /Restoring/);
    let boot1 = null;
    for (let i = 0; i < 150 && !(boot1 && boot1 !== boot0); i++) { await new Promise(res => setTimeout(res, 100)); boot1 = await boot(); }
    assert.ok(boot0 && boot1 && boot1 !== boot0, `the server started again: ${boot0} → ${boot1}`);
    ctx.db.close();
    assert.equal(ctx.db.setting("discogsToken"), "page-secret", "the keys put back with the passphrase");
  } finally {
    await srv.stop();
  }
});
