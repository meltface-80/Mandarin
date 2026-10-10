"use strict";
/*
 * Opening the share card (v0.7.6): the card is drawn from what the page
 * already has, and only then are the three acts asked for.
 *
 * What used to make a card slow, each caught here so it stays gone:
 *  - the cover at a size nothing else used (1000 → the server's 1200 px
 *    step): a render on the server and a download for every first share.
 *    The card now asks for the 800 px address Now playing and the album page
 *    show, so it is the browser's copy;
 *  - the duck tile as a 900 KB PNG;
 *  - a wordmark the card doesn't carry, which loadImage(null) turned into a
 *    request for "/null" — the whole app page, on every draw.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { FakeHousehold } = require("./fake-sonos");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const $ = id => document.getElementById(id);
  const until = async (f, ms = 15000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(10); } };
  const out = { requests: [] };
  // Every request the share makes, in order, with the moment the card appeared.
  const seen = new PerformanceObserver(list => { for (const e of list.getEntries()) out.requests.push({ at: e.startTime, url: e.name.replace(location.origin, "").split("?")[0] + (e.name.includes("?") ? "?" + e.name.split("?")[1] : "") }); });
  seen.observe({ type: "resource", buffered: false });
  await until(() => document.querySelector("#home-view .album"));
  const sel = $("zone-select");
  const k = await until(() => [...sel.options].find(o => o.textContent.trim() === "Kitchen"), 20000);
  sel.value = k.value; sel.dispatchEvent(new Event("change"));
  await until(() => window.__getCurrentNp && window.__getCurrentNp() && window.__getCurrentNp().line3 === "Album One", 20000);
  const np = window.__getCurrentNp();
  // Now playing, as the mini transport opens it.
  window.__openAlbum({ title: np.line3, subtitle: np.line2, image_key: np.image_key }, { source: "now-playing" });
  await until(() => !$("album-modal").classList.contains("hidden") && $("album-modal").classList.contains("np-mode"));
  await until(() => $("modal-img") && $("modal-img").complete && $("modal-img").naturalWidth > 0, 15000);
  out.np_art = $("modal-img") ? $("modal-img").getAttribute("src") : null;
  await sleep(300);
  out.requests.length = 0;
  const t0 = performance.now();
  // The moment the card lands, to the microtask (a poll would be late by its tick).
  const landed = new Promise(ok => new MutationObserver((m, o) => { const i = $("share-frame").querySelector("img"); if (i) { o.disconnect(); ok({ img: i, at: performance.now() }); } }).observe($("share-frame"), { childList: true, subtree: true }));
  $("modal-share-btn").click();
  const { img, at } = await Promise.race([landed, sleep(30000).then(() => ({ img: null, at: 0 }))]);
  out.card_at = at;
  out.card_ms = Math.round(out.card_at - t0);
  await until(() => out.requests.some(r => r.url.startsWith("/api/similar")), 8000);
  await sleep(500);
  out.card_src = img ? img.src.slice(0, 5) : null;
  return out;
})()`;

test("the share card is drawn from the page's own cover and tile, and the suggestions are asked for after it", { skip, timeout: 120000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("../index.js");
  const srv = createServer({ port: PORT, musicDir: lib.music, dataDir: lib.data, serverIp: "127.0.0.1", sonosHosts: [ports.host(0)], upnpMulticast: false, identify: false });
  await srv.start();
  try {
    const token = await signIn(B);
    const H = { headers: { Authorization: "Bearer " + token } };
    for (let i = 0; i < 100; i++) { const st = await (await fetch(B + "/api/status", H)).json(); if (st.index_count === 3) break; await new Promise(r => setTimeout(r, 100)); }
    let zones = [];
    for (let i = 0; i < 150; i++) { const z = await (await fetch(B + "/api/zones", H)).json(); zones = z.zones || []; if (zones.some(x => x.display_name === "Kitchen")) break; await new Promise(r => setTimeout(r, 100)); }
    const kitchen = zones.find(z => z.display_name === "Kitchen");
    const albums = (await (await fetch(B + "/api/library/albums?sort=album", H)).json()).albums;
    const cd = albums.find(a => a.title === "Album One");
    await fetch(B + "/api/play", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, H.headers), body: JSON.stringify({ offset: cd.offset, zone_or_output_id: kitchen.zone_id, kind: "play_now" }) });
    for (let i = 0; i < 50 && house.room("Kitchen").queue.length !== 3; i++) await new Promise(r => setTimeout(r, 100));

    const b = await Browser.launch({ width: 390, height: 844 });
    let r;
    try {
      const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }] });
      r = await page.eval(DRIVER);
      assert.deepEqual(page.errors, []);
    } finally { await b.close(); }
    assert.equal(r.card_src, "blob:", "the card is on screen");
    const urls = r.requests.map(x => x.url);
    const covers = urls.filter(u => u.startsWith("/api/image/"));
    assert.ok(covers.length >= 1, "the card asked for the cover: " + urls.join(" "));
    for (const u of covers) assert.equal(u, r.np_art, "the card's cover is Now playing's own picture (the browser's copy), not a size of its own");
    assert.ok(!urls.some(u => u === "/null" || u.startsWith("/null?")), "no request for a wordmark the card doesn't carry: " + urls.join(" "));
    // The server rendered nothing new for it: only the 800 px step is on disk.
    const sizes = fs.readdirSync(path.join(lib.data, "art")).filter(f => f.startsWith(cd.image_key)).map(f => f.split("@")[1]);
    assert.ok(!sizes.includes("1200.jpg"), "no 1200 px render for the card: " + sizes.join(" "));
    // Then, and only then, the three acts.
    const similar = r.requests.find(x => x.url.startsWith("/api/similar"));
    assert.ok(similar, "the suggestions were asked for: " + urls.join(" "));
    assert.ok(similar.at >= r.card_at - 1, `the suggestions were asked for after the card was on screen (card at ${Math.round(r.card_at)}, asked at ${Math.round(similar.at)})`);
  } finally { await srv.stop(); await house.stop(); }
});

test("the duck tile is a small file", () => {
  const st = fs.statSync(path.join(__dirname, "..", "public", "icons", "duck-tile.png"));
  assert.ok(st.size < 120 * 1024, "the tile is drawn at 96 px; it was a 900 KB PNG once: " + st.size);
});
