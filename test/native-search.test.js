"use strict";
/*
 * The Android app's native Search (the Search group of
 * docs/specs/plan-android-native.md, bug list item 61; a preview), as the page
 * hands it over (public/app/native-search.js): with the app's Search on, the
 * glass and the row's Search open the app's (MusicdApp.openSearch, with the
 * words, the UI Settings and the room) in place of the page's field, as does a
 * search seeded elsewhere; off, offline or in a browser, the page's own. What
 * the native Search hands back (public/app/native-handoff.js): a service's
 * artist in that service's browser, a Pitchfork review in the magazine. And
 * the search's services and reviews against the screens contract, as
 * test/parity.test.js holds its library half: Qobuz and Pitchfork answering
 * from fakes on loopback. Skipped where no Chromium or Chrome is found.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { started, until } = require("./helpers");
const { Browser, findBrowser } = require("./browser-harness");
const { built } = require("./server");
const { FakeQobuz } = require("./fake-qobuz");
const { FakeWeb } = require("./fake-web");
const { CHECK } = require("./parity-check");
const contract = require("../docs/specs/screens.json");

const skip = built() || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");

const KIT = `
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (fn, ms = 10000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(50); } return true; };
  const shown = (el) => !!el && !el.classList.contains("hidden") && getComputedStyle(el).display !== "none" && el.getClientRects().length > 0;
  const $ = (s) => document.querySelector(s);
  await until(() => document.querySelectorAll("#home-library .album").length > 1, 20000);
  await sleep(500);`;

// Before the page's scripts: the app's bridge, whether it draws the search itself ([on]), and what it was asked to open.
const bridge = (on) => `window.MusicdApp = { on: ${on ? "true" : "false"}, opened: [],
  nativeSearch() { return this.on; }, setNativeSearch() {}, openSearch(q, prefs, zone) { this.opened.push([q, JSON.parse(prefs).layout, zone]); },
  nativeNowPlaying() { return false; }, setNativeNowPlaying() {}, openNowPlaying() {}, nativeAlbum() { return false; }, setNativeAlbum() {},
  nativeLibrary() { return false; }, setNativeLibrary() {} };`;

/* The row's Search, then a search seeded: what the app was asked to open, and whether the page's field opened. */
const OPENED = `(async () => { ${KIT}
  $("#tnav-search").click(); await sleep(400);
  const fieldOpen = $("#topbar-search").classList.contains("is-open");
  window.__runSearch("Artist A"); await sleep(300);
  return { opened: window.MusicdApp ? window.MusicdApp.opened : null, fieldOpen, typed: $("#search-input").value };
})()`;

/* What the native Search hands back: a service's artist (the Qobuz browser), a review (the magazine). */
const HANDOFF = `(async () => { ${KIT}
  const out = { bad: window.__musicdNative("service-artist", "{"), none: window.__musicdNative("service-artist", JSON.stringify({ service: "nowhere", id: "1" })) };
  out.artist = window.__musicdNative("service-artist", JSON.stringify({ service: "qobuz", id: "1", name: "Q Artist" }));
  out.qobuz = await until(() => shown($("#qobuz-overlay")));
  $("#qobuz-overlay-close").click(); await until(() => !shown($("#qobuz-overlay")));
  out.review = window.__musicdNative("review", JSON.stringify({ url: "https://pitchfork.com/reviews/albums/artist-a-album-one/", album: "Album One", artist: "Artist A" }));
  out.pitchfork = await until(() => shown($("#pitchfork-overlay")));
  return out;
})()`;

/* The search's services and reviews: the row's Search, "artist" typed, Qobuz's and Pitchfork's sections waited for. */
const SERVICES = `(async () => { ${KIT}
  $("#tnav-search").click();
  await until(() => $("#topbar-search").classList.contains("is-open"));
  const f = $("#search-input"); f.value = "artist"; f.dispatchEvent(new Event("input", { bubbles: true }));
  const up = await until(() => $(".ext-search-wrap .qobuz-tile") && $(".ext-search-wrap .qobuz-artist-chip") && $(".ext-search-wrap .ext-search-row") && $("#album-grid > .album"), 20000);
  await sleep(800);
  return up ? "open" : "no sections: " + [...document.querySelectorAll(".search-section-header")].map(h => h.textContent).join(", ");
})()`;

