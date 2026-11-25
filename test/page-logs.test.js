"use strict";
/*
 * The page's side of Mandarin's one log (items 389, 425), in a browser:
 *   - an error the page throws and a promise it refuses, caught by no one, are sent to the server and kept in the one
 *     log, <data>/Logs/Mandarin_log.txt, as "[web <the browser's name>]" (app/page-errors.js); the same error over and
 *     over is kept once; an error whose stack doesn't say what it was (Safari's: only where, item 538) is kept with its
 *     name and message before the stack;
 *   - no Logs in Settings → Setup: the log is read where it is kept (on Mandarin OS, the shared folder's Logs).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

const THROW = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  if (!(await until(() => document.querySelector("#home-view .album")))) return "no home";
  for (let i = 0; i < 5; i++) setTimeout(() => { throw new Error("thrown on purpose"); }, 0);
  // As Safari's: the stack only where it was thrown, its name and message left out.
  setTimeout(() => {
    const e = new ReferenceError("Cannot access uninitialized variable.");
    Object.defineProperty(e, "stack", { value: "paintSize@http://box/app.js:6619:23\\nglobal code@http://box/app.js:6688:12" });
    throw e;
  }, 0);
  Promise.reject(new Error("refused on purpose"));
  await sleep(300);
  window.__sendPageErrors();
  return "sent";
})()`;

const SETUP = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  const shown = e => !!e && e.getClientRects().length > 0;
  document.getElementById("settings-toggle").click();
  const row = await until(() => [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="setup"]')].find(shown));
  if (!row) return { why: "no setup" };
  row.click();
  // Setup's last row (Away from home since item 494's API Keys went): the list drawn.
  if (!await until(() => [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="away"]')].find(shown))) return { why: "no Away from home" };
  return { logs: document.querySelectorAll('[data-pane="logs"], #logs-lines, #logs-download').length };
})()`;

test("the page's errors in the one log, and no Logs in Settings", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const b = await Browser.launch({ width: 1280, height: 900 });
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      assert.equal(await page.eval(THROW), "sent");
      const file = path.join(lib.data, "Logs", "Mandarin_log.txt");
      const t0 = Date.now();
      while (!(fs.existsSync(file) && /refused on purpose/.test(fs.readFileSync(file, "utf8"))) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 100));
      const web = fs.readFileSync(file, "utf8");
      assert.match(web, /UTC {2}ERROR {2}\[web [^\]]*Chrom[^\]]*\] \[page\] Error: thrown on purpose/, web);
      assert.match(web, /\[page\] a promise refused with no one to hear it: Error: refused on purpose/, web);
      assert.equal((web.match(/thrown on purpose/g) || []).length, 1, "the same error kept once: " + web);
      assert.match(web, /\[page\] ReferenceError: Cannot access uninitialized variable\.\n[^\n]*paintSize@http:\/\/box\/app\.js:6619:23/, "Safari's error with what it was: " + web);

      const r = await page.eval(SETUP);
      assert.ok(!r.why, r.why);
      assert.equal(r.logs, 0, "no Logs page, row or download");
    } finally { await b.close(); }
  } finally { await srv.stop(); }
});
