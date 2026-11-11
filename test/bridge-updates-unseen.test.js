"use strict";
/*
 * Settings → Updates' Mandarin Bridges list is asked again every 3 s while an update is under way on one (downloading,
 * or waiting to be finished on the device), and each ask has the server ask every Bridge. Every page open asked it,
 * Settings closed or the tab in the background, for as long as an update waited: a day, where an Android Bridge's
 * update waited on its owner. Now it is asked again only while the list can be seen.
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

// The server's answer stood in for: one Bridge, its update downloading. Each ask counted.
const INIT = `(() => {
  const real = window.fetch.bind(window);
  window.__bridgeAsks = 0;
  window.fetch = (u, o) => {
    if (String(u).includes("/api/update/bridges") && !String(u).includes("/apply")) {
      window.__bridgeAsks++;
      return Promise.resolve(new Response(JSON.stringify({ bridges: [{ id: "pi", name: "Kitchen Pi", version: "0.3.7", update: { state: "downloading" } }] }), { headers: { "Content-Type": "application/json" } }));
    }
    return real(u, o);
  };
})();`;

test("the Bridges' updates are asked again only while Settings → Updates can be seen", { skip, timeout: 90000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("./server");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  const b = await Browser.launch();
  t.after(() => b.close());
  const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init: INIT });
  const asks = async () => Number(await page.eval("window.__bridgeAsks"));
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Settings closed: asked as the page starts, then not again.
  await wait(1500);
  const first = await asks();
  assert.ok(first >= 1, "asked as the page starts");
  await wait(7000);
  assert.equal(await asks(), first, "not asked again while Settings is closed");

  // Settings → Updates open: asked at once, and every few seconds while the update goes on.
  await page.eval(`window.__openSettingsPane("system"), true`);
  await wait(7500);
  assert.ok(await asks() >= first + 3, "asked again and again while it can be seen: " + (await asks()));
});