test("the app's native Search: opened in place of the page's, and what it hands back; the services' sections keep the contract", { skip, timeout: 240000 }, async (t) => {
  const lib = require("./fixtures").makeLibrary();
  const qobuz = new FakeQobuz({ art: path.join(lib.music, "Artist A", "Album One", "cover.jpg"), albums: [
    { id: 1001, title: "Q Album", artist: "Q Artist", year: 2021, rate: 96000, bits: 24, tracks: [{ id: 5001, title: "Q Song", file: path.join(lib.music, "Artist A", "Album One", "01 Song 1.flac"), duration: 3 }] }
  ] });
  const web = new FakeWeb({
    "/reviews/albums/": "<html>Access denied</html>",
    "/feed/feed-album-reviews/rss": `<rss><channel><item><title><![CDATA[Album One]]></title><link>https://pitchfork.com/reviews/albums/artist-a-album-one/</link>` +
      `<pubDate>Wed, 07 Oct 2026 10:00:00 +0000</pubDate></item></channel></rss>`,
    "/reviews/best/albums/": "<html><script>window.__PRELOADED_STATE__ = " + JSON.stringify({ transformed: { list: [
      { contentType: "review", url: "/reviews/albums/artist-b-hi-res/", ratingValue: { score: 9.1, isBestNewMusic: true }, dangerousHed: "<em>Hi Res</em>",
        subHed: { name: "Artist B" }, pubDate: "2026-10-01T10:00:00.000Z" }] } }) + ";</script></html>"
  });
  await Promise.all([qobuz.start(), web.start()]);
  t.after(() => Promise.all([qobuz.stop(), web.stop()]));
  const { base, token, api } = await started(t, { qobuzBaseUrl: qobuz.base, qobuzSyncDelayMs: 100000, pitchforkBaseUrl: web.base });
  const signed = await fetch(base + "/api/settings/qobuz/signin", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ username: "tester@example.com", password: "pw" }) });
  assert.equal(signed.status, 200, "signed in to the fake Qobuz");
  await until(async () => (await api("settings/qobuz")).json.connected, 10000, "Qobuz connected");
  const b = await Browser.launch({ width: 412, height: 915 });
  t.after(() => b.close());
  const cookies = [{ name: "musicd_session", value: token, url: base }];
  const page = async (init) => b.page(base + "/", { cookies, touch: true, init: init || "" });
  const run = async (js, init) => {
    const p = await page(init);
    const r = await p.eval(js);
    assert.deepEqual(p.errors, [], "nothing thrown");
    return r;
  };

  await t.test("on: the row's Search and a seeded search open the app's, not the page's field", async () => {
    const r = await run(OPENED, bridge(true));
    assert.deepEqual(r.opened, [["", "auto", ""], ["Artist A", "auto", ""]]);
    assert.equal(r.fieldOpen, false, "the page's field stays shut");
  });

  await t.test("off, offline, or a browser: the page's own search", async () => {
    for (const init of [bridge(false), "window.__musicdOffline = true;" + bridge(true), ""]) {
      const r = await run(OPENED, init);
      assert.deepEqual(r.opened || [], [], init.slice(0, 40));
      assert.equal(r.fieldOpen, true, "the page's field opens");
      assert.equal(r.typed, "Artist A", "and takes the seeded words");
    }
  });

  await t.test("handed back: a service's artist in its browser, a review in the magazine", async () => {
    const r = await run(HANDOFF, bridge(true));
    assert.deepEqual(r, { bad: false, none: false, artist: true, qobuz: true, review: true, pitchfork: true });
  });

  await t.test("the services' and the reviews' sections keep the screens contract", async () => {
    const p = await page();
    assert.equal(await p.eval(SERVICES), "open");
    const wrong = await p.eval(CHECK("search", contract.screens.search.items, "body", ["mini-player", "nav"]));
    assert.deepEqual(wrong, [], "the page and the contract differ:\n  " + wrong.join("\n  "));
    assert.deepEqual(p.errors, [], "nothing thrown");
  });
});
