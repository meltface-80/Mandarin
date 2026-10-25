"use strict";
/*
 * Toasts on a big screen (bug list item 162): on a 65" TV the toast's 14px
 * couldn't be read from the sofa. It follows the page's text size now (UI
 * Settings, --ui-menu), and on a screen 1600px wide or more it grows with
 * the width: twice its size at 1920px. A laptop's stays as it was. Skipped
 * where no Chromium or Chrome is found (test/browser-harness.js).
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = !findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)";
const PORT = ports.port();
const B = "http://127.0.0.1:" + PORT;

const MEASURE = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 400 && !window.__showToast; i++) await sleep(50);
  window.__showToast("Added to Listen later");
  const t = document.querySelector(".toast");
  const px = () => parseFloat(getComputedStyle(t).fontSize);
  const info = document.querySelector(".settings-info-toast");
  const out = { toast: px(), info: info ? parseFloat(getComputedStyle(info).fontSize) : null };
  document.documentElement.style.setProperty("--ui-menu", "1.5");
  out.larger = px();
  return out;
})()`;

test("toasts grow on a big screen and follow the page's text size", { skip, timeout: 120000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "musicd-toast-"));
  fs.mkdirSync(path.join(tmp, "music"));
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: path.join(tmp, "music"), dataDir: path.join(tmp, "data"), serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const at = async (width, height) => {
      const b = await Browser.launch({ width, height });
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
        return await page.eval(MEASURE);
      } finally { await b.close(); }
    };
    const laptop = await at(1280, 800);
    assert.equal(laptop.toast, 14, "a laptop's toast as it was");
    assert.equal(laptop.larger, 21, "the page's text size +50%");
    const tv = await at(1920, 1080);
    assert.ok(Math.abs(tv.toast - 28) < 0.5, `twice the size at 1920px: ${tv.toast}`);
    assert.ok(Math.abs(tv.larger - 42) < 0.75, `and the text size on top: ${tv.larger}`);
    if (tv.info != null) assert.ok(Math.abs(tv.info - 28) < 0.5, `the settings' info toast too: ${tv.info}`);
  } finally {
    await srv.stop();
  }
});
