"use strict";
/*
 * The page's side of Mandarin's logs (item 389), in a browser:
 *   - an error the page throws and a promise it refuses, caught by no one, are sent to the server and kept in
 *     Logs/Web/MandarinWeb_log.txt under the browser's name (app/page-errors.js); the same error over and over is
 *     kept once;
 *   - Settings → Setup → Logs (app/settings-logs.js): the server's newest lines, narrowed by what they hold, and
 *     Download all logs, the zip.
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
  Promise.reject(new Error("refused on purpose"));
  await sleep(300);
  window.__sendPageErrors();
  return "sent";
})()`;

const LOGS = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(30); } };
  const shown = e => !!e && e.getClientRects().length > 0;
  document.getElementById("settings-toggle").click();
  for (const pane of ["setup", "logs"]) {
    const row = await until(() => [...document.querySelectorAll('#settings-overlay .settings-nav-item[data-pane="' + pane + '"]')].find(shown));
    if (!row) return { why: "no " + pane };
    row.click();
  }
  const out = document.getElementById("logs-lines");
  if (!(await until(() => /\\[auth\\] signed in/.test(out.textContent)))) return { why: "no lines: " + out.textContent };
  const all = out.textContent;
  const f = document.getElementById("logs-filter");
  f.value = "nothing holds this";
  f.dispatchEvent(new Event("input"));
  const none = out.textContent;
  return { all, none, about: document.getElementById("logs-about").textContent, href: document.getElementById("logs-download").getAttribute("href") };
})()`;

test("the page's errors in the server's logs, and Settings → Logs", { skip, timeout: 120000 }, async () => {
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
      const file = path.join(lib.data, "Logs", "Web", "MandarinWeb_log.txt");
      const t0 = Date.now();
      while (!(fs.existsSync(file) && /refused on purpose/.test(fs.readFileSync(file, "utf8"))) && Date.now() - t0 < 10000) await new Promise(r => setTimeout(r, 100));
      const web = fs.readFileSync(file, "utf8");
      assert.match(web, /UTC {2}ERROR {2}\[[^\]]*Chrom[^\]]*\] \[page\] Error: thrown on purpose/, web);
      assert.match(web, /\[page\] a promise refused with no one to hear it: Error: refused on purpose/, web);
      assert.equal((web.match(/thrown on purpose/g) || []).length, 1, "the same error kept once: " + web);

      const r = await page.eval(LOGS);
      assert.ok(!r.why, r.why);
      assert.match(r.all, /UTC {2}INFO {3}\[auth\] signed in/);
      assert.equal(r.none, "No lines here.");
      assert.match(r.about, /keeps a log always/);
      assert.equal(r.href, "/api/diagnostics/zip");
    } finally { await b.close(); }
  } finally { await srv.stop(); }
});
