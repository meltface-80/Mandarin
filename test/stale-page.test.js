"use strict";
/*
 * The page doesn't go stale (v0.8.36). A phone that slept, or moved from
 * Wi-Fi to mobile data, can leave requests on connections that never answer;
 * the browser keeps only six to the server, so six of those and everything
 * after them waited too — the screen stale, nothing tapped doing anything,
 * until the app was closed and opened again. In a browser, with the
 * requests a dead connection would hold held for ever by the browser itself:
 *   - a request that never answers is given up (here after 1.5 s; 30 s for real);
 *   - coming back to the page lets go at once of the reads still waiting
 *     (not a write: its answer may be in already; it has its own limit);
 *   - failed requests don't each start another look at the server while a
 *     look hangs (the offline check), one look at a time;
 *   - hidden, the room list isn't asked for every 15 s; shown, it is at once.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { makeLibrary, haveFfmpeg } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The page shown and hidden as the phone does it (document.hidden, then visibilitychange).
const SHOW = (hidden) => `(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => ${hidden} });
  document.dispatchEvent(new Event("visibilitychange"));
})()`;

test("the page doesn't go stale when requests never answer", { skip, timeout: 120000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  t.after(() => srv.stop());
  const token = await signIn(B);
  for (let i = 0; i < 100; i++) {
    const st = await (await fetch(B + "/api/status", { headers: { Authorization: "Bearer " + token } })).json();
    if (st.index_count >= 3) break;
    await sleep(100);
  }
  const b = await Browser.launch({ width: 390, height: 844 });
  t.after(() => b.close());
  const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch: true,
    init: "window.__musicdRequestLimits = { read: 1500, other: 3000 };" });
  await page.eval(`(async () => {
    const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await new Promise(r => setTimeout(r, 50)); } };
    await until(() => document.querySelector("#home-view .album"));
  })()`);
  // From here: these held by the browser for ever, as a dead connection holds them; /api/queue fails at once.
  const asked = [];
  page.on((msg) => {
    if (msg.method !== "Fetch.requestPaused") return;
    const url = msg.params.request.url;
    asked.push(new URL(url).pathname);
    if (/\/api\/queue/.test(url)) page.send("Fetch.failRequest", { requestId: msg.params.requestId, errorReason: "ConnectionReset" }).catch(() => {});
  });
  await page.send("Fetch.enable", { patterns: ["/api/library-stats", "/api/status", "/api/zones", "/api/queue", "/api/settings/display"].map(p => ({ urlPattern: "*" + p + "*" })) });
  const count = (p) => asked.filter(x => x === p).length;

  await t.test("a request that never answers is given up", async () => {
    const r = await page.eval(`(async () => {
      const t0 = Date.now();
      try { await fetch("/api/library-stats"); return { answered: true }; } catch (e) { return { name: e.name, ms: Date.now() - t0 }; }
    })()`);
    assert.equal(r.name, "TimeoutError", JSON.stringify(r));
    assert.ok(r.ms >= 1400 && r.ms < 5000, "after its time: " + r.ms + " ms");
  });

  await t.test("coming back to the page lets go at once of what was still waiting", async () => {
    const r = await page.eval(`(async () => {
      window.__musicdRequestLimits.read = 60000;
      const waiting = fetch("/api/library-stats").then(() => "answered", (e) => e.name);
      await new Promise(r => setTimeout(r, 300));
      ${SHOW(true)};
      await new Promise(r => setTimeout(r, 100));
      ${SHOW(false)};
      const out = await Promise.race([waiting, new Promise(r => setTimeout(() => r("still waiting"), 2000))]);
      window.__musicdRequestLimits.read = 1500;
      return out;
    })()`);
    assert.equal(r, "AbortError");
  });

  await t.test("a write still waiting isn't let go on coming back (its answer may be in): it keeps its own limit", async () => {
    const r = await page.eval(`(async () => {
      const waiting = fetch("/api/settings/display", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(() => "answered", (e) => e.name);
      await new Promise(r => setTimeout(r, 300));
      ${SHOW(true)};
      await new Promise(r => setTimeout(r, 100));
      ${SHOW(false)};
      const early = await Promise.race([waiting, new Promise(r => setTimeout(() => r("still waiting"), 1000))]);
      return { early, late: await waiting };
    })()`);
    assert.equal(r.early, "still waiting", "not let go on coming back");
    assert.equal(r.late, "TimeoutError", "given up at its own limit");
  });

  await t.test("failed requests don't each start another look while one hangs", async () => {
    const before = count("/api/status");
    await page.eval(`(async () => {
      for (let i = 0; i < 4; i++) { await fetch("/api/queue?zone=x").catch(() => {}); await new Promise(r => setTimeout(r, 300)); }
    })()`);
    await sleep(300);
    assert.ok(count("/api/queue") >= 4, "the four failed");
    assert.ok(count("/api/status") - before <= 1, `one look at a time: ${count("/api/status") - before} asked`);
  });

  await t.test("hidden, the room list isn't asked for; shown again, it is at once", async () => {
    await page.eval(SHOW(true));
    const before = count("/api/zones");
    await sleep(16500);
    assert.equal(count("/api/zones"), before, "not while hidden");
    await page.eval(SHOW(false));
    await sleep(500);
    assert.ok(count("/api/zones") > before, "asked on coming back");
    assert.deepEqual(page.errors, []);
  });
});
