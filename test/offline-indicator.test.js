"use strict";
/*
 * Offline: when the Android app answers for a server it can't reach (or
 * its Offline mode is on), /api/status says so (offline, offline_mode); in
 * a browser, /api/status doesn't answer at all. The page no longer writes a
 * notice across the top of the screen; a symbol sits in the top bar between
 * the menu and the search, and a tap on it says what the matter is: the
 * server can't be reached, or Offline mode is on (with the app's switch to
 * turn it off).
 *
 * The app is stood in for: its /api/status answer and its MusicdDownloads
 * bridge; a server gone away, by every /api request failing in the page. Skipped
 * where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert/strict");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");

const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

// Before the page's scripts: /api/status as the app answers it offline, and
// (Offline mode) the app's bridge, with every setting it is given written down.
const init = (offline, bridge) => `(() => {
  const extra = ${JSON.stringify(offline)};
  const real = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (url.pathname.startsWith("/api/") && window.__down) throw new TypeError("Failed to fetch");
    const r = await real(input, init);
    if (url.pathname !== "/api/status" || !extra) return r;
    const j = Object.assign(await r.json(), extra);
    return new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  ${bridge ? `window.__set = [];
  window.MusicdDownloads = { settings: () => JSON.stringify({ offlineMode: true }), set: (k, v) => window.__set.push([k, v]) };` : ""}
})();`;

const LOOK = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, ms = 8000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const $ = id => document.getElementById(id);
  const shown = el => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
  await until(() => document.querySelector("#home-view .album"));
  await sleep(1500);   // the status has been read
  const notice = $("server-notice");
  const out = { notice: shown(notice) ? notice.textContent : "", btn: shown($("offline-btn")) };
  if (!out.btn) return out;
  const box = el => el.getBoundingClientRect();
  out.between = box($("menu-toggle")).right <= box($("offline-btn")).left && box($("offline-btn")).right <= box($("search-open")).left;
  out.order = [...$("offline-btn").parentElement.children].filter(shown).map(e => e.id).slice(0, 3);
  out.label = $("offline-btn").getAttribute("aria-label");
  $("offline-btn").click();
  out.popup = shown($("offline-overlay"));
  out.title = $("offline-title").textContent;
  out.text = [...$("offline-text").querySelectorAll("p")].map(p => p.textContent);
  out.switch = shown($("offline-switch"));
  out.focus = document.activeElement && document.activeElement.id;
  if (out.switch) {
    $("offline-switch").click();
    out.set = window.__set;
  } else {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(100);
    out.menuOpen = shown($("menu-overlay"));
  }
  out.closed = !shown($("offline-overlay"));
  return out;
})()`;

test("offline: a symbol in the top bar, not a notice; a tap says what the matter is", { skip: (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)"), timeout: 180000 }, async (t) => {
  const lib = makeLibrary();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [], upnpMulticast: false, identify: false });
  await srv.start();
  const b = await Browser.launch({ width: 390, height: 844 });
  try {
    const token = await signIn(B);
    const H = { Authorization: "Bearer " + token };
    for (let i = 0; i < 100 && (await (await fetch(B + "/api/status", { headers: H })).json()).index_count < 3; i++) await new Promise(r => setTimeout(r, 100));
    const look = async (offline, bridge) => {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init: init(offline, bridge) });
      const r = await page.eval(LOOK);
      r.errors = page.errors;
      return r;
    };

    await t.test("online: no symbol", async () => {
      const r = await look(null);
      assert.equal(r.btn, false);
      assert.doesNotMatch(r.notice, /offline|can.t be reached/i);
    });

    await t.test("the server can't be reached: the symbol between the menu and the search, and why", async () => {
      const r = await look({ offline: true, offline_mode: false });
      assert.equal(r.notice, "", "no notice across the top of the page");
      assert.equal(r.btn, true);
      assert.equal(r.between, true, "between the menu button and the magnifying glass");
      assert.deepEqual(r.order, ["menu-toggle", "offline-btn", "topbar-search"]);
      assert.equal(r.label, "Mandarin can't be reached — tap for more");
      assert.equal(r.popup, true);
      assert.equal(r.title, "Mandarin can’t be reached");
      assert.equal(r.text.length, 3);
      assert.match(r.text[0], /can’t reach the Mandarin server/);
      assert.match(r.text[1], /comes back by itself/);
      assert.equal(r.switch, false, "nothing to switch: it isn't Offline mode");
      assert.equal(r.focus, "offline-close");
      assert.equal(r.closed, true, "Escape closes it");
      assert.equal(r.menuOpen, false);
      assert.deepEqual(r.errors, []);
    });

    await t.test("Offline mode: said so, with the app's switch to turn it off", async () => {
      const r = await look({ offline: true, offline_mode: true }, true);
      assert.equal(r.notice, "");
      assert.equal(r.btn, true);
      assert.equal(r.label, "Offline mode is on — tap for more");
      assert.equal(r.title, "Offline mode is on");
      assert.match(r.text[0], /You switched Offline mode on/);
      assert.equal(r.switch, true);
      assert.deepEqual(r.set, [["offlineMode", "false"]], "the app is told to switch it off");
      assert.equal(r.closed, true);
      assert.deepEqual(r.errors, []);
    });

    await t.test("a browser that can't reach the server: the symbol in seconds (not at the next minute's look), and gone when it answers", async () => {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], init: init(null) });
      const r = await page.eval(`(async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const until = async (f, ms) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) return false; await sleep(100); } return Date.now() - t0; };
        const $ = id => document.getElementById(id);
        const shown = el => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none";
        await until(() => document.querySelector("#home-view .album"), 8000);
        // A request of the page's own that finds no server (the zones are
        // asked for every 15 s) starts the looks at once; they run every 5 s
        // while it is away. The first one missed is a blip, three in a row
        // are news: the symbol within ~25 s, never inside 10.
        window.__down = true;
        await sleep(6000);
        const out = { early: shown($("offline-btn")) };
        out.after = await until(() => shown($("offline-btn")), 30000);
        out.notice = shown($("server-notice")) ? $("server-notice").textContent : "";
        $("offline-btn").click();
        out.title = $("offline-title").textContent;
        out.text = [...$("offline-text").querySelectorAll("p")].map(p => p.textContent);
        out.switch = shown($("offline-switch"));
        window.__down = false;
        out.back = await until(() => !shown($("offline-btn")), 20000);
        out.popupClosed = !shown($("offline-overlay"));
        return out;
      })()`);
      assert.equal(r.early, false, "not for a moment's blip");
      assert.ok(r.after, "the symbol never came");
      assert.equal(r.notice, "", "no notice across the top of the page");
      assert.equal(r.title, "Mandarin can’t be reached");
      assert.match(r.text[0], /This device can’t reach the Mandarin server/);
      assert.match(r.text[2], /container is up/);
      assert.equal(r.switch, false);
      assert.ok(r.back, "the symbol stayed after the server answered");
      assert.equal(r.popupClosed, true, "and its popup with it");
      assert.deepEqual(page.errors, []);
    });
  } finally {
    await b.close();
    await srv.stop();
  }
});
