"use strict";
/*
 * Mandarin without an account (bug list item 161) in a real browser: a new
 * install's setup page offers "Use without an account", which goes straight
 * in; another browser at home then opens Mandarin with no sign-in page at all;
 * Settings → Account shows Ask for a sign-in off, no password to change and no
 * Sign out, and switching it on with no account goes to make the account.
 * Skipped where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)";
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const HELPERS = `const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = id => document.getElementById(id);
  const shown = el => !!(el && el.offsetParent);`;

const SETUP = `(async () => { ${HELPERS}
  await until(() => shown($("setup")));
  const out = { path: location.pathname, offered: shown($("su-open")) };
  $("su-open").click();
  return out;
})()`;

const ACCOUNT = `(async () => { ${HELPERS}
  // The page's scripts take hold as it finishes loading: Settings asked for until it opens.
  await until(() => document.readyState === "complete" && $("settings-toggle"));
  const nav = () => shown(document.querySelector('.settings-nav-item[data-pane="account"]'));
  for (let i = 0; i < 40 && !nav(); i++) { $("settings-toggle").click(); await until(nav, 500); }
  document.querySelector('.settings-nav-item[data-pane="account"]').click();
  await until(() => $("acct-ask-note").textContent.length > 0);
  await until(() => document.querySelectorAll(".acct-device").length > 0);
  const out = { ask: $("acct-ask").checked, note: $("acct-ask-note").textContent, password: shown($("acct-pw-block")),
    signout: shown($("acct-signout")), devices: document.querySelectorAll(".acct-device").length };
  $("acct-ask").click();
  return out;
})()`;

async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* the page is on its way */ }
    if (Date.now() - t0 > ms) return null;
    await new Promise(r => setTimeout(r, 100));
  }
}

test("Use without an account, in a browser", { skip, timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-open-page-"));
  fs.mkdirSync(path.join(tmp, "music"));
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: path.join(tmp, "music"), dataDir: path.join(tmp, "data"), serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    let b = await Browser.launch({ width: 1280, height: 800 });
    try {
      const page = await b.page(B + "/");
      const setup = await page.eval(SETUP);
      assert.equal(setup.path, "/login", "a new install opens on its setup page");
      assert.equal(setup.offered, true, "with Use without an account");
      assert.ok(await until(async () => (await page.eval("location.pathname")) === "/"), "in, with no account");
      const acct = await page.eval(ACCOUNT);
      assert.equal(acct.ask, false, "Ask for a sign-in shows off");
      assert.match(acct.note, /^Off: anything on your home network or your Tailscale network/);
      assert.match(acct.note, /Switching it on makes the account first\.$/);
      assert.equal(acct.password, false, "no password to change without an account");
      assert.equal(acct.signout, false, "no Sign out while no sign-in is asked for");
      assert.equal(acct.devices, 1, "the browser is a device of its own");
      // Switched on with no account: off to make the account, without "Use without an account" this time.
      assert.ok(await until(async () => (await page.eval("location.pathname + location.search")).startsWith("/login?create=1")));
      const made = await until(async () => page.eval(`(() => { const s = document.getElementById("setup"); return s && s.offsetParent ? { open: !!document.getElementById("su-open").offsetParent } : null; })()`));
      assert.deepEqual(made, { open: false });
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }

    // Another browser at home: no sign-in page at all.
    b = await Browser.launch({ width: 1280, height: 800 });
    try {
      const page = await b.page(B + "/library");
      assert.equal(await page.eval("location.pathname"), "/library");
      assert.equal(await page.eval(`(async () => (await (await fetch("/api/auth/status")).json()).signed_in)()`), true);
    } finally { await b.close(); }
  } finally {
    await srv.stop();
  }
});
