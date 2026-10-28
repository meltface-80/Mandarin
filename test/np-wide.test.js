"use strict";
/*
 * np-wide.test.js — Now playing in three columns (item 216; the owner chose
 * "the same" as the album view's, item 214; public/app/np-wide.js), in a
 * browser, Album One playing in a fake Sonos room:
 *   - a desktop and a tablet held sideways: on the left the cover over the
 *     playing track, its progress and transport; in the middle About this
 *     album and about its artist, fitted to the screen with Read more; on the
 *     right the playing album's tracks, the one playing lit, a tap playing
 *     from it;
 *   - the Queue tab, a tablet upright and a phone: as before, no columns.
 * Skipped where no Chromium or Chrome is found.
 */
const ports = require("./ports");
const test = require("node:test");
const assert = require("node:assert");
const { haveFfmpeg, makeLibrary } = require("./fixtures");
const { signIn } = require("./auth-helper");
const { Browser, findBrowser } = require("./browser-harness");
const { FakeHousehold } = require("./fake-sonos");

const skip = (!haveFfmpeg() && "ffmpeg is not installed") || (!findBrowser() && !process.env.CI && "no Chromium or Chrome (set CHROME_PATH)");
const PORT = ports.port(), B = "http://127.0.0.1:" + PORT;

// The album's review and its artist's biography as their sources would give them (nothing leaves this machine in a test);
// what the page asks to play, kept.
const REVIEW = "Album One is the first album by Artist A, recorded over a wet summer in a converted chapel. ".repeat(14);
const BIO = "Artist A is a singer and songwriter whose records mix soul, jazz and the odd drum machine. ".repeat(18);
const STUB = `(() => { const real = window.fetch.bind(window);
  const ok = (j) => Promise.resolve(new Response(JSON.stringify(j), { status: 200, headers: { "Content-Type": "application/json" } }));
  window.__played = [];
  window.fetch = (u, o) => { const s = String(u);
    if (s.includes("/api/album/extras")) return ok({ album: { description: ${JSON.stringify(REVIEW)}, source: "Wikipedia", url: "https://en.wikipedia.org/wiki/Album_One" } });
    if (s.includes("/api/artist-bio")) return ok({ bio: { text: ${JSON.stringify(BIO)}, source: "Wikipedia" } });
    if (s.includes("/api/play-track")) { window.__played.push(JSON.parse(o.body)); return ok({ action: "play_now" }); }
    return real(u, o); }; })();`;

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, what, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("not in time: " + what); await sleep(30); } };
  const $ = s => document.querySelector(s);
  const box = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  await until(() => document.querySelector("#home-view .album"), "Home");
  const sel = $("#zone-select");
  const k = await until(() => [...sel.options].find(o => o.textContent.trim() === "Kitchen"), "Kitchen");
  sel.value = k.value; sel.dispatchEvent(new Event("change"));
  const np = await until(() => window.__getCurrentNp && window.__getCurrentNp() && window.__getCurrentNp().line3 === "Album One" && window.__getCurrentNp(), "Album One playing");
  window.__openAlbum({ title: np.line3, subtitle: np.line2, image_key: np.image_key }, { source: "now-playing" });
  const m = $("#album-modal");
  await until(() => !m.classList.contains("hidden") && m.classList.contains("np-mode"), "Now playing");
  await sleep(300);
  const out = { wide: m.classList.contains("np-wide") };
  if (!out.wide) { out.cols = document.querySelectorAll(".np-col").length; return out; }
  await until(() => document.querySelectorAll("#np-tracks li").length === 3, "the playing album's tracks");
  await until(() => !$("#np-about").classList.contains("hidden") && !$("#np-artist").classList.contains("hidden"), "the review and the biography");
  const mid = $(".np-col.np-mid"), right = $(".np-col.np-right");
  const reads = () => [...mid.querySelectorAll(".aw-read")].map(b => b.classList.contains("hidden") ? "" : b.textContent);
  await until(() => reads().join() === "Read more,Read more", "Read more under both");
  out.art = box($("#album-modal .modal-art")); out.info = box($("#np-screen")); out.mid = box(mid); out.right = box(right);
  out.transport = !!$("#np-playpause") && $("#np-playpause").getClientRects().length > 0;
  out.titles = [...document.querySelectorAll("#np-tracks li .t-title")].map(t => t.textContent);
  out.lit = [...document.querySelectorAll("#np-tracks li")].map(li => li.classList.contains("is-now-track"));
  out.playingTitle = np.line1;
  out.head = $("#np-tracks-head").textContent;
  out.artistHead = $("#np-artist .section-label").textContent;
  out.fits = mid.scrollHeight <= mid.clientHeight + 1;
  mid.querySelector(".aw-read").click();
  await until(() => reads().join() === "Read less,Read less", "Read less");
  out.reading = mid.scrollHeight > mid.clientHeight;
  // A tap on the second track plays from it, in this zone.
  document.querySelectorAll("#np-tracks li")[1].click();
  await until(() => window.__played.length, "the tap played");
  out.played = window.__played[0];
  out.zone = k.value;
  // The Queue tab: no columns.
  document.querySelector('.modal-tab[data-tab="queue"]').click();
  await sleep(100);
  out.queueWide = m.classList.contains("np-wide") || document.querySelectorAll(".np-col").length > 0;
  return out;
})()`;

test("Now playing in three columns on a desktop and a tablet held sideways, the playing album's tracks lit; as before elsewhere (item 216)", { skip, timeout: 240000 }, async () => {
  const lib = makeLibrary();
  const house = new FakeHousehold();
  await house.start();
  const { createServer } = require("./server");
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

    for (const [w, h, touch, wide] of [[1440, 900, false, true], [1180, 820, true, true], [820, 1180, true, false], [390, 844, true, false]]) {
      const size = `${w}x${h}${touch ? "" : " (a mouse)"}`;
      const b = await Browser.launch({ width: w, height: h, mouse: !touch });
      let r;
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch, init: STUB });
        r = await page.eval(DRIVER);
        assert.deepEqual(page.errors, [], size);
      } finally { await b.close(); }
      assert.equal(r.wide, wide, `${size}: ${wide ? "three columns" : "as before"}`);
      if (!wide) { assert.equal(r.cols, 0, size + ": no columns"); continue; }
      assert.ok(r.info.t >= r.art.b - 1 && r.info.r <= r.mid.l + 1, `${size}: the track and its transport under the cover, on the left (art ${JSON.stringify(r.art)}, info ${JSON.stringify(r.info)})`);
      assert.ok(r.transport, size + ": its transport there");
      assert.ok(r.art.r <= r.mid.l + 1 && r.mid.r <= r.right.l + 1 && r.right.r <= w, `${size}: three across (${JSON.stringify([r.art, r.mid, r.right])})`);
      assert.deepEqual(r.titles, ["Song 1", "Song 2", "Song 3"], size + ": the playing album's tracks");
      assert.deepEqual(r.lit, r.titles.map(t => t === r.playingTitle), `${size}: the one playing lit (${r.playingTitle})`);
      assert.equal(r.head, "Album One", size + ": the album named over its tracks");
      assert.equal(r.artistHead, "About Artist A");
      assert.ok(r.fits, size + ": the middle fitted to the screen");
      assert.ok(r.reading, size + ": Read more opens the whole of both, scrolling");
      assert.equal(r.played.track, 1, size + ": the tapped track played");
      assert.equal(r.played.title, "Song 2");
      assert.equal(r.played.zone_or_output_id, r.zone, size + ": in the zone playing");
      assert.equal(r.queueWide, false, size + ": the Queue tab as before");
    }
  } finally { await srv.stop(); await house.stop(); }
});
