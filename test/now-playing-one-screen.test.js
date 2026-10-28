"use strict";
/*
 * now-playing-one-screen.test.js — Now playing is one screen on a desktop and a
 * tablet held sideways, as on any other (item 217: item 216's three columns
 * weren't asked for; only the album view has them, item 214), in a browser,
 * Album One playing in a fake Sonos room: the cover, the playing track and its
 * transport, no columns, nothing of the album view's moved into it.
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

const DRIVER = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const until = async (f, what, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = f(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("not in time: " + what); await sleep(30); } };
  const $ = s => document.querySelector(s);
  await until(() => document.querySelector("#home-view .album"), "Home");
  const sel = $("#zone-select");
  const k = await until(() => [...sel.options].find(o => o.textContent.trim() === "Kitchen"), "Kitchen");
  sel.value = k.value; sel.dispatchEvent(new Event("change"));
  const np = await until(() => window.__getCurrentNp && window.__getCurrentNp() && window.__getCurrentNp().line3 === "Album One" && window.__getCurrentNp(), "Album One playing");
  window.__openAlbum({ title: np.line3, subtitle: np.line2, image_key: np.image_key }, { source: "now-playing" });
  const m = $("#album-modal");
  await until(() => !m.classList.contains("hidden") && m.classList.contains("np-mode"), "Now playing");
  await sleep(500);
  const shown = (s) => { const el = $(s); return !!el && el.getClientRects().length > 0; };
  return {
    classes: ["np-wide", "album-wide"].filter(c => m.classList.contains(c)),
    cols: document.querySelectorAll(".np-col, .aw-col").length,
    screen: shown("#np-screen"), transport: shown("#np-playpause"), art: shown("#album-modal .modal-art"),
  };
})()`;

test("Now playing is one screen on a desktop and a tablet held sideways, no columns (item 217)", { skip, timeout: 180000 }, async () => {
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

    for (const [w, h, touch] of [[1440, 900, false], [1180, 820, true]]) {
      const size = `${w}x${h}${touch ? "" : " (a mouse)"}`;
      const b = await Browser.launch({ width: w, height: h, mouse: !touch });
      let r;
      try {
        const page = await b.page(B + "/", { cookies: [{ name: "musicd_session", value: token, url: B }], touch });
        r = await page.eval(DRIVER);
        assert.deepEqual(page.errors, [], size);
      } finally { await b.close(); }
      assert.deepEqual(r.classes, [], size + ": neither Now playing's columns nor the album view's");
      assert.equal(r.cols, 0, size + ": no columns");
      assert.ok(r.art && r.screen && r.transport, `${size}: the cover, the playing track and its transport (${JSON.stringify(r)})`);
    }
  } finally { await srv.stop(); await house.stop(); }
});
